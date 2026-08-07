# Web IDE

A JetBrains-style IDE for the browser, split into two apps:

- `logic-ide` — NestJS API on port 4000: project filesystem, git, symbol index (JS, PHP, Python), GitHub, terminal and plugin host.
- `ui-ide` — Next.js UI on port 3000: React tool windows around a Monaco editor manager.

## Run

```bash
npm install
npm run dev          # starts both apps
```

Open http://localhost:3000. The UI talks to `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`); the API allows the
origins in `UI_ORIGIN` (default `http://localhost:3000,http://127.0.0.1:3000`) with credentials, so no CORS setup is needed.
Set `IDE_TOKEN=secret` on the API to require a token; open `http://localhost:4000/?token=secret` once to set the cookie.

## Layout

```
logic-ide/src
  projects/   project registry, sandboxed filesystem, watcher
  git/        git runner, status, branches, log, stash, changelists, controllers
  symbols/    JS/PHP/Python parsers and the index behind completion and navigation
  github/     GitHub client, pull requests, clone jobs
  plugins/    plugin host (folders with plugin.json, client.js, server.mjs)
  ws/         websocket upgrade for terminal, project events and plugins
ui-ide/src
  lib/        api client, zustand store, event bus, actions registry
  editor/     Monaco manager, theme, definitions, intellisense, JetBrains keymap
  components/ layout, project tree, editor chrome, commit, vcs, git log, GitHub, search, terminal, plugins
  plugins/    plugin loader and DOM helpers for plugin clients
```

## Tests

```bash
cd logic-ide && PORT=4999 UI_ORIGIN=http://localhost:3015 node dist/main.js &
cd ui-ide && NEXT_PUBLIC_API_URL=http://localhost:4999 npx next dev -p 3015 &
sh ../code-editor/scripts/fixture.sh && UI_URL=http://localhost:3015 npm test --workspace ui-ide
```
