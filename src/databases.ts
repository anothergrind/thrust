/**
 * The opt-in database layer: which engines can be chosen, and what each stack
 * needs in order to talk to them.
 *
 * Every stack ends up with the same shape — a model, a repository or client,
 * and a worked GET/POST /api/items — reached through whichever ORM is native
 * to that language: Prisma for TypeScript, SQLAlchemy for Python, Spring Data
 * JPA for Java. The connection string always comes from DATABASE_URL, so the
 * variable name is the same wherever you look.
 */

import type { Stack } from "./stacks.js";

export const DATABASES = ["none", "sqlite", "postgres", "mysql"] as const;
export type Database = (typeof DATABASES)[number];

/** Every database except "none", which means "don't scaffold a layer at all". */
export type Engine = Exclude<Database, "none">;

export const DATABASE_LABELS: Record<Database, string> = {
  none: "None — add one later",
  sqlite: "SQLite — a file, nothing to install",
  postgres: "PostgreSQL — also Supabase, Neon, RDS",
  mysql: "MySQL or MariaDB",
};

export function isEngine(database: Database): database is Engine {
  return database !== "none";
}

/** Prisma's provider name and a starting DATABASE_URL, per engine. */
const PRISMA: Record<Engine, { provider: string; url: string }> = {
  sqlite: { provider: "sqlite", url: "file:./dev.db" },
  postgres: {
    provider: "postgresql",
    url: "postgresql://postgres:postgres@localhost:5432/__PROJECT_NAME__",
  },
  mysql: { provider: "mysql", url: "mysql://root:root@localhost:3306/__PROJECT_NAME__" },
};

/** SQLAlchemy URLs, and the driver each one needs on top of SQLAlchemy. */
const SQLALCHEMY: Record<Engine, { url: string; requirements: string[] }> = {
  sqlite: { url: "sqlite:///./dev.db", requirements: [] },
  postgres: {
    url: "postgresql+psycopg://postgres:postgres@localhost:5432/__PROJECT_NAME__",
    requirements: ["psycopg[binary]>=3.2"],
  },
  mysql: {
    url: "mysql+pymysql://root:root@localhost:3306/__PROJECT_NAME__",
    requirements: ["PyMySQL>=1.1"],
  },
};

type MavenDependency = { groupId: string; artifactId: string; scope?: string };

/**
 * JDBC settings per engine. SQLite has no Hibernate dialect in the core
 * distribution, so it also pulls in the community dialects module — the same
 * arrangement Spring's own SQLite guides use.
 */
const JDBC: Record<
  Engine,
  { url: string; driver: MavenDependency; properties: Record<string, string> }
> = {
  sqlite: {
    url: "jdbc:sqlite:./dev.db",
    driver: { groupId: "org.xerial", artifactId: "sqlite-jdbc" },
    properties: {
      "spring.jpa.properties.hibernate.dialect":
        "org.hibernate.community.dialect.SQLiteDialect",
    },
  },
  postgres: {
    url: "jdbc:postgresql://localhost:5432/__PROJECT_NAME__",
    driver: { groupId: "org.postgresql", artifactId: "postgresql", scope: "runtime" },
    properties: {
      "spring.datasource.username": "${DATABASE_USER:postgres}",
      "spring.datasource.password": "${DATABASE_PASSWORD:postgres}",
    },
  },
  mysql: {
    url: "jdbc:mysql://localhost:3306/__PROJECT_NAME__",
    driver: { groupId: "com.mysql", artifactId: "mysql-connector-j", scope: "runtime" },
    properties: {
      "spring.datasource.username": "${DATABASE_USER:root}",
      "spring.datasource.password": "${DATABASE_PASSWORD:root}",
    },
  },
};

const EXTRA_SQLITE_JAVA: MavenDependency = {
  groupId: "org.hibernate.orm",
  artifactId: "hibernate-community-dialects",
};

const PRISMA_VERSION = "^6.2.0";

