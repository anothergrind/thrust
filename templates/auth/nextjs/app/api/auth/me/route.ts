import { NextResponse } from "next/server";

import { userFromRequest } from "@/lib/auth";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  return NextResponse.json({ user });
}
