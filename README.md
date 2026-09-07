# Web-IDE

A JetBrains-style IDE that runs entirely in the browser, built as a monorepo with a NestJS API (`logic-ide`) and a Next.js UI (`ui-ide`). It gives you a Monaco editor with tabs and diff view, full git integration with a commit window and log graph, a built-in terminal, project-wide search, and a plugin system — all working directly on real projects on your machine.

**Languages supported:** JavaScript, PHP, Python — with symbol indexing, autocompletion, go-to-definition, find-usages and a structure view.
<img width="1512" height="909" alt="image" src="https://github.com/user-attachments/assets/0c9e0483-c961-47dd-b20b-73ae446313d6" />
<img width="3013" height="1527" alt="image" src="https://github.com/user-attachments/assets/d5a0e4e7-9368-47fd-a748-1af53ae69407" />
<img width="3021" height="1533" alt="image" src="https://github.com/user-attachments/assets/abb4e285-5af2-4220-955f-f454a809a571" />
<img width="3014" height="1519" alt="image" src="https://github.com/user-attachments/assets/1bd0a265-fb23-49ba-990f-c6b5f8098236" />
<img width="3019" height="1538" alt="image" src="https://github.com/user-attachments/assets/4914bd3b-97d7-4d72-af33-c0a31f41799c" />
<img width="3016" height="1533" alt="image" src="https://github.com/user-attachments/assets/3bfbec58-da8a-4f1b-a3ed-1626c6b49420" />

## Run

```bash
npm install && npm run dev
```

Then open http://web-ide.com — run `sudo ./scripts/setup-local-domain.sh` once (after each reboot) to map the domain locally and forward port 80 to the UI; the API runs on port 4099. Without the domain setup, open http://localhost:3099.
