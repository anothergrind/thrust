# Contributing

Thanks for helping out. This is a scaffolding CLI, so most changes land in one
of two places: the CLI itself in `src/`, or a project template in `templates/`.

## Getting set up

```bash
npm install      # the CLI's own dependencies
npm run build    # compiles src/ to dist/ — required before every run
node dist/index.js my-app --stack=typescript
```

`npm run build` has to be re-run after any change to `src/`; `npm run dev`
watches instead. The `dist/` directory is the npm bin entry point, so the tests
and the smoke script both run against it rather than the TypeScript sources.

## Repository layout

```
thrust/
├── src/
│   ├── index.ts        CLI entry point: prompts, scaffolding, git, GitHub
│   ├── stacks.ts       Stack metadata and the "next steps" list
│   ├── target.ts       Resolving a target path and inspecting what's there
│   └── validate.ts     Project-name rules
├── test/               node --test suites, run against dist/
├── scripts/
│   ├── smoke.mjs       Boots a generated project per stack
│   └── check-tarball.mjs  Packs a release and checks its contents
├── dist/               Compiled output — generated
└── templates/
    ├── backends/       Root files + server/ for each backend
    │   ├── typescript/     Express
    │   ├── python/         FastAPI
    │   └── springboot/     Spring Boot
    ├── frontends/      client/ for each frontend, plus env/gitignore fragments
    │   ├── next/           Next.js (React)
    │   ├── svelte/         SvelteKit
    │   └── vue/            Vue 3 + Vite
    ├── compose/        The docker-compose.yml skeleton, and one fragment
    │                   per service that can go in it
    ├── databases/      The opt-in data layer, one fragment per stack, plus
    │                   mongodb/ for the two stacks whose client changes
    ├── storage/        The opt-in S3 layer, one implementation per stack
    ├── auth/           The opt-in auth stub, one implementation per stack
    └── nextjs/         The all-in-one stack: a whole project, not a half
```

## Tests

```bash
npm test              # builds, then runs test/*.test.mjs
npm run smoke         # slow: boots a real project per stack
npm run smoke -- --stack=python --keep
```

`npm test` is quick and safe to run constantly. It covers project-name rules,
target-directory handling, cross-platform path handling, the `--github`
fallback when the GitHub CLI is missing, and — by packing a real tarball and
scaffolding from it — that dotfiles survive publication.

`npm run smoke` takes `--frontend=svelte` too, and CI runs every backend
against Next plus one backend against each alternative frontend.

`npm run smoke` is the slow one: for each stack it scaffolds a project,
installs it, starts `npm run dev`, and checks that `/api/health` answers, that
CORS allows the frontend's origin, and that the page renders. `--keep` leaves
the generated project in place so you can poke at it.

Both run in CI on every push, across Ubuntu and Windows for the unit suite.

## Working on templates

- A project is assembled from two halves: a backend supplies the root files
  and `server/`, a frontend supplies `client/`. The CLI only offers halves
  whose directory exists, so a half-finished template stays out of the picker.
- `.env.example` and `.gitignore` are the two files neither half owns alone.
  Each backend and frontend carries a fragment, and the CLI appends the
  frontend's to the backend's while copying.
- Text in a template can also carry `__FRONTEND_LABEL__` (how to describe the
  chosen frontend) and `__CLIENT_API_ENV__` (the variable it reads the API URL
  from). Both come from `FRONTEND_DETAILS` in `src/stacks.ts`, which is the one
  place that knows a SvelteKit client reads `PUBLIC_API_URL` and a Vite one
  reads `VITE_API_URL`.
- Template files are copied verbatim, then `__PROJECT_NAME__` is replaced
  throughout with the project name. It becomes an npm package name and a Maven
  artifactId, which is why `src/validate.ts` is strict about what it allows.
- npm strips dotfiles from published tarballs, so templates store them with a
  leading underscore (`_env`, `_gitignore`, `_mvn`) and the CLI restores the
  real names while copying. Add new dotfiles the same way, or they will be
  missing for anyone who installs from npm.
- A file that must stay executable (`mvnw`) needs its git mode set with
  `git update-index --chmod=+x <file>` *and* an entry in `EXECUTABLE_FILES` in
  `src/index.ts`, because tarballs packed on Windows carry no executable bits.
- Every backend answers `GET /api/health` with `{"status":"ok"}`. A split
  stack also reads `SERVER_PORT` and `CLIENT_ORIGIN` on the server and
  `NEXT_PUBLIC_API_URL` on the client; a single-process stack like `nextjs`
  has none of those, and `LAYOUT` in `scripts/smoke.mjs` says which is which.
  The smoke test enforces that contract, and a new template is expected to
  keep it.
