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
 *   node scripts/smoke.mjs --frontend=svelte  with a different frontend
 *   node scripts/smoke.mjs --db=sqlite        with the database layer
 *   node scripts/smoke.mjs --auth             with the auth stub
 *   node scripts/smoke.mjs --keep             leave the generated project behind
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The CLI's own table of which environment variable each frontend reads its
// API URL from, so this script can't drift from what it scaffolds.
import { FRONTEND_DETAILS, stackTakesFrontend } from "../dist/stacks.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "dist", "index.js");
const isWindows = process.platform === "win32";
const NPM = isWindows ? "npm.cmd" : "npm";

const ALL_STACKS = ["typescript", "python", "springboot", "nextjs"];

/**
 * "split" stacks run a frontend and a separate backend, wired by env files and
 * CORS. "single" is the all-in-one Next.js app: one process, one port, and the
 * API on the page's own origin — so there is no env file to write and no CORS
 * header to check.
 */
const LAYOUT = {
  typescript: "split",
  python: "split",
  springboot: "split",
  nextjs: "single",
};

/** Spring Boot downloads Maven and a dependency tree on first run. */
const BOOT_TIMEOUT_MS = {
  typescript: 180_000,
  python: 180_000,
  springboot: 600_000,
  nextjs: 180_000,
};
const INSTALL_TIMEOUT_MS = {
  typescript: 600_000,
  python: 600_000,
  springboot: 900_000,
  nextjs: 600_000,
};

function parseArgs(argv) {
  const stacks = [];
  let frontend = "next";
  let db = "none";
  let auth = false;
  let keep = false;
  for (const arg of argv) {
    if (arg === "--keep") keep = true;
    else if (arg.startsWith("--stack=")) stacks.push(arg.slice("--stack=".length));
    else if (arg.startsWith("--frontend=")) frontend = arg.slice("--frontend=".length);
    else if (arg.startsWith("--db=")) db = arg.slice("--db=".length);
    else if (arg === "--auth") auth = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const stack of stacks) {
    if (!ALL_STACKS.includes(stack)) {
      throw new Error(`Unknown stack "${stack}". Choose from: ${ALL_STACKS.join(", ")}`);
    }
  }
  const frontends = Object.keys(FRONTEND_DETAILS);
  if (!frontends.includes(frontend)) {
    throw new Error(`Unknown frontend "${frontend}". Choose from: ${frontends.join(", ")}`);
  }
  return { stacks: stacks.length ? stacks : ALL_STACKS, frontend, db, auth, keep };
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
async function until(description, timeoutMs, output, check) {
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
  // The dev server's own output is the only thing that explains a boot that
  // never happened, so a timeout carries it.
  throw new Error(`Timed out waiting for ${description}${detail}
${output.join("")}`);
}

/**
 * Always addressed as "localhost", never 127.0.0.1: Vite binds ::1 only, so
 * the IPv4 loopback is refused for the Svelte and Nuxt dev servers.
 */
function get(url, headers = {}) {
  return fetch(url, { headers, signal: AbortSignal.timeout(5000) });
}

/**
 * Ports are fixed per stack, well away from the 3000/3001 defaults, so a
 * developer's own dev server is never mistaken for the one under test.
 */
function portsFor(stack) {
  const offset = ALL_STACKS.indexOf(stack) * 2;
  const client = 43101 + offset;
  // The all-in-one app serves its own API, so both live on one port.
  return { server: LAYOUT[stack] === "split" ? 43100 + offset : client, client };
}

/**
 * Split stacks only: point the two halves at the ports this run picked, while
 * leaving every other line alone — a database layer has already written
 * DATABASE_URL into the same file, and overwriting it costs the run its
 * database.
 */
async function rewriteEnv(envPath, values) {
  const existing = await fs.readFile(envPath, "utf-8").catch(() => "");
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => line.trim() && !Object.keys(values).some((key) => line.startsWith(`${key}=`)));
  const updated = [...Object.entries(values).map(([key, value]) => `${key}=${value}`), ...kept];
  await fs.writeFile(envPath, `${updated.join("\n")}\n`);
}

async function writeEnv(project, ports, frontend) {
  await rewriteEnv(path.join(project, "server", ".env"), {
    SERVER_PORT: ports.server,
    CLIENT_ORIGIN: `http://localhost:${ports.client}`,
  });
  await rewriteEnv(path.join(project, "client", ".env"), {
    [FRONTEND_DETAILS[frontend].apiEnv]: `http://localhost:${ports.server}`,
  });
}

