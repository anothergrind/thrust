#!/usr/bin/env node
import { Command } from "commander";
import * as p from "@clack/prompts";
import { execa, execaCommand } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectNameError, projectNameWarnings } from "./validate.js";
import {
  buildNextSteps,
  INSTALL_COMMANDS,
  STACK_LABELS,
  STACKS,
  type Stack,
} from "./stacks.js";
import {
  inspectTarget,
  resolveTarget,
  targetBaseName,
  targetBlockedMessage,
  typedBaseName,
} from "./target.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SENTINEL = "__PROJECT_NAME__";

const TEXT_EXTENSIONS = new Set([
  ".json", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".html", ".css", ".md", ".yml", ".yaml", ".toml", ".xml",
  ".env", ".txt", ".py", ".java", ".properties", ".gradle", ".cfg",
]);

function isTextFile(filename: string): boolean {
  if (filename.startsWith("_env") || filename.startsWith(".env")) return true;
  const ext = path.extname(filename).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * npm strips dotfiles from published tarballs, so templates store them with a
 * leading underscore and we restore the real name on copy.
 */
function renameDotfile(name: string): string {
  if (name === "_gitignore") return ".gitignore";
  if (name === "_env") return ".env";
  if (name === "_env.example") return ".env.example";
  if (name === "_mvn") return ".mvn";
  return name;
}

async function copyDir(src: string, dest: string): Promise<void> {
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
    }
  }
}

async function replaceInDir(dir: string, projectName: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await replaceInDir(fullPath, projectName);
    } else if (isTextFile(entry.name)) {
      const content = await fs.readFile(fullPath, "utf-8");
      if (content.includes(SENTINEL)) {
        await fs.writeFile(fullPath, content.replaceAll(SENTINEL, projectName), "utf-8");
      }
    }
  }
}

