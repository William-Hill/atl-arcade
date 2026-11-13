# Skate ATL design audit, 2026-11-13

Build: `epic/city-look` at `73200b8d`, dev server, high tier, pbr look.
Purpose: find the design problems to fix before a City of Atlanta pitch demo.

## Method

1. A game-designer agent reviewed the concept, the landmark discovery GDD, and the code against the pillars. File: `design-review-docs.md` (this folder). It did not run the game.
2. Autopilot (the Three.js fork, agent `claude-opus-5-5` with fast mode off, decision model Jev) played 3 design runs. Reports: `reports/autopilot/design-2026-11-13-run{1,2,3}-report.json`.

| Run | Question | Play | Cost |
|---|---|---|---|
| 1 `20261113-092119` | A first-time player, screen knowledge only | about 290 s, 3 episodes | $2.31 |
| 2 `20261113-094125` | The landmark discovery loop | about 480 s, 8 episodes, 3 rounds | $2.19 |
| 3 `20261113-095904` | Combos in the H4W skatepark | about 270 s, 5 episodes | $2.10 |

Total: $6.60 on the Anthropic key, plus an estimated $0.02 to $0.22 on the TypeSafe key (not measured). Aura was not used.

Limits:
- Autopilot is a scripted agent, not a human. Its steering stalled on walls in run 2, and its balance keys were reversed at first in run 1. The reports mark these as harness limits.
- The game ran about 3 times slower than wall time.
- The HUD is page markup, so the filmed frames do not show it. The agent read the HUD text.
- No human played. The concept hypothesis stays untested by humans.

## Verdict

The skate feel works. A skater who finds the park gets a good loop: 84% grind snaps, combos of 7 to 8 links, and 33,000 points in one round. The landmark data and the claim flow work.

The game does not explain itself, and the landmark loop starves after the first 25 seconds. A City reviewer who plays once, without help, sees the same problems as the agent:
- no teaching
- no goals on the screen
- no visible reward for a claim
- no facts unless they open a menu

## Findings

### A. Onboarding: the screen does not teach (run 1)

1. The start hint "Press any key or click to start the beat" names no control. It goes away on the first key. The only control help is the small line at the bottom left. The words "push" and "brake" never appear.
2. The HUD never shows the round goals. The goals (6,000 points, a 1,000-point combo, 3 fact cards, 2 gap hops) appear only on the "Time!" screen. The agent met the combo goal at about 104 s and passed 6,000 points at about 207 s, with no sign on the screen.
3. The only goal line on the HUD is about landmark claims. It changes with distance and does not follow the challenge the player is doing (runs 1 and 2).
4. A dance (Q or E) does nothing in the air or on a rail. The screen gives no reason. The first chain attempt of the agent got only 2 links.
5. The rails are only in the skatepark, 73 m from the spawn. Only the minimap skate icon points to them. Nothing tells the player which way to lean on a rail, except the BALANCE dot during the grind.
6. First times in a clean round: push 1 s, jump 8 s, 3-move combo 28.7 s. The first grind snap came only in episode 1, at 30.4 s, and the skater fell 0.17 s later.

Hypothesis check (agent, not human): a 3-move combo came well within 3 minutes. The rail falls in run 1 came from the harness steering. Run 3 had 5 bails in about 4.5 minutes, all on one ledge.

### B. The landmark loop: a dense start, then a long gap (run 2)

