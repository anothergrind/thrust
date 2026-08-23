"""A minimal auth stub: signup, login, and one protected route.

Users live in memory, so they vanish when the server restarts — replace the
`_users` dict with a table when you're ready (with a database layer scaffolded,
that is a session query in three places). The token and password handling are
the real thing: PBKDF2-SHA256 hashing, an HMAC-signed token, constant-time
comparison.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

SECRET = os.getenv("AUTH_SECRET", "development-secret-change-me")
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7
PBKDF2_ROUNDS = 200_000

_users: dict[str, dict] = {}
_next_id = 1

router = APIRouter()


class Credentials(BaseModel):
    email: str
    password: str


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ROUNDS)
    return f"{salt}:{digest.hex()}"


def _password_matches(password: str, stored: str) -> bool:
    salt, expected = stored.split(":")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ROUNDS)
    return hmac.compare_digest(digest.hex(), expected)


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(payload: str) -> str:
    return _b64(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())


def create_token(user: dict) -> str:
    payload = _b64(
        json.dumps(
            {
                "sub": user["id"],
                "email": user["email"],
                "exp": int(time.time()) + TOKEN_TTL_SECONDS,
            }
        ).encode()
    )
    return f"{payload}.{_sign(payload)}"


def read_token(token: str) -> dict | None:
    payload, _, signature = token.partition(".")
    if not payload or not signature:
        return None
    if not hmac.compare_digest(signature, _sign(payload)):
        return None

    claims = json.loads(_unb64(payload))
    if claims["exp"] < int(time.time()):
        return None

    return {"id": claims["sub"], "email": claims["email"]}


def current_user(authorization: str = Header(default="")) -> dict:
    """FastAPI dependency: put it on any route that needs a signed-in user."""
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    user = read_token(token) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="not signed in")
    return user


@router.post("/api/auth/signup", status_code=201)
def signup(credentials: Credentials):
    global _next_id

    email = credentials.email.strip().lower()
    if not email or len(credentials.password) < 8:
        raise HTTPException(
            status_code=400, detail="email and a password of 8+ characters are required"
        )
    if email in _users:
        raise HTTPException(status_code=409, detail="that email is already registered")

    user = {
        "id": _next_id,
        "email": email,
        "password_hash": _hash_password(credentials.password),
    }
    _users[email] = user
    _next_id += 1

    account = {"id": user["id"], "email": user["email"]}
    return {"token": create_token(account), "user": account}


@router.post("/api/auth/login")
def login(credentials: Credentials):
    email = credentials.email.strip().lower()
    user = _users.get(email)

    # One message for both cases, so this can't be used to enumerate accounts.
    if user is None or not _password_matches(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="wrong email or password")

    account = {"id": user["id"], "email": user["email"]}
    return {"token": create_token(account), "user": account}


@router.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {"user": user}
