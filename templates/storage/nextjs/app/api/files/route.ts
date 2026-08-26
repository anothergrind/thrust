import { randomUUID } from "node:crypto";

import { ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { BUCKET, ensureBucket, s3 } from "@/lib/storage";

/**
 * A worked example of the storage layer: upload a file and list what's there.
 * Copy the shape, or delete this route and lib/storage.ts.
 */
export async function GET() {
  await ensureBucket();

  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  return NextResponse.json(
    (listed.Contents ?? []).map((object) => ({
      key: object.Key,
      size: object.Size,
      updatedAt: object.LastModified,
    }))
  );
}

export async function POST(request: Request) {
  await ensureBucket();

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  // The name a browser sends is not unique and not always safe; the key is.
  const key = `${randomUUID()}-${file.name}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type || "application/octet-stream",
    })
  );

  return NextResponse.json({ key, size: file.size }, { status: 201 });
}
