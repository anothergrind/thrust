# Releasing

The package is `create-thrust`, which is what makes `npm create thrust@latest
my-app` work. Everything users get comes from the published tarball, so the
point of this checklist is to look inside it before it ships.

## Before every release

```bash
npm test              # unit suite; also packs a tarball and scaffolds from it
npm run smoke         # slow: boots a real project per stack, checks /api/health
npm run release:check # builds, packs, and prints exactly what would ship
```

`npm run release:check` fails if anything in `scripts/check-tarball.mjs`'s
required list is missing, if a real dotfile made it into the tarball (npm
strips those on publish, which is why templates store them as `_env`,
`_gitignore`, `_mvn`), or if build output like `target/` or `.next/` crept in.

Its output is worth reading, not just its exit code:

```
create-thrust-0.1.0.tgz — 74 files, 41 KB packed, 132 KB unpacked

    12  dist
     1  LICENSE
     1  package.json
     1  README.md
    17  templates/python
    23  templates/springboot
    17  templates/typescript
```

A stack whose file count suddenly drops is a template that stopped shipping.

## Publishing

```bash
npm version <patch|minor|major>   # commits and tags
npm publish                       # first release may need --access public
git push --follow-tags
```

## After publishing

```bash
cd "$(mktemp -d)"
npm create thrust@latest my-app -- --stack=typescript
cd my-app && npm run dev
```

That last step is the only check that covers the published artifact end to
end — the registry copy, the bin entry, the restored dotfiles and the
generated project actually booting.

## Repository metadata

GitHub's description and topics are what people see before the README, and
they live in repository settings rather than in the tree — so the current
values are recorded here, and re-applying them is one command:

```bash
gh repo edit anothergrind/thrust \
  --description "CLI that scaffolds a full-stack hackathon project in one command: Next.js frontend wired to an Express, FastAPI, or Spring Boot backend." \
  --add-topic cli --add-topic scaffolding --add-topic hackathon \
  --add-topic fullstack --add-topic project-generator --add-topic nextjs \
  --add-topic react --add-topic express --add-topic fastapi \
  --add-topic spring-boot --add-topic typescript --add-topic python \
  --add-topic java --add-topic npm-package --add-topic boilerplate
```

Keep it in step with the stacks the CLI actually offers: a new backend or
frontend option belongs in both the description and the topics.

## Adding a template file

Two rules keep releases honest:

- A dotfile belongs in the template under an underscore name (`_env`,
  `_gitignore`, `_mvn`), with the mapping added to `renameDotfile` in
  `src/index.ts`. npm will strip it otherwise.
- A file that has to stay executable (`mvnw`) needs its git mode set
  (`git update-index --chmod=+x <file>`) and an entry in `EXECUTABLE_FILES` in
  `src/index.ts`, because tarballs packed on Windows carry no executable bits.

Add the new file to `REQUIRED_FILES` in `scripts/check-tarball.mjs` so a
release that loses it fails loudly.
