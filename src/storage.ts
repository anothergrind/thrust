/**
 * The opt-in object store: somewhere for the files an app's users upload,
 * which is not a job for a database column.
 *
 * One flag, one API on every stack — POST /api/files, GET /api/files, and
 * GET /api/files/:key handing back a signed URL — reached through whichever
 * AWS SDK the language already has. S3 here means the protocol rather than the
 * vendor: MinIO runs it locally, and Cloudflare R2, DigitalOcean Spaces and
 * S3 itself are the same code with a different endpoint.
 */

import type { ComposeService, LayerPlan } from "./layers.js";
import type { Stack } from "./stacks.js";

export const STORAGES = ["none", "s3"] as const;
export type Storage = (typeof STORAGES)[number];

export const STORAGE_LABELS: Record<Storage, string> = {
  none: "None — add one later",
  s3: "S3 — also MinIO, R2, Spaces",
};

/** The local S3, in the project's compose file. */
const MINIO: ComposeService = { fragment: "minio", label: "MinIO", volume: "storage-data" };

/**
 * Bucket names are stricter than project names: lowercase, no underscores, and
 * between 3 and 63 characters. A project called `My_App` is fine on npm and
 * rejected by S3, so the bucket is a cleaned-up version rather than the name.
 */
export function bucketName(project: string): string {
  const cleaned = project
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  const base = cleaned || "app";
  return base.length >= 3 ? base : `${base}-files`;
}

/**
 * The same five variables on every stack. AWS's own names are used where AWS
 * has one, so the SDKs pick their credentials up without being told to, and a
 * deployment that already sets them needs no changes here.
 *
 * S3_ENDPOINT is the local MinIO; emptying it is what points the code at the
 * real S3, since only S3-compatible stores need an endpoint at all.
 */
const STORAGE_ENV: Record<string, string> = {
  S3_BUCKET: "__BUCKET_NAME__",
  S3_ENDPOINT: "http://localhost:9000",
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "minioadmin",
  AWS_SECRET_ACCESS_KEY: "minioadmin",
};

const AWS_SDK_VERSION = "^3.700.0";
/** Not managed by Spring Boot's BOM, so the version has to be said out loud. */
const AWS_SDK_JAVA_VERSION = "2.29.52";

const README = [
  "",
  "## File storage",
  "",
  "An S3 bucket, named by `S3_BUCKET`. `S3_ENDPOINT` points at the MinIO in",
  "`docker-compose.yml`; empty it and the same code talks to S3 itself, or to",
  "R2 or Spaces. The bucket is created on startup if it isn't there yet.",
  "",
  "```bash",
  "npm run docker:up     # start MinIO, and open http://localhost:9001 to browse it",
  "```",
  "",
  "| Endpoint               | What it does                                     |",
  "| ---------------------- | ------------------------------------------------ |",
  "| `POST /api/files`      | Uploads one file, form field `file`              |",
  "| `GET /api/files`       | Lists what's in the bucket                       |",
  "| `GET /api/files/:key`  | Redirects to a signed URL, good for an hour      |",
  "",
  "Uploads are held in memory before they are sent on, which is fine up to the",
  "25 MB limit set here and is not how you would stream a video.",
];

export function planStorage(stack: Stack): LayerPlan {
  const common: LayerPlan = {
    envHeading: "# File storage",
    env: STORAGE_ENV,
    compose: MINIO,
    readme: { path: "README.md", lines: README },
  };

  switch (stack) {
    case "typescript":
      return {
        ...common,
        packageJson: {
          path: "server/package.json",
          dependencies: {
            "@aws-sdk/client-s3": AWS_SDK_VERSION,
            "@aws-sdk/s3-request-presigner": AWS_SDK_VERSION,
            // 2.x is the line that supports Express 5, which the template uses.
            multer: "^2.0.0",
          },
          devDependencies: { "@types/multer": "^1.4.12" },
        },
        wiring: {
          path: "server/src/index.ts",
          imports: [
            'import { files } from "./files.js";',
            'import { ensureBucket } from "./storage.js";',
          ],
          routes: [
            "app.use(files);",
            // Fire and forget: a store that isn't up yet shouldn't stop the
            // rest of the API from serving.
            'void ensureBucket().catch((error) => console.error("storage:", error));',
          ],
        },
      };

    case "nextjs":
      return {
        ...common,
        packageJson: {
          path: "package.json",
          dependencies: {
            "@aws-sdk/client-s3": AWS_SDK_VERSION,
            "@aws-sdk/s3-request-presigner": AWS_SDK_VERSION,
          },
        },
      };

    case "python":
      return {
        ...common,
        requirements: {
          path: "server/requirements.txt",
          // FastAPI parses multipart form data through python-multipart, and
          // says so at import time if it is missing.
          lines: ["boto3>=1.35", "python-multipart>=0.0.9"],
        },
        wiring: {
          path: "server/main.py",
          imports: ["from files import router as files_router", "from storage import ensure_bucket"],
          routes: ["ensure_bucket()", "app.include_router(files_router)"],
        },
      };

    case "springboot":
      return {
        ...common,
        maven: {
          path: "server/pom.xml",
          dependencies: [
            {
              groupId: "software.amazon.awssdk",
              artifactId: "s3",
              version: AWS_SDK_JAVA_VERSION,
            },
          ],
        },
        properties: {
          path: "server/src/main/resources/application.properties",
          heading: "# File storage",
          entries: {
            "spring.servlet.multipart.max-file-size": "25MB",
            "spring.servlet.multipart.max-request-size": "25MB",
          },
        },
      };
  }
}
