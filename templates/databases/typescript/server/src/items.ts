import { Router } from "express";

import { prisma } from "./db.js";

/**
 * A worked example of the database layer: list and create rows. Copy the shape
 * for your own models, or delete this file and its two lines in index.ts.
 */
export const items = Router();

items.get("/api/items", async (_req, res) => {
  const all = await prisma.item.findMany({ orderBy: { id: "asc" } });
  res.json(all);
});

items.post("/api/items", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const item = await prisma.item.create({ data: { name } });
  res.status(201).json(item);
});
