/**
 * Rules for the final folder name of a target path. That name is copied into
 * package.json, pom.xml and the browser title of the generated project, so it
 * has to be legal as a folder name *and* as an npm package name — including
 * the "-client" and "-server" variants the templates derive from it.
 */

import { builtinModules } from "node:module";

/** npm's limit for a package name. */
const NPM_NAME_MAX = 214;

/** Templates append "-client" / "-server", so the base has less room. */
export const MAX_NAME_LENGTH = NPM_NAME_MAX - "-client".length;

/** npm refuses these outright, whatever else the name looks like. */
const NPM_RESERVED = new Set(["node_modules", "favicon.ico"]);

/** MS-DOS device names Windows still won't create a file or folder for. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

const ALLOWED_CHARACTERS = /^[a-zA-Z0-9._-]+$/;

const CORE_MODULES = new Set(
  builtinModules.filter((m) => !m.startsWith("_") && !m.includes("/"))
);

/**
 * A name close to `base` that satisfies every rule below, used to make error
 * messages actionable. Returns undefined when nothing usable is left.
 */
export function suggestProjectName(base: string): string | undefined {
  let suggestion = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[.\s-]+$/, "")
    .slice(0, MAX_NAME_LENGTH);

  // Truncating can expose a fresh trailing separator.
  suggestion = suggestion.replace(/[.-]+$/, "");

  if (!suggestion) return undefined;
  if (NPM_RESERVED.has(suggestion)) return undefined;
  if (WINDOWS_RESERVED.test(stripExtension(suggestion))) {
    // Only the stem is reserved, so fold any extension into the name — a bare
    // "con.txt-app" would still be a device name as far as Windows is concerned.
    suggestion = `${suggestion.replaceAll(".", "-")}-app`;
  }
  return suggestion;
}

function stripExtension(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

function withSuggestion(message: string, base: string): string {
  const suggestion = suggestProjectName(base);
  return suggestion ? `${message} Try "${suggestion}".` : message;
}

/**
 * The reason `base` can't be used, or undefined when it's fine. Only hard
 * failures live here — things npm or the filesystem would reject outright.
 * Anything merely inadvisable belongs in projectNameWarnings.
 */
export function projectNameError(base: string): string | undefined {
  if (!base.trim()) return "Project name is required.";

  if (base.length > MAX_NAME_LENGTH)
    return `The final folder name is ${base.length} characters; npm allows ${NPM_NAME_MAX}, and the generated client and server packages add "-client" and "-server" to it. Keep it to ${MAX_NAME_LENGTH}.`;

  if (base !== base.trim())
    return withSuggestion("The final folder name can't start or end with a space.", base);

  if (!ALLOWED_CHARACTERS.test(base))
    return withSuggestion(
      "The final folder name may use only letters, numbers, dots, hyphens, and underscores.",
      base
    );

  if (/^[._]/.test(base))
    return withSuggestion("The final folder name can't start with a dot or underscore.", base);

  if (base.endsWith("."))
    return withSuggestion("The final folder name can't end with a dot — Windows drops it.", base);

  if (NPM_RESERVED.has(base.toLowerCase()))
    return `"${base}" is reserved by npm and can't be used as a package name.`;

  if (WINDOWS_RESERVED.test(stripExtension(base)))
    return withSuggestion(
      `"${base}" is a reserved device name on Windows, so the folder can't be created there.`,
      `${base}-app`
    );

  return undefined;
}

/**
 * Problems worth mentioning that still let scaffolding go ahead: the project is
 * generated as a private package, so npm's publish-time rules only bite later.
 */
export function projectNameWarnings(base: string): string[] {
  const warnings: string[] = [];

  if (/[A-Z]/.test(base))
    warnings.push(
      `npm won't accept "${base}" as a package name when published — it has to be lowercase. The generated project is private, so this only matters if you publish it.`
    );

  if (CORE_MODULES.has(base.toLowerCase()))
    warnings.push(
      `"${base}" is the name of a Node core module, which will confuse imports if the project is ever published.`
    );

  return warnings;
}
