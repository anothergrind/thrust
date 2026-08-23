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
    ├── typescript/     Express
    ├── python/         FastAPI
    └── springboot/     Spring Boot
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

`npm run smoke` is the slow one: for each stack it scaffolds a project,
installs it, starts `npm run dev`, and checks that `/api/health` answers, that
CORS allows the frontend's origin, and that the page renders. `--keep` leaves
the generated project in place so you can poke at it.

Both run in CI on every push, across Ubuntu and Windows for the unit suite.

## Working on templates

- The CLI only offers stacks whose directory exists under `templates/`, so a
  half-finished template will not appear in the picker.
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
- Every backend answers `GET /api/health` with `{"status":"ok"}`, reads
  `SERVER_PORT` and `CLIENT_ORIGIN`, and every frontend reads
  `NEXT_PUBLIC_API_URL`. The smoke test enforces that contract, and a new
  template is expected to keep it.
- Build output can appear inside `templates/` on its own — an IDE Java
  extension will happily compile `templates/springboot/server/pom.xml` into a
  `target/` directory. The `!templates/**/…` entries in `files` keep that (plus
  `.next/`, `.venv/`, `out/`) out of the published package.

After a template change, `npm run release:check` shows what would actually
ship. [RELEASING.md](RELEASING.md) covers the rest of the release flow.

## Pull requests

- Keep commits focused; one behaviour change per commit reads best in history.
- Add or update a test when you change CLI behaviour — the fast suite is the
  one that gets run, so put the check there when it can live there.
- CI has to be green: unit tests on Ubuntu and Windows, and a generated
  project that boots for each stack.
