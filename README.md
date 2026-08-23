# thrust

CLI that scaffolds full-stack projects so hackathon teams can skip
frontend/backend wiring and jump straight to features.

> **Not published to npm yet.** The package is called `create-thrust`, so
> `npm create thrust@latest my-app` will be the whole installation step once
> it ships. Until then, run it from source — see
> [Running the CLI](#running-the-cli) below.

## Demo

![Scaffolding a project with thrust: project name, backend stack, and the generated next steps](docs/demo.gif)

## What you get

A ready-to-run project with:

- **Frontend**: your choice of Next.js (React), SvelteKit, or Vue — all in
  TypeScript with Tailwind CSS
- **Backend**: your choice of Express, FastAPI, Spring Boot — or Next.js
  API routes, with no separate backend at all
- **Glue already wired**: CORS configured, a `GET /api/health` endpoint, the
  frontend fetching it on load, and `.env` files with matching variable names
- **One command** (`npm run dev`) starts frontend and backend together
- **Optional database layer** (`--db`) with a model, a client and a worked
  `/api/items` endpoint already in place
- **Optional auth stub** (`--auth`) — signup, login and a protected route,
  the same three endpoints whichever backend you picked

## Running the CLI

### First-time setup

```bash
cd thrust
npm install      # installs the CLI's own dependencies
npm run build    # compiles src/ to dist/ — required before every run
```

`npm run build` must be re-run after any change to `src/`.

### Generate a project

Once the package is published, no checkout is needed:

```bash
npm create thrust@latest my-app
npm create thrust@latest my-app -- --stack=typescript   # flags need the --
```

From a checkout:

```bash
# Interactive — prompts for project name, then backend stack
node dist/index.js

# Name given, stack prompted
node dist/index.js my-app

# Fully non-interactive
node dist/index.js my-app --stack=typescript

# Somewhere other than the current directory
node dist/index.js ../my-app --stack=typescript
node dist/index.js ~/code/my-app --stack=typescript
node dist/index.js C:/Users/me/code/my-app --stack=typescript
```

A bare name is created under your **current working directory**. Anywhere else,
pass a path — relative, absolute, or `~`-prefixed. Missing parent folders are
created for you, so `code/2026/my-app` works even if none of it exists yet.

Only the final folder name becomes the project name, so `../my-app` still
produces a project called `my-app`.

### Project name rules

That final folder name is written into `package.json`, `pom.xml` and the
browser tab title of the generated project, so it has to work as a package name
as well as a folder name. The CLI checks it before copying anything and, where
it can, suggests a name that would work:

- Letters, numbers, dots, hyphens and underscores only
- Can't start with a dot or underscore, or end with a dot
- At most 207 characters — npm's limit is 214, and the generated packages add
  `-client` and `-server`
- Not `node_modules` or `favicon.ico`, which npm reserves
- Not a Windows device name (`con`, `nul`, `com1`, `lpt9`, …), which Windows
  refuses to create a folder for. These are rejected on every platform so a
  project stays usable across a team.

Uppercase letters and Node core module names (`http`, `stream`, …) are warned
about but allowed: generated projects are private, so those only matter if you
publish one.

The interactive prompt accepts all the same forms — it asks for a "project name
or path", so you can type `~/code/my-app` there rather than `cd`-ing first.

### Options

| Flag             | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `--stack <name>` | `typescript`, `python`, `springboot`, or `nextjs`. Skips the prompt |
| `--frontend <name>` | `next`, `svelte`, or `vue`. Defaults to `next`         |
| `--db <name>`    | `sqlite`, `postgres`, or `mysql`. Defaults to none        |
| `--auth`         | Add the signup/login stub                                 |
| `--no-install`   | Skip dependency installation                             |
| `--no-git`       | Skip git repository initialization                       |
| `--github`       | Create a GitHub repository and push (requires `gh`)      |
| `--public`       | Make the created GitHub repository public                |
| `-h, --help`     | Show help                                                |

Without `--no-install`, the CLI installs dependencies for you: it asks first in
interactive mode, and does it automatically when both a name and `--stack` are
given.

### Git and GitHub

Every generated project becomes its own git repository with one initial commit,
unless you pass `--no-git`.

If you scaffold into a folder that already sits inside another git repository,
the CLI warns you first — the new project would otherwise show up as untracked
files in the parent repo. Interactive runs ask before continuing.

To also create the remote, pass `--github` (or answer yes to the prompt in
interactive mode). This shells out to the [GitHub CLI](https://cli.github.com),
so `gh` must be installed and `gh auth login` already done. Repositories are
created **private** unless you pass `--public`. Without `gh`, the CLI prints the
`git remote add` / `git push` steps instead.

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

| Stack        | Backend             | Needs beyond Node.js 18+ |
| ------------ | ------------------- | ------------------------ |
| `typescript` | Express             | —                        |
| `python`     | FastAPI             | Python 3.9+              |
| `springboot` | Spring Boot         | JDK 17+                  |
| `nextjs`     | Next.js API routes  | —                        |

Every stack exposes the same `GET /api/health` and starts with the same
`npm run dev`. The first three run the frontend and backend as separate
processes wired by environment variables; `nextjs` is one app serving both.

## Frontends

The three split stacks take any of these, chosen with `--frontend` or at the
prompt:

| Frontend | Framework            | Client reads          |
| -------- | -------------------- | --------------------- |
| `next`   | Next.js (React)      | `NEXT_PUBLIC_API_URL` |
| `svelte` | SvelteKit            | `PUBLIC_API_URL`      |
| `vue`    | Vue 3 + Vite         | `VITE_API_URL`        |

All three render the same page, fetch `/api/health` on load, style with
Tailwind, and run on port 3000 (or `PORT`). Only the variable name differs,
because each framework exposes its own prefix to browser code — the generated
`.env.example` and README always name the one your project actually uses.

The `nextjs` stack is a Next.js app by definition, so `--frontend` doesn't
apply to it.

Stack-specific notes:

- **python** — `npm run install:all` creates a local `.venv/` and installs
  `requirements.txt` into it. No global pip installs, no manual activation.
- **springboot** — the Maven Wrapper (`server/mvnw`) is included, so Maven does
  **not** need to be installed; it is downloaded on first run. The first
  `npm run dev` is slow while Maven fetches the Spring dependency tree.
- **nextjs** — takes no `--frontend`: no `client/`, no `server/`, no CORS and no API URL to configure:
  the page calls `/api/health` on its own origin, and route handlers live in
  `app/api/`. One `npm install`, one process, one port. Pick it when the
  backend is only ever going to serve this frontend; pick one of the others
  when the API needs its own language or its own life.

## Database

Optional, and off unless you ask for it. `--db=sqlite` (or `postgres`, or
`mysql`) adds a real data layer to whichever stack you picked, using the ORM
that stack's ecosystem already expects:

| Stack        | Layer               | You get                                  |
| ------------ | ------------------- | ---------------------------------------- |
| `typescript` | Prisma              | `schema.prisma`, a client, `items.ts`    |
| `nextjs`     | Prisma              | `schema.prisma`, `lib/db.ts`, a route    |
| `python`     | SQLAlchemy          | `db.py`, `models.py`, `items.py`         |
| `springboot` | Spring Data JPA     | `Item`, `ItemRepository`, a controller   |

Each one lands with the same worked example — `GET /api/items` and
`POST /api/items` against an `Item` model — so there is something to copy
rather than a blank ORM to configure. Delete it once you have your own models.

The connection string is always `DATABASE_URL` in `server/.env`, whichever
stack and engine you chose. `postgres` is also how you reach Supabase, Neon or
RDS: keep the layer and point `DATABASE_URL` at their connection string.

```bash
npm create thrust@latest my-app -- --stack=typescript --db=sqlite
```

SQLite needs nothing installed — the file is created during `npm install`, and
`npm run dev` works immediately. `postgres` and `mysql` scaffold the same code
against a server you point them at; create the schema with
`npm run db:push --prefix server` (Prisma) once it's reachable, or let
SQLAlchemy and Hibernate create the tables on first start.

## Auth stub

`--auth` adds three endpoints, identical on every stack:

| Endpoint                | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `POST /api/auth/signup` | Creates an account, returns a token              |
| `POST /api/auth/login`  | Checks a password, returns a token               |
| `GET /api/auth/me`      | The signed-in user, or 401 without a valid token |

```bash
curl -X POST localhost:3001/api/auth/signup   -H 'Content-Type: application/json'   -d '{"email":"you@example.com","password":"correct horse"}'

curl localhost:3001/api/auth/me -H "Authorization: Bearer <token>"
```

There is no auth library behind it. Passwords are hashed with PBKDF2 (scrypt
on Node), tokens are HMAC-signed and expiring, comparisons are constant-time —
all from the standard library of whichever language your backend is in. Each
project gets its own `AUTH_SECRET`, generated at scaffold time and written to
`server/.env`, so no two projects sign the same tokens.

**Users are kept in memory**, which means they disappear when the server
restarts. That is the "stub" part: it exists so a hackathon demo can have
accounts by lunchtime, and so the shape is already there when you swap the map
for a table (with `--db`, that is a query in three places) or hand the whole
thing over to Auth0, Clerk or Supabase Auth.

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

## Contributing

The CLI lives in `src/`, the project templates in `templates/`, and both have
tests that run on every push. [CONTRIBUTING.md](CONTRIBUTING.md) covers the
layout, how to run the fast and slow test suites, and the rules a new template
has to follow. [RELEASING.md](RELEASING.md) covers publishing.

## License

MIT — see [LICENSE](LICENSE).
