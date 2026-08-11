#!/usr/bin/env node
import { Command } from "commander";
import * as p from "@clack/prompts";
import { execaCommand } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STACKS = ["typescript", "python", "springboot"] as const;
type Stack = (typeof STACKS)[number];

const STACK_LABELS: Record<Stack, string> = {
  typescript: "TypeScript (Express)",
  python: "Python (FastAPI)",
  springboot: "Spring Boot",
};

const INSTALL_COMMANDS: Record<Stack, string[]> = {
  typescript: ["npm install", "npm run install:all"],
  python: ["npm install", "npm run install:all"],
  springboot: ["npm install", "npm run install:all"],
};

const DEV_COMMANDS: Record<Stack, string> = {
  typescript: "npm run dev",
  python: "npm run dev",
  springboot: "npm run dev",
};

const SENTINEL = "__PROJECT_NAME__";

const TEXT_EXTENSIONS = new Set([
  ".json", ".ts", ".tsx", ".js", ".jsx", ".html", ".css",
  ".md", ".yml", ".yaml", ".toml", ".xml", ".env", ".txt",
  ".py", ".java", ".properties", ".gradle", ".cfg",
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

async function scaffold(projectName: string, stack: Stack): Promise<void> {
  const templateDir = path.join(TEMPLATES_DIR, stack);
  const destDir = path.resolve(process.cwd(), projectName);

  try {
    await fs.access(destDir);
    p.log.error(`Directory "${projectName}" already exists.`);
    process.exit(1);
  } catch {
    // Directory doesn't exist — good
  }

  const spinner = p.spinner();
  spinner.start(`Copying ${STACK_LABELS[stack]} template...`);
  await copyDir(templateDir, destDir);
  await replaceInDir(destDir, projectName);
  spinner.stop(`Template copied to ${projectName}/`);
}

/** Returns true only if every install command succeeded. */
async function runInstall(
  projectName: string,
  stack: Stack
): Promise<boolean> {
  const destDir = path.resolve(process.cwd(), projectName);
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
  projectName: string,
  stack: Stack,
  alreadyInstalled: boolean
): void {
  const steps = [`cd ${projectName}`];
  if (!alreadyInstalled) steps.push(INSTALL_COMMANDS[stack].join(" && "));
  steps.push(DEV_COMMANDS[stack]);

  p.note(steps.join("\n"), "Next steps");
}

async function promptProjectName(): Promise<string> {
  const projectName = await p.text({
    message: "Project name:",
    placeholder: "my-app",
    validate(value) {
      if (!value.trim()) return "Project name is required.";
      if (!/^[a-zA-Z0-9_-]+$/.test(value))
        return "Use only letters, numbers, hyphens, and underscores.";
    },
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
    .name("create-launch")
    .description("Scaffold a full-stack hackathon project")
    .argument("[project-name]", "Name of the project")
    .option(
      "--stack <stack>",
      `Backend stack: ${STACKS.join(", ")}`
    )
    .option("--no-install", "Skip dependency installation")
    .parse();

  const args = program.args;
  const opts = program.opts<{ stack?: string; install: boolean }>();

  const shouldInstall = opts.install;
  const available = await getAvailableStacks();

  if (available.length === 0) {
    console.error(
      `No templates found in ${TEMPLATES_DIR}. Did you run "npm run build"?`
    );
    process.exit(1);
  }

  const isNonInteractive = Boolean(args[0] && opts.stack);

  let projectName: string;
  let stack: Stack;

  if (isNonInteractive) {
    projectName = args[0];
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
    p.intro("create-launch — scaffold a full-stack hackathon project");
    projectName = args[0] ?? (await promptProjectName());
    stack = await selectStack(available);
  }

  await scaffold(projectName, stack);

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
      installed = await runInstall(projectName, stack);
    }
  }

  printNextSteps(projectName, stack, installed);
  p.outro("Happy hacking!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
