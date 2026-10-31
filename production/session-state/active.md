# Active session

- Concept: Skate ATL — free skate in 3D (THPS meets Jet Set Radio), Three.js
- Prior prototype: beat-lock (Phaser) — PIVOT, see prototypes/beat-lock-concept/PIVOT-NOTE.md
- Hypothesis: free movement + grind + jump + style chain feels good; new player chains a 3-move combo within 3 minutes; accidental rail falls under 1 per minute.
- Riskiest assumption: a kinematic skate controller with rail snapping and a follow camera feels good in the browser, built by agents without a scene editor.
- Phase: M0 Greybox movement prototype, in build.

## Two sessions built M0 at the same time

On 2026-10-31 two automated sessions worked this milestone against this repo
in parallel, and both opened pull requests. They overlap:

| Issue | This session | The other session |
|---|---|---|
| M0-01 | PR #25 (`m0-01-threejs-shell`) | added a fixup commit to the same branch |
| M0-02 | PR #27 (`m0-02-greybox-block`) | PR #26 (`m0-02-greybox-level`) |
| M0-03 | branch `m0-03-skate-controller-alt`, no PR | PR #28 (`m0-03-skate-controller`) |
| M0-04 | not started | PR #29 (`m0-04-follow-camera`) |

This session stopped opening pull requests at M0-03 rather than file a second
copy of work that already had one. The M0-03 branch is pushed so nothing is
lost, but it has no pull request. William picks which line to keep.

## M0 progress

| Issue | Branch | State |
|---|---|---|
| M0-01 Three.js + Vite shell | `m0-01-threejs-shell` | PR open |
| M0-02 Greybox block + Rapier | `m0-02-greybox-block` | PR open |
| M0-03 Skate controller | `m0-03-skate-controller` | PR open |
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
npm run dev     # greybox block at http://localhost:5173
npm test        # Vitest
npm run e2e     # Playwright, headless

# controls: W or Shift push, A/D carve, S brake, Space jump, R reset, P colliders

# useful URLs
# /?debug=colliders   start with the Rapier collider overlay up (P toggles it)
# /?view=fixed        the screenshot camera
# /?view=fixed&cam=ramp
```