- Build output can appear inside `templates/` on its own — an IDE Java
  extension will happily compile `templates/springboot/server/pom.xml` into a
  `target/` directory. The `!templates/**/…` entries in `files` keep that (plus
  `.next/`, `.venv/`, `out/`) out of the published package.

## Working on the optional layers

`--db` and `--auth` work the same way: copy `templates/<layer>/<stack>` over
the project, then edit the files that already exist. What to edit is described
by a `LayerPlan` (`src/layers.ts`) — dependencies to merge into a manifest,
lines to append to `requirements.txt`, Maven dependencies, Spring properties,
environment variables, and the import and route lines for the backend's entry
point. `planDatabase` in `src/databases.ts` and `planAuth` in `src/auth.ts`
build those plans; `applyLayer` carries them out. Adding a SQL engine usually
means adding a row to the `PRISMA`, `SQLALCHEMY` and `JDBC` tables rather than
writing new code. MongoDB is the exception that shows where that ends: Prisma
reaches it with the same client API and needs one line of schema changed, while
SQLAlchemy and JPA cannot reach it at all, so those two stacks have a second
set of templates under `templates/databases/mongodb`.

A layer that needs a secret should generate it per project, put the real value
in `.env` and a placeholder in `.env.example` (`envExample` on the plan). No
generated project should ever ship a secret that another one shares.

A layer that adds commands should also add a `readme` section explaining them.
The next steps the CLI prints are seen once, by one person; everyone who clones
the repository afterwards has the project's own README and nothing else.

Entry points carry `thrust:imports` and `thrust:routes` marker comments so the
layer knows where its lines go. Anything not used is stripped before the
project is finished, so a project scaffolded without a database has no trace of
the mechanism.

A layer's module reads the environment as it is imported — `db.py` builds its
engine at module scope — so anything that loads `.env` has to run above the
`thrust:imports` marker, not below it. `load_dotenv()` in the FastAPI entry
point and `import "dotenv/config"` in the Express one both sit there for that
reason.

Sentinels like `__PROJECT_NAME__` are filled in by one sweep at the end of
`scaffold`, and a plan's `replacements` can contain them too — every Postgres
and MySQL URL carries the project name. `resolveReplacements` expands the
values against each other before that sweep so the order of the map can't
matter, and refuses a cycle rather than leaving a sentinel in the project.

A layer's setup goes in one of two places. `installStep` is appended to the
install command and has to succeed offline; `manualStep` is printed in the next
steps with its reason and never run, which is where anything needing a database
server belongs — a failed schema push during install reads as a failed install.
The smoke script runs whatever `manualStep` the plan carries, so there is one
definition of that step rather than two.

`--db=postgres` and `--db=mysql` are applied as two layers rather than one:
`templates/databases/engines/<engine>` carries the compose file that runs the
server, and `templates/databases/<stack>` carries the code that talks to it.
`planDatabaseLayers` returns both in the order they have to happen, and is what
the smoke script reads too — so "start the database, then push the schema" has
one definition rather than one per caller.

A project can want more than one service — a database and an object store —
and only one `docker-compose.yml`, so that file is assembled rather than
copied: `templates/compose/docker-compose.yml` carries a marker per section,
and each layer names a fragment in `templates/compose/services` to insert. The
fragments are written flush left, since `insertAtMarker` adds the marker's own
indentation to every line it inserts.

CI boots SQLite in the `generate` job, and Postgres, MySQL, MongoDB and MinIO
in the `services` job. Neither uses service containers: the smoke script runs
the project's own `npm run docker:up`, so the compose file a developer is
handed is the one under test. Locally it is the same command, and it needs
Docker:

```bash
npm run smoke -- --stack=typescript --db=mongodb --storage=s3
```

After a template change, `npm run release:check` shows what would actually
ship. [RELEASING.md](RELEASING.md) covers the rest of the release flow.

## Refreshing the README demo

`docs/demo.gif` is rendered from `demo/demo.tape` by
[VHS](https://github.com/charmbracelet/vhs), which drives the real CLI through
the interactive flow — nothing in it is mocked up.

```bash
vhs demo/demo.tape       # writes docs/demo.gif and docs/demo-final.png
```

VHS needs ttyd and ffmpeg, so if you would rather not install it, the "Demo"
workflow renders the tape on GitHub Actions — run it from the Actions tab (or
push a change to the tape) and download the `demo` artifact.

Re-record whenever the prompts change, and when the package is published: the
tape types the from-source invocation today, and should type
`npm create thrust@latest` once that works.

## Pull requests

- Keep commits focused; one behaviour change per commit reads best in history.
- Add or update a test when you change CLI behaviour — the fast suite is the
  one that gets run, so put the check there when it can live there.
- CI has to be green: unit tests on Ubuntu and Windows, and a generated
  project that boots for each stack.
