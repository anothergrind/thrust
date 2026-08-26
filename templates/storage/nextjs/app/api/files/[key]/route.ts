import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

import { BUCKET, ensureBucket, s3 } from "@/lib/storage";

/**
 * A signed URL rather than the bytes: the browser fetches from the store
 * itself, the app never proxies the download, and the link expires.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  await ensureBucket();

  const { key } = await params;
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 3600,
  });

  return NextResponse.redirect(url);
}
