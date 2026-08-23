import crypto from "node:crypto";

/**
 * A minimal auth stub: password hashing, an HMAC-signed token, and an
 * in-memory user store shared by the routes under app/api/auth.
 *
 * Users vanish when the server restarts (and in dev, whenever this module is
 * reloaded) — replace the `users` map with a table when you're ready. With a
 * database layer scaffolded that is a `prisma.user` call in three places. The
 * hashing and signing below are the real thing.
 */

const SECRET = process.env.AUTH_SECRET ?? "development-secret-change-me";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export type User = { id: number; email: string };
type StoredUser = User & { passwordHash: string };

// Parked on globalThis so an edit in dev doesn't sign everyone out.
const store = globalThis as unknown as { users?: Map<string, StoredUser>; nextId?: number };
const users = (store.users ??= new Map<string, StoredUser>());
store.nextId ??= 1;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
  );
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createToken(user: User): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string): User | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;

  return { id: claims.sub, email: claims.email };
}

/** The signed-in user for a request, or null. Use it in any route handler. */
export function userFromRequest(request: Request): User | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token ? readToken(token) : null;
}

export function createUser(email: string, password: string): User {
  const user: StoredUser = {
    id: store.nextId!++,
    email,
    passwordHash: hashPassword(password),
  };
  users.set(email, user);
  return { id: user.id, email: user.email };
}

export function findUser(email: string): StoredUser | undefined {
  return users.get(email);
}

export function checkPassword(password: string, user: StoredUser): boolean {
  return passwordMatches(password, user.passwordHash);
}
