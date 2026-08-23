import { PrismaClient } from "@prisma/client";

// One client per process. `tsx watch` re-imports this module on every save, so
// the instance is parked on globalThis — without that, a morning of editing
// leaves dozens of connection pools open.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
