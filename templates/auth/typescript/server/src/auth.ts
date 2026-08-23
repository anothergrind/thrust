import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";

/**
 * A minimal auth stub: signup, login, and one protected route.
 *
 * Users live in memory, so they vanish when the server restarts — replace the
 * `users` map with a table when you're ready (with a database layer scaffolded,
 * that is a `prisma.user` call in three places). The token and password
 * handling below are the real thing: PBKDF2-style hashing via scrypt, an
 * HMAC-signed token, constant-time comparison.
 */

const SECRET = process.env.AUTH_SECRET ?? "development-secret-change-me";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export type User = { id: number; email: string };
type StoredUser = User & { passwordHash: string };

const users = new Map<string, StoredUser>();
let nextId = 1;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
  );
}

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createToken(user: User): string {
  const payload = encode({
    sub: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
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

export type AuthedRequest = Request & { user?: User };

/** Put this in front of any route that needs a signed-in user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = token ? readToken(token) : null;

  if (!user) {
    res.status(401).json({ error: "not signed in" });
    return;
  }

  (req as AuthedRequest).user = user;
  next();
}

export const auth = Router();

auth.post("/api/auth/signup", (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  if (!email || password.length < 8) {
    res.status(400).json({ error: "email and a password of 8+ characters are required" });
    return;
  }
  if (users.has(email)) {
    res.status(409).json({ error: "that email is already registered" });
    return;
  }

  const user: StoredUser = { id: nextId++, email, passwordHash: hashPassword(password) };
  users.set(email, user);

  const account = { id: user.id, email: user.email };
  res.status(201).json({ token: createToken(account), user: account });
});

auth.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const user = users.get(email);

  // One message for both cases, so this can't be used to enumerate accounts.
  if (!user || !passwordMatches(password, user.passwordHash)) {
    res.status(401).json({ error: "wrong email or password" });
    return;
  }

  const account = { id: user.id, email: user.email };
  res.json({ token: createToken(account), user: account });
});

auth.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: (req as AuthedRequest).user });
});
