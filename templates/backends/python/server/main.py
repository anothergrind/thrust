import os

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Loaded above the imports that follow it, not below: an optional layer reads
# the environment as its module is imported — a database layer builds its
# engine right there — and would otherwise see .env as if it were empty.
load_dotenv()
# thrust:imports

SERVER_PORT = int(os.getenv("SERVER_PORT", "3001"))
CLIENT_ORIGIN = os.getenv("CLIENT_ORIGIN", "http://localhost:3000")

app = FastAPI(title="__PROJECT_NAME__")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[CLIENT_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# thrust:routes


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=SERVER_PORT, reload=True)
