# __PROJECT_NAME__

Full-stack app with **React + Vite + Tailwind** frontend and **Express** backend.

## Setup

```bash
# Install all dependencies (root, server, and client)
npm install
npm run install:all

# Copy environment files (defaults work out of the box)
# Edit .env files in server/ and client/ if needed

# Start both frontend and backend
npm run dev
```

The client runs on [http://localhost:5173](http://localhost:5173) and the server on [http://localhost:3001](http://localhost:3001).

## Project structure

```
├── client/          React + Vite + Tailwind frontend
│   └── src/
│       └── App.tsx  Main app component (fetches /api/health)
├── server/          Express backend
│   └── src/
│       └── index.ts API entry point
├── .env.example     Reference for all environment variables
└── package.json     Root scripts (dev, build)
```

## Environment variables

| Variable       | Where    | Default                  | Purpose            |
| -------------- | -------- | ------------------------ | ------------------ |
| `SERVER_PORT`  | `server` | `3001`                   | Backend port       |
| `VITE_API_URL` | `client` | `http://localhost:3001`  | Backend URL        |