function assertEqual(actual, expected, what) {
  const [a, b] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

async function smoke(stack, frontend, db, auth, keep) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `thrust-smoke-${stack}-`));
  const project = path.join(workspace, `${stack}-app`);
  const ports = portsFor(stack);

  const usesFrontend = stackTakesFrontend(stack);
  const args = [CLI, project, `--stack=${stack}`, "--no-git"];
  if (usesFrontend) args.push(`--frontend=${frontend}`);
  if (db !== "none") args.push(`--db=${db}`);
  if (auth) args.push("--auth");

  log(stack, `scaffolding ${usesFrontend ? `with ${frontend} ` : ""}into ${project}`);
  await runToCompletion(process.execPath, args, {
    cwd: workspace,
    timeout: INSTALL_TIMEOUT_MS[stack],
  });

  const split = LAYOUT[stack] === "split";
  if (split) await writeEnv(project, ports, frontend);

  log(
    stack,
    split
      ? `starting npm run dev (api ${ports.server}, web ${ports.client})`
      : `starting npm run dev (app ${ports.client})`
  );
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
      until("GET /api/health", BOOT_TIMEOUT_MS[stack], output, async () => {
        const response = await get(`http://localhost:${ports.server}/api/health`);
        if (response.ok) return response.json();
      }),
    ]);
    assertEqual(health, { status: "ok" }, `${stack}: /api/health payload`);
    log(stack, "GET /api/health answered with status ok");

    // The same request the page makes, so a CORS misconfiguration fails here
    // rather than silently in someone's browser. The all-in-one app serves the
    // API from the page's own origin, where CORS never enters into it.
    if (split) {
      const origin = `http://localhost:${ports.client}`;
      const cors = await get(`http://localhost:${ports.server}/api/health`, { Origin: origin });
      const allowed = cors.headers.get("access-control-allow-origin");
      if (allowed !== origin && allowed !== "*") {
        throw new Error(
          `${stack}: the backend does not allow the frontend origin (got ${allowed ?? "no header"})`
        );
      }
      log(stack, `CORS allows ${origin}`);
    }

    const page = await Promise.race([
      devExited,
      until("the frontend to serve a page", BOOT_TIMEOUT_MS[stack], output, async () => {
        const response = await get(`http://localhost:${ports.client}/`);
        if (response.ok) return response.text();
      }),
    ]);
    if (!page.includes(`${stack}-app`)) {
      throw new Error(`${stack}: the page did not render the project name`);
    }
    log(stack, "the frontend served its page");

    // With a database layer the project also has a worked CRUD endpoint, and
    // that is what proves the ORM, the schema and the connection all landed.
    if (db !== "none") {
      const apiBase = `http://localhost:${ports.server}/api/items`;
      const created = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "smoke test" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (created.status !== 201) {
        throw new Error(`${stack}: POST /api/items answered ${created.status}`);
      }

      const listed = await (await get(apiBase)).json();
      if (!listed.some((item) => item.name === "smoke test")) {
        throw new Error(`${stack}: the row just created isn't in GET /api/items`);
      }
      log(stack, `${db}: POST then GET /api/items round-tripped a row`);
    }

    // The auth stub is the same three endpoints on every stack, so one signup
    // and one call to a protected route covers all of them.
    if (auth) {
      const credentials = { email: `smoke-${Date.now()}@example.com`, password: "correct horse" };
      const post = (route, body, headers = {}) =>
        fetch(`http://localhost:${ports.server}/api/auth/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });

      const signedUp = await post("signup", credentials);
      if (signedUp.status !== 201) {
        throw new Error(`${stack}: POST /api/auth/signup answered ${signedUp.status}`);
      }
      const { token } = await signedUp.json();

      const me = await get(`http://localhost:${ports.server}/api/auth/me`, {
        Authorization: `Bearer ${token}`,
      });
      const identified = await me.json();
      if (identified.user?.email !== credentials.email) {
        throw new Error(`${stack}: /api/auth/me didn't recognise the token it just issued`);
      }

      const anonymous = await get(`http://localhost:${ports.server}/api/auth/me`);
      if (anonymous.status !== 401) {
        throw new Error(
          `${stack}: /api/auth/me answered ${anonymous.status} without a token, not 401`
        );
      }
      log(stack, "auth: signed up, read /api/auth/me, and was refused without a token");
    }
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

const { stacks, frontend, db, auth, keep } = parseArgs(process.argv.slice(2));

for (const stack of stacks) {
  await smoke(stack, frontend, db, auth, keep);
  log(stack, "ok");
}

const suffix = `${db === "none" ? "" : `+${db}`}${auth ? "+auth" : ""}`;
console.log(
  `Smoke tests passed: ${stacks.map((s) => `${s}+${frontend}${suffix}`).join(", ")}`
);
