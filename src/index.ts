#!/usr/bin/env node
import { Command } from "commander";
import * as p from "@clack/prompts";
import { execa, execaCommand } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectNameError, projectNameWarnings } from "./validate.js";
import { copyDir, replaceInDir, stripMarkers } from "./copy.js";
import {
  DATABASE_LABELS,
  DATABASES,
  isEngine,
  planDatabase,
  type Database,
} from "./databases.js";
import { applyLayer, type LayerPlan } from "./layers.js";
import { planAuth } from "./auth.js";
import {
  buildNextSteps,
  FRONTEND_DETAILS,
  FRONTEND_LABELS,
  FRONTENDS,
  stackTakesFrontend,
  type Frontend,
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

const PROJECT_NAME_SENTINEL = "__PROJECT_NAME__";
const FRONTEND_LABEL_SENTINEL = "__FRONTEND_LABEL__";
const CLIENT_API_ENV_SENTINEL = "__CLIENT_API_ENV__";

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
const BACKENDS_DIR = path.join(TEMPLATES_DIR, "backends");
const FRONTENDS_DIR = path.join(TEMPLATES_DIR, "frontends");
/** The all-in-one stack is a whole project, not a backend half. */
const NEXTJS_DIR = path.join(TEMPLATES_DIR, "nextjs");
const DATABASES_DIR = path.join(TEMPLATES_DIR, "databases");
const AUTH_DIR = path.join(TEMPLATES_DIR, "auth");

async function directoriesIn(dir: string): Promise<Set<string>> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    return new Set();
  }
}

/** Only offer stacks whose template directory actually exists on disk. */
async function getAvailableStacks(): Promise<Stack[]> {
  const present = await directoriesIn(BACKENDS_DIR);
  try {
    await fs.access(NEXTJS_DIR);
    present.add("nextjs");
  } catch {
    // The all-in-one template isn't there; just don't offer it.
  }
  return STACKS.filter((s) => present.has(s));
}

async function getAvailableFrontends(): Promise<Frontend[]> {
  const present = await directoriesIn(FRONTENDS_DIR);
  return FRONTENDS.filter((f) => present.has(f));
}

/** Adds one half's fragment to a file the other half already wrote. */
async function appendPart(partPath: string, destPath: string): Promise<void> {
  const part = await fs.readFile(partPath, "utf-8");
  await fs.appendFile(destPath, part, "utf-8");
}

async function scaffold(
  target: string,
  destDir: string,
  stack: Stack,
  frontend: Frontend,
  database: Database,
  withAuth: boolean
): Promise<string[]> {
  // Setup a database layer can only do once the dependencies are installed.
  const extraInstallSteps: string[] = [];
  const spinner = p.spinner();
  const parts = [STACK_LABELS[stack]];
  if (stackTakesFrontend(stack)) parts.push(FRONTEND_LABELS[frontend]);
  if (isEngine(database)) parts.push(DATABASE_LABELS[database].split(" —")[0]);
  if (withAuth) parts.push("auth");
  spinner.start(`Copying ${parts.join(" + ")} template...`);

  if (stackTakesFrontend(stack)) {
    await copyDir(path.join(BACKENDS_DIR, stack), destDir);
    await copyDir(path.join(FRONTENDS_DIR, frontend, "client"), path.join(destDir, "client"));
    // .env.example and .gitignore are assembled from both halves: each one
    // only knows its own variables and its own build directories.
    await appendPart(path.join(FRONTENDS_DIR, frontend, "_env.example"), path.join(destDir, ".env.example"));
    await appendPart(path.join(FRONTENDS_DIR, frontend, "_gitignore"), path.join(destDir, ".gitignore"));
  } else {
    await copyDir(NEXTJS_DIR, destDir);
  }

  const replacements: Record<string, string> = {
    // The project name becomes an npm package name and the browser tab title,
    // so it must be the folder name alone — never a path like "../my-app".
    [PROJECT_NAME_SENTINEL]: path.basename(destDir),
    [FRONTEND_LABEL_SENTINEL]: FRONTEND_DETAILS[frontend].label,
    [CLIENT_API_ENV_SENTINEL]: FRONTEND_DETAILS[frontend].apiEnv,
  };

  const layers: { templateDir: string; plan: LayerPlan }[] = [];
  if (isEngine(database)) {
    layers.push({
      templateDir: path.join(DATABASES_DIR, stack),
      plan: planDatabase(stack, database),
    });
  }
  if (withAuth) {
    layers.push({ templateDir: path.join(AUTH_DIR, stack), plan: planAuth(stack) });
  }

  for (const layer of layers) {
    await applyLayer(destDir, layer.templateDir, layer.plan);
    await writeEnvEntries(destDir, stack, layer.plan);
    Object.assign(replacements, layer.plan.replacements);
    if (layer.plan.installStep) extraInstallSteps.push(layer.plan.installStep);
  }

  await replaceInDir(destDir, replacements);
  // Whatever the optional layers didn't use is scaffolding noise.
  await stripMarkers(destDir);

  spinner.stop(`Template copied to ${target}/`);
  return extraInstallSteps;
}

