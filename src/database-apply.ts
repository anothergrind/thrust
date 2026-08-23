/**
 * Applying a chosen database to a freshly copied project: dropping in the
 * layer's files, then editing the handful of files that already exist —
 * a manifest, a requirements list, a pom, an entry point.
 *
 * Every edit is additive and anchored, so a project scaffolded without a
 * database is byte-for-byte what it always was.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { copyDir, insertAtMarker } from "./copy.js";
import type { DatabasePlan } from "./databases.js";

export async function applyDatabase(
  destDir: string,
  templateDir: string,
  plan: DatabasePlan
): Promise<void> {
  await copyDir(templateDir, destDir);

  if (plan.packageJson) {
    await mergePackageJson(path.join(destDir, plan.packageJson.path), plan.packageJson);
  }
  if (plan.requirements) {
    await appendLines(path.join(destDir, plan.requirements.path), plan.requirements.lines);
  }
  if (plan.maven) {
    await insertMavenDependencies(path.join(destDir, plan.maven.path), plan.maven.dependencies);
  }
  if (plan.properties) {
    await appendProperties(path.join(destDir, plan.properties.path), plan.properties.entries);
  }
  if (plan.wiring) {
    const entryPoint = path.join(destDir, plan.wiring.path);
    await insertAtMarker(entryPoint, "imports", plan.wiring.imports);
    await insertAtMarker(entryPoint, "routes", plan.wiring.routes);
  }
  if (plan.gitignore) {
    await appendLines(path.join(destDir, ".gitignore"), plan.gitignore);
  }
}

/**
 * Merges dependencies and scripts into an existing manifest, keeping the key
 * order npm itself writes so the diff stays readable.
 */
async function mergePackageJson(
  manifestPath: string,
  additions: NonNullable<DatabasePlan["packageJson"]>
): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

  for (const field of ["dependencies", "devDependencies", "scripts"] as const) {
    const extra = additions[field];
    if (!extra) continue;
    manifest[field] = sortKeys({ ...(manifest[field] ?? {}), ...extra });
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

async function appendLines(filePath: string, lines: string[]): Promise<void> {
  const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await fs.writeFile(filePath, `${existing}${separator}${lines.join("\n")}\n`, "utf-8");
}

async function appendProperties(
  filePath: string,
  entries: Record<string, string>
): Promise<void> {
  const lines = ["", "# Database"];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`${key}=${value}`);
  }
  await appendLines(filePath, lines);
}

/** Inserts Maven dependencies at the pom's marker, indented to match. */
async function insertMavenDependencies(
  pomPath: string,
  dependencies: { groupId: string; artifactId: string; scope?: string }[]
): Promise<void> {
  const lines: string[] = [];
  for (const dependency of dependencies) {
    lines.push(
      "<dependency>",
      `    <groupId>${dependency.groupId}</groupId>`,
      `    <artifactId>${dependency.artifactId}</artifactId>`,
      ...(dependency.scope ? [`    <scope>${dependency.scope}</scope>`] : []),
      "</dependency>",
      ""
    );
  }
  await insertAtMarker(pomPath, "dependencies", lines);
}
