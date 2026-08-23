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

/** Rewrites every text file under `dir`, applying all sentinel replacements. */
export async function replaceInDir(
  dir: string,
  replacements: Record<string, string>
): Promise<void> {
  await eachTextFile(dir, async (filePath, content) => {
    let updated = content;
    for (const [sentinel, value] of Object.entries(replacements)) {
      updated = updated.replaceAll(sentinel, value);
    }
    return updated;
  });
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
