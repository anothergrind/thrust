import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectTarget, targetBlockedMessage } from "../dist/target.js";

async function scratch() {
  return fs.mkdtemp(path.join(os.tmpdir(), "thrust-target-"));
}

test("a path that doesn't exist is free to use", async () => {
  const dir = await scratch();
  const state = await inspectTarget(path.join(dir, "my-app"));
  assert.deepEqual(state, { kind: "missing" });
  assert.equal(targetBlockedMessage("my-app", state), undefined);
});

test("an existing empty directory is allowed", async () => {
  const dir = await scratch();
  const state = await inspectTarget(dir);
  assert.deepEqual(state, { kind: "empty" });
  assert.equal(targetBlockedMessage("my-app", state), undefined);
});

test("a non-empty directory is refused and names what's in it", async () => {
  const dir = await scratch();
  await fs.writeFile(path.join(dir, "notes.md"), "keep me");
  const state = await inspectTarget(dir);
  assert.equal(state.kind, "occupied");
  const message = targetBlockedMessage("my-app", state) ?? "";
  assert.match(message, /already exists and isn't empty/);
  assert.match(message, /notes\.md/);
  assert.match(message, /nothing was written/);
});

test("a dotfile counts as content", async () => {
  const dir = await scratch();
  await fs.mkdir(path.join(dir, ".git"));
  assert.equal((await inspectTarget(dir)).kind, "occupied");
});

test("only the first few entries are listed", async () => {
  const dir = await scratch();
  for (const name of ["a", "b", "c", "d", "e"]) {
    await fs.writeFile(path.join(dir, name), "");
  }
  assert.match(
    targetBlockedMessage("my-app", await inspectTarget(dir)) ?? "",
    /a, b, c and 2 more/
  );
});

test("a file in the way is refused with its own message", async () => {
  const dir = await scratch();
  const file = path.join(dir, "my-app");
  await fs.writeFile(file, "");
  const state = await inspectTarget(file);
  assert.deepEqual(state, { kind: "file" });
  assert.match(targetBlockedMessage("my-app", state) ?? "", /is a file/);
});