/** True if `command --version` runs successfully, i.e. it's on PATH. */
async function hasCommand(command: string): Promise<boolean> {
  try {
    await execa(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks up from `dir` to the first directory that exists on disk. The target
 * project directory doesn't exist yet, and the user may have asked for nested
 * parents ("../work/new/app"), so repo detection has to start somewhere real.
 */
async function nearestExistingDir(dir: string): Promise<string> {
  let current = dir;
  for (;;) {
    try {
      await fs.access(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/** Root of the git repo containing `dir`, or null when it isn't inside one. */
async function findEnclosingRepo(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Makes the generated project its own repo with one commit. Without this a
 * project scaffolded inside another repo is silently absorbed by that parent.
 */
async function initGitRepo(destDir: string): Promise<boolean> {
  try {
    await execa("git", ["init", "-b", "main"], { cwd: destDir });
    await execa("git", ["add", "-A"], { cwd: destDir });
    await execa("git", ["commit", "-m", "Initial commit from thrust"], {
      cwd: destDir,
    });
    return true;
  } catch {
    return false;
  }
}

/** gh is only usable for repo creation when it's installed *and* logged in. */
async function isGhReady(): Promise<boolean> {
  if (!(await hasCommand("gh"))) return false;
  try {
    await execa("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function createGitHubRepo(
  destDir: string,
  repoName: string,
  visibility: "private" | "public"
): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "gh",
      [
        "repo",
        "create",
        repoName,
        `--${visibility}`,
        "--source",
        ".",
        "--remote",
        "origin",
        "--push",
      ],
      { cwd: destDir }
    );
    const url = stdout.match(/https:\/\/\S+/)?.[0];
    return url ?? "";
  } catch {
    return null;
  }
}

const TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");

/** Only offer stacks whose template directory actually exists on disk. */
async function getAvailableStacks(): Promise<Stack[]> {
  try {
    const entries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
    const present = new Set(
      entries.filter((e) => e.isDirectory()).map((e) => e.name)
    );
    return STACKS.filter((s) => present.has(s));
  } catch {
    return [];
  }
}

async function scaffold(
  target: string,
  destDir: string,
  stack: Stack
): Promise<void> {
  const templateDir = path.join(TEMPLATES_DIR, stack);

  const spinner = p.spinner();
  spinner.start(`Copying ${STACK_LABELS[stack]} template...`);
  await copyDir(templateDir, destDir);
  // The sentinel becomes an npm package name and the browser tab title, so it
  // must be the folder name alone — never a path like "../my-app".
  await replaceInDir(destDir, path.basename(destDir));
  spinner.stop(`Template copied to ${target}/`);
}

/** Returns true only if every install command succeeded. */
async function runInstall(destDir: string, stack: Stack): Promise<boolean> {
  const spinner = p.spinner();
  spinner.start("Installing dependencies...");
  try {
    for (const cmd of INSTALL_COMMANDS[stack]) {
      await execaCommand(cmd, { cwd: destDir });
    }
    spinner.stop("Dependencies installed.");
    return true;
  } catch {
    spinner.stop("Could not install dependencies — run the steps below by hand.");
    return false;
  }
}

function printNextSteps(
  target: string,
  stack: Stack,
  alreadyInstalled: boolean,
  needsRemote: boolean
): void {
  const steps = buildNextSteps(target, stack, alreadyInstalled, needsRemote);
  p.note(steps.join("\n"), "Next steps");
}

/**
 * Accepts either a bare name ("my-app") or a path ("../my-app", "~/code/app"),
 * so a project can be created outside the current directory. Only the final
 * folder name is constrained, since that becomes the npm package name.
 */
function validateTarget(value: string): string | undefined {
  if (!value.trim()) return "Project name is required.";
  const base = targetBaseName(value);
  if (!base) {
    return "That path doesn't end in a folder name — add one, like ~/code/my-app.";
  }
  const error = projectNameError(base);
  if (!error) return undefined;
  // "." and ".." borrow their name from a folder the user never typed, so say
  // which one the complaint is about.
  return typedBaseName(value) === base
    ? error
    : `"${value.trim()}" points at a folder called "${base}". ${error}`;
}

async function promptProjectName(): Promise<string> {
  const projectName = await p.text({
    message: "Project name or path:",
    placeholder: "my-app",
    validate: validateTarget,
  });

  if (p.isCancel(projectName)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return projectName as string;
}

async function selectStack(available: Stack[]): Promise<Stack> {
  const stack = await p.select({
    message: "Pick a backend stack:",
    options: available.map((s) => ({ value: s, label: STACK_LABELS[s] })),
  });

  if (p.isCancel(stack)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return stack as Stack;
}

async function main(): Promise<void> {
  const program = new Command()
    .name("create-thrust")
    .description("Scaffold a full-stack hackathon project")
    .argument("[project-name]", "Name of the project")
    .option(
      "--stack <stack>",
      `Backend stack: ${STACKS.join(", ")}`
    )
    .option("--no-install", "Skip dependency installation")
    .option("--no-git", "Skip git repository initialization")
    .option("--github", "Create a GitHub repository and push (requires gh)")
    .option("--public", "Make the created GitHub repository public")
    .parse();

  const args = program.args;
  const opts = program.opts<{
    stack?: string;
    install: boolean;
    git: boolean;
    github?: boolean;
    public?: boolean;
  }>();

  const shouldInstall = opts.install;
  const available = await getAvailableStacks();

  if (available.length === 0) {
    console.error(
      `No templates found in ${TEMPLATES_DIR}. Did you run "npm run build"?`
    );
    process.exit(1);
  }

  const isNonInteractive = Boolean(args[0] && opts.stack);

  let target: string;
  let stack: Stack;

  if (isNonInteractive) {
    target = args[0];
    const invalid = validateTarget(target);
    if (invalid) {
      console.error(invalid);
      process.exit(1);
    }
    if (!STACKS.includes(opts.stack as Stack)) {
      console.error(
        `Unknown stack "${opts.stack}". Choose from: ${STACKS.join(", ")}`
      );
      process.exit(1);
    }
    if (!available.includes(opts.stack as Stack)) {
      console.error(
        `The "${opts.stack}" template isn't available yet. Ready now: ${available.join(", ")}`
      );
      process.exit(1);
    }
    stack = opts.stack as Stack;
  } else {
    p.intro("thrust — scaffold a full-stack hackathon project");
    target = args[0] ?? (await promptProjectName());
    if (args[0]) {
      const invalid = validateTarget(target);
      if (invalid) {
        p.cancel(invalid);
        process.exit(1);
      }
    }
    stack = await selectStack(available);
  }

  const destDir = resolveTarget(target);

  for (const warning of projectNameWarnings(targetBaseName(target))) {
    p.log.warn(warning);
  }

  // Checked before anything else is asked, so a doomed run fails on its first
  // screen rather than after the install and GitHub questions.
  const blocked = targetBlockedMessage(target, await inspectTarget(destDir));
  if (blocked) {
    p.log.error(blocked);
    process.exit(1);
  }

  // A project created inside another repo gets absorbed by it, which is rarely
  // what anyone wants — surface it before writing any files.
  const parentRepo = await findEnclosingRepo(
    await nearestExistingDir(path.dirname(destDir))
  );
  if (parentRepo) {
    p.log.warn(
      `${destDir} is inside the existing git repository at ${parentRepo}.\n` +
        "The new project would show up as untracked files there."
    );
    if (!isNonInteractive) {
      const proceed = await p.confirm({
        message: "Create it here anyway?",
        initialValue: false,
      });
      if (p.isCancel(proceed) || !proceed) {
        p.cancel("Cancelled — try a path outside that repository.");
        process.exit(0);
      }
    }
  }

  await scaffold(target, destDir, stack);

  let installed = false;

  if (shouldInstall) {
    const doInstall = isNonInteractive
      ? true
      : await p.confirm({ message: "Install dependencies now?" });
    if (p.isCancel(doInstall)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    if (doInstall) {
      installed = await runInstall(destDir, stack);
    }
  }

  let committed = false;

  if (opts.git) {
    if (await hasCommand("git")) {
      committed = await initGitRepo(destDir);
      if (committed) {
        p.log.success("Initialized a git repository with an initial commit.");
      } else {
        p.log.warn(
          "Could not create the initial commit — check that user.name and user.email are set in your git config."
        );
      }
    } else {
      p.log.warn("git isn't on PATH, so the project wasn't initialized.");
    }
  }

  let pushed = false;

  // --github can't be honoured without a commit, and silently doing nothing
  // would look like the push succeeded.
  if (opts.github && !committed) {
    p.log.warn(
      opts.git
        ? "--github had nothing to push, because the initial commit wasn't created."
        : "--github needs a git repository, but --no-git was passed. Nothing was pushed."
    );
  }

  // Pushing is only offered once there's a commit to push.
  if (committed && (opts.github || !isNonInteractive)) {
    const ghReady = await isGhReady();

    if (opts.github && !ghReady) {
      p.log.warn(
        "--github needs the GitHub CLI installed and authenticated (https://cli.github.com, then `gh auth login`)."
      );
    }

    if (ghReady) {
      const wanted = opts.github
        ? true
        : await p.confirm({
            message: "Create a GitHub repository and push?",
            initialValue: false,
          });
      if (p.isCancel(wanted)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      if (wanted) {
        const visibility = opts.public ? "public" : "private";
        const spinner = p.spinner();
        spinner.start(`Creating ${visibility} GitHub repository...`);
        const url = await createGitHubRepo(
          destDir,
          path.basename(destDir),
          visibility
        );
        if (url === null) {
          spinner.stop("Could not create the GitHub repository.");
        } else {
          spinner.stop(`Pushed to ${url || "GitHub"}`);
          pushed = true;
        }
      }
    }
  }

  printNextSteps(target, stack, installed, committed && !pushed);
  p.outro("Happy hacking!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
