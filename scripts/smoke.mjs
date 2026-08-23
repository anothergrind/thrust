#!/usr/bin/env node
/**
 * Scaffolds a project, installs it, starts `npm run dev` and checks that the
 * result actually boots: GET /api/health answers {"status":"ok"}, the frontend
 * serves its page, and the backend's CORS headers allow the frontend's origin.
 *
 * That last check stands in for "the browser fetch works" — no browser runs
 * here, so the request the page would make is replayed with the same Origin
 * header instead. CORS is the part that silently breaks when the three
 * templates drift apart.
 *
 *   node scripts/smoke.mjs                    every stack, one after another
 *   node scripts/smoke.mjs --stack=python     just one
 *   node scripts/smoke.mjs --keep             leave the generated project behind
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "dist", "index.js");
const isWindows = process.platform === "win32";
const NPM = isWindows ? "npm.cmd" : "npm";

const ALL_STACKS = ["typescript", "python", "springboot"];

/** Spring Boot downloads Maven and a dependency tree on first run. */
const BOOT_TIMEOUT_MS = { typescript: 180_000, python: 180_000, springboot: 600_000 };
const INSTALL_TIMEOUT_MS = { typescript: 600_000, python: 600_000, springboot: 900_000 };

function parseArgs(argv) {
  const stacks = [];
  let keep = false;
  for (const arg of argv) {
    if (arg === "--keep") keep = true;
    else if (arg.startsWith("--stack=")) stacks.push(arg.slice("--stack=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const stack of stacks) {
    if (!ALL_STACKS.includes(stack)) {
      throw new Error(`Unknown stack "${stack}". Choose from: ${ALL_STACKS.join(", ")}`);
    }
  }
  return { stacks: stacks.length ? stacks : ALL_STACKS, keep };
}

function log(stack, message) {
  console.log(`[${stack}] ${message}`);
}

/** Keeps the tail of a process's output so a failure can show what it said. */
function record(child, sink) {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      sink.push(chunk.toString());
      if (sink.length > 400) sink.shift();
    });
  }
}

function spawnStep(command, args, options) {
  return spawn(command, args, {
    // Windows refuses to spawn npm.cmd without a shell, and a shell mangles
    // the space in the node.exe path under Program Files, so only npm gets one.
    shell: isWindows && command === NPM,
    // A process group lets the whole dev tree be stopped at once on POSIX.
    detached: !isWindows,
    ...options,
  });
}

async function runToCompletion(command, args, { timeout, ...options }) {
  const child = spawnStep(command, args, options);
  const output = [];
  record(child, output);

  const timer = setTimeout(() => stop(child), timeout);
  try {
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) {
      throw new Error(`${command} ${args.join(" ")} exited with ${code}\n${output.join("")}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` returns a value, or gives up and throws. */
async function until(description, timeoutMs, check) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await wait(1000);
  }
  const detail = lastError ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}${detail}`);
}

function get(url, headers = {}) {
  return fetch(url, { headers, signal: AbortSignal.timeout(5000) });
}

/**
 * Ports are fixed per stack, well away from the 3000/3001 defaults, so a
 * developer's own dev server is never mistaken for the one under test.
 */
function portsFor(stack) {
  const offset = ALL_STACKS.indexOf(stack) * 2;
  return { server: 43100 + offset, client: 43101 + offset };
}

async function writeEnv(project, ports) {
  await fs.writeFile(
    path.join(project, "server", ".env"),
    `SERVER_PORT=${ports.server}\nCLIENT_ORIGIN=http://localhost:${ports.client}\n`
  );
  await fs.writeFile(
    path.join(project, "client", ".env"),
    `NEXT_PUBLIC_API_URL=http://localhost:${ports.server}\n`
  );
}

function assertEqual(actual, expected, what) {
  const [a, b] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

async function smoke(stack, keep) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `thrust-smoke-${stack}-`));
  const project = path.join(workspace, `${stack}-app`);
  const ports = portsFor(stack);

  log(stack, `scaffolding and installing into ${project}`);
  await runToCompletion(process.execPath, [CLI, project, `--stack=${stack}`, "--no-git"], {
    cwd: workspace,
    timeout: INSTALL_TIMEOUT_MS[stack],
  });

  await writeEnv(project, ports);

  log(stack, `starting npm run dev (api ${ports.server}, web ${ports.client})`);
  const dev = spawnStep(NPM, ["run", "dev"], {
    cwd: project,
    env: { ...process.env, PORT: String(ports.client), BROWSER: "none" },
  });
  const output = [];
  record(dev, output);

  const devExited = new Promise((_resolve, reject) => {
    dev.on("exit", (code) => {
      reject(new Error(`dev server exited early with ${code}\n${output.join("")}`));
    });
  });

  try {
    const health = await Promise.race([
      devExited,
      until("GET /api/health", BOOT_TIMEOUT_MS[stack], async () => {
        const response = await get(`http://127.0.0.1:${ports.server}/api/health`);
        if (response.ok) return response.json();
      }),
    ]);
    assertEqual(health, { status: "ok" }, `${stack}: /api/health payload`);
    log(stack, "GET /api/health answered with status ok");

    // The same request the page makes, so a CORS misconfiguration fails here
    // rather than silently in someone's browser.
    const origin = `http://localhost:${ports.client}`;
    const cors = await get(`http://127.0.0.1:${ports.server}/api/health`, { Origin: origin });
    const allowed = cors.headers.get("access-control-allow-origin");
    if (allowed !== origin && allowed !== "*") {
      throw new Error(
        `${stack}: the backend does not allow the frontend origin (got ${allowed ?? "no header"})`
      );
    }
    log(stack, `CORS allows ${origin}`);

    const page = await Promise.race([
      devExited,
      until("the frontend to serve a page", BOOT_TIMEOUT_MS[stack], async () => {
        const response = await get(`http://127.0.0.1:${ports.client}/`);
        if (response.ok) return response.text();
      }),
    ]);
    if (!page.includes(`${stack}-app`)) {
      throw new Error(`${stack}: the page did not render the project name`);
    }
    log(stack, "the frontend served its page");
  } finally {
    stop(dev);
    await wait(500);
    if (keep) {
      log(stack, `left in place: ${project}`);
    } else {
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const { stacks, keep } = parseArgs(process.argv.slice(2));

for (const stack of stacks) {
  await smoke(stack, keep);
  log(stack, "ok");
}

console.log(`Smoke tests passed: ${stacks.join(", ")}`);
