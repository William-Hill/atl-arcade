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

## Trick input playtest 1 (#326)

The prototype is `prototypes/trick-input/`. Its automated playtest runs with `node prototypes/trick-input/playtest/playtest.mjs` and writes `prototypes/trick-input/playtest/results.md`. It uses 5 synthetic player profiles (a model of human timing), not humans.

| Metric | Target | Automated result, first run (2026-11-23, the R3 rule) | Automated result, after the #326 fix (2026-11-25, the axis rule, default) |
|---|---|---|---|
| Tricks as wanted | 90% or more | Keyboard 88.8%, phone 90.3%, gamepad 92.1% | Keyboard **90.7%**, phone 90.3%, gamepad 93.1% |
| Unwanted Up from push taps | under 5% | Keyboard 2.9% (0% on the phone and the gamepad) | Keyboard 3.5% (0% on the phone and the gamepad) |
| Unwanted Left/Right from carves | under 5% | Keyboard 11.3%, gamepad 6.4%, phone 0% | Keyboard **7.1%**, gamepad **5.3%**, phone 0% (target still not met) |
| Time to the first 3-link combo with a manual | under 3 minutes | 6.1 s for the route bot (the shortest route, not a human) | 6.1 s for the route bot |

Values are the mean of the 5 synthetic players at seed 11. On 20 more seeds (101 to 120): keyboard 90.2% to 91.4% as wanted, carve leak 9.1% to 6.0%; gamepad 90.7% to 91.8%, carve leak 6.1% to 5.6%. The axis rule is GDD R3a and `docs/decisions.md` (2026-11-25). Toggle 7 (`?gddRule`) gives the first rule for the comparison in the human playtest.

An Autopilot playtest (owner choice 2026-11-25) adds extra evidence; its kit and results table are in `prototypes/trick-input/REPORT.md`. It does not replace the human playtest.

Autopilot runs (2026-11-26, agent with Jev, not humans): axis rule 204 trials, 99.0% as wanted, Up from push 0.0% (0 of 50), L/R from carves 1.1% (1 of 92); GDD rule 257 trials, 99.6%, 0.0% (0 of 45), 0.9% (1 of 117). The agent's timing does not separate the 2 rules; the first-combo times (245.8 s, 15.8 s) are not new-player times. Details: `prototypes/trick-input/REPORT.md`.

**Verdict: PROCEED (2026-11-26, owner choice, on the Autopilot evidence).** The human playtest is deferred to a later date; the carve leak (7.1% predicted on the keyboard) and the time of a new player to the first combo are not measured yet. See `docs/decisions.md` (2026-11-26) and the checklist in `prototypes/trick-input/REPORT.md`.

Autopilot runs in the real game (2026-11-27, `main` at `bb08aaff`, after wave 2: #402, #401, #403, #404; agent with Jev, not humans; BeltLine Eastside skatepark, `?run=free`; no game code changed):

| Run | Focus | Trials | Tricks as wanted | Up from push | L/R from carves | Rail stance as wanted | Cost |
|---|---|---|---|---|---|---|---|
| 1 | Dances and grabs | 21 | 90.5% (19 of 21) | 0.0% (0 of 1) | 0.0% (0 of 5) | not tested | $2.02 |
| 2 | Rails and manuals | 34 | 91.2% (31 of 34) | none | 0.0% (0 of 2) | 100% (15 of 15 snaps: n 2, l 3, r 4, u 4, d 2) | $3.86 |

- The game gave no trick with a wrong direction that the log can prove. All 5 misses are timing misses: 4 presses gave no trick (2 late Q presses in a short hop, 2 F presses in the air with no rail in reach), and in run 2 i33 a Q press in a hop gave no grab, so the log took the next Manual link (n) as its result.
- Run 2 banked combos of grind, manual, and grab, but the time to the first 3-link combo is not measured: the page script read the combo links after the bank cleared them. The script now keeps the links of the frame before the bank.
- The sample is small: about 4.5 and 4 minutes of play. In run 2 the headless game stepped about 0.4 s of sim for each frame, so the agent could not time presses to the frame.
- Run 1 has 8 more trials from the agent's setup probe (i0 to i7); they are not in the numbers above.
- The intent log is a page script, `reports/autopilot/trick-game-intent-page.mjs`; it reads `skater.trick` and the key events. Raw data: `reports/autopilot/trick-game-2026-11-27-run{1,2}-*`.
