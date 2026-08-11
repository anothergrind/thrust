# __PROJECT_NAME__

Full-stack app with **React + Vite + Tailwind** frontend and **Spring Boot** backend.

## Prerequisites

- Node.js 18+
- JDK 17+

Maven is **not** required. This project ships the Maven Wrapper
(`server/mvnw`), which downloads Maven on first use.

## Setup

```bash
# Install all dependencies (resolves Maven deps and installs the client)
npm install
npm run install:all

# Start both frontend and backend
npm run dev
```

The client runs on [http://localhost:5173](http://localhost:5173) and the server on [http://localhost:3001](http://localhost:3001).

> The first `npm run dev` is slow — Maven downloads the Spring dependency tree.
> Subsequent starts are fast.

## Project structure

```
├── client/                      React + Vite + Tailwind frontend
│   └── src/
│       └── App.tsx              Main app component (fetches /api/health)
├── server/                      Spring Boot backend
│   ├── pom.xml                  Maven build
│   ├── mvnw, mvnw.cmd, .mvn/    Maven Wrapper (no system Maven needed)
│   └── src/main/
│       ├── java/com/example/app/
│       │   ├── Application.java     Entry point
│       │   ├── HealthController.java  GET /api/health
│       │   └── WebConfig.java       CORS configuration
│       └── resources/
│           └── application.properties
├── scripts/
│   └── mvn.mjs                  Runs Maven and loads server/.env
├── .env.example                 Reference for all environment variables
└── package.json                 Root scripts (dev, build, install:all)
```

## Environment variables

| Variable        | Where    | Default                 | Purpose             |
| --------------- | -------- | ----------------------- | ------------------- |
| `SERVER_PORT`   | `server` | `3001`                  | Backend port        |
| `CLIENT_ORIGIN` | `server` | `http://localhost:5173` | Allowed CORS origin |
| `VITE_API_URL`  | `client` | `http://localhost:3001` | Backend URL         |

Spring does not read `.env` files natively, so `scripts/mvn.mjs` loads
`server/.env` and passes it through as environment variables. That keeps the
variable names identical across every create-launch template.

## Upgrading Maven or Spring Boot

To change the Maven version the wrapper fetches:

```bash
cd server && ./mvnw wrapper:wrapper -Dmaven=3.9.16
```

The Spring Boot version is the `<parent>` version in `server/pom.xml`.
