import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_NAME_LENGTH,
  projectNameError,
  projectNameWarnings,
  suggestProjectName,
} from "../dist/validate.js";

const accepted = ["my-app", "app2", "app.io", "my_app", "APP", "a"];

test("accepts ordinary project names", () => {
  for (const name of accepted) {
    assert.equal(projectNameError(name), undefined, name);
  }
});

test("requires a name", () => {
  assert.match(projectNameError(""), /required/);
  assert.match(projectNameError("   "), /required/);
});

test("rejects characters that are illegal in a path or a package name", () => {
  for (const name of ["my app", "my:app", "my*app", "my|app", 'my"app']) {
    assert.match(projectNameError(name) ?? "", /only letters, numbers/, name);
  }
});

test("rejects names npm reserves or refuses", () => {
  assert.match(projectNameError(".hidden") ?? "", /dot or underscore/);
  assert.match(projectNameError("_tmp") ?? "", /dot or underscore/);
  assert.match(projectNameError("node_modules") ?? "", /reserved by npm/);
  assert.match(projectNameError("favicon.ico") ?? "", /reserved by npm/);
});

test("rejects Windows device names whatever their case or extension", () => {
  for (const name of ["con", "CON", "Nul.txt", "com1", "LPT9.log"]) {
    assert.match(projectNameError(name) ?? "", /reserved device name/, name);
  }
  assert.equal(projectNameError("console"), undefined);
});

test("rejects a trailing dot, which Windows silently drops", () => {
  assert.match(projectNameError("my-app.") ?? "", /can't end with a dot/);
});

test("leaves room for the -client and -server packages", () => {
  assert.equal(MAX_NAME_LENGTH, 207);
  assert.equal(projectNameError("a".repeat(MAX_NAME_LENGTH)), undefined);
  assert.match(
    projectNameError("a".repeat(MAX_NAME_LENGTH + 1)) ?? "",
    /Keep it to 207/
  );
});

test("suggests a usable name in the error message", () => {
  assert.match(projectNameError("my app") ?? "", /Try "my-app"/);
  assert.match(projectNameError("_my-app") ?? "", /Try "my-app"/);
  assert.match(projectNameError("con") ?? "", /Try "con-app"/);
});

test("suggestProjectName cleans up a name, or gives up", () => {
  assert.equal(suggestProjectName("My App!"), "my-app");
  assert.equal(suggestProjectName("  ..My  App..  "), "my-app");
  assert.equal(suggestProjectName("a".repeat(300)), "a".repeat(MAX_NAME_LENGTH));
  assert.equal(suggestProjectName("___"), undefined);
  assert.equal(suggestProjectName("node_modules"), undefined);
});

test("every suggestion it makes would itself be accepted", () => {
  const inputs = [
    "my app", "_tmp", ".hidden", "my-app.", "con", "CON.txt", "COM1",
    "a".repeat(300), "  ..My  App..  ", "my:app", "node_modules", "favicon.ico",
    "...", "-", "n", "@scope/pkg", "my/app",
  ];
  for (const input of inputs) {
    const suggestion = suggestProjectName(input);
    if (suggestion !== undefined) {
      assert.equal(projectNameError(suggestion), undefined, `${input} -> ${suggestion}`);
    }
  }
});

test("warns without blocking on names npm dislikes", () => {
  assert.deepEqual(projectNameWarnings("my-app"), []);
  assert.equal(projectNameWarnings("MyApp").length, 1);
  assert.match(projectNameWarnings("MyApp")[0], /lowercase/);
  assert.match(projectNameWarnings("http")[0], /core module/);
});
