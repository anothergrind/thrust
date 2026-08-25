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

import type { LayerPlan, MavenDependency } from "./layers.js";
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
    // MySQL 8 authenticates with caching_sha2_password by default, and PyMySQL
    // can only complete that handshake with cryptography installed.
    requirements: ["PyMySQL>=1.1", "cryptography>=43.0"],
  },
};

/**
 * JDBC settings per engine. SQLite has no Hibernate dialect in the core
 * distribution, so it also pulls in the community dialects module — the same
 * arrangement Spring's own SQLite guides use.
 *
 * JDBC is the one place where the user and password are not part of the URL,
 * so they travel as their own variables. They go in `.env` next to
 * DATABASE_URL rather than only in application.properties: a JDBC URL is
 * where someone editing their connection expects to find everything about it,
 * and defaults nothing mentions are defaults nobody can change.
 */
const JDBC: Record<
  Engine,
  {
    url: string;
    driver: MavenDependency;
    credentials?: Record<string, string>;
    properties: Record<string, string>;
  }
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
    credentials: { DATABASE_USER: "postgres", DATABASE_PASSWORD: "postgres" },
    properties: {
      "spring.datasource.username": "${DATABASE_USER:postgres}",
      "spring.datasource.password": "${DATABASE_PASSWORD:postgres}",
    },
  },
  mysql: {
    url: "jdbc:mysql://localhost:3306/__PROJECT_NAME__",
    driver: { groupId: "com.mysql", artifactId: "mysql-connector-j", scope: "runtime" },
    credentials: { DATABASE_USER: "root", DATABASE_PASSWORD: "root" },
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

/**
 * Prisma is the one ORM here that won't create its tables on first start, so
 * every Prisma project needs `db:push` run once before `POST /api/items` can
 * work. SQLite has no server to wait for and can do it during install; the
 * others can only be pushed to once the developer has a database up, so the
 * command is printed instead of run.
 *
 * SQLAlchemy and Hibernate need neither: `create_tables()` and
 * `ddl-auto=update` cover the same ground on startup.
 */
function schemaPush(
  engine: Engine,
  command: string
): Pick<LayerPlan, "installStep" | "manualStep"> {
  if (engine === "sqlite") return { installStep: command };
  return {
    manualStep: { command, reason: "creates the tables, once your database is reachable" },
  };
}

const ENGINE_NAMES: Record<Engine, string> = {
  sqlite: "SQLite",
  postgres: "Postgres",
  mysql: "MySQL",
};

/**
 * The local server the project can start for itself: a compose file for the
 * engine, and the two scripts that drive it. SQLite is a file and has nothing
 * to start, and a hosted DATABASE_URL makes the whole thing ignorable — which
 * is why this is a layer of its own rather than part of the ORM's plan.
 *
 * The compose file carries the same credentials and database name the URL
 * does, through the same __PROJECT_NAME__ sentinel, so the two cannot drift.
 */
function planDatabaseServer(engine: Engine): LayerPlan {
  return {
    packageJson: {
      // The project root, whether or not the backend lives in server/:
      // a database is the whole project's, not the backend's alone.
      path: "package.json",
      scripts: {
        "db:up": "docker compose up -d --wait",
        "db:down": "docker compose down",
      },
    },
    manualStep: {
      command: "npm run db:up",
      reason: `starts ${ENGINE_NAMES[engine]} in Docker (skip it for a hosted URL)`,
    },
  };
}

/** The ORM each stack reaches its database through, by name. */
const ORM: Record<Stack, string> = {
  typescript: "Prisma",
  nextjs: "Prisma",
  python: "SQLAlchemy",
  springboot: "Spring Data JPA",
};

/**
 * The section the layer adds to the project's own README: where the connection
 * string lives, the commands that drive the database, and what the worked
 * example is for. `push` is the Prisma command, on the stacks that have one.
 */
function readmeSection(stack: Stack, engine: Engine, push?: string): string[] {
  const envFile = stack === "nextjs" ? "`.env`" : "`server/.env`";
  const lines = ["", "## Database", ""];

  lines.push(
    ...(engine === "sqlite"
      ? [
          `${ENGINE_NAMES[engine]}, through ${ORM[stack]}. The database is a single`,
          `file, named by \`DATABASE_URL\` in ${envFile}.`,
        ]
      : [
          `${ENGINE_NAMES[engine]}, through ${ORM[stack]}. The connection string is`,
          `\`DATABASE_URL\` in ${envFile} — point it at a hosted database and the`,
          "code follows it there.",
        ])
  );

  if (stack === "springboot") {
    lines.push(
      "",
      "A JDBC URL carries no credentials, so Spring reads `DATABASE_USER` and",
      "`DATABASE_PASSWORD` from the same file."
    );
  }

  const commands: [string, string][] = [];
  if (engine !== "sqlite") {
    commands.push(["npm run db:up", `start ${ENGINE_NAMES[engine]} in Docker, on that URL`]);
  }
  if (push) {
    commands.push([push, "create or update the tables"]);
  }
  if (engine !== "sqlite") {
    commands.push(["npm run db:down", "stop it; your data stays in the volume"]);
  }
  if (commands.length > 0) {
    const width = Math.max(...commands.map(([command]) => command.length));
    lines.push(
      "",
      "```bash",
      ...commands.map(([command, note]) => `${command.padEnd(width)}   # ${note}`),
      "```"
    );
  }

  lines.push(
    "",
    push
      ? "The schema lives in `schema.prisma`; the tables follow it on `db:push`."
      : "Tables are created on startup from the models, so there is no migration step.",
    "",
    "`GET /api/items` and `POST /api/items` are a worked example against the",
    "`Item` model. Copy the shape you need, then delete it."
  );

  return lines;
}

/** A layer of the database feature: which template directory, and what to do. */
export type DatabaseLayer = { template: string; plan: LayerPlan };

/**
 * Everything `--db` applies, in the order it has to happen — the server first,
 * so that "start the database" is printed above "create the tables in it".
 *
 * One list, so that the CLI and the smoke script are looking at the same
 * layers rather than each keeping their own idea of what a database involves.
 */
export function planDatabaseLayers(stack: Stack, engine: Engine): DatabaseLayer[] {
  const layers: DatabaseLayer[] = [];
  if (engine !== "sqlite") {
    layers.push({ template: `engines/${engine}`, plan: planDatabaseServer(engine) });
  }
  layers.push({ template: stack, plan: planDatabase(stack, engine) });
  return layers;
}

export function planDatabase(stack: Stack, engine: Engine): LayerPlan {
  switch (stack) {
    case "typescript":
      return {
        envHeading: "# Database",
        env: { DATABASE_URL: PRISMA[engine].url },
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
        ...schemaPush(engine, "npm run db:push --prefix server"),
        gitignore: engine === "sqlite" ? SQLITE_IGNORES.typescript : undefined,
        readme: {
          path: "README.md",
          lines: readmeSection(stack, engine, "npm run db:push --prefix server"),
        },
      };

    case "nextjs":
      return {
        envHeading: "# Database",
        env: { DATABASE_URL: PRISMA[engine].url },
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
        ...schemaPush(engine, "npm run db:push"),
        gitignore: engine === "sqlite" ? SQLITE_IGNORES.nextjs : undefined,
        readme: { path: "README.md", lines: readmeSection(stack, engine, "npm run db:push") },
      };

    case "python":
      return {
        envHeading: "# Database",
        env: { DATABASE_URL: SQLALCHEMY[engine].url },
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
        readme: { path: "README.md", lines: readmeSection(stack, engine) },
      };

    case "springboot":
      return {
        envHeading: "# Database",
        env: { DATABASE_URL: JDBC[engine].url, ...JDBC[engine].credentials },
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
        readme: { path: "README.md", lines: readmeSection(stack, engine) },
      };
  }
}
