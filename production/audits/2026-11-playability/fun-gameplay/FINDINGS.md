# Fun and gameplay audit (#65)

**Date:** 2026-11-03. **Build:** `audit-65-playability` at `90260bb`. No source change. **Auditor:** an agent. No human played. **Skills applied by hand:** playtest-report, design-review (lean, concept v2), balance-check, game-code-review. **Weight:** every finding has a phone impact.

## Scores

| Area | Score | Reason |
|---|---|---|
| Funness | 2 | Push, carve, jump, and the dances feel and look good. The real level has nothing to grind, no goal, and no end. |
| Gameplay | 2 | The moves work on the greybox. The BeltLine has no grind or ramp objects, walls stop the skater dead, and the score has no ceiling. |

## Test and playtest numbers

| Run | Result | Load (1 min) | Evidence |
|---|---|---|---|
| `npm test` | 40 files, 341 tests pass, 5.3 s | 57.9 / 55.2 | — |
| `npm run playtest` (port 5197) | Median 20 FPS (avg 19.4, p5 12), gate 55 FAIL. Score 1,886, max combo 3, falls 1.34/min (the rails session falls on purpose), first 3-link combo 4.15 s, 0 respawns | 39.6 at end. The first try on port 5191 did not start: the port was in use. | `playtest-reports/playtest-2026-11-03-17-17-45.json` |
| `npm run playtest:beltline` (port 5192) | Median 12 FPS (avg 11.3, p5 6.7), FAIL. Score 0 (no tricks in the session) | 53.5 / 55.7 | `playtest-reports/playtest-beltline-eastside-2026-11-03-17-16-08.json` |
| Agent BeltLine play (port 5181, real keys) | First frame after 4.7 s, tier `low`, 0 console errors | 35.7 / 47.0 | `play-log.json` |

The FPS numbers do not measure the game. Other headless browsers ran at the same time, at a load average of 35 to 61. M0 measured 59.9 FPS.

## The first 30 seconds

| Question | Answer | Evidence |
|---|---|---|
| Does the game teach the moves with no text wall? | No. The only teaching is one 45-word line at the bottom of the screen, with developer items ("H for colliders", "?view=orbit"). Nothing in the world prompts a move. | `01-first-view.jpg` |
| Push and steer | Learned in seconds: 0 to 11 m/s in about 2.4 s. The feel is good. | `02-push.jpg`, `03-steer.jpg` |
| Jump | Works. A hop scores 50. | `04-jump-air.jpg` |
| Grind | Cannot be taught on the BeltLine: 0 objects. Hold F does nothing. | `05-grind-attempt-beltline.jpg`, `levels/beltline-eastside/level.json` |
| Dance | Works and looks good ("Bankhead Bounce"). The name shows only when the dance ends. | `06-dance.jpg` |
| Goal understood? | No goal exists. | `11-idle-20s.jpg` |
| Phone | The help line names keys. The beat prompt says "Press any key or click". The game has no touch input. | `12-phone-landscape.jpg` |

## One more run?

No. The build has no run timer, goal list, score or combo target, medals, fact cards, landmark gaps, rink finale, results screen or restart. The agent waited 20 s idle after 47 s of play, and nothing ended. The style meter sets `signatureReady`, but no signature move exists. The score has no ceiling (GP-2).

## Core loop

- **Concept:** one song, 2 to 3 min. Chain grind, air, manual and dance, and chase the goal list (score, combo, 3 fact cards, 2 landmark gaps, rink finale). Medals and fact cards unlock content.
- **BeltLine today:** push, hop and dance along the trail. A dance chain banks. That is all, and the run never ends.
- **Greybox today:** rail grind, hop, dance and vert air. This is the only place where the 30-second loop exists. The run never ends.

## Best and worst moments

| | Moment | Evidence |
|---|---|---|
| B1 | A vert air off the quarter pipe, with an arm-up pose and a +1,017 bank | `16-greybox-vert-air.jpg` |
| B2 | The first push down the tree-lined BeltLine trail | `02-push.jpg` |
| B3 | Rail Grind + Hop + Bankhead Bounce: the combo string and "189 x 2" grow on screen | `14-greybox-grind.jpg`, `15-greybox-dance-in-combo.jpg` |
| W1 | A dead stop at a building wall about 25 s after the spawn. 20 of 20 samples are under 0.5 m/s over 4 s of push. | `10-wall-or-stall.jpg` |
| W2 | Hold F to grind on the BeltLine: nothing happens | `05-grind-attempt-beltline.jpg` |
| W3 | The first screen: a key-name text wall and no goal. On a phone it fills about a quarter of the screen, and the score overlaps the map credit. | `01-first-view.jpg`, `12-phone-landscape.jpg` |

## Gaps: concept and build

| Concept item | Build | Issue |
|---|---|---|
| Run timer, one run = one song | None. The beat is a 100 BPM click track. | #15, #20 |
| Score and combo targets, medals, results screen | None | #15 |
| 3 fact cards | None | #17 |
| 2 landmark gaps | None | #14 |
| Rink finale | None | #19 |
| Leaderboard and share card | None | #21 |
| Rails, ledges and ramps on real features | Greybox yes. BeltLine 0. | #14 |
| Manual in combos | `COMBO.manualPoints` exists, but no input is bound | — |
| Signature move on a full style meter | The meter fills, but no move exists | — |
| A bail ends the combo | Only a rail fall bails | — |
| Touch controls | None | #24 |

## Design review of the concept (lean)

Completeness: 3 of 8. Overview, fantasy and dependencies are present. Rules, formulas, edge cases, tuning knobs and acceptance criteria are missing. These items must change:

