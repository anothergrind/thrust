import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * The auth stub arrives the same way on every stack, so these check that it is
 * wired in, that its secret is generated per project rather than shipped, and
 * that it stays out of a project that didn't ask for it. Whether signup and
 * login actually work is the smoke script's job.
 */

async function scaffold(args) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-auth-"));
  const project = path.join(workspace, "my-app");
  await run(process.execPath, [CLI, project, ...args, "--no-install", "--no-git"]);
  return { workspace, project };
}

const read = (project, file) => fs.readFile(path.join(project, file), "utf-8");

test("the Express server gets the stub and its route", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript", "--auth"]);

  await fs.access(path.join(project, "server", "src", "auth.ts"));

  const entry = await read(project, "server/src/index.ts");
  assert.match(entry, /import \{ auth \} from ".\/auth.js";/);
  assert.match(entry, /app.use\(auth\);/);
  assert.ok(!entry.includes("thrust:"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("the FastAPI server gets the stub and its router", async () => {
  const { workspace, project } = await scaffold(["--stack=python", "--auth"]);

  await fs.access(path.join(project, "server", "auth.py"));

  const entry = await read(project, "server/main.py");
  assert.match(entry, /from auth import router as auth_router/);
  assert.match(entry, /app.include_router\(auth_router\)/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("Spring finds the stub by component scanning, and is handed the secret", async () => {
  const { workspace, project } = await scaffold(["--stack=springboot", "--auth"]);

  const java = "server/src/main/java/com/example/app";
  await fs.access(path.join(project, java, "AuthController.java"));
  await fs.access(path.join(project, java, "AuthService.java"));

  const properties = await read(project, "server/src/main/resources/application.properties");
  assert.match(properties, /app\.auth-secret=\$\{AUTH_SECRET:/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("the all-in-one stack gets route handlers under app/api/auth", async () => {
  const { workspace, project } = await scaffold(["--stack=nextjs", "--auth"]);

  for (const route of ["signup", "login", "me"]) {
    await fs.access(path.join(project, "app", "api", "auth", route, "route.ts"));
  }
  await fs.access(path.join(project, "lib", "auth.ts"));
  assert.match(await read(project, ".env"), /AUTH_SECRET/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("each project gets its own secret, and .env.example never sees it", async () => {
  const first = await scaffold(["--stack=typescript", "--auth"]);
  const second = await scaffold(["--stack=typescript", "--auth"]);

  const secretOf = (env) => env.match(/AUTH_SECRET="([^"]+)"/)?.[1];
  const one = secretOf(await read(first.project, "server/.env"));
  const two = secretOf(await read(second.project, "server/.env"));

  assert.match(one ?? "", /^[0-9a-f]{64}$/, "the secret should be 32 random bytes");
  assert.notEqual(one, two, "two projects should not share a signing secret");

  const example = await read(first.project, ".env.example");
  assert.match(example, /AUTH_SECRET="replace-me/);
  assert.ok(!example.includes(one), "the real secret leaked into .env.example");

  await fs.rm(first.workspace, { recursive: true, force: true });
  await fs.rm(second.workspace, { recursive: true, force: true });
});

test("auth and a database compose without stepping on each other", async () => {
  const { workspace, project } = await scaffold([
    "--stack=typescript",
    "--db=sqlite",
    "--auth",
  ]);

  const entry = await read(project, "server/src/index.ts");
  assert.match(entry, /app.use\(items\);/);
  assert.match(entry, /app.use\(auth\);/);

  const env = await read(project, "server/.env");
  assert.match(env, /DATABASE_URL=/);
  assert.match(env, /AUTH_SECRET=/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("without --auth nothing auth-shaped is added", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript"]);

  await assert.rejects(fs.access(path.join(project, "server", "src", "auth.ts")));
  assert.ok(!(await read(project, "server/.env")).includes("AUTH_SECRET"));
  assert.ok(!(await read(project, "server/src/index.ts")).includes("auth"));

  await fs.rm(workspace, { recursive: true, force: true });
});
