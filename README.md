# thrust

CLI that scaffolds full-stack projects so hackathon teams can skip
frontend/backend wiring and jump straight to features.

> **Not published to npm yet.** `npm create launch` will not work until this
> package is published. Until then, run it from source — see
> [Running the CLI](#running-the-cli) below.

## What you get

A ready-to-run project with:

- **Frontend**: Next.js + React + TypeScript + Tailwind CSS
- **Backend**: your choice of Express, FastAPI, or Spring Boot
- **Glue already wired**: CORS configured, a `GET /api/health` endpoint, the
  frontend fetching it on load, and `.env` files with matching variable names
- **One command** (`npm run dev`) starts frontend and backend together

## Running the CLI

### First-time setup

```bash
cd thrust
npm install      # installs the CLI's own dependencies
npm run build    # compiles src/ to dist/ — required before every run
```

`npm run build` must be re-run after any change to `src/`.

### Generate a project

```bash
# Interactive — prompts for project name, then backend stack
node dist/index.js

# Name given, stack prompted
node dist/index.js my-app

# Fully non-interactive
node dist/index.js my-app --stack=typescript
```

The project is created in a new folder under your **current working directory**,
so `cd` to wherever you want it first.

### Options

| Flag             | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `--stack <name>` | `typescript`, `python`, or `springboot`. Skips the prompt |
| `--no-install`   | Skip dependency installation                            |
| `-h, --help`     | Show help                                               |

Without `--no-install`, the CLI installs dependencies for you: it asks first in
interactive mode, and does it automatically when both a name and `--stack` are
given.

## Running a generated project

The commands are the same for all three stacks.

**If you let the CLI install dependencies**, only one command is left:

```bash
cd my-app
npm run dev
```

**If you passed `--no-install`**, run both install steps first:

```bash
cd my-app
npm install          # root dependencies (concurrently)
npm run install:all  # backend + client dependencies
npm run dev
```

Both steps are needed — `npm install` at the root only installs the task runner,
while `npm run install:all` installs the actual backend and frontend packages.

Once running:

| Service  | URL                                              |
| -------- | ------------------------------------------------ |
| Frontend | [http://localhost:3000](http://localhost:3000)   |
| Backend  | [http://localhost:3001](http://localhost:3001)   |
| Health   | `http://localhost:3001/api/health` → `{"status":"ok"}` |

The page shows a green dot and `API: ok` when the frontend reaches the backend.

## Stacks

| Stack        | Backend     | Needs beyond Node.js 18+ |
| ------------ | ----------- | ------------------------ |
| `typescript` | Express     | —                        |
| `python`     | FastAPI     | Python 3.9+              |
| `springboot` | Spring Boot | JDK 17+                  |

All three ship the identical Next.js + React + Tailwind frontend, expose the same
`GET /api/health`, use the same environment variable names, and start with the
same `npm run dev`.

Stack-specific notes:

- **python** — `npm run install:all` creates a local `.venv/` and installs
  `requirements.txt` into it. No global pip installs, no manual activation.
- **springboot** — the Maven Wrapper (`server/mvnw`) is included, so Maven does
  **not** need to be installed; it is downloaded on first run. The first
  `npm run dev` is slow while Maven fetches the Spring dependency tree.

## Generated project structure

```
my-app/
├── client/          Next.js App Router (identical in every stack)
│   ├── app/
│   │   ├── page.tsx    Fetches /api/health and displays the status
│   │   ├── layout.tsx  Root layout
│   │   └── globals.css Tailwind entry point
│   └── .env         NEXT_PUBLIC_API_URL=http://localhost:3001
├── server/          Express / FastAPI / Spring Boot
│   └── .env         SERVER_PORT=3001, CLIENT_ORIGIN=http://localhost:3000
├── .env.example     Reference for every environment variable
├── .gitignore
├── package.json     Root scripts: dev, install:all, build
└── README.md        Setup steps for that specific stack
```

## Environment variables

Identical names across all three templates:

| Variable              | Where    | Default                 | Purpose             |
| --------------------- | -------- | ----------------------- | ------------------- |
| `SERVER_PORT`         | `server` | `3001`                  | Backend port        |
| `CLIENT_ORIGIN`       | `server` | `http://localhost:3000` | Allowed CORS origin |
| `NEXT_PUBLIC_API_URL` | `client` | `http://localhost:3001` | Backend URL         |

Working `.env` files are generated with these defaults, so a fresh project runs
without editing anything.

Next.js only exposes `NEXT_PUBLIC_`-prefixed variables to browser code and
inlines them at build time, so restart the dev server after changing one.

## Repository layout

```
thrust/
├── src/index.ts     CLI source (the only place to edit)
├── dist/            Compiled output — generated, and the npm bin entry point
└── templates/
    ├── typescript/  Express
    ├── python/      FastAPI
    └── springboot/  Spring Boot
```

Notes for contributors:

- The CLI only offers stacks whose directory exists under `templates/`, so a
  half-finished template will not appear in the picker.
- Template files are copied verbatim, then `__PROJECT_NAME__` is replaced
  throughout with the project name.
- npm strips dotfiles from published tarballs, so templates store them with a
  leading underscore (`_env`, `_gitignore`, `_mvn`) and the CLI restores the
  real names while copying. Add new dotfiles the same way, or they will be
  missing for anyone who installs from npm.
- Build output can appear inside `templates/` on its own — an IDE Java
  extension will happily compile `templates/springboot/server/pom.xml` into a
  `target/` directory. The `!templates/**/…` entries in `files` keep that (plus
  `.next/`, `.venv/`, `out/`) out of the published package.

Check what would actually ship before publishing:

```bash
npm pack --dry-run
```

## License

MIT
