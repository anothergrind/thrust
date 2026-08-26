import { randomUUID } from "node:crypto";

import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import multer from "multer";

import { BUCKET, s3 } from "./storage.js";

/**
 * A worked example of the storage layer: upload a file, list what's there, and
 * hand out a link to one. Copy the shape, or delete this file and its lines in
 * index.ts.
 */
export const files = Router();

// In memory, then straight on to the store. Anything much larger than this
// wants streaming instead, which is a different and longer piece of code.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

files.post("/api/files", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  // The name a browser sends is not unique and not always safe; the key is.
  const key = `${randomUUID()}-${req.file.originalname}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    })
  );

  res.status(201).json({ key, size: req.file.size });
});

files.get("/api/files", async (_req, res) => {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  res.json(
    (listed.Contents ?? []).map((object) => ({
      key: object.Key,
      size: object.Size,
      updatedAt: object.LastModified,
    }))
  );
});

// A signed URL rather than the bytes: the browser fetches from the store
// itself, the server never proxies the download, and the link expires.
files.get("/api/files/:key", async (req, res) => {
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: req.params.key }),
    { expiresIn: 3600 }
  );
  res.redirect(url);
});
