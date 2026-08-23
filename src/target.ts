/**
 * Turning what the user typed into a directory to write into: resolving it to
 * an absolute path, working out the folder name it ends in, and checking what
 * is already sitting there.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type TargetState =
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "occupied"; entries: string[] }
  | { kind: "file" };

export async function inspectTarget(destDir: string): Promise<TargetState> {
  let stats;
  try {
    stats = await fs.stat(destDir);
  } catch {
    return { kind: "missing" };
  }

  if (!stats.isDirectory()) return { kind: "file" };

  const entries = await fs.readdir(destDir);
  if (entries.length === 0) return { kind: "empty" };
  return { kind: "occupied", entries };
}

/** "a, b and 2 more" — enough to recognise the folder without a wall of text. */
function describeEntries(entries: string[]): string {
  const shown = entries.slice(0, 3);
  const rest = entries.length - shown.length;
  const listed = shown.join(", ");
  return rest > 0 ? `${listed} and ${rest} more` : listed;
}

/**
 * Why `state` can't be scaffolded into, or undefined when it can. An empty
 * directory is allowed: people run `mkdir my-app && cd my-app` first, and
 * refusing that is more annoying than helpful.
 */
export function targetBlockedMessage(
  target: string,
  state: TargetState
): string | undefined {
  if (state.kind === "file") {
    return `"${target}" is a file, so a project can't be created there.`;
  }
  if (state.kind === "occupied") {
    return `"${target}" already exists and isn't empty (${describeEntries(
      state.entries
    )}). Pick another name, or empty that folder first — nothing was written.`;
  }
  return undefined;
}

/**
 * Resolves a target to an absolute directory, expanding a leading "~". The
 * interactive prompt has no shell behind it, so "~/code/app" typed there would
 * otherwise create a folder literally named "~".
 */
export function resolveTarget(value: string): string {
  let input = value.trim();
  if (input === "~") {
    input = os.homedir();
  } else if (input.startsWith("~/") || input.startsWith("~\\")) {
    input = path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(process.cwd(), input);
}

/** The last segment of a target as typed, before any path resolution. */
export function typedBaseName(value: string): string {
  const trimmed = value.trim().replace(/[/\\]+$/, "");
  return trimmed.split(/[/\\]+/).pop() ?? "";
}

/**
 * The folder name a target ends in — the part that becomes the project name.
 * Read from the typed segment rather than the resolved path, because resolving
 * normalizes away some of the characters worth complaining about. "~", "." and
 * ".." name a folder only once resolved, so those fall back to the real path.
 */
export function targetBaseName(value: string): string {
  const typed = typedBaseName(value);
  if (typed === "" || typed === "~" || typed === "." || typed === "..") {
    return path.basename(resolveTarget(value));
  }
  return typed;
}
