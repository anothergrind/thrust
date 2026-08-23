import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This project keeps separate package.json files for the client and server,
  // so point Turbopack at this directory instead of letting it guess a root
  // from the nearest lockfile.
  turbopack: {
    root: __dirname,
  },

  // Don't auto-generate AGENTS.md / CLAUDE.md. Set this to true if you want
  // Next.js to write its AI agent instruction files into the project.
  agentRules: false,
};

export default nextConfig;
