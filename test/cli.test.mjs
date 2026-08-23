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

/** Contract checks on the CLI's own surface, rather than what it generates. */

test("prompting without a terminal explains itself instead of crashing", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-cli-"));

  // No project name and no --stack, so the interactive path is chosen; stdin
  // is a pipe, so the prompts cannot run.
  const failure = await run(process.execPath, [CLI], { cwd }).then(
    () => null,
    (error) => error
  );

  assert.ok(failure, "expected a non-zero exit");
  assert.match(failure.stderr, /prompts need an interactive terminal/);
  assert.match(failure.stderr, /--stack=typescript/);
  assert.ok(!failure.stderr.includes("ERR_TTY_INIT_FAILED"), "leaked a Node stack trace");
  assert.deepEqual(await fs.readdir(cwd), [], "nothing should have been written");

  await fs.rm(cwd, { recursive: true, force: true });
});

test("a name and a stack still work without a terminal", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-cli-"));

  await run(process.execPath, [CLI, "my-app", "--stack=typescript", "--no-install", "--no-git"], {
    cwd,
  });
  await fs.access(path.join(cwd, "my-app", "package.json"));

  await fs.rm(cwd, { recursive: true, force: true });
});
