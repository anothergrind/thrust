/**
 * Runs Maven against server/, preferring the project's Maven Wrapper (./mvnw)
 * and falling back to a system `mvn` installation.
 *
 * It also loads server/.env into the child process environment, so SERVER_PORT
 * and CLIENT_ORIGIN behave exactly like they do in the other create-launch
 * templates — application.properties reads them as ${SERVER_PORT} etc.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "server");
const isWindows = process.platform === "win32";

function loadEnv() {
  const env = { ...process.env };
  const envPath = path.join(serverDir, ".env");
  if (!existsSync(envPath)) return env;

  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    // A real environment variable always wins over the .env file.
    if (!(key in env)) env[key] = trimmed.slice(separator + 1).trim();
  }
  return env;
}

function resolveMaven() {
  const wrapper = path.join(serverDir, isWindows ? "mvnw.cmd" : "mvnw");
  if (existsSync(wrapper)) return wrapper;

  const probe = spawnSync("mvn", ["-v"], { stdio: "ignore", shell: isWindows });
  if (!probe.error && probe.status === 0) return "mvn";

  console.error(
    [
      "Maven was not found.",
      "",
      "Install Maven (https://maven.apache.org/install.html), or add the Maven",
      "Wrapper to server/ so no system install is needed:",
      "",
      "    cd server && mvn wrapper:wrapper",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const result = spawnSync(resolveMaven(), process.argv.slice(2), {
  cwd: serverDir,
  stdio: "inherit",
  env: loadEnv(),
  shell: isWindows,
});

if (result.error) throw result.error;
process.exit(result.status ?? 0);
