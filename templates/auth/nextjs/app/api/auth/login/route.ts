import { NextResponse } from "next/server";

import { checkPassword, createToken, findUser } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const stored = findUser(email);

  // One message for both cases, so this can't be used to enumerate accounts.
  if (!stored || !checkPassword(password, stored)) {
    return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
  }

  const user = { id: stored.id, email: stored.email };
  return NextResponse.json({ token: createToken(user), user });
}
