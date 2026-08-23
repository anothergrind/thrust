import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { packTo, verify } from "../scripts/check-tarball.mjs";

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("..", import.meta.url));

/**
 * npm strips dotfiles from published tarballs, so the templates keep them
 * under underscore names and the CLI restores them on copy. Nothing in the
 * other tests can catch a break in that chain: run from a git checkout every
 * file is already where it should be. These tests pack the package the way a
 * release would and scaffold from the result.
 *
 * The tarball is unpacked rather than installed, so the CLI still resolves its
 * dependencies from the repo's node_modules and no registry access is needed.
 * What is being checked is the tarball's contents, which packing has already
 * decided by that point.
 */

let packed;

test("pack the package once for the tests below", async () => {
  const workspace = await fs.mkdtemp(path.join(REPO, ".pack-test-"));
  const { filename, files } = await packTo(workspace);
  // Bare filename from inside the workspace: GNU tar reads a Windows
  // drive-letter argument as a remote host and refuses it.
  await run("tar", ["-xzf", filename], { cwd: workspace });

  packed = { workspace, files, cli: path.join(workspace, "package", "dist", "index.js") };
});

test("the tarball holds everything a release needs and nothing it shouldn't", () => {
  assert.deepEqual(verify(packed.files), []);
});

async function scaffoldFromTarball(stack, name) {
  const project = path.join(packed.workspace, name);
  await run(process.execPath, [
    packed.cli,
    project,
    `--stack=${stack}`,
    "--no-install",
    "--no-git",
  ]);
  return project;
}

test("a project scaffolded from the tarball gets real dotfiles", async () => {
  const project = await scaffoldFromTarball("typescript", "ts-app");

  for (const file of [".gitignore", ".env.example", "client/.env", "server/.env"]) {
    await fs.access(path.join(project, file));
  }
  for (const leftover of ["_gitignore", "_env.example", "client/_env", "server/_env"]) {
    await assert.rejects(fs.access(path.join(project, leftover)), `${leftover} was left behind`);
  }
});

test("the Spring Boot wrapper is restored, and runnable", async () => {
  const project = await scaffoldFromTarball("springboot", "boot-app");

  await fs.access(path.join(project, "server", ".mvn", "wrapper", "maven-wrapper.properties"));
  await assert.rejects(fs.access(path.join(project, "server", "_mvn")));

  if (process.platform !== "win32") {
    // A tarball packed on Windows carries no executable bits, so `npm run dev`
    // would die on "permission denied" before Maven ever started.
    const { mode } = await fs.stat(path.join(project, "server", "mvnw"));
    assert.ok(mode & 0o111, "mvnw was not executable");
  }
});

test("clean up the packed workspace", async () => {
  await fs.rm(packed.workspace, { recursive: true, force: true });
});