/**
 * A layer's variables go wherever that stack reads its environment from: the
 * backend's own .env for a split project, the app root for the all-in-one.
 * The real values go in .env, and .env.example gets whatever is safe to
 * commit — a generated secret belongs in neither a repository nor a README.
 */
async function writeEnvEntries(
  destDir: string,
  stack: Stack,
  plan: LayerPlan
): Promise<void> {
  if (!plan.env) return;

  const format = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([key, value]) => `${key}="${value}"`)
      .join("\n") + "\n";

  const heading = plan.envHeading ? `${plan.envHeading}\n` : "";
  const real = format(plan.env);
  const example = `${heading}${format(plan.envExample ?? plan.env)}`;

  if (stackTakesFrontend(stack)) {
    await fs.appendFile(path.join(destDir, "server", ".env"), real, "utf-8");
    await fs.appendFile(path.join(destDir, ".env.example"), `\n${example}`, "utf-8");
    return;
  }

  // The all-in-one app has no .env at all until a layer needs one.
  const started = await fs
    .readFile(path.join(destDir, ".env.example"), "utf-8")
    .catch(() => "");
  await fs.appendFile(path.join(destDir, ".env"), real, "utf-8");
  await fs.appendFile(
    path.join(destDir, ".env.example"),
    started === "" ? example : `\n${example}`,
    "utf-8"
  );

  const gitignorePath = path.join(destDir, ".gitignore");
  const gitignore = await fs.readFile(gitignorePath, "utf-8");
  if (!gitignore.includes("\n.env\n")) {
    await fs.appendFile(gitignorePath, `\n# Environment\n.env\n!.env.example\n`, "utf-8");
  }
}