/** What applying a database to a project involves, resolved per stack. */
export type DatabasePlan = {
  /** DATABASE_URL for the generated .env, before the project name is filled in. */
  url: string;
  /** Sentinel values only this layer knows about. */
  replacements: Record<string, string>;
  /** package.json fields to merge into the server's (or the app's) manifest. */
  packageJson?: {
    path: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  /** Lines appended to a requirements.txt. */
  requirements?: { path: string; lines: string[] };
  /** Maven dependencies inserted at the pom's marker. */
  maven?: { path: string; dependencies: MavenDependency[] };
  /** Lines appended to a Spring properties file. */
  properties?: { path: string; entries: Record<string, string> };
  /** Import and route registration lines for the backend's entry point. */
  wiring?: { path: string; imports: string[]; routes: string[] };
  /** Extra .gitignore entries, e.g. the SQLite file itself. */
  gitignore?: string[];
  /** Appended to the root install command, for setup that can run offline. */
  installStep?: string;
};

/**
 * Where each stack's SQLite file actually lands. Prisma resolves a relative
 * url against the schema's directory, while SQLAlchemy and JDBC resolve it
 * against the process's working directory — which is the server folder.
 */
const SQLITE_IGNORES: Record<Stack, string[]> = {
  typescript: ["", "# Database", "server/prisma/dev.db", "server/prisma/dev.db-journal"],
  nextjs: ["", "# Database", "prisma/dev.db", "prisma/dev.db-journal"],
  python: ["", "# Database", "server/dev.db", "server/dev.db-journal"],
  springboot: ["", "# Database", "server/dev.db", "server/dev.db-journal"],
};

export function planDatabase(stack: Stack, engine: Engine): DatabasePlan {
  switch (stack) {
    case "typescript":
      return {
        url: PRISMA[engine].url,
        replacements: { __DB_PROVIDER__: PRISMA[engine].provider },
        packageJson: {
          path: "server/package.json",
          dependencies: { "@prisma/client": PRISMA_VERSION },
          devDependencies: { prisma: PRISMA_VERSION },
          scripts: {
            postinstall: "prisma generate",
            "db:push": "prisma db push",
            "db:studio": "prisma studio",
          },
        },
        wiring: {
          path: "server/src/index.ts",
          imports: ['import { items } from "./items.js";'],
          routes: ["app.use(items);"],
        },
        // SQLite needs no server, so the table can be created during install.
        installStep: engine === "sqlite" ? "npm run db:push --prefix server" : undefined,
        gitignore: engine === "sqlite" ? SQLITE_IGNORES.typescript : undefined,
      };

    case "nextjs":
      return {
        url: PRISMA[engine].url,
        replacements: { __DB_PROVIDER__: PRISMA[engine].provider },
        packageJson: {
          path: "package.json",
          dependencies: { "@prisma/client": PRISMA_VERSION },
          devDependencies: { prisma: PRISMA_VERSION },
          scripts: {
            postinstall: "prisma generate",
            "db:push": "prisma db push",
            "db:studio": "prisma studio",
          },
        },
        installStep: engine === "sqlite" ? "npm run db:push" : undefined,
        gitignore: engine === "sqlite" ? SQLITE_IGNORES.nextjs : undefined,
      };

    case "python":
      return {
        url: SQLALCHEMY[engine].url,
        replacements: { __DB_URL__: SQLALCHEMY[engine].url },
        requirements: {
          path: "server/requirements.txt",
          lines: ["sqlalchemy>=2.0", ...SQLALCHEMY[engine].requirements],
        },
        wiring: {
          path: "server/main.py",
          imports: ["from db import create_tables", "from items import router as items_router"],
          routes: ["create_tables()", "app.include_router(items_router)"],
        },
        gitignore: engine === "sqlite" ? SQLITE_IGNORES.python : undefined,
      };

    case "springboot":
      return {
        url: JDBC[engine].url,
        replacements: {},
        maven: {
          path: "server/pom.xml",
          dependencies: [
            { groupId: "org.springframework.boot", artifactId: "spring-boot-starter-data-jpa" },
            JDBC[engine].driver,
            ...(engine === "sqlite" ? [EXTRA_SQLITE_JAVA] : []),
          ],
        },
        properties: {
          path: "server/src/main/resources/application.properties",
          entries: {
            "spring.datasource.url": "${DATABASE_URL:" + JDBC[engine].url + "}",
            "spring.jpa.hibernate.ddl-auto": "update",
            "spring.jpa.open-in-view": "false",
            ...JDBC[engine].properties,
          },
        },
        gitignore: engine === "sqlite" ? SQLITE_IGNORES.springboot : undefined,
      };
  }
}
