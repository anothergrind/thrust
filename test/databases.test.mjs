import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { isTextFile, resolveReplacements } from "../dist/copy.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * The database layer is applied on top of a copied project, so these check the
 * edits it makes to files that already exist — a manifest, a requirements
 * list, a pom, an entry point — and that a project without one is untouched.
 * Whether the ORM actually talks to a database is the smoke script's job.
 */

async function scaffold(args) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-db-"));
  const project = path.join(workspace, "my-app");
  const { stdout } = await run(process.execPath, [
    CLI,
    project,
    ...args,
    "--no-install",
    "--no-git",
  ]);
  // The next steps are drawn in a box with colour codes around every line.
  const output = stdout.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  return { workspace, project, output };
}

/** Every text file in a generated project, as [relative path, contents]. */
async function textFiles(dir, base = dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await textFiles(full, base)));
    } else if (isTextFile(entry.name)) {
      found.push([path.relative(base, full), await fs.readFile(full, "utf-8")]);
    }
  }
  return found;
}

const read = (project, file) => fs.readFile(path.join(project, file), "utf-8");

test("Prisma is wired into the Express server", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript", "--db=sqlite"]);

  const schema = await read(project, "server/prisma/schema.prisma");
  assert.match(schema, /provider = "sqlite"/);
  assert.match(schema, /model Item/);

  const manifest = JSON.parse(await read(project, "server/package.json"));
  assert.ok(manifest.dependencies["@prisma/client"]);
  assert.ok(manifest.devDependencies.prisma);
  assert.equal(manifest.scripts["db:push"], "prisma db push");
  // The template's own scripts survive the merge.
  assert.equal(manifest.scripts.dev, "tsx watch src/index.ts");

  const entry = await read(project, "server/src/index.ts");
  assert.match(entry, /import \{ items \} from ".\/items.js";/);
  assert.match(entry, /app.use\(items\);/);
  assert.ok(!entry.includes("thrust:"), "insertion markers were left in the project");

  assert.match(await read(project, "server/.env"), /DATABASE_URL="file:\.\/dev\.db"/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("SQLAlchemy is wired into the FastAPI server", async () => {
  const { workspace, project } = await scaffold(["--stack=python", "--db=postgres"]);

  const requirements = await read(project, "server/requirements.txt");
  assert.match(requirements, /sqlalchemy>=2\.0/);
  assert.match(requirements, /psycopg\[binary\]/);
  assert.match(requirements, /fastapi/, "the template's own requirements survive");

  const entry = await read(project, "server/main.py");
  assert.match(entry, /from items import router as items_router/);
  assert.match(entry, /app.include_router\(items_router\)/);
  assert.match(entry, /create_tables\(\)/);
  assert.ok(!entry.includes("thrust:"));

  assert.match(await read(project, "server/db.py"), /postgresql\+psycopg/);
  assert.match(await read(project, "server/.env"), /DATABASE_URL="postgresql\+psycopg/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("JPA is wired into the Spring Boot server", async () => {
  const { workspace, project } = await scaffold(["--stack=springboot", "--db=mysql"]);

  const pom = await read(project, "server/pom.xml");
  assert.match(pom, /spring-boot-starter-data-jpa/);
  assert.match(pom, /mysql-connector-j/);
  assert.match(pom, /spring-boot-starter-web/, "the template's own dependencies survive");
  assert.ok(!pom.includes("thrust:"));

  const properties = await read(project, "server/src/main/resources/application.properties");
  assert.match(properties, /spring\.datasource\.url=\$\{DATABASE_URL:jdbc:mysql/);
  assert.match(properties, /spring\.jpa\.hibernate\.ddl-auto=update/);
  assert.match(properties, /spring\.application\.name=my-app/, "existing properties survive");

  // A JDBC URL carries no credentials, so the two variables the properties
  // fall back on have to be in .env where someone changing the URL sees them.
  const env = await read(project, "server/.env");
  assert.match(env, /DATABASE_USER="root"/);
  assert.match(env, /DATABASE_PASSWORD="root"/);
  assert.match(await read(project, ".env.example"), /DATABASE_USER="root"/);

  await fs.access(path.join(project, "server/src/main/java/com/example/app/ItemController.java"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("the all-in-one stack gets Prisma at the app root", async () => {
  const { workspace, project } = await scaffold(["--stack=nextjs", "--db=sqlite"]);

  await fs.access(path.join(project, "prisma", "schema.prisma"));
  await fs.access(path.join(project, "app", "api", "items", "route.ts"));

  const manifest = JSON.parse(await read(project, "package.json"));
  assert.ok(manifest.dependencies["@prisma/client"]);
  assert.equal(manifest.scripts.dev, "next dev");

  // A stack with no .env at all until a database needs one.
  assert.match(await read(project, ".env"), /DATABASE_URL/);
  assert.match(await read(project, ".gitignore"), /^\.env$/m);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("SQLite's file is ignored where each stack actually writes it", async () => {
  for (const [args, expected] of [
    [["--stack=typescript", "--db=sqlite"], "server/prisma/dev.db"],
    [["--stack=python", "--db=sqlite"], "server/dev.db"],
    [["--stack=nextjs", "--db=sqlite"], "prisma/dev.db"],
  ]) {
    const { workspace, project } = await scaffold(args);
    assert.match(await read(project, ".gitignore"), new RegExp(`^${expected}$`, "m"));
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("without --db nothing database-shaped is added", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript"]);

  await assert.rejects(fs.access(path.join(project, "server", "prisma")));
  await assert.rejects(fs.access(path.join(project, "server", "src", "db.ts")));

  const manifest = JSON.parse(await read(project, "server/package.json"));
  assert.ok(!manifest.dependencies["@prisma/client"]);

  const entry = await read(project, "server/src/index.ts");
  assert.ok(!entry.includes("items"));
  // The markers the layer would have used are cleaned up either way.
  assert.ok(!entry.includes("thrust:"));
  assert.ok(!(await read(project, "server/.env")).includes("DATABASE_URL"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("an unknown database is refused, and says what there is", async () => {
  await assert.rejects(
    scaffold(["--stack=typescript", "--db=oracle"]),
    (error) => /Unknown database "oracle".*none, sqlite, postgres, mysql/s.test(error.stderr)
  );
});

/**
 * The sentinel sweep used to run in map order, so a value that itself contained
 * a sentinel — every Postgres and MySQL URL carries the project name — shipped
 * a literal __PROJECT_NAME__ into the generated source. SQLite's URL has no
 * project name in it, which is why the engine CI booted never showed this.
 *
 * Asserting that no sentinel survives anywhere, rather than checking the one
 * file that was wrong, keeps the next nested value from reintroducing it.
 */
test("no sentinel survives into a generated project", async () => {
  for (const args of [
    ["--stack=python", "--db=postgres"],
    ["--stack=typescript", "--db=mysql"],
    ["--stack=springboot", "--db=postgres"],
    ["--stack=nextjs", "--db=postgres"],
  ]) {
    const { workspace, project } = await scaffold(args);

    const leftover = (await textFiles(project))
      .filter(([, content]) => /__[A-Z][A-Z0-9_]*__/.test(content))
      .map(([file, content]) => `${file}: ${content.match(/__[A-Z][A-Z0-9_]*__/)[0]}`);
    assert.deepEqual(leftover, [], `${args.join(" ")} left sentinels behind`);

    // And the project name did reach the URL that carries it.
    const urls = await read(project, args[0] === "--stack=nextjs" ? ".env" : "server/.env");
    assert.match(urls, /DATABASE_URL=.*my-app/);

    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("sentinels that refer to each other in a cycle are refused", () => {
  assert.deepEqual(resolveReplacements({ __A__: "__B__/x", __B__: "b" }), {
    __A__: "b/x",
    __B__: "b",
  });
  assert.throws(
    () => resolveReplacements({ __A__: "__B__", __B__: "__A__" }),
    /cycle: __A__, __B__/
  );
  assert.throws(() => resolveReplacements({ __A__: "x__A__" }), /cycle: __A__/);
});

/**
 * Prisma is the only ORM here that doesn't create its tables on startup, so
 * where the push happens is what decides whether `npm run dev` works.
 */
test("the Prisma schema is pushed during install for SQLite", async () => {
  const { workspace, output } = await scaffold(["--stack=typescript", "--db=sqlite"]);

  assert.match(output, /npm install && npm run install:all && npm run db:push --prefix server/);
  assert.ok(!output.includes("once your database is reachable"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("and printed as its own step for a server-backed engine", async () => {
  for (const [args, command] of [
    [["--stack=typescript", "--db=postgres"], "npm run db:push --prefix server"],
    [["--stack=nextjs", "--db=mysql"], "npm run db:push"],
  ]) {
    const { workspace, output } = await scaffold(args);

    assert.ok(
      output.includes(`${command}   # creates the tables`),
      `${args.join(" ")} should print the schema push as a step of its own`
    );
    // Never folded into the install: there is no server up yet to push to, and
    // a failure there reads as a broken install.
    assert.ok(!/npm install.*db:push/.test(output));

    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("stacks whose ORM creates its own tables print no extra step", async () => {
  for (const args of [
    ["--stack=python", "--db=postgres"],
    ["--stack=springboot", "--db=mysql"],
  ]) {
    const { workspace, output } = await scaffold(args);
    assert.ok(!output.includes("db:push"), `${args.join(" ")} should need no schema push`);
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("SQLite needs no JDBC credentials, and gets none", async () => {
  const { workspace, project } = await scaffold(["--stack=springboot", "--db=sqlite"]);

  const env = await read(project, "server/.env");
  assert.match(env, /DATABASE_URL="jdbc:sqlite/);
  assert.ok(!env.includes("DATABASE_USER"), "a file has nobody to log in as");

  await fs.rm(workspace, { recursive: true, force: true });
});

test("PyMySQL gets what MySQL 8's default authentication needs", async () => {
  const { workspace, project } = await scaffold(["--stack=python", "--db=mysql"]);

  const requirements = await read(project, "server/requirements.txt");
  assert.match(requirements, /PyMySQL>=1\.1/);
  // caching_sha2_password is unreachable for PyMySQL without it.
  assert.match(requirements, /cryptography>=/);

  await fs.rm(workspace, { recursive: true, force: true });
});

/**
 * db.py builds its engine, and the auth stub reads its secret, as their
 * modules are imported — which the entry point does at its marker. Loading
 * .env after that point left both reading the fallbacks baked into the
 * templates: a DATABASE_URL pointing at localhost however the project's own
 * .env was edited, and one shared development secret across every project.
 */
test("FastAPI loads .env before the layers that read it are imported", async () => {
  const { workspace, project } = await scaffold(["--stack=python", "--db=postgres", "--auth"]);

  const main = await read(project, "server/main.py");
  const loaded = main.indexOf("load_dotenv()");
  assert.ok(loaded !== -1, "the entry point should load .env at all");
  for (const line of ["from db import", "from items import", "from auth import"]) {
    assert.ok(main.indexOf(line) > loaded, `${line} is imported before .env is loaded`);
  }

  await fs.rm(workspace, { recursive: true, force: true });
});

/**
 * Choosing Postgres or MySQL used to mean "now go install a database server":
 * the project described a connection nothing was listening on. It now brings
 * the server with it, and the compose file has to describe the same database
 * the URL points at — same engine, same port, same name — or `npm run db:up`
 * starts something the app still can't reach.
 */
test("a server-backed engine arrives with a database the project can start", async () => {
  for (const [args, image, port, name] of [
    [["--stack=typescript", "--db=postgres"], "postgres:16", "5432", "POSTGRES_DB"],
    [["--stack=python", "--db=mysql"], "mysql:8", "3306", "MYSQL_DATABASE"],
    [["--stack=springboot", "--db=postgres"], "postgres:16", "5432", "POSTGRES_DB"],
    [["--stack=nextjs", "--db=postgres"], "postgres:16", "5432", "POSTGRES_DB"],
  ]) {
    const { workspace, project } = await scaffold(args);

    const compose = await read(project, "docker-compose.yml");
    assert.match(compose, new RegExp(`image: ${image}`));
    assert.match(compose, new RegExp(`"${port}:${port}"`));
    assert.match(compose, new RegExp(`${name}: my-app`), "the project's own database");

    const envFile = args[0] === "--stack=nextjs" ? ".env" : "server/.env";
    assert.match(
      await read(project, envFile),
      new RegExp(`DATABASE_URL=.*:${port}/my-app`),
      `${args.join(" ")}: the URL and the compose file disagree`
    );

    const manifest = JSON.parse(await read(project, "package.json"));
    assert.equal(manifest.scripts["db:up"], "docker compose up -d --wait");
    assert.equal(manifest.scripts["db:down"], "docker compose down");

    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("a file-backed engine has nothing to start, and brings nothing", async () => {
  for (const args of [["--stack=typescript", "--db=sqlite"], ["--stack=typescript"]]) {
    const { workspace, project } = await scaffold(args);

    await assert.rejects(
      fs.access(path.join(project, "docker-compose.yml")),
      `${args.join(" ")} should have no database server to run`
    );
    const manifest = JSON.parse(await read(project, "package.json"));
    assert.ok(!manifest.scripts["db:up"]);

    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("the database is started before the schema is pushed into it", async () => {
  const { workspace, output } = await scaffold(["--stack=typescript", "--db=postgres"]);

  const up = output.indexOf("npm run db:up");
  const push = output.indexOf("npm run db:push");
  assert.ok(up !== -1 && push !== -1, "both steps should be printed");
  assert.ok(up < push, "pushing a schema into a database that isn't up yet fails");

  await fs.rm(workspace, { recursive: true, force: true });
});

/**
 * The CLI prints the database's commands once, to whoever ran it. Everyone who
 * clones the repo afterwards has only the project's own README to go on.
 */
test("the project's README explains the database it was given", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript", "--db=postgres"]);

  const readme = await read(project, "README.md");
  assert.match(readme, /## Database/);
  assert.match(readme, /npm run db:up\s+# start Postgres in Docker/);
  assert.match(readme, /npm run db:push --prefix server\s+# create or update the tables/);
  assert.match(readme, /npm run db:down/);
  assert.match(readme, /`DATABASE_URL` in `server\/\.env`/);
  // The template's own sections are still there.
  assert.match(readme, /## Project structure/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("and says nothing about one when there isn't one", async () => {
  const { workspace, project } = await scaffold(["--stack=python"]);

  const readme = await read(project, "README.md");
  assert.ok(!readme.includes("## Database"));
  assert.ok(!readme.includes("DATABASE_URL"));

  await fs.rm(workspace, { recursive: true, force: true });
});
