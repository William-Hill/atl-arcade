# Trick input greybox (#326)

A throwaway prototype of `docs/gdd/trick-input.md`. It does not import `src/`.

- `index.html`, `src/main.js`: the Three.js page (capsule, rail, kicker, pad, HUD, touch buttons).
- Pure modules with Vitest tests: `src/direction.js` (R2, R3), `src/flick.js` (R11), `src/manual.js` (F1, F2), `src/scoring.js` (F3 to F7), `src/tricks.js` (the map and names), `src/input.js` (devices to sim input), `src/sim.js` (the greybox skater), `src/harness.js`, `src/bots.js` (synthetic players).
- `src/intent.js` (the intent log of an agent playtest) and `src/autopilot/` (the Autopilot bridge copy and hooks, only with `?autopilot=1` in the dev server).
- `playtest/playtest.mjs`: the automated Playwright playtest. Results and screenshots are in `playtest/`.
- `REPORT.md`: the results, the findings, and the human playtest checklist.

Tests: `npx vitest run --config prototypes/trick-input/vitest.config.js`
