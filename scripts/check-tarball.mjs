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
  "package/dist/target.js",
  "package/dist/validate.js",
  // One entry per template, plus every dotfile the CLI has to restore.
  "package/templates/typescript/package.json",
  "package/templates/typescript/_gitignore",
  "package/templates/typescript/_env.example",
  "package/templates/typescript/client/_env",
  "package/templates/typescript/server/_env",
  "package/templates/python/package.json",
  "package/templates/python/_gitignore",
  "package/templates/python/_env.example",
  "package/templates/python/client/_env",
  "package/templates/python/server/_env",
  "package/templates/python/server/requirements.txt",
  "package/templates/springboot/package.json",
  "package/templates/springboot/_gitignore",
  "package/templates/springboot/_env.example",
  "package/templates/springboot/client/_env",
  "package/templates/springboot/server/_env",
  "package/templates/springboot/server/mvnw",
  "package/templates/springboot/server/mvnw.cmd",
  "package/templates/springboot/server/_mvn/wrapper/maven-wrapper.properties",
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
      parts[0] === "templates" && parts.length > 1 ? `templates/${parts[1]}` : parts[0];
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
