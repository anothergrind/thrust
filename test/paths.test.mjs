import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveTarget, targetBaseName, typedBaseName } from "../dist/target.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const onWindows = process.platform === "win32";

test("a bare name lands under the current directory", () => {
  assert.equal(resolveTarget("my-app"), path.resolve(process.cwd(), "my-app"));
  assert.equal(resolveTarget("  my-app  "), path.resolve(process.cwd(), "my-app"));
});

test("relative paths resolve against the current directory", () => {
  assert.equal(resolveTarget("../my-app"), path.resolve(process.cwd(), "..", "my-app"));
  assert.equal(
    resolveTarget("code/2026/my-app"),
    path.resolve(process.cwd(), "code", "2026", "my-app")
  );
});

test("a leading ~ expands, because the prompt has no shell behind it", () => {
  assert.equal(resolveTarget("~"), path.resolve(os.homedir()));
  assert.equal(resolveTarget("~/code/my-app"), path.join(os.homedir(), "code", "my-app"));
});

test("~ only expands when it stands alone or starts a path", () => {
  assert.equal(resolveTarget("~someone"), path.resolve(process.cwd(), "~someone"));
  assert.equal(resolveTarget("code/~/my-app"), path.resolve(process.cwd(), "code", "~", "my-app"));
});

test("Windows drive paths and backslashes", { skip: !onWindows }, () => {
  const winPath = "C:\\Users\\me\\code\\my-app";
  assert.equal(resolveTarget("C:/Users/me/code/my-app"), winPath);
  assert.equal(resolveTarget(winPath), winPath);
  assert.equal(resolveTarget("~\\code\\my-app"), path.join(os.homedir(), "code", "my-app"));
  assert.equal(targetBaseName(winPath), "my-app");
  assert.equal(targetBaseName("code\\my-app\\"), "my-app");
});

test("POSIX absolute paths", { skip: onWindows }, () => {
  assert.equal(resolveTarget("/tmp/my-app"), "/tmp/my-app");
  assert.equal(targetBaseName("/tmp/my-app"), "my-app");
});

test("the project name comes from the last segment, however it was written", () => {
  assert.equal(targetBaseName("my-app"), "my-app");
  assert.equal(targetBaseName("../code/my-app"), "my-app");
  assert.equal(targetBaseName("my-app/"), "my-app");
  assert.equal(targetBaseName("my-app//"), "my-app");
  assert.equal(targetBaseName("~/code/my-app"), "my-app");
});

test("segments that only name a folder once resolved fall back to the real path", () => {
  assert.equal(typedBaseName("."), ".");
  assert.equal(targetBaseName("."), path.basename(process.cwd()));
  assert.equal(targetBaseName(".."), path.basename(path.resolve(process.cwd(), "..")));
  assert.equal(targetBaseName("~"), path.basename(os.homedir()));
});

test("missing parent directories are created on the way", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-paths-"));
  await run(
    process.execPath,
    [CLI, "code/2026/my-app", "--stack=typescript", "--no-install", "--no-git"],
    { cwd }
  );
  const project = path.join(cwd, "code", "2026", "my-app");
  assert.equal(JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf-8")).name, "my-app");
  await fs.rm(cwd, { recursive: true, force: true });
});

test("an absolute path scaffolds outside the working directory", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-paths-cwd-"));
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-paths-out-"));
  const destination = path.join(elsewhere, "my-app");
  await run(
    process.execPath,
    [CLI, destination, "--stack=typescript", "--no-install", "--no-git"],
    { cwd }
  );
  await fs.access(path.join(destination, "client", "app", "page.tsx"));
  assert.deepEqual(await fs.readdir(cwd), []);
  await fs.rm(cwd, { recursive: true, force: true });
  await fs.rm(elsewhere, { recursive: true, force: true });
});
