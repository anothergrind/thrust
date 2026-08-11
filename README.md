# create-launch

CLI that scaffolds full-stack projects so hackathon teams can skip frontend/backend wiring and jump straight to features.

```bash
npm create launch my-app
```

## What you get

A ready-to-run project with:

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: your choice of Express, FastAPI, or Spring Boot
- **Glue already wired**: CORS configured, `/api/health` endpoint, frontend fetching from backend, `.env` files with consistent variable naming
- **One command** (`npm run dev`) starts both frontend and backend

## Usage

### Interactive

```bash
npm create launch
```

Prompts for project name and backend stack.

### Non-interactive

```bash
npm create launch my-app -- --stack=typescript
```

| Stack          | Backend        | Status      |
| -------------- | -------------- | ----------- |
| `typescript`   | Express        | Ready       |
| `python`       | FastAPI        | Not yet     |
| `springboot`   | Spring Boot    | Not yet     |

### Options

| Flag             | Description                      |
| ---------------- | -------------------------------- |
| `--stack <name>` | Backend stack (skips prompt)      |
| `--no-install`   | Skip dependency installation     |

## Generated project structure

```
my-app/
├── client/          React + Vite + Tailwind
│   ├── src/
│   │   └── App.tsx  Fetches /api/health and displays status
│   └── .env         VITE_API_URL=http://localhost:3001
├── server/          Backend (Express / FastAPI / Spring Boot)
│   ├── src/
│   └── .env         SERVER_PORT=3001
├── .env.example     Reference for all env vars
├── .gitignore
├── package.json     Root scripts: dev, build, install:all
└── README.md        Setup steps for the generated project
```

## Development

```bash
git clone <repo-url>
cd thrust
npm install
npm run build
```

Test the CLI locally:

```bash
node dist/index.js                                    # interactive
node dist/index.js my-app --stack=typescript          # non-interactive
```

The CLI only offers stacks whose template directory exists under `templates/`,
so a stack that hasn't been built yet won't appear in the picker.

## License

MIT
