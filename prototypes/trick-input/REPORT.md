# Trick input: greybox prototype and playtest 1 (#326)

**Date:** 2026-11-23. Updated 2026-11-25: the fix for the keyboard misses (the axis rule).
**Design:** `docs/gdd/trick-input.md` (epic #324, PR #325)
**Build:** this folder. It does not import `src/`, and `src/` does not import it (AGENTS.md).
**Playtest 1 status:** the automated part is done, and it ran again after the axis rule fix (2026-11-25). The human part (5 or more players, keyboard and phone) is **not done**. A cloud session cannot run a human playtest.
**Verdict:** **none yet.** The owner gives PROCEED, PIVOT, or KILL after the human playtest. The other trick input issues (#327 to #344) wait for PROCEED.

## What the prototype has

The capsule skater, one rail, one kicker, and a flat pad. Text labels show the trick name and the clip name in place of clips.

| GDD rule | In the prototype | Evidence |
|---|---|---|
| R2, R3 fresh direction | Keyboard (WASD and arrows, the newest key wins, Shift gives no direction), gamepad (stick 0.5, main axis, d-pad), `dirBefore` 150 ms, `dirAfter` 60 ms | `src/direction.js`, unit tests, sim tests, real-browser checks |
| Autopilot playtest (owner choice 2026-11-25, extra evidence) | The bridge behind `?autopilot=1` (dev server only), the hooks, and the intent log (`playtest.intend`, `playtest.metrics`). See "Autopilot playtest kit". | `src/intent.js` (13 unit tests), `src/autopilot/hooks.js` (7 unit tests), real-browser checks |
| R3a axis rule (owner choice 2026-11-25, default) | An up or down still held at the press counts up to `udHold` (300 ms); an up or down beats a left or right when both are fresh. The input keeps a short history of start events (`dirHist`). Key 7 or `?gddRule` turns it off (the R3 rule only). | `src/direction.js` (`freshDir`, `resolvePressHist`), 10 unit tests, 2 sim tests, 3 real-browser checks |
| R4, R5 grabs | 5 grabs, `grabMinAir`, first press only, hold pay, air spin sum | `src/sim.js`, sim tests |
| R6 grind stances | 5 stances at the press or at the snap (buffered), names "[Long] [edge] [stance] Grind", HUD short form | sim and name tests |
| R7 dances | 10 slots per skater (Nia, Marcus), `beats` and `points` per dance, `STYLE.minSpeed` | sim and data tests |
| R8, F1, F2 manual | `manualDelay`, `manualMinSpeed`, W/S balance, half friction, Toe Roll, the cap at 30 m, the grind-to-manual link, the manual into a kicker | `src/manual.js`, 8 unit tests, 11 sim tests |
| R10 landings | Clean, stumble (grab held at the touchdown), late grab void (`landingGrace`) | sim tests |
| R11 phone flick | Tap = neutral, 24 px drag = direction, 120 ms timeout, GRIND press at the touch-down and the stance at the resolve (one change only), flick ring with short names | `src/flick.js`, 7 unit tests, 4 sim tests, 3 Pixel 7 checks |
| R12 accessibility | One-button mode (key 1), Relaxed timing (key 2), rebind with clash block | sim tests |
| Playtest toggles (owner choice 2026-11-23, not in the GDD) | Key 5: `flickMin` 16 px in place of 24 px. Key 6: carve guard (a left or right still held that started more than 100 ms before the press does not count). Both are off by default. URL flags `?shortFlick` and `?carveGuard` turn them on at load. Key 7 (`?gddRule`) turns the axis rule off. | 5 unit and sim tests, 1 real-browser check |
| F3 to F7 scoring | Air, grind, link, beat tiers (PERFECT 1.75, GOOD 1.5), multiplier, bank, bail bank | `src/scoring.js`, 17 unit tests (the GDD examples: 268, 408, 3894, 3492, 325) |

Not in the prototype: the grind balance and the grind bail (the bail bank is tested in `scoring.test.js`), vert ramps, drops, switch, sound, and clips.

**Tests:** 157 Vitest tests in 9 files, all pass (`npx vitest run --config prototypes/trick-input/vitest.config.js`).

## How to run it

```bash
npx vite --port 5190
```

Open `http://localhost:5190/prototypes/trick-input/index.html` (add `?touch` for the phone layout on a desktop). The keys are in the help panel. The top-right panel shows `dir`, `lastDir`, and the R3 window, so a tester can see why a trick came out neutral.

```bash
node prototypes/trick-input/playtest/playtest.mjs
```

This runs the automated playtest and writes `playtest/results.md`, `playtest/results.json`, and `playtest/screenshots/`.

## Automated playtest 1: method

1. **Real-browser input checks.** Headless Chromium, Playwright. Real key events, a fake `navigator.getGamepads()`, and CDP touch events on a Pixel 7 viewport. The page runs in real time.
2. **Synthetic players.** 5 seeded player profiles (`PROFILES` in `src/bots.js`). Each profile has a timing spread for the direction key against the trick button, push and carve habits, and a flick model. Each player does 150 trials per device (keyboard, phone, gamepad): air grabs, ground dances, and grind stances, 5 intended directions. The raw events go through `input.js` and `sim.js`, the same path as the page. The sessions run inside the browser page.
3. **Route bot.** A closed-loop bot plays the route rail, manual, kicker, grab, and measures the time to the first 3-link combo with a manual.

**Important:** the synthetic numbers test the rules against stated assumptions about human timing. They are not human data. Each profile value is an assumption, and the result moves with it. The sweeps below show how much.

## Results

### Real-browser checks: 18 of 18 pass

Keyboard A then Q (60 ms) in the air gives the Japan Grab (5 of 5). With the carve guard on (key 6), D held 200 ms before Q gives the neutral grab. W held 1 s then Q gives the neutral dance. A W tap 80 ms before Q gives Up. With the axis rule (default), W held from 250 ms before Q gives the Rocket Grab, and key 7 (GDD rule) gives the Mute Grab for the same input. A W tap, then a carve D, then Q gives the Rocket Grab. The gamepad stick left then Y gives the Japan Grab; the stick at 0.49 gives the neutral grab. On the Pixel 7 viewport: a 30 px flick right gives the Side Grab, a tap gives the Mute Grab, a flick up on SPIN gives ATL Rydin, and the layout has 5 buttons with TRICK in place of GROOVE. No console errors.

### Measured against the targets of the issue

Mean over the 5 synthetic players, 150 trials each, seed 11 (full table in `playtest/results.md`). "Before" is the R3 rule (toggle 7). "After" is the axis rule, the default since 2026-11-25.

| Metric | Target | Keyboard before | Keyboard after | Phone | Gamepad before | Gamepad after |
|---|---|---|---|---|---|---|
| Tricks as wanted | 90% or more | 88.8% (82.0 to 97.3) | **90.7%** (84.0 to 98.0) | 90.3% (78.7 to 98.7) | 92.1% | **93.1%** (88.0 to 98.7) |
| Unwanted Up from push | under 5% | 2.9% | **3.5%** (0.0 to 7.0) | 0.0% | 0.0% | 0.0% (push is a button) |
| Unwanted Left/Right from carves | under 5% | 11.3% | **7.1%** (2.9 to 8.7) | 0.0% | 6.4% | **5.3%** (0.0 to 9.3) |
| Time to the first 3-link combo with a manual | under 3 min (human) | 6.1 s (bot) | 6.1 s (bot, the shortest route) | not measured | not measured | not measured |

**Seed check.** All 5 players use seed 11, so they share the trial layouts, and the sample is small. On 20 more seeds (101 to 120, 100 sessions per row): keyboard 90.2% to 91.4% as wanted, Up 2.9% to 3.9%, carve leak 9.1% to 6.0%. Gamepad 90.7% to 91.8%, carve leak 6.1% to 5.6%.

**Result.** The axis rule meets the tricks-as-wanted target on the keyboard and keeps the unwanted Up under 5%. It cuts the carve leak by about one third, but the carve leak target (under 5%) is **still not met** on the keyboard and the gamepad. The owner chose (2026-11-25) to make the axis rule the default and let the human playtest decide.

The route bot banks "Long Rail Grind + Manual + Japan Grab" (about 2360 points) on the first attempt for all 5 profiles. This proves that the route can be done. It does not measure how long a human needs to learn it.

### Findings

1. **Carves are the main risk on the keyboard and the gamepad.** A and D steer and also give left and right (R2). A carve that starts in the 210 ms window around a neutral trick press turns it into Left or Right. With the R3 rule, 11.3% of the neutral and up/down tricks with a carve came out Left or Right on the keyboard. On the phone the steer stick is not a direction source, so the leak is 0%.

   **Cause of the keyboard misses (2026-11-25).** A dump of the missed trials shows 2 causes. (a) Early holds: the player presses the direction 150 to 300 ms before TRICK and holds it. The start is older than `dirBefore`, so the trick is neutral. (b) Last event wins: R3 reads only the newest start event, so a carve that starts after an intended up or down takes the trick (for example "W tap, D carve, Q" gave the Side Grab).

   **Carve guard (toggle 6) sweep.** The guard does not fix the misses. With the R3 rule, keyboard / gamepad as wanted and carve leak:

   | Guard threshold | Keyboard as wanted | Keyboard leak | Gamepad as wanted | Gamepad leak |
   |---|---|---|---|---|
   | off | 88.8% | 11.3% | 92.1% | 6.4% |
   | 0.05 s | 70.9% | 7.8% | 72.1% | 6.4% |
   | 0.10 s (toggle 6) | 82.5% | 9.5% | 84.9% | 6.4% |
   | 0.15 s or more | 88.8% | 11.3% | 92.1% | 6.4% |

   The guard blocks intended left and right that the player holds early, and most modeled carves start inside the last 100 ms or after the press, where the guard does not act. With the axis rule, guard 0.10 s gives keyboard 84.7% and 5.8%.

   **Fix: the axis rule (GDD R3a).** An up or down still held at the press counts up to `udHold` (0.3 s); an up or down beats a left or right when both are fresh. Each part alone: `udHold` only gives keyboard 89.7% and 11.3%; up/down first only gives 89.7% and 7.1%. Together: 90.7% and 7.1%. `udHold` 0.25 s and 0.40 s give the same numbers as 0.30 s.

   **Why the leak target is still missed.** In the bot model a carve and an intended left or right differ only in their timing spread. Left and right are the same keys, so a timing window cannot separate them: a narrower left/right window cuts the leak and also the tricks as wanted. Examples (axis rule plus the named knobs, keyboard / gamepad): `lrAfter` 0.03 s gives 90.5% and 7.1% / 91.5% and 2.6%; `lrAfter` 0 gives 88.3% and 5.4% / 89.7% and 2.6%; `dirBefore` 0.20, `lrBefore` 0.13, `lrAfter` 0.05 gives 88.0%, Up 6.2%, leak 4.9% / 93.3% and 4.3%. No tested setting meets all 3 targets on the keyboard. The human playtest must measure whether real players carve in the window.
2. **Push taps are safe only if players pause before a trick.** The profiles stop most push taps 200 to 250 ms before the press, and the unwanted Up stays at 2.9%. With no pause, the share of neutral tricks that come out Up is about (`dirBefore` + `dirAfter`) / tap period: 37.5% at a tap every 0.6 s, 26.5% at 1.0 s. Shift gives no direction, so a player who pushes with Shift has no leak.

   | `dirBefore` | Tap every 0.4 s | 0.6 s | 1.0 s |
   |---|---|---|---|
   | 0.10 s | 41.5% | 31.0% | 21.0% |
   | 0.15 s (typical) | 57.5% | 37.5% | 26.5% |
   | 0.25 s | 80.0% | 50.5% | 31.0% |
3. **`flickMin` 24 px is too long for slow or short flicks in the model.** The phone misses are flicks under 24 px that resolve as taps. `flickMin` 16 gives 95.9% as wanted (1.8% of taps then jitter into a direction). `flickMin` 40 gives 61.5%. (Correction from the PR review: the first run read only the grind snap and missed the stance change of a flick that resolves after the snap. The phone numbers here count that change: 90.3% in place of 82.8%.) The owner chose (2026-11-23) to keep 24 px as the default and to add 16 px as a toggle (key 5), so testers try both on a real phone.
4. **`dirBefore` trades aim for leaks.** With the axis rule on the keyboard: 0.10 s gives 83.9% as wanted, 0.15 s gives 90.7%, 0.25 s gives 93.5% but 7.4% unwanted Up. `dirAfter` 0 drops the keyboard to 84.5%: the 60 ms after the press catches the late directions.
5. **A GRIND held early before a rail gives a short manual first.** At 8.6 m/s, 0.15 s (`manualDelay`) is about 1.3 m. A player who holds GRIND more than about 1.3 m before the rail gets "Manual + Rail Grind". The GDD allows this (Edge Cases), but a player can see it as a surprise. The first route bot did this. Watch for it in the human playtest.
6. **Frame rate.** Headless SwiftShader: 56 FPS on the desktop viewport and 46 FPS on the Pixel 7 viewport (2026-11-25 run; 44 and 26 FPS on 2026-11-23) (software render at 2x pixel ratio). This is not a device number. At a low frame rate, CDP touch events arrive late; the playtest uses one-step flicks for this reason.

## Screenshots

| File | Shows |
|---|---|
| `playtest/screenshots/01-keyboard-japan-grab.png` | Real keys: A then Q in the air, Japan Grab, clip label |
| `playtest/screenshots/02-keyboard-dance-up.png` | A W tap before Q: Swag Surf; the R3 window panel |
| `playtest/screenshots/03-route-grind.png` | Rail Grind |
| `playtest/screenshots/04-route-manual-bar.png` | The grind-to-manual link and the balance bar |
| `playtest/screenshots/05-route-japan-grab.png` | Japan Grab off the kicker, combo line |
| `playtest/screenshots/06-route-combo-banked.png` | The combo banks |
| `playtest/screenshots/07-grayscale-manual-bar.png` | Grayscale: the bar reads from shape and text (R12.4) |
| `playtest/screenshots/08-phone-flick-ring.png` | Pixel 7: flick ring, Side Grab lit |
| `playtest/screenshots/09-phone-atl-rydin.png` | Pixel 7: flick up on SPIN, ATL Rydin; 5 buttons |

## Human playtest kit

### URL flags and keys

Start the page with `npx vite --port 5190` and open `http://localhost:5190/prototypes/trick-input/index.html`.

| Setting | URL flag | Key | Use |
|---|---|---|---|
| Axis rule (default) | none | none | The new rule: an up or down held up to 300 ms before TRICK counts, and an up or down beats a carve |
| GDD rule (axis rule off) | `?gddRule` | 7 | The first R3 rule, for the comparison |
| Carve guard | `?carveGuard` | 6 | A left or right held more than 100 ms before TRICK does not count |
| Short flick (16 px) | `?touch&shortFlick` | 5 | The phone flick needs 16 px in place of 24 px |
| Phone layout on a desktop | `?touch` | 4 | The touch buttons |
| One-button mode, Relaxed timing | none | 1, 2 | Try once per player |

The status line (top left) shows "axis rule" or "GDD rule", and the toggles that are on. Flags can go together, for example `?gddRule&carveGuard`. The keys toggle at any time; a toggle resets the skater in place.

### What to tell the players (1 minute, then no coaching)

- "W pushes, A and D steer, S brakes. Space jumps. F grinds and, held on the ground, does a manual."
- "Q is TRICK. Press Q alone for the basic trick. For a different trick, press a direction (W, A, S, or D) just before Q, or at the same time."
- "Say the trick you want before you press, for example 'left grab' or 'basic dance'."
- Phone: "TRICK, SPIN, and GRIND: tap for the basic trick, or flick from the button up, down, left, or right."
- Do not tell the players about the timing windows or the toggles.

### Plan per keyboard player

1. 5 minutes with the default (axis rule), then 5 minutes with `?gddRule` (key 7). Swap the order for every second player.
2. If time permits, 3 minutes with the carve guard (key 6) on top of the default.

### What to record for the 3 metrics

For every trick press, write: the player, the device, the rule (axis or GDD), the intended trick (what the player said), and the trick that came out (the log panel at the bottom right). The R3 panel at the top right shows why a trick came out neutral. Then count:

1. **Tricks as wanted** = presses where the result is the intended trick / all presses. Target 90% or more.
2. **Unwanted Up from push** = presses that came out Up while the player wanted another trick and pushed with W in the 1.5 s before / presses with W push input in the 1.5 s before and another intended trick. Target under 5%.
3. **Unwanted Left/Right from carves** = presses that came out Left or Right while the player wanted neutral, Up, or Down and steered with A or D near the press / presses with a carve near the press and a neutral, Up, or Down intention. Target under 5%. The automated run predicts about 7% with the axis rule and about 11% with the GDD rule, so this metric decides between the rules.

Also time each player to the first banked 3-link combo with a manual (target under 3 minutes). A screen recording with the log panel visible makes the counts easier.

## Autopilot playtest kit (extra evidence, owner choice 2026-11-25)

The owner chose (2026-11-25) to run an Autopilot playtest of the prototype now. It is **extra evidence only**. The human playtest (5 or more players) stays the gate for PROCEED, PIVOT, or KILL. Autopilot is an agent with a decision model, not human timing, so its numbers are model evidence, as the synthetic players are.

A cloud session cannot run Autopilot: a run needs the Jev decision model (a TypeSafe key or an Aura plan) and an Anthropic API key. Run it on the owner's computer, as for the design audit runs of 2026-11-13 (`production/audits/2026-11-13-design-audit/REPORT.md`), with the fork `William-Hill/autopilot`, branch `threejs-engine`, and `AUTOPILOT_SHARE=0`.

### What the prototype gives Autopilot

- **The bridge.** `src/autopilot/` is a copy of the game's bridge (`src/autopilot/autopilot-bridge.js` at the repository root; a prototype never imports `src/`). It connects only in the dev server and only with `?autopilot=1`. It says hello as engine `threejs`, project `atl-arcade`, `share: false`.
- **The hooks** (`src/autopilot/hooks.js`): the skater (position, heading, speed, mode), the key bindings (the direction actions share A, D, W, S with steer, push, and brake), `move` (hold W and steer toward a direction), restart, pause, and the game time (the sim clock).
- **The intent log** (`src/intent.js`). The agent says the trick it wants before each press. The page pairs it with the trick that comes out and gives the 3 metrics with the same definitions as the synthetic players. The agent reaches it by name through the bridge objects:
  - `game.call("playtest", "intend", "l")`: the intended direction (`n`, `l`, `r`, `u`, or `d`) just before the press. An optional second argument is a note.
  - `game.call("playtest", "metrics")`: for the rule setting now (`config`, for example "axis" or "gdd+guard"): the trials, tricks as wanted, unwanted Up from push, unwanted Left/Right from carves, the presses with no trick, the time to the first 3-link combo with a manual (from the last restart), and the last 10 trials. `byConfig` gives the trial count of each setting; `metrics("gdd")` gives another setting. Each trial keeps the setting of its press, so a run that changes a toggle does not mix the settings.
  - `game.call("playtest", "rows", 0, 100)`: the trials, 100 per page, with `total` and `next` (the offset of the next page, or null).
  - The log tracks the TRICK, SPIN, and GRIND presses. A press with an intention and no trick within 1 s (GRIND: within the 0.15 s grind buffer plus one frame) is a failed trial. The push and carve windows start at the press. A reset starts a new run: old input does not reach the new run.
  - Only `playtest` is reachable by name through the bridge. The skater state comes through the player hook.
  - The same calls work in a browser console: `__ti.playtest.intend("l")`, `__ti.playtest.metrics()`.

### Steps

1. Start the prototype: `npx vite --port 5190` in the repository root.
2. Start the Autopilot agent service (the fork) as for the 2026-11-13 runs, with `AUTOPILOT_SHARE=0`.
3. Open the page for the run (the bridge connects to `ws://127.0.0.1:8765/v1/bridge`; `autopilot_url=` changes it):
   - Run A, the axis rule (default): `http://localhost:5190/prototypes/trick-input/index.html?autopilot=1`
   - Run B, the GDD rule: `http://localhost:5190/prototypes/trick-input/index.html?autopilot=1&gddRule`
4. Give Autopilot the request below (a `goal` run of about 10 minutes each). Use the same request for runs A and B.
5. At the end, the agent reads `playtest.metrics()`. Copy the numbers into the table below and the report into `reports/autopilot/`.

### The request for Autopilot

> Play the trick input prototype like a new player for 10 minutes. The keys: W pushes, A and D steer, S brakes, Space jumps, F grinds (hold it off a rail for a manual), Q is TRICK, E is SPIN. A direction key (W, A, S, or D) pressed just before Q, or at the same time, picks a different trick. Before EVERY press of Q, E, or F, call `game.call("playtest", "intend", <dir>)` with the direction you want: n (no direction), l, r, u, or d. Mix all 5 directions, in the air (off the kicker), on the ground (dances), and on the rail. Skate as a player does: push with W and steer with A and D between tricks. Do not wait still before a trick. Also try to bank a combo of 3 links or more with a manual (for example rail grind, manual, then a grab off the kicker). At the end, call `game.call("playtest", "metrics")` and report the result, and every trial where the result was not the intended direction.

### Results (to fill in)

| Run | Rule | Trials | Tricks as wanted | Unwanted Up from push | Unwanted L/R from carves | First 3-link combo with a manual |
|---|---|---|---|---|---|---|
| A | axis (default) | | | | | |
| B | GDD (`?gddRule`) | | | | | |

Targets: 90% or more, under 5%, under 5%, under 3 minutes. A metric with fewer than 20 trials in its count (`pushTrials`, `carveTrials`) is too small to read.

## Human playtest: checklist for the owner

The automated run cannot close these items. Do them, then record the verdict.

- [ ] Find 5 or more players. Include at least 2 on a real phone and 1 rink skater (Pillar 5).
- [ ] Give each player 10 minutes on the keyboard or the phone with no coaching after a 1-minute key explanation.
- [ ] For each trick press, ask or log the intended trick. Count the tricks as wanted (target 90% or more). The log panel (bottom right) and the R3 panel (top right) help.
- [ ] Count unwanted Up from push taps and unwanted Left/Right from carves (target under 5% each). Check finding 1 first: it is the largest risk.
- [ ] Time each player to the first banked 3-link combo with a manual (target under 3 minutes).
- [ ] On the phone, note flicks that came out as taps (finding 3) and the comfort of the flick ring. Each phone player plays half the time with the 16 px toggle (key 5, or open the page with `?touch&shortFlick`).
- [ ] Each keyboard player plays half the time with the axis rule (default) and half the time with the GDD rule (key 7, or `?gddRule`). Count the carve leaks and the missed directions for both rules (finding 1, the kit above). If time permits, also try the carve guard (key 6).
- [ ] Ask each player to try one-button mode (key 1) and Relaxed timing (key 2) once.
- [ ] Watch for the early-GRIND manual before the rail (finding 5).
- [ ] Write the numbers in the table below and the verdict in `docs/playtest-metrics.md`.

| Player | Device and rule/toggle | Tricks as wanted | Unwanted Up | Unwanted L/R | Time to 3-link + manual | Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |

The verdict (PROCEED, PIVOT, or KILL) goes in `docs/playtest-metrics.md` after the human playtest.
