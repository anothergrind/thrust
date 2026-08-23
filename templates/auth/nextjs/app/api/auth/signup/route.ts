import { NextResponse } from "next/server";

import { createToken, createUser, findUser } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!email || password.length < 8) {
    return NextResponse.json(
      { error: "email and a password of 8+ characters are required" },
      { status: 400 }
    );
  }
  if (findUser(email)) {
    return NextResponse.json({ error: "that email is already registered" }, { status: 409 });
  }

  const user = createUser(email, password);
  return NextResponse.json({ token: createToken(user), user }, { status: 201 });
}
