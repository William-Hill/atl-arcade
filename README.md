# ATL Arcade

Atlanta games on real open data, in one Three.js shell. The first game is Skate ATL.

- Agent guide: `AGENTS.md`
- Concept: `docs/games/2026-10-30-skate-atl-concept.md`
- Decisions: `docs/decisions.md`
- Session state: `production/session-state/active.md`
- Prototypes: `prototypes/` (history; never imported by production)

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173 for the shell.

## Checks

```sh
npm test     # Vitest, pure simulation modules
npm run e2e  # Playwright, headless browser, screenshots to e2e/__screenshots__
npm run build
```

## Layout

| Path | What |
|---|---|
| `src/sim/` | Pure simulation. No Three.js, no DOM. Tested with Vitest. |
| `src/render/` | Three.js rendering. Reads simulation output, never the other way. |
| `e2e/` | Playwright tests and committed screenshot evidence. |
| `prototypes/` | Throwaway history. Never imports `src/`, and `src/` never imports it. |

## Rules

- Prototype code never imports production code, and production never imports prototypes.
- Use dependency versions published at least 7 days ago.
- Record decisions in `docs/decisions.md`.
