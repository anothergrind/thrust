import { NextResponse } from "next/server";

// Every thrust stack answers this, so tooling and teammates can check the
// backend the same way whichever one a project was scaffolded with.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
