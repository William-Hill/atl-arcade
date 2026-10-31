# Active session

- Concept: Skate ATL — free skate in 3D (THPS meets Jet Set Radio), Three.js
- Prior prototype: beat-lock (Phaser) — PIVOT, see prototypes/beat-lock-concept/PIVOT-NOTE.md
- Hypothesis: free movement + grind + jump + style chain feels good; new player chains a 3-move combo within 3 minutes; accidental rail falls under 1 per minute.
- Riskiest assumption: a kinematic skate controller with rail snapping and a follow camera feels good in the browser, built by agents without a scene editor.
- Phase: M0 Greybox movement prototype, in build.

## M0 progress

| Issue | Branch | State |
|---|---|---|
| M0-01 Three.js + Vite shell | `m0-01-threejs-shell` | PR #25 open, verified locally on macOS (Vitest 7 pass, e2e 1 pass, build ok) |
| M0-02 Greybox block + Rapier | — | not started |
| M0-03 Skate controller | — | not started |
| M0-04 Follow camera | — | not started |
| M0-05 Grind system | — | not started |
| M0-06 Combo and style | — | not started |
| M0-07 On-beat bonus | — | not started |
| M0-08 Input mapping | — | not started |
| M0-09 Playtest harness | — | not started |
| M0-10 Human playtest | — | for William, not an agent task |

## Run it

```sh
npm install
npm run dev     # shell at http://localhost:5173
npm test        # Vitest
npm run e2e     # Playwright, headless
```