/** Returns true only if every install command succeeded. */
async function runInstall(
  destDir: string,
  stack: Stack,
  extraSteps: string[]
): Promise<boolean> {
  const spinner = p.spinner();
  spinner.start("Installing dependencies...");
  try {
    for (const cmd of [...INSTALL_COMMANDS[stack], ...extraSteps]) {
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
  needsRemote: boolean,
  extraInstallSteps: string[]
): void {
  const steps = buildNextSteps(
    target,
    stack,
    alreadyInstalled,
    needsRemote,
    extraInstallSteps
  );
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

async function selectFrontend(available: Frontend[]): Promise<Frontend> {
  const frontend = await p.select({
    message: "Pick a frontend:",
    options: available.map((f) => ({ value: f, label: FRONTEND_LABELS[f] })),
  });

  if (p.isCancel(frontend)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return frontend as Frontend;
}

async function selectDatabase(): Promise<Database> {
  const database = await p.select({
    message: "Add a database layer?",
    options: DATABASES.map((d) => ({ value: d, label: DATABASE_LABELS[d] })),
  });

  if (p.isCancel(database)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return database as Database;
}

/** Asked last, because it is the one choice that changes nothing else. */
async function confirmAuth(): Promise<boolean> {
  const wanted = await p.confirm({
    message: "Add an auth stub (signup, login, a protected route)?",
    initialValue: false,
  });

  if (p.isCancel(wanted)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return wanted;
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
    .option(
      "--frontend <frontend>",
      `Frontend framework: ${FRONTENDS.join(", ")} (default: next)`
    )
    .option("--auth", "Add a signup/login stub with a protected route")
    .option(
      "--db <database>",
      `Database layer: ${DATABASES.join(", ")} (default: none)`
    )
    .option("--no-install", "Skip dependency installation")
    .option("--no-git", "Skip git repository initialization")
    .option("--github", "Create a GitHub repository and push (requires gh)")
    .option("--public", "Make the created GitHub repository public")
    .parse();

  const args = program.args;
  const opts = program.opts<{
    stack?: string;
    frontend?: string;
    db?: string;
    auth?: boolean;
    install: boolean;
    git: boolean;
    github?: boolean;
    public?: boolean;
  }>();

  const shouldInstall = opts.install;
  const available = await getAvailableStacks();
  const availableFrontends = await getAvailableFrontends();

  if (available.length === 0) {
    console.error(
      `No templates found in ${TEMPLATES_DIR}. Did you run "npm run build"?`
    );
    process.exit(1);
  }

  const isNonInteractive = Boolean(args[0] && opts.stack);

  let target: string;
  let stack: Stack;
  let frontend: Frontend = "next";
  let database: Database = "none";
  let withAuth = false;

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

    if (opts.frontend !== undefined) {
      if (!FRONTENDS.includes(opts.frontend as Frontend)) {
        console.error(
          `Unknown frontend "${opts.frontend}". Choose from: ${FRONTENDS.join(", ")}`
        );
        process.exit(1);
      }
      if (!stackTakesFrontend(stack)) {
        console.error(
          `The "${stack}" stack is a Next.js app already, so it has no separate frontend to choose.`
        );
        process.exit(1);
      }
      if (!availableFrontends.includes(opts.frontend as Frontend)) {
        console.error(
          `The "${opts.frontend}" frontend isn't available yet. Ready now: ${availableFrontends.join(", ")}`
        );
        process.exit(1);
      }
      frontend = opts.frontend as Frontend;
    }

    if (opts.db !== undefined) {
      if (!DATABASES.includes(opts.db as Database)) {
        console.error(
          `Unknown database "${opts.db}". Choose from: ${DATABASES.join(", ")}`
        );
        process.exit(1);
      }
      database = opts.db as Database;
    }

    withAuth = opts.auth === true;
  } else {
    // The prompts need a real terminal. Without this the first prompt throws
    // ERR_TTY_INIT_FAILED and the user gets a Node stack trace instead of a
    // hint — which is what happens in CI, in a Docker build, or behind a pipe.
    if (!process.stdin.isTTY) {
      console.error(
        "The prompts need an interactive terminal." +
          `\nPass a name and a stack to skip them, e.g. create-thrust my-app --stack=${STACKS[0]}` +
          "\nRun with --help to see every option."
      );
      process.exit(1);
    }

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

    // Only asked when there's a choice to make: the all-in-one stack is a
    // Next.js app, and a lone frontend isn't worth a prompt.
    if (stackTakesFrontend(stack) && availableFrontends.length > 1) {
      frontend = await selectFrontend(availableFrontends);
    }

    database = await selectDatabase();
    withAuth = opts.auth === true || (await confirmAuth());
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

  const extraInstallSteps = await scaffold(
    target,
    destDir,
    stack,
    frontend,
    database,
    withAuth
  );

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
      installed = await runInstall(destDir, stack, extraInstallSteps);
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

  printNextSteps(target, stack, installed, committed && !pushed, extraInstallSteps);
  p.outro("Happy hacking!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
