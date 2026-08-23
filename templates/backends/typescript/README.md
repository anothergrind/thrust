# __PROJECT_NAME__

Full-stack app with a **__FRONTEND_LABEL__** frontend and an **Express**
backend.

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
├── client/              Frontend (__FRONTEND_LABEL__)
│                        Its home page fetches /api/health on load
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
| `__CLIENT_API_ENV__` | `client` | `http://localhost:3001` | Backend URL         |

Frontend frameworks only expose prefixed variables to browser code, which is
why the client's variable is named `__CLIENT_API_ENV__` — restart the dev
server after changing it.

## Adding an API route

The client's home page fetches from the Express server on load. Add new
endpoints in `server/src/index.ts`:

```ts
app.get("/api/items", (_req, res) => {
  res.json([{ id: 1, name: "First item" }]);
});
```
