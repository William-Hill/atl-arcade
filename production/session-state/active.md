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
| M0-02 Greybox block + Rapier | `m0-02-greybox-level` | PR open, branched from `m0-01-threejs-shell` |
| M0-03 Skate controller | `m0-03-skate-controller` | PR open, branched from `m0-02-greybox-level` |
| M0-04 Follow camera | `m0-04-follow-camera` | PR open, branched from `m0-03-skate-controller` |
| M0-05 Grind system | `m0-05-grind-system` | PR open, branched from `m0-04-follow-camera` |
| M0-06 Combo and style | — | not started |
| M0-07 On-beat bonus | — | not started |
| M0-08 Input mapping | — | not started |
| M0-09 Playtest harness | — | not started |
| M0-10 Human playtest | — | for William, not an agent task |

## Run it

```sh
npm install
npx playwright install chromium   # only for `npm run e2e`
npm run dev     # shell at http://localhost:5173
npm test        # Vitest
npm run e2e     # Playwright, headless, starts Vite on port 5180
# http://localhost:5173/ is the follow camera; ?view=orbit to inspect; ?view=fixed&debug=1 is the reference pose with the collider overlay
# Keys: A/D or arrows steer, W/Up/Shift push, S/Down brake, Space jump, hold F grind, H colliders
```