1. Give numbers for the score target, the combo target and the medals.
2. Replace "routes" (from v1) with "levels".
3. Replace "Desktop first, phones in version 2", which the 2026-11-03 decision supersedes.
4. Define a touch scheme.
5. Define the combo repeat rules and a ceiling. Pillar 1 says the challenge comes from the ceiling.
6. Define what a wall hit does to speed and the combo.

## Balance check: critical issues

The multiplier equals the link count, so a combo banks n² × p. 10 links bank 15,000; 100 links bank 1,500,000. The rules have no repeat decay and no cap. A held dance never lets the combo bank.

| 120 s on flat ground | Links | Pending (never banked) |
|---|---|---|
| Hold W+Q | 99 | 1,470,150 |
| W held, Q and E in turn | 148 | 3,432,120 |
| W held, Space every 0.7 s | 171 | 1,462,050 |

Points per second: spin dance 267, vert air 200, grind 160, groove dance 125, hop 100. The hardest move (the grind) is not the best choice.

## Code review

- Good: the sim is pure and deterministic at 60 Hz, with Vitest tests.
- `comboTick` ignores the injected `k` and reads `COMBO.linkWindow`.
- The code copies the skater, the combo and their arrays every tick. This makes GC churn on a phone. It is not measured.
- A dance press under 1.5 m/s is lost (no buffer). A dance continues after a wall stop.
- `bonkSpeedKeep: 0` causes the dead stop (#58).
- A wall hit does not bail the combo.
- No reset input: R is switch.

## Findings

| Id | Sev | Finding | Evidence | Fix | Issue | Phone |
|---|---|---|---|---|---|---|
| FUN-1 | P0 | No timer, goals, results screen or restart | `11-idle-20s.jpg`, `play-log.json` | A 2-min timer, 3 goals with numbers, results and restart | #15 | High |
| FUN-2 | P0 | The BeltLine has 0 rails, ledges or ramps | `05-grind-attempt-beltline.jpg`, `level.json` | Put 3 or more rails or ledges and 1 ramp on real features near the spawn | #14 | High |
| GP-1 | P0 | No touch input | `src/input/input.js`, `12-phone-landscape.jpg` | Move the touch part of #24 into M1 | #24 | High |
| GP-2 | P1 | No score ceiling: hold W+Q gives 1.47M points | `balance-sim.json` | Decay repeats (100/50/25 %), cap the multiplier (for example 10), make a grind worth more per second than a dance | — | High |
| GP-3 | P1 | Dead stop at walls next to open grass | `10-wall-or-stall.jpg`, `play-log.json` | Fix #58. Add soft bounds near the trail | #58, #57 | High |
| FUN-3 | P1 | No teaching. A 45-word text line with developer items | `01-first-view.jpg` | One in-world prompt at a time, with icons for each input type. Put developer items behind a flag. | — | High |
| GP-4 | P1 | The move set needs chords that do not fit two thumbs | `bindings.js`, `skater.js` | Auto-push on touch, tap to snap to a rail, stick or tilt for balance | #24 | High |
| FUN-4 | P1 | The BeltLine is a ride. The player drifts onto empty grass. | `03-steer.jpg`, `04-jump-air.jpg`, `09-*.jpg` | Put the objects along the trail, mark them with color, add a guide arrow | #14 | Med |
| GP-5 | P2 | A full style meter does nothing | `08-*.jpg`, `combo.js` | Add a signature move or hide the meter | — | Low |
| GP-6 | P2 | Manual has no input. The 0.8 s window splits the rail-to-ramp line. | `greybox-combo-log.json` | Bind manual. Tune the window to the object spacing. | — | Low |
| GP-7 | P2 | A wall hit does not bail the combo | `run.js` | Decide the rule with #58 | #58 | Low |
| GP-8 | P2 | No reset or back-to-trail input | `bindings.js` | Add a button | — | Med |
| GP-9 | P2 | Allocations every tick (GC) | `controller.js`, `skater.js`, `combo.js` | Profile on a phone first | — | Med |
| GP-10 | P2 | `comboTick` ignores `k` | `combo.js` | Pass `k` | — | Low |
| FUN-5 | P2 | No juice: no sparks, dust, shake or hit stop | cheatsheet, `16-greybox-vert-air.jpg` | One pooled emitter and a small shake with an off switch | — | Low |
| FUN-6 | P2 | The dance name shows late. The score overlaps the credit on a phone. The beat prompt asks for a key. | `06-dance.jpg`, `12-phone-landscape.jpg` | Show the name at the start, move the credit, show "Tap to start" on touch | — | Med |
| FUN-7 | P2 | No music. One run = one song is not possible. | `beat-clock.js` | Add one track and tie the timer to it | #20 | Med |

The audit did not test these known items again: #61 (PR #64), #57 (PR #66), and the rails that are not solid.

## Verified

- 341/341 tests pass.
- Both playtests ran to the end and failed the FPS gate under load.
- The BeltLine has 0 objects, and F does not snap.
- Push, steer, hop and dances work with real keys. A dance chain banked +1,380.
- A wall hit set the speed to 0, and 4 s of push did not move the skater.
- No end, timer or goal appeared in about 67 s, and a source search finds no code for them.
- A greybox grind, hop, dance and vert air score.
- The degenerate combos, in node.
- All screenshots are from this build and under 60 kB.

## Not verified

- Any human play (the M0 hypothesis is still untested).
- FPS on a real GPU or a phone.
- Touch, a real gamepad and sound.
- The on-beat bonus by ear.
- The GC cost.
- The camera at a wall in motion.
- The rails that are not solid, and #61.
