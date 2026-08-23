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
    ├── databases/      The opt-in data layer, one fragment per stack
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

## Working on the database layer

`--db` copies `templates/databases/<stack>` over the project and then edits the
files that already exist. Those edits are described by `planDatabase` in
`src/databases.ts` — dependencies to merge into a manifest, lines to append to
`requirements.txt`, Maven dependencies, Spring properties, and the import and
route lines for the backend's entry point — and carried out by
`src/database-apply.ts`. Adding an engine usually means adding a row to the
`PRISMA`, `SQLALCHEMY` and `JDBC` tables, not writing new code.

Entry points carry `thrust:imports` and `thrust:routes` marker comments so the
layer knows where its lines go. Anything not used is stripped before the
project is finished, so a project scaffolded without a database has no trace of
the mechanism.

Only SQLite is booted in CI: Postgres and MySQL differ from it by a driver and
a URL, and standing servers up per job would cost more than it proves.

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