1. Two claims and three finds came in the first 25 s. After that the gaps were 20 to 60 s, and round 2 ended with 0 claims.
2. Found and claimed states carry over to the next round. Thus round 2 starts with the near spots done, and nothing on the screen says so. Each round gets emptier.
3. The 150 s timer cut 2 routes with no warning. The level is about 1.9 km long. Spots 500 to 1,000 m away are out of reach in what is left of a round. 8 of 15 spots were never found.
4. The grind claim "Grind the curb below the bridge for 15 m" (Ralph McGill) does not say which curb. Three attempts (about 95 s) failed.
5. Claim feedback: the SPOT CLAIMED banner (2.6 s) and the chime fire on each claim. In the 3D view, the ring only turns yellow and fades in about 1 s, with no burst (#221).
6. A third find banner is dropped when spots come fast (`foundQueueMax` 2). Freedom Park was "found" about 300 m from its icon, because its footprint reaches near the spawn.
7. Facts: no story card shows at a find or claim (#220). The agent was offered the Guide tab at almost every decision and never opened it. No trail fact pop-up appeared in about 480 s. As built, a player sees the facts only if they open a menu.
8. Fast travel ("click, then T") on the full map can remove the travel time that the loop depends on.

### C. The skatepark and the score loop (run 3)

1. Grind snaps: 21 of 25 passes (84%).
2. All 5 bails came on the 6 m concrete ledge. Its solid body stops the skater (a bonk). A grind then starts at the minimum speed of 2.5 m/s and tips over. The other rails have no solid body.
3. The score rewards slow grinds: a grind is 100 + 300 points per second on the rail, so a slow "Long Ledge Grind" beats a fast rail line.
4. Repeated moves decay. At 8 links the multiplier showed x7. Long combos plateau unless the dances vary.
5. The ramps, the kicker, and the bank gave 0 links. The quarter pipe can never trigger the vert air launch: its steepest normal is about 0.36, and the threshold is 0.15 (`launchNormalY`, `src/sim/skate/constants.js:33`; the 0.36 comes from the agent's code reading, not checked here). Only the rail lane scores.
6. The skater clips into the planter and the back face of the quarter pipe. The ramp lane can carry the skater off the pad.
7. The HUD combo line grows without a limit (about 90 characters at 8 links). The "+N" after a bank stays until the next combo.
8. The yellow beat lines on the ground cross over the ramps and ledges.

### D. Rules and pillars (document review)

1. Moving cars are on by default, and a car is a solid box for the skater. AGENTS.md says obstacles are "cones, crowds, and construction". `docs/decisions.md` has a 2026-11-05 entry for "calm traffic" and an older entry that says "no traffic". Decide the policy before the pitch.
2. Claim points do not matter to the medals. All 13 claims sum to 4,000 points, and a run gives at most 1,000 (`runCap`). The gold medal needs 12,000.
3. The GDD unlocks outfits at 7, 14, and 20 claims. The data has 13 claim spots, and no outfit content exists.
4. Fact cards (3) and landmark facts are 2 separate systems with different screens.

### E. Possible bugs (check before a fix)

1. After "Skate again", the skater stood still for about 20 s with the push key held (run 1). Check if the game ignores a key held through the "Time!" screen.
2. The ring line timer jumped back to "24 s left" twice with no message (run 1). By the code, the player re-entered ring 1.
3. The quarter pipe vert air threshold (C5).

## Recommendations, ranked for the City pitch demo

| # | Change | Size | Issue |
|---|---|---|---|
| 1 | Show the round goals on the HUD, and teach the controls in the first 60 s with a guided hop, grind, and 3-move combo. | M | #76 |
| 2 | Build the story card at the claim, and a results row "Spots claimed this run". | M | #220 |
| 3 | Make the landmark loop reachable: a "Tour" mode with claims and no timer, or a longer demo round, a warning when a spot is out of reach, and a soft end of the round. | M | #260 |
| 4 | Build the claim effect in 3D. | S | #221 |
| 5 | Decide the traffic policy and write it in `docs/decisions.md` and `AGENTS.md`. | S | #261 |
| 6 | Fix the skatepark: the ledge bonk then the slow grind, the quarter pipe launch, the clipping, and a score that rewards speed. | M | #262 |
| 7 | Give claims a reward that matters: points that count toward medals, and unlock counts that match 13 spots. | M | #263 |
| 8 | Put the curb or rail of each grind claim on the screen, for example a highlight. | S | #264 |
| 9 | Merge fact cards and landmark facts in one Guide, with a source tag on each card. | S | #265 |
| 10 | Run 5 cold-start human playtests and record the concept hypothesis numbers. | S | #266 |

Not ranked: a second neighborhood. One neighborhood with a clear start, claims, and cards is a stronger pitch than two thin ones.
