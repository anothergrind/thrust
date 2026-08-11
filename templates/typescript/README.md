# __PROJECT_NAME__

Full-stack app with a **Next.js + React + Tailwind** frontend and an
**Express** backend.

## Prerequisites

- Node.js 18+

## Setup

```bash
# Install all dependencies (root, server, and client)
npm install
npm run install:all

# Start both frontend and backend
npm run dev
```

The client runs on [http://localhost:3000](http://localhost:3000) and the
server on [http://localhost:3001](http://localhost:3001).

## Project structure

```
├── client/              Next.js frontend (App Router)
│   └── app/
│       ├── page.tsx     Home page — fetches /api/health
│       ├── layout.tsx   Root layout
│       └── globals.css  Tailwind entry point
├── server/              Express backend
│   └── src/
│       └── index.ts     API entry point
├── .env.example         Reference for all environment variables
└── package.json         Root scripts (dev, build, install:all)
```

## Environment variables

| Variable              | Where    | Default                 | Purpose             |
| --------------------- | -------- | ----------------------- | ------------------- |
| `SERVER_PORT`         | `server` | `3001`                  | Backend port        |
| `CLIENT_ORIGIN`       | `server` | `http://localhost:3000` | Allowed CORS origin |
| `NEXT_PUBLIC_API_URL` | `client` | `http://localhost:3001` | Backend URL         |

Next.js only exposes variables prefixed with `NEXT_PUBLIC_` to browser code,
and inlines them at build time — restart the dev server after changing one.

## Adding an API route

`app/page.tsx` is a client component (note the `"use client"` directive) that
fetches from the Express server. Add new endpoints in `server/src/index.ts`:

```ts
app.get("/api/items", (_req, res) => {
  res.json([{ id: 1, name: "First item" }]);
});
```
