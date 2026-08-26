import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

export const BUCKET = process.env.S3_BUCKET ?? "__BUCKET_NAME__";

// Only S3-compatible stores need an endpoint; S3 itself is found from the
// region. Emptying S3_ENDPOINT in .env is what moves you from MinIO to AWS.
const endpoint = process.env.S3_ENDPOINT || undefined;

export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  endpoint,
  // MinIO addresses a bucket as a path, where AWS uses a subdomain.
  forcePathStyle: Boolean(endpoint),
});

/**
 * Creates the bucket unless it is already there, the way the database layers
 * create their tables on startup. The retries are for the seconds after
 * `npm run docker:up` in which MinIO is running but not yet answering.
 */
export async function ensureBucket(): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
      return;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
        return;
      }
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
