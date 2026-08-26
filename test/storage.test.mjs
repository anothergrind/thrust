import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { bucketName } from "../dist/storage.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * The storage layer is the database layer's shape applied to files: the same
 * three endpoints on every stack, a service in the compose file, and a bucket
 * created on startup. These check what lands; whether it can really talk to an
 * S3 is the smoke script's job.
 */

async function scaffold(args) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "thrust-storage-"));
  const project = path.join(workspace, "my-app");
  const { stdout } = await run(process.execPath, [
    CLI,
    project,
    ...args,
    "--no-install",
    "--no-git",
  ]);
  return { workspace, project, output: stdout.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") };
}

const read = (project, file) => fs.readFile(path.join(project, file), "utf-8");

test("the Express server gets an S3 client and a files router", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript", "--storage=s3"]);

  await fs.access(path.join(project, "server/src/storage.ts"));
  await fs.access(path.join(project, "server/src/files.ts"));

  const manifest = JSON.parse(await read(project, "server/package.json"));
  assert.ok(manifest.dependencies["@aws-sdk/client-s3"]);
  assert.ok(manifest.dependencies["@aws-sdk/s3-request-presigner"]);
  assert.ok(manifest.dependencies.multer, "multipart needs a parser");
  assert.equal(manifest.scripts.dev, "tsx watch src/index.ts", "the template's scripts survive");

  const entry = await read(project, "server/src/index.ts");
  assert.match(entry, /import \{ files \} from ".\/files.js";/);
  assert.match(entry, /app.use\(files\);/);
  // The bucket is created on startup, and a store that isn't up yet must not
  // take the rest of the API down with it.
  assert.match(entry, /void ensureBucket\(\)\.catch/);
  assert.ok(!entry.includes("thrust:"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("FastAPI gets boto3, a multipart parser and the same three routes", async () => {
  const { workspace, project } = await scaffold(["--stack=python", "--storage=s3"]);

  const requirements = await read(project, "server/requirements.txt");
  assert.match(requirements, /boto3/);
  assert.match(requirements, /python-multipart/, "UploadFile needs it at import time");
  assert.match(requirements, /fastapi/, "the template's own requirements survive");

  const entry = await read(project, "server/main.py");
  assert.match(entry, /from files import router as files_router/);
  assert.match(entry, /ensure_bucket\(\)/);
  // Same rule as the database layer: storage.py reads the environment as it is
  // imported, so .env has to be loaded above it.
  assert.ok(entry.indexOf("load_dotenv()") < entry.indexOf("from files import"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("Spring Boot gets the AWS SDK, with the version it isn't given", async () => {
  const { workspace, project } = await scaffold(["--stack=springboot", "--storage=s3"]);

  const pom = await read(project, "server/pom.xml");
  // Spring Boot's dependency management has no opinion about the AWS SDK, so
  // a versionless dependency would simply fail to resolve.
  assert.match(
    pom,
    /<groupId>software.amazon.awssdk<\/groupId>\s*<artifactId>s3<\/artifactId>\s*<version>/
  );
  assert.ok(!pom.includes("thrust:"));

  const properties = await read(project, "server/src/main/resources/application.properties");
  assert.match(properties, /# File storage/);
  assert.match(properties, /spring.servlet.multipart.max-file-size=25MB/);

  await fs.access(path.join(project, "server/src/main/java/com/example/app/StorageService.java"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("the all-in-one stack gets route handlers instead of a router", async () => {
  const { workspace, project } = await scaffold(["--stack=nextjs", "--storage=s3"]);

  await fs.access(path.join(project, "lib/storage.ts"));
  await fs.access(path.join(project, "app/api/files/route.ts"));
  await fs.access(path.join(project, "app/api/files/[key]/route.ts"));

  const manifest = JSON.parse(await read(project, "package.json"));
  assert.ok(manifest.dependencies["@aws-sdk/client-s3"]);
  assert.ok(!manifest.dependencies.multer, "Next parses form data itself");

  await fs.rm(workspace, { recursive: true, force: true });
});

test("MinIO is in the compose file, addressed by what .env says", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript", "--storage=s3"]);

  const compose = await read(project, "docker-compose.yml");
  assert.match(compose, /image: minio\/minio/);
  assert.match(compose, /"9000:9000"/);
  assert.match(compose, /storage-data:/);

  const env = await read(project, "server/.env");
  assert.match(env, /S3_ENDPOINT="http:\/\/localhost:9000"/);
  assert.match(env, /S3_BUCKET="my-app"/);
  assert.match(env, /AWS_ACCESS_KEY_ID="minioadmin"/);
  // Whatever is in .env is what the compose file starts.
  assert.match(compose, /MINIO_ROOT_USER: minioadmin/);

  assert.match(await read(project, ".env.example"), /S3_BUCKET="my-app"/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("a database and a store share one compose file", async () => {
  const { workspace, project, output } = await scaffold([
    "--stack=typescript",
    "--db=postgres",
    "--storage=s3",
  ]);

  const compose = await read(project, "docker-compose.yml");
  assert.match(compose, /image: postgres:16/);
  assert.match(compose, /image: minio\/minio/);
  assert.match(compose, /db-data:/);
  assert.match(compose, /storage-data:/);

  // One file means one command, named for what it starts rather than for one
  // of the things in it.
  assert.match(output, /npm run docker:up\s+# starts Postgres and MinIO in Docker/);
  assert.ok(!output.includes("npm run db:up"));

  const manifest = JSON.parse(await read(project, "package.json"));
  assert.equal(manifest.scripts["docker:up"], "docker compose up -d --wait");

  await fs.rm(workspace, { recursive: true, force: true });
});

test("without --storage nothing file-shaped is added", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript"]);

  await assert.rejects(fs.access(path.join(project, "server", "src", "files.ts")));
  await assert.rejects(fs.access(path.join(project, "docker-compose.yml")));
  assert.ok(!(await read(project, "server/.env")).includes("S3_BUCKET"));
  assert.ok(!(await read(project, "README.md")).includes("## File storage"));

  await fs.rm(workspace, { recursive: true, force: true });
});

test("the project's README explains the bucket it was given", async () => {
  const { workspace, project } = await scaffold(["--stack=typescript", "--storage=s3"]);

  const readme = await read(project, "README.md");
  assert.match(readme, /## File storage/);
  assert.match(readme, /POST \/api\/files/);
  assert.match(readme, /S3_ENDPOINT/);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("an unknown storage is refused, and says what there is", async () => {
  await assert.rejects(scaffold(["--stack=typescript", "--storage=gcs"]), (error) =>
    /Unknown storage "gcs".*none, s3/s.test(error.stderr)
  );
});

/**
 * S3 is stricter about names than npm is: lowercase, no underscores, three
 * characters at least. A project called My_App is a valid package and an
 * invalid bucket, and the failure would arrive on the first upload.
 */
test("bucket names are the project's, cleaned up until S3 will take them", () => {
  assert.equal(bucketName("my-app"), "my-app");
  assert.equal(bucketName("My_App"), "my-app");
  assert.equal(bucketName("_leading-and-trailing_"), "leading-and-trailing");
  assert.equal(bucketName("ab"), "ab-files");
  assert.equal(bucketName("!!"), "app");
  assert.equal(bucketName("x".repeat(80)).length, 63);
});
