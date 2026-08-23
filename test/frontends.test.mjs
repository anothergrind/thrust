import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { FRONTEND_DETAILS } from "../dist/stacks.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * A project is assembled from a backend half and a frontend half, so these
 * check the seams: that the right client arrives, and that the two files each
 * half only knows part of — .env.example and .gitignore — end up holding both
 * halves' entries. Nothing is installed here; booting the result is the smoke
 * script's job.
 */

async function scaffold(args) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-frontend-"));
  const project = path.join(workspace, "my-app");
  await run(process.execPath, [CLI, project, ...args, "--no-install", "--no-git"]);
  return { workspace, project };
}

const read = (project, file) => fs.readFile(path.join(project, file), "utf-8");

const MARKERS = {
  next: "client/next.config.mjs",
  svelte: "client/svelte.config.js",
  vue: "client/vite.config.ts",
};

for (const frontend of Object.keys(FRONTEND_DETAILS)) {
  test(`--frontend=${frontend} composes with a backend`, async () => {
    const { workspace, project } = await scaffold([
      "--stack=typescript",
      `--frontend=${frontend}`,
    ]);

    await fs.access(path.join(project, MARKERS[frontend]));
    await fs.access(path.join(project, "server", "src", "index.ts"));

    const client = JSON.parse(await read(project, "client/package.json"));
    assert.equal(client.name, "my-app-client");

    // Both halves' variables, in one file the user can read top to bottom.
    const env = await read(project, ".env.example");
    assert.match(env, /SERVER_PORT=3001/);
    assert.match(env, /CLIENT_ORIGIN=http:\/\/localhost:3000/);
    assert.ok(
      env.includes(`${FRONTEND_DETAILS[frontend].apiEnv}=http://localhost:3001`),
      "the frontend's API variable is missing from .env.example"
    );

    // The client's own .env uses the same name, since that is what it reads.
    assert.ok((await read(project, "client/.env")).includes(FRONTEND_DETAILS[frontend].apiEnv));

    // The backend contributes its build directories, the frontend its own.
    const gitignore = await read(project, ".gitignore");
    assert.match(gitignore, /node_modules\//);
    assert.match(gitignore, /client\//);

    // The generated README describes the frontend that was actually chosen.
    // A plain includes: the labels carry "+" signs, which a regexp would eat.
    assert.ok(
      (await read(project, "README.md")).includes(FRONTEND_DETAILS[frontend].label),
      "the README does not name the chosen frontend"
    );

    await fs.rm(workspace, { recursive: true, force: true });
  });
}

test("the default frontend is Next.js", async () => {
  const { workspace, project } = await scaffold(["--stack=python"]);
  await fs.access(path.join(project, "client", "next.config.mjs"));
  await fs.access(path.join(project, "server", "main.py"));
  await fs.rm(workspace, { recursive: true, force: true });
});

test("the all-in-one stack has no client half at all", async () => {
  const { workspace, project } = await scaffold(["--stack=nextjs"]);
  await fs.access(path.join(project, "app", "api", "health", "route.ts"));
  await assert.rejects(fs.access(path.join(project, "client")));
  await assert.rejects(fs.access(path.join(project, "server")));
  await fs.rm(workspace, { recursive: true, force: true });
});

test("asking for a frontend on the all-in-one stack is refused", async () => {
  await assert.rejects(
    scaffold(["--stack=nextjs", "--frontend=svelte"]),
    (error) => /is a Next.js app already/.test(error.stderr),
    "expected the combination to be rejected"
  );
});

test("an unknown frontend is refused, and says what there is", async () => {
  await assert.rejects(
    scaffold(["--stack=typescript", "--frontend=angular"]),
    (error) => /Unknown frontend "angular".*next, svelte, vue/s.test(error.stderr)
  );
});
