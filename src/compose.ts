/**
 * The project's docker-compose.yml, assembled rather than copied: a skeleton
 * with a marker per section, and a fragment for each service that wants to be
 * in it.
 *
 * A database and an object store both want a compose file, and a project can
 * have both — so a layer contributes a service to the file instead of owning
 * the whole of it.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { insertAtMarker } from "./copy.js";
import type { ComposeService } from "./layers.js";

/**
 * One pair of scripts for the whole file, whatever is in it. `--wait` is what
 * makes `docker:up` worth running before anything else: it returns when the
 * services are up, not when Docker has agreed to start them.
 */
export const COMPOSE_SCRIPTS: Record<string, string> = {
  "docker:up": "docker compose up -d --wait",
  "docker:down": "docker compose down",
};

/** The step the CLI prints for starting whatever ended up in the file. */
export function composeStep(services: ComposeService[]): { command: string; reason: string } {
  const labels = services.map((service) => service.label);
  const list =
    labels.length > 1
      ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
      : labels[0];
  return {
    command: "npm run docker:up",
    reason: `starts ${list} in Docker (skip it for hosted services)`,
  };
}

export async function assembleCompose(
  templatesDir: string,
  destDir: string,
  services: ComposeService[]
): Promise<void> {
  const composePath = path.join(destDir, "docker-compose.yml");
  await fs.copyFile(path.join(templatesDir, "compose", "docker-compose.yml"), composePath);

  for (const [index, service] of services.entries()) {
    const fragmentPath = path.join(
      templatesDir,
      "compose",
      "services",
      `${service.fragment}.yml`
    );
    const fragment = await fs.readFile(fragmentPath, "utf-8");
    // The marker's own indentation is added to every line, so the fragments
    // are written flush left: a service is a top-level key in its own file.
    // The blank line goes between services, never after the last one, so
    // the file reads the same however many of them there are.
    const lines = [...(index > 0 ? [""] : []), ...fragment.trimEnd().split("\n")];
    await insertAtMarker(composePath, "services", lines);
    if (service.volume) {
      await insertAtMarker(composePath, "volumes", [`${service.volume}:`]);
    }
  }
}
