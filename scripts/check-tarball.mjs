#!/usr/bin/env node
/**
 * Packs the package the way a release would and checks what came out.
 *
 * Everything users get comes from this tarball, and the two ways it goes wrong
 * are silent: a template file that never made it in, or a dotfile npm stripped
 * on the way. Both look fine in a git checkout, where every file is already in
 * place, and only break for people installing from the registry.
 *
 *   node scripts/check-tarball.mjs        pack, verify and print what ships
 *
 * The checks are exported so the test suite runs them too — this script is the
 * one place that says what a release must contain.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Without these the published CLI is broken in a way no checkout reveals. */
export const REQUIRED_FILES = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/dist/index.js",
  "package/dist/stacks.js",
  "package/dist/target.js",
  "package/dist/validate.js",
  // Backends: the root files a project is built from, plus the dotfiles and
  // wrapper scripts that go missing quietly.
  "package/templates/backends/typescript/package.json",
  "package/templates/backends/typescript/_gitignore",
  "package/templates/backends/typescript/_env.example",
  "package/templates/backends/typescript/server/_env",
  "package/templates/backends/python/package.json",
  "package/templates/backends/python/_gitignore",
  "package/templates/backends/python/_env.example",
  "package/templates/backends/python/server/_env",
  "package/templates/backends/python/server/requirements.txt",
  "package/templates/backends/python/scripts/py.mjs",
  "package/templates/backends/springboot/package.json",
  "package/templates/backends/springboot/_gitignore",
  "package/templates/backends/springboot/_env.example",
  "package/templates/backends/springboot/server/_env",
  "package/templates/backends/springboot/server/mvnw",
  "package/templates/backends/springboot/server/mvnw.cmd",
  "package/templates/backends/springboot/server/_mvn/wrapper/maven-wrapper.properties",
  "package/templates/backends/springboot/scripts/mvn.mjs",
  // Frontends: each contributes a client/ tree and the two fragments that are
  // appended to the backend's .env.example and .gitignore.
  "package/templates/frontends/next/client/package.json",
  "package/templates/frontends/next/client/_env",
  "package/templates/frontends/next/_env.example",
  "package/templates/frontends/next/_gitignore",
  "package/templates/frontends/svelte/client/package.json",
  "package/templates/frontends/svelte/client/_env",
  "package/templates/frontends/svelte/_env.example",
  "package/templates/frontends/svelte/_gitignore",
  "package/templates/frontends/vue/client/package.json",
  "package/templates/frontends/vue/client/_env",
  "package/templates/frontends/vue/_env.example",
  "package/templates/frontends/vue/_gitignore",
  // The all-in-one stack is a whole project rather than two halves.
  "package/templates/nextjs/package.json",
  "package/templates/nextjs/_gitignore",
  "package/templates/nextjs/app/api/health/route.ts",
];

/** Build output and installed dependencies that must never ship. */
const FORBIDDEN = /\/(target|\.next|out|\.venv|__pycache__|node_modules)\//;

/**
 * npm drops dotfiles from tarballs, which is the whole reason the templates
 * store them under underscore names. A real dotfile in here means someone
 * added a template file that will silently go missing for npm users.
 */
function isDotfile(file) {
  return file.split("/").some((segment) => segment.startsWith(".") && segment !== ".");
}

export async function packTo(destination) {
  const { stdout } = await run("npm", ["pack", "--json", "--pack-destination", destination], {
    cwd: REPO,
    shell: process.platform === "win32",
    maxBuffer: 10 * 1024 * 1024,
  });
  const [{ filename, size, unpackedSize }] = JSON.parse(stdout.slice(stdout.indexOf("[")));
  // GNU tar reads a Windows drive-letter argument as a remote host, so the
  // listing is taken from inside the destination with a bare filename.
  const { stdout: listing } = await run("tar", ["-tzf", filename], { cwd: destination });
  const files = listing
    .split("\n")
    .map((line) => line.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return { filename, path: path.join(destination, filename), files, size, unpackedSize };
}

/** Everything wrong with a tarball's contents, as a list of sentences. */
export function verify(files) {
  const problems = [];

  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) problems.push(`missing: ${required}`);
  }
  for (const file of files.filter(isDotfile)) {
    problems.push(`dotfile npm will strip: ${file} (store it under an underscore name)`);
  }
  for (const file of files.filter((f) => FORBIDDEN.test(f))) {
    problems.push(`build output or dependency: ${file}`);
  }

  return problems;
}

/** File counts per top-level entry, with templates broken out per stack. */
function summarise(files) {
  const groups = new Map();
  for (const file of files) {
    const parts = file.split("/").slice(1);
    const group =
      parts[0] === "templates" && parts.length > 2
        ? parts.slice(0, parts[1] === "nextjs" ? 2 : 3).join("/")
        : parts[0];
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

async function main() {
  const workspace = await fs.mkdtemp(path.join(REPO, ".pack-check-"));
  try {
    const { filename, files, size, unpackedSize } = await packTo(workspace);

    console.log(`${filename} — ${files.length} files, ${kb(size)} packed, ${kb(unpackedSize)} unpacked\n`);
    for (const [group, count] of summarise(files)) {
      console.log(`  ${String(count).padStart(4)}  ${group}`);
    }

    const problems = verify(files);
    if (problems.length > 0) {
      console.error(`\n${problems.length} problem(s) with the tarball:`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log("\nTarball contents look right.");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
