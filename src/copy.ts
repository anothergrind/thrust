/**
 * Copying template files into a new project: restoring the names npm strips,
 * filling in sentinels, and clearing the markers that guide optional layers.
 */

import fs from "node:fs/promises";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".json", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".html", ".css", ".md", ".yml", ".yaml", ".toml", ".xml",
  ".env", ".txt", ".py", ".java", ".properties", ".gradle", ".cfg",
  ".svelte", ".vue", ".prisma",
]);

export function isTextFile(filename: string): boolean {
  if (filename.startsWith("_env") || filename.startsWith(".env")) return true;
  const ext = path.extname(filename).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * npm strips dotfiles from published tarballs, so templates store them with a
 * leading underscore and we restore the real name on copy.
 */
export function renameDotfile(name: string): string {
  if (name === "_gitignore") return ".gitignore";
  if (name === "_env") return ".env";
  if (name === "_env.example") return ".env.example";
  if (name === "_mvn") return ".mvn";
  return name;
}

/**
 * Files that have to stay runnable. An npm tarball built on Windows carries no
 * executable bits at all, so the Maven wrapper arrives unusable on macOS and
 * Linux unless the bit is put back here.
 */
const EXECUTABLE_FILES = new Set(["mvnw"]);

export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destName = renameDotfile(entry.name);
    const destPath = path.join(dest, destName);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      if (process.platform !== "win32" && EXECUTABLE_FILES.has(destName)) {
        await fs.chmod(destPath, 0o755);
      }
    }
  }
}

function substitute(text: string, replacements: Record<string, string>): string {
  let updated = text;
  for (const [sentinel, value] of Object.entries(replacements)) {
    updated = updated.replaceAll(sentinel, value);
  }
  return updated;
}

/**
 * Expands the replacement values against each other, so that a value which
 * itself contains a sentinel — a database URL carries the project name — is
 * resolved before any file is touched.
 *
 * Without this the sweep is order-dependent: `__PROJECT_NAME__` is replaced
 * first, then `__DB_URL__` drops a fresh `__PROJECT_NAME__` into the file that
 * nothing will ever come back for, and the sentinel ships in someone's source.
 */
export function resolveReplacements(
  replacements: Record<string, string>
): Record<string, string> {
  const resolved = { ...replacements };
  const sentinels = Object.keys(resolved);

  // Each pass resolves one more level of nesting, so a chain of n sentinels
  // settles in at most n passes.
  for (let pass = 0; pass < sentinels.length; pass++) {
    let changed = false;
    for (const sentinel of sentinels) {
      const expanded = substitute(resolved[sentinel], resolved);
      if (expanded !== resolved[sentinel]) {
        resolved[sentinel] = expanded;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // A sentinel that survives its own expansion is one that refers to itself,
  // directly or through another. Saying so is better than the alternative:
  // quietly writing the sentinel into the project, which is the bug this
  // whole function exists to prevent.
  const cyclic = sentinels.filter((sentinel) =>
    sentinels.some((other) => resolved[sentinel].includes(other))
  );
  if (cyclic.length > 0) {
    throw new Error(`Sentinel values refer to each other in a cycle: ${cyclic.join(", ")}`);
  }

  return resolved;
}

/** Rewrites every text file under `dir`, applying all sentinel replacements. */
export async function replaceInDir(
  dir: string,
  replacements: Record<string, string>
): Promise<void> {
  const resolved = resolveReplacements(replacements);
  await eachTextFile(dir, async (_filePath, content) => substitute(content, resolved));
}

/**
 * Markers like `// thrust:routes` tell the optional layers where to add their
 * imports and routes. Whatever is left once those have run is scaffolding
 * scaffolding, and shouldn't be in anyone's project.
 */
const MARKER_LINE = /^\s*(\/\/|#|<!--)\s*thrust:[a-z-]+\s*(-->)?\s*$/;

export async function stripMarkers(dir: string): Promise<void> {
  await eachTextFile(dir, async (_filePath, content) => {
    if (!content.includes("thrust:")) return content;
    const lines = content.split("\n").filter((line) => !MARKER_LINE.test(line));
    return lines.join("\n");
  });
}

/**
 * Inserts `lines` just above a marker, at the marker's indentation. The marker
 * stays put so a second layer can use it too; stripMarkers clears them all
 * once every layer has had its turn.
 */
export async function insertAtMarker(
  filePath: string,
  marker: string,
  lines: string[]
): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const source = content.split("\n");
  const index = source.findIndex((line) => line.includes(`thrust:${marker}`));
  if (index === -1) {
    throw new Error(`No "thrust:${marker}" marker in ${filePath}`);
  }

  const indent = source[index].match(/^\s*/)?.[0] ?? "";
  source.splice(index, 0, ...lines.map((line) => (line === "" ? "" : `${indent}${line}`)));
  await fs.writeFile(filePath, source.join("\n"), "utf-8");
}

async function eachTextFile(
  dir: string,
  transform: (filePath: string, content: string) => Promise<string>
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await eachTextFile(fullPath, transform);
    } else if (isTextFile(entry.name)) {
      const content = await fs.readFile(fullPath, "utf-8");
      const updated = await transform(fullPath, content);
      if (updated !== content) {
        await fs.writeFile(fullPath, updated, "utf-8");
      }
    }
  }
}
