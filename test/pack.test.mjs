import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("..", import.meta.url));

/**
 * npm strips dotfiles from published tarballs, so the templates keep them
 * under underscore names and the CLI restores them on copy. Nothing in the
 * repo-level tests can catch a break in that chain: run from a git checkout
 * every file is already where it should be. These tests pack the package the
 * way a release would and scaffold from the result.
 *
 * The tarball is unpacked inside the repo rather than installed, so the CLI
 * still resolves its dependencies from the repo's node_modules and no network
 * or registry access is needed. What is being checked is the tarball's
 * contents, which packing has already decided by that point.
 */

async function packAndUnpack() {
  const workspace = await fs.mkdtemp(path.join(REPO, ".pack-test-"));
  const { stdout } = await run("npm", ["pack", "--json", "--pack-destination", workspace], {
    cwd: REPO,
    shell: process.platform === "win32",
  });
  const [{ filename }] = JSON.parse(stdout.slice(stdout.indexOf("[")));
  // Run tar from inside the workspace with a bare filename: GNU tar reads a
  // Windows "C:\..." argument as a remote host and refuses it.
  await run("tar", ["-xzf", filename], { cwd: workspace });
  const { stdout: listing } = await run("tar", ["-tzf", filename], { cwd: workspace });
  return {
    workspace,
    cli: path.join(workspace, "package", "dist", "index.js"),
    files: listing.split("\n").map((line) => line.trim().replace(/\/$/, "")).filter(Boolean),
  };
}

let packed;

test("pack the package once for the tests below", async () => {
  packed = await packAndUnpack();
});

test("the tarball carries the underscore-named dotfiles", () => {
  for (const file of [
    "package/templates/typescript/_gitignore",
    "package/templates/typescript/_env.example",
    "package/templates/typescript/client/_env",
    "package/templates/typescript/server/_env",
    "package/templates/springboot/server/_mvn/wrapper/maven-wrapper.properties",
  ]) {
    assert.ok(packed.files.includes(file), `${file} missing from the tarball`);
  }
});

test("the tarball carries no real dotfiles, which npm would have stripped", () => {
  const stripped = packed.files.filter((file) =>
    file.split("/").some((segment) => segment.startsWith(".") && segment !== ".")
  );
  assert.deepEqual(stripped, []);
});

test("build output kept out of the published package", () => {
  const unwanted = packed.files.filter((file) =>
    /\/(target|\.next|out|\.venv|__pycache__|node_modules)\//.test(file)
  );
  assert.deepEqual(unwanted, []);
});

async function scaffoldFromTarball(stack, name) {
  const project = path.join(packed.workspace, name);
  await run(process.execPath, [packed.cli, project, `--stack=${stack}`, "--no-install", "--no-git"]);
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

test("the Spring Boot wrapper directory is restored too", async () => {
  const project = await scaffoldFromTarball("springboot", "boot-app");

  await fs.access(path.join(project, "server", ".mvn", "wrapper", "maven-wrapper.properties"));
  await assert.rejects(fs.access(path.join(project, "server", "_mvn")));
});

test("clean up the packed workspace", async () => {
  await fs.rm(packed.workspace, { recursive: true, force: true });
});
