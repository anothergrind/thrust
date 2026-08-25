/**
 * Applying an optional layer — a database, an auth stub — to a freshly copied
 * project: dropping in the layer's files, then editing the handful of files
 * that already exist: a manifest, a requirements list, a pom, an entry point.
 *
 * Every edit is additive and anchored to a marker or a known field, so a
 * project scaffolded without any layers is byte-for-byte what it always was.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { copyDir, insertAtMarker } from "./copy.js";

/** What applying a layer to a project involves. Every field is optional. */
export type LayerPlan = {
  /** Sentinel values only this layer knows about. */
  replacements?: Record<string, string>;
  /** Variables for the project's .env, e.g. DATABASE_URL or AUTH_SECRET. */
  env?: Record<string, string>;
  /** The comment those variables sit under in .env.example. */
  envHeading?: string;
  /** What .env.example should show instead, where a real value is a secret. */
  envExample?: Record<string, string>;
  /** package.json fields to merge into the server's (or the app's) manifest. */
  packageJson?: {
    path: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  /** Lines appended to a requirements.txt. */
  requirements?: { path: string; lines: string[] };
  /** Maven dependencies inserted at the pom's marker. */
  maven?: { path: string; dependencies: MavenDependency[] };
  /** Lines appended to a Spring properties file. */
  properties?: { path: string; entries: Record<string, string> };
  /** Import and route registration lines for the backend's entry point. */
  wiring?: { path: string; imports: string[]; routes: string[] };
  /** Extra .gitignore entries, e.g. a SQLite file. */
  gitignore?: string[];
  /**
   * A section appended to the project's README. The CLI prints a layer's
   * commands once, to whoever ran it; the README is where the rest of the
   * team, and that same person on Monday, will look for them.
   */
  readme?: { path: string; lines: string[] };
  /** Appended to the root install command, for setup that can run offline. */
  installStep?: string;
  /**
   * Setup that needs something the install can't assume is there — a database
   * server, in practice. Printed in the next steps with its reason, never run,
   * because a failure here would look like a failed install.
   */
  manualStep?: { command: string; reason: string };
};

export type MavenDependency = { groupId: string; artifactId: string; scope?: string };

export async function applyLayer(
  destDir: string,
  templateDir: string,
  plan: LayerPlan
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
  if (plan.readme) {
    await appendLines(path.join(destDir, plan.readme.path), plan.readme.lines);
  }
}

/**
 * Merges dependencies and scripts into an existing manifest, keeping the key
 * order npm itself writes so the diff stays readable.
 */
async function mergePackageJson(
  manifestPath: string,
  additions: NonNullable<LayerPlan["packageJson"]>
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
  dependencies: MavenDependency[]
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
