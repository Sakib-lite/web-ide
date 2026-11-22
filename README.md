# Web-IDE

A JetBrains-style IDE that runs entirely in the browser, built as a monorepo with a NestJS API (`logic-ide`) and a Next.js UI (`ui-ide`). It gives you a Monaco editor with tabs and diff view, full git integration with a commit window and log graph, a built-in terminal, project-wide search, and a plugin system — all working directly on real projects on your machine.

**Languages supported:** JavaScript, PHP, Python — with symbol indexing, autocompletion, go-to-definition, find-usages and a structure view.
<img width="1512" height="909" alt="Welcome screen with the project list" src="docs/screenshots/welcome.png" />
<img width="3013" height="1527" alt="Project tree and Monaco editor on a real repository" src="docs/screenshots/workbench.png" />
<img width="3021" height="1533" alt="Open File or Project dialog" src="docs/screenshots/open-project.png" />
<img width="3014" height="1519" alt="Settings dialog with GitHub and Git configuration" src="docs/screenshots/settings.png" />
<img width="3019" height="1538" alt="Search Everywhere over a opened project" src="docs/screenshots/search-everywhere.png" />
<img width="3016" height="1533" alt="Editor with tabs, structure outline and minimap" src="docs/screenshots/editor.png" />

## Run

```bash
npm install && npm run dev
```

Then open http://web-ide.com — run `sudo ./scripts/setup-local-domain.sh` once (after each reboot) to map the domain locally and forward port 80 to the UI; the API runs on port 4099. Without the domain setup, open http://localhost:3099.
