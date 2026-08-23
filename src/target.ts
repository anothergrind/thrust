/**
 * What's already sitting at a target directory. Scaffolding writes a whole
 * project tree, so it has to know the difference between "nothing there",
 * "an empty folder someone made first" and "a folder with work in it".
 */

import fs from "node:fs/promises";

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
