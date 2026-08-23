import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  await run(process.execPath, [CLI, project, ...args, "--no-install", "--no-git"]);
  return { workspace, project };
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
