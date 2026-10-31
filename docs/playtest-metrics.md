# Playtest metrics

The harness in `scripts/playtest.mjs` loads the greybox block in headless Chromium, drives the three scripted sessions from `src/playtest/sessions.js`, and writes `reports/playtest-<date>.json`, two screenshots per session, and one short video per session (`.webm`, not committed). Run it with:

```sh
npm run playtest
npm run playtest -- --gate 55 --port 5182
```

The run fails (exit code 1) when the median FPS over all sessions is under the gate (55) or any session logs a console error. A page error or a session that runs past four times its simulated length plus 30 s stops the run at once, writes `reports/playtest-<date>-failed.json`, and closes the browser and the server.

## Sessions

| Id | What it does | Why |
|---|---|---|
| `lap` | East along the street, a U-turn onto the north sidewalk, west, a U-turn, east. No tricks. | The FPS baseline with the follow camera moving through the whole block. |
| `rails` | Three approaches to the straight rail: one with no balance input (a fall), one balanced, one more. | Falls per minute and snap behavior. |
| `combo` | Grind the straight rail, hop off, shuffle on the roll-out, then push east and launch off the quarter pipe. | The 3-link combo and the vert air, the two moments the M0 hypothesis needs. |

Each session is a list of `{ frames, input }` entries played one per fixed 60 Hz tick, so a session is deterministic. The same sessions run in node through the pure run layer in `src/playtest/sessions.test.js`, which asserts the expected outcomes before the browser ever runs them.

## Metrics

All times come from the simulation tick count (60 ticks per second), not the wall clock, except the FPS numbers.

| Metric | Definition | Where it comes from |
|---|---|---|
| `fps.medianFps` | 1000 divided by the median frame time in ms over the session. The gate metric. | `window.__atl.fps` samples the elapsed time per `requestAnimationFrame`. |
| `fps.averageFps` | 1000 divided by the mean frame time. | Same. |
| `fps.p5Fps` | 1000 divided by the 95th percentile frame time: the slow frames. | Same. |
| `score` | Banked score at the end of the session. | `run.combo.score`. |
| `bestCombo` | The highest single banked combo. | `run.combo.best`. |
| `comboCount` | Number of combos that banked (a link window ran out with points pending). | Count of `bank` events. |
| `maxCombo` | The most links in one combo, banked or not. | Consecutive `move` events with no `bank` or `bail` between them. |
| `timeToFirstThreeLinkSec` | Seconds from the session start to the move that made a combo 3 links long. `null` when it never happened. | Tick of that `move` event divided by 60. |
| `vertAirs` | Landed launches off the quarter pipe. | `move` events named `Vert Air`. |
| `snaps`, `exits`, `falls` | Rail snaps, clean exits (end or jump), falls off a rail. | `skater.stats`. |
| `respawns` | Times the skater left the level and went back to the spawn point. Should be 0. | `skater.stats.respawns`. |
| `fallsPerMinute` | `falls` divided by simulated minutes. The M0 hypothesis asks for under 1 per minute for a human; the scripted `rails` session falls on purpose. | Derived. |
| `grindSeconds` | Seconds spent on rails. | `skater.stats.grindTime`. |
| `styleMoves` | Completed dance moves. | `skater.stats.styles`. |
| `moves` | Every scored move with its tick, points, and on-beat tag. | `move` events. |
| `consoleErrors` | Browser console errors and page errors during the session. Any error fails the run. | Playwright listeners. |

`totals` repeats the FPS numbers over all frames of all sessions, sums score, combos, and falls, and takes the earliest `timeToFirstThreeLinkSec`.

## Reading the report for M0-10

The human playtest asks two numbers of William, not of the script: time to the first 3-link combo (target under 3 minutes) and accidental falls per minute (target under 1). The harness proves the moves are reachable (`combo` session: a 3-link combo and a vert air) and that the build holds 55 FPS; it cannot measure the human numbers. Record the human numbers in `prototypes/greybox-skate/REPORT.md` next to the harness report.

## Machine note

Headless Chromium renders through SwiftShader (software) and is capped at 60 FPS by the frame scheduler. On this development Mac the median is 59.9 FPS. A headed Chrome on the same machine runs at 120 FPS.
