import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildNextSteps } from "../dist/stacks.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/** clack decorates its output; assertions care about the words, not the box. */
function plain(output) {
  return output.replace(/\u001B\[[0-9;]*m/g, "").replace(/\s+/g, " ");
}

function directoriesOnPath() {
  return (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
}

function holds(dir, command) {
  return ["", ".exe", ".cmd", ".bat"].some((ext) =>
    existsSync(path.join(dir, command + ext))
  );
}

/** A PATH exactly like this machine's, minus every directory holding gh. */
function pathWithoutGh() {
  return directoriesOnPath()
    .filter((dir) => !holds(dir, "gh"))
    .join(path.delimiter);
}

const hasGit = directoriesOnPath().some((dir) => holds(dir, "git"));

async function scaffold(args, env) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-github-"));
  const { stdout } = await run(process.execPath, [CLI, "my-app", ...args], {
    cwd,
    env: { ...process.env, PATH: env },
  });
  return { cwd, output: plain(stdout) };
}

test("manual remote steps are printed whenever nothing was pushed", () => {
  const steps = buildNextSteps("my-app", "typescript", true, true);
  assert.deepEqual(steps, [
    "cd my-app",
    "npm run dev",
    "git remote add origin <your-repo-url>",
    "git push -u origin main",
  ]);
});

test("a pushed project isn't told to add a remote", () => {
  const steps = buildNextSteps("my-app", "typescript", true, false);
  assert.ok(!steps.some((step) => step.includes("git remote add")));
});

test("install commands are listed when the install was skipped", () => {
  assert.deepEqual(buildNextSteps("my-app", "python", false, false), [
    "cd my-app",
    "npm install && npm run install:all",
    "npm run dev",
  ]);
});

test(
  "--github without gh installed explains itself and falls back to manual steps",
  { skip: !hasGit && "git is needed to reach the push step" },
  async () => {
    const { cwd, output } = await scaffold(
      ["--stack=typescript", "--no-install", "--github"],
      pathWithoutGh()
    );

    assert.match(output, /--github needs the GitHub CLI installed and authenticated/);
    assert.match(output, /cli\.github\.com/);
    assert.match(output, /git remote add origin <your-repo-url>/);
    assert.match(output, /git push -u origin main/);

    await fs.rm(cwd, { recursive: true, force: true });
  }
);

test("--github with --no-git says why it did nothing", async () => {
  const { cwd, output } = await scaffold(
    ["--stack=typescript", "--no-install", "--no-git", "--github"],
    pathWithoutGh()
  );

  assert.match(output, /--github needs a git repository, but --no-git was passed/);
  // Without a commit there is no remote to add, so those steps stay out.
  assert.ok(!output.includes("git remote add origin"));

  await fs.rm(cwd, { recursive: true, force: true });
});
