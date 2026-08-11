/**
 * Runs the project's Python interpreter, creating .venv on first use.
 *
 * This exists so `npm run dev` behaves identically on Windows, macOS, and
 * Linux — the venv interpreter lives in Scripts/ on Windows and bin/ elsewhere,
 * which a plain npm script can't express portably.
 *
 *   node scripts/py.mjs --install   install requirements.txt into .venv
 *   node scripts/py.mjs main.py     run a script with the venv interpreter
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "server");
const venvDir = path.join(root, ".venv");

const isWindows = process.platform === "win32";
const venvPython = path.join(
  venvDir,
  isWindows ? "Scripts" : "bin",
  isWindows ? "python.exe" : "python"
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findSystemPython() {
  for (const candidate of isWindows ? ["py", "python"] : ["python3", "python"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  console.error(
    "Python 3 was not found on PATH. Install it from https://python.org and try again."
  );
  process.exit(1);
}

if (!existsSync(venvPython)) {
  console.log("Creating virtual environment in .venv ...");
  run(findSystemPython(), ["-m", "venv", venvDir]);
}

const args = process.argv.slice(2);

if (args[0] === "--install") {
  run(venvPython, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  run(venvPython, [
    "-m",
    "pip",
    "install",
    "--quiet",
    "-r",
    path.join(serverDir, "requirements.txt"),
  ]);
  console.log("Python dependencies installed into .venv");
} else {
  run(venvPython, args, { cwd: serverDir });
}
