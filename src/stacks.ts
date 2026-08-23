/** The stacks the CLI can scaffold, and the commands each one needs. */

export const STACKS = ["typescript", "python", "springboot", "nextjs"] as const;
export type Stack = (typeof STACKS)[number];

export const STACK_LABELS: Record<Stack, string> = {
  typescript: "TypeScript (Express)",
  python: "Python (FastAPI)",
  springboot: "Spring Boot",
  nextjs: "Next.js only (API routes, no separate backend)",
};

export const INSTALL_COMMANDS: Record<Stack, string[]> = {
  typescript: ["npm install", "npm run install:all"],
  python: ["npm install", "npm run install:all"],
  springboot: ["npm install", "npm run install:all"],
  // Everything lives in one package, so there is no second install to chain.
  nextjs: ["npm install"],
};

export const DEV_COMMANDS: Record<Stack, string> = {
  typescript: "npm run dev",
  python: "npm run dev",
  springboot: "npm run dev",
  nextjs: "npm run dev",
};

/**
 * What the user still has to do by hand. `needsRemote` covers every way
 * pushing can fail to happen — gh missing, gh unauthenticated, the user
 * declining, or the repo creation itself failing — so a project with commits
 * and no remote always says how to add one.
 */
export function buildNextSteps(
  target: string,
  stack: Stack,
  alreadyInstalled: boolean,
  needsRemote: boolean
): string[] {
  const steps = [`cd ${target}`];
  if (!alreadyInstalled) steps.push(INSTALL_COMMANDS[stack].join(" && "));
  steps.push(DEV_COMMANDS[stack]);
  if (needsRemote) {
    steps.push("git remote add origin <your-repo-url>");
    steps.push("git push -u origin main");
  }
  return steps;
}
