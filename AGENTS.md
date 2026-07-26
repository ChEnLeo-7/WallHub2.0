# Repository Guidelines

## Project Structure & Module Organization

`server.js` is the small Node entry point; startup logic belongs in `src/bootstrap/`. Backend code is divided into `src/app/` (HTTP lifecycle and routing), `src/domains/` (business behavior), `src/infrastructure/` (process, network, and archive adapters), and `src/shared/` (reusable utilities). The React/TypeScript UI lives in `frontend/src/`, organized into `components/`, `hooks/`, and `lib/`. Vite writes the committed production bundle to `public/`. Keep tests beside backend modules as `*.test.js`. Packaging and conversion utilities live under `tools/`, while longer operational notes belong in `docs/`.

## Build, Test, and Development Commands

- `npm ci`: install exactly the dependencies in `package-lock.json` (Node 16.17+).
- `npm start`: run the backend and built UI at `http://localhost:3090`.
- `npm run dev:ui`: run Vite at port 5173; keep the backend running for `/api` proxy requests.
- `npm run build:ui`: bundle `frontend/` and replace the generated `public/` output.
- `npm test`: discover and run every `src/**/*.test.js` file with Node's test runner.
- `npx tsc --noEmit`: enforce the strict frontend TypeScript configuration.
- `python -m unittest tools/mpkg/test_mobile_mpkg.py`: validate MPKG changes. Use `bash tools/installer/test_install.sh` for installer work.

## Coding Style & Naming Conventions

Follow the existing two-space indentation, single quotes, semicolons, and trailing commas in multiline TypeScript. Use `PascalCase.tsx` for React components, `useCamelCase.ts` for hooks, and `camelCase` for functions and JavaScript module names. Keep backend modules CommonJS unless extending an existing `.mjs` compatibility pair. Prefer the `@/` alias for imports within `frontend/src`. No formatter or linter script is configured, so match nearby code and rely on type checks and focused diffs.

## Testing Guidelines

Use `node:test` with `node:assert/strict`; name tests after observable behavior and add regression coverage next to the changed module. There is no numeric coverage threshold. Before submitting, run `npm test`, `npx tsc --noEmit`, and `npm run build:ui`; run the Python or shell suites when their areas change.

## Commit & Pull Request Guidelines

Recent commits use short, lowercase imperative subjects without punctuation, such as `stabilize Termux Proot installation`. Scoped Conventional Commit subjects (for example, `fix(installer): ...`) are also established. Keep each commit focused. Pull requests should describe behavior and risk, list verification commands, link relevant issues, and include before/after screenshots for visible UI changes. Call out regenerated `public/assets/` files explicitly.

## Security & Generated Data

Never commit `.env*`, credentials, logs, downloads, or runtime state from `Downloads/`, `SteamKit/`, `cache-settings.json`, or `wallhub-data/`. Review generated bundle diffs and avoid checking in local `build/` or `dist/` artifacts.
