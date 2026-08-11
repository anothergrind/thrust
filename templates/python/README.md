# __PROJECT_NAME__

Full-stack app with **React + Vite + Tailwind** frontend and **FastAPI** backend.

## Prerequisites

- Node.js 18+
- Python 3.9+

## Setup

```bash
# Install all dependencies (creates .venv and installs the client)
npm install
npm run install:all

# Start both frontend and backend
npm run dev
```

The client runs on [http://localhost:5173](http://localhost:5173) and the server on [http://localhost:3001](http://localhost:3001).

Interactive API docs are available at [http://localhost:3001/docs](http://localhost:3001/docs).

## Project structure

```
├── client/              React + Vite + Tailwind frontend
│   └── src/
│       └── App.tsx      Main app component (fetches /api/health)
├── server/              FastAPI backend
│   ├── main.py          API entry point
│   └── requirements.txt Python dependencies
├── scripts/
│   └── py.mjs           Resolves the .venv interpreter cross-platform
├── .env.example         Reference for all environment variables
└── package.json         Root scripts (dev, build, install:all)
```

## Environment variables

| Variable        | Where    | Default                 | Purpose               |
| --------------- | -------- | ----------------------- | --------------------- |
| `SERVER_PORT`   | `server` | `3001`                  | Backend port          |
| `CLIENT_ORIGIN` | `server` | `http://localhost:5173` | Allowed CORS origin   |
| `VITE_API_URL`  | `client` | `http://localhost:3001` | Backend URL           |

## Notes

Python dependencies install into a local `.venv/` directory, created
automatically on first `npm run install:all`. To use it directly:

```bash
# macOS / Linux
source .venv/bin/activate

# Windows
.venv\Scripts\activate
```
