# #262: park combo ride, 2026-11-23

Issue: #262, last acceptance item ("An Autopilot run in the park scores combo links from the ramps").
Build: `main` at `9fea9a1` (the ride ran on branch commit `0d7fdfc`, which adds only this folder).

## Result

- **Autopilot: BLOCKED.** No Autopilot run was made. This item stays open.
- **Scripted Playwright ride: PASS.** This is extra evidence only. It does not replace the Autopilot run.

## Why Autopilot is blocked in the cloud

The design audit runs (`production/audits/2026-11-13-design-audit/REPORT.md`) used the Autopilot fork
`William-Hill/autopilot`, branch `threejs-engine`, on the owner's computer. A run needs:

1. The Jev decision model. Jev needs a TypeSafe API key or an Aura plan.
2. A language model key for the agent (the audit used the owner's Anthropic key).

This cloud session has no TypeSafe key, no Aura account, and no Anthropic API key. The only connected service is
`api.meshy.ai`. The fork is reachable (`git ls-remote` works), but a run cannot start without the keys. Each audit run
cost about $2.10 to $2.31.

To close the item, run Autopilot on the owner's computer (as for run `20261113-095904`), or add a TypeSafe key and an
Anthropic key to a cloud environment.

## The scripted ride

`park-combo.spec.js`, run with:

```bash
npx playwright test --config reports/playtest/2026-11-23-262-park-combo/playwright.config.js
```

Headless Chromium (SwiftShader), dev server, high tier, toon look, 960 x 540, clear weather at 14:00. `npm ci`, a real
`node_modules` folder. The pure simulation plans each ride (closed loop). The page replays the input script tick for
tick. For the two ramp rides, the page moves and banks must equal the simulation. For the ledge ride, the test does
not compare the page moves and banks with the simulation. It checks 0 bonks in the simulation, 0 falls, bails, and
respawns in the page, and the page exit reason "end". Time: 5.5 min. Console errors: 0. Data: `result.json`.

| Ride | Start (pad m) | Moves (page) | Banked | Falls, bails, respawns |
|---|---|---|---|---|
| Kicker | u -14, v 0, heading +u | Ramp Air 100, Hop 50 | 300 (150 x 2) | 0 |
| Pyramid and quarter pipe | u -11, v 3, heading +u | Vert Air 200, Hop 50 | 500 (250 x 2) | 0 |
| Ledge, 70 degree approach (#262 ride) | from `rides262().ledgeCatch` | Ledge Grind 210, Hop 50 | not banked in the script time | 0 |

- Both ramp rides bank one combo with a ramp move as its first link.
- The ledge ride snaps onto `line-ledge:front` at 7.55 m/s, exits at the end of the ledge, and has 0 bonks
  (simulation) and 0 falls (page). There is no bonk-then-tip-over.
- The bank face gives no move by itself, so it is not in the table.

Pictures: `kicker-air.jpg`, `kicker-bank.jpg`, `quarter-air.jpg` (the "Vert Air 200 x 1" line), `quarter-bank.jpg`
(the HUD shows +500, score 500), `ledge-air.jpg`.

## Limits

- This ride is a script, not an agent. It does not show that a player or Autopilot finds these links.
- The ride does not check the beat lines (another #262 item).
