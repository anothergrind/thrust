/**
 * The opt-in auth stub: signup, login and one protected route, in the same
 * shape on every stack.
 *
 * There is deliberately no library behind it. Every backend here can hash a
 * password and sign a token with what ships in its standard library, and a
 * stub that fits on one screen is easier to replace with a real provider than
 * a half-configured framework would be.
 */

import crypto from "node:crypto";

import type { LayerPlan } from "./layers.js";
import type { Stack } from "./stacks.js";

/** A per-project secret, so no two generated projects sign the same tokens. */
function generateSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

const SECRET_PLACEHOLDER = "replace-me-with-a-long-random-string";

export function planAuth(stack: Stack): LayerPlan {
  const envHeading = "# Auth";
  const env = { AUTH_SECRET: generateSecret() };
  const envExample = { AUTH_SECRET: SECRET_PLACEHOLDER };

  switch (stack) {
    case "typescript":
      return {
        envHeading,
        env,
        envExample,
        wiring: {
          path: "server/src/index.ts",
          imports: ['import { auth } from "./auth.js";'],
          routes: ["app.use(auth);"],
        },
      };

    case "python":
      return {
        envHeading,
        env,
        envExample,
        wiring: {
          path: "server/main.py",
          imports: ["from auth import router as auth_router"],
          routes: ["app.include_router(auth_router)"],
        },
      };

    case "springboot":
      // Component scanning finds the controller and the service on its own;
      // only the secret has to be handed over.
      return {
        envHeading,
        env,
        envExample,
        properties: {
          path: "server/src/main/resources/application.properties",
          heading: "# Auth",
          entries: { "app.auth-secret": "${AUTH_SECRET:" + SECRET_PLACEHOLDER + "}" },
        },
      };

    case "nextjs":
      // Route handlers are found by their place in app/, so there is nothing
      // to register.
      return { envHeading, env, envExample };
  }
}
