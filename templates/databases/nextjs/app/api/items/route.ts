import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/**
 * A worked example of the database layer: list and create rows. Copy the shape
 * for your own models, or delete this route and prisma/schema.prisma's Item.
 */
export async function GET() {
  const items = await prisma.item.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const item = await prisma.item.create({ data: { name } });
  return NextResponse.json(item, { status: 201 });
}
