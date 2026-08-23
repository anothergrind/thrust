import { PrismaClient } from "@prisma/client";

// One client per process. Next.js reloads modules on every edit in dev, so the
// instance is parked on globalThis — without that, an afternoon of editing
// leaves dozens of connection pools open.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
