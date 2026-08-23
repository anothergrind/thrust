# __PROJECT_NAME__

One **Next.js + React + Tailwind** app serving both the pages and the API —
no separate backend, no CORS, one process.

## Prerequisites

- Node.js 18+

## Setup

```bash
npm install
npm run dev
```

The app runs on [http://localhost:3000](http://localhost:3000), and the API
lives under the same origin at
[http://localhost:3000/api/health](http://localhost:3000/api/health).

## Project structure

```
├── app/
│   ├── page.tsx           Home page — fetches /api/health
│   ├── layout.tsx         Root layout
│   ├── globals.css        Tailwind entry point
│   └── api/
│       └── health/
│           └── route.ts   GET /api/health
├── next.config.mjs
└── package.json
```

## Environment variables

There are none to set up: the page calls `/api/health` on its own origin, so
there is no backend URL to configure and no CORS to allow.

When you do need configuration, put it in `.env.local` (already gitignored).
Variables are server-only unless prefixed with `NEXT_PUBLIC_`, which inlines
them into browser code at build time — restart the dev server after a change.

## Adding an API route

A route is a folder with a `route.ts` in it. `app/api/items/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json([{ id: 1, name: "First item" }]);
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ created: body }, { status: 201 });
}
```

Route handlers run on the server, so database calls and secrets belong here
rather than in a component. Anything a page needs from the server can also
skip the API entirely — a server component can query directly and pass the
result down as props.

## When to move to a separate backend

This layout is the fastest to build in, and it holds up well. Reach for one of
the other thrust stacks when you need a backend in another language, a
long-running process that outlives a request, or an API that other clients
consume independently of this app.
