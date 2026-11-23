# Trick input: greybox prototype and playtest 1 (#326)

**Date:** 2026-11-23
**Design:** `docs/gdd/trick-input.md` (epic #324, PR #325)
**Build:** this folder. It does not import `src/`, and `src/` does not import it (AGENTS.md).
**Playtest 1 status:** the automated part is done. The human part (5 or more players, keyboard and phone) is **not done**. A cloud session cannot run a human playtest.
**Verdict:** **none yet.** The owner gives PROCEED, PIVOT, or KILL after the human playtest. The other trick input issues (#327 to #344) wait for PROCEED.

## What the prototype has

The capsule skater, one rail, one kicker, and a flat pad. Text labels show the trick name and the clip name in place of clips.

| GDD rule | In the prototype | Evidence |
|---|---|---|
| R2, R3 fresh direction | Keyboard (WASD and arrows, the newest key wins, Shift gives no direction), gamepad (stick 0.5, main axis, d-pad), `dirBefore` 150 ms, `dirAfter` 60 ms | `src/direction.js`, 15 unit tests, 9 sim tests, 5 real-browser checks |
| R4, R5 grabs | 5 grabs, `grabMinAir`, first press only, hold pay, air spin sum | `src/sim.js`, sim tests |
| R6 grind stances | 5 stances at the press or at the snap (buffered), names "[Long] [edge] [stance] Grind", HUD short form | sim and name tests |
| R7 dances | 10 slots per skater (Nia, Marcus), `beats` and `points` per dance, `STYLE.minSpeed` | sim and data tests |
| R8, F1, F2 manual | `manualDelay`, `manualMinSpeed`, W/S balance, half friction, Toe Roll, the cap at 30 m, the grind-to-manual link, the manual into a kicker | `src/manual.js`, 8 unit tests, 11 sim tests |
| R10 landings | Clean, stumble (grab held at the touchdown), late grab void (`landingGrace`) | sim tests |
| R11 phone flick | Tap = neutral, 24 px drag = direction, 120 ms timeout, GRIND press at the touch-down and the stance at the resolve (one change only), flick ring with short names | `src/flick.js`, 7 unit tests, 4 sim tests, 3 Pixel 7 checks |
| R12 accessibility | One-button mode (key 1), Relaxed timing (key 2), rebind with clash block | sim tests |
| Playtest toggles (owner choice 2026-11-23, not in the GDD) | Key 5: `flickMin` 16 px in place of 24 px. Key 6: carve guard (a left or right still held that started more than 100 ms before the press does not count). Both are off by default. URL flags `?shortFlick` and `?carveGuard` turn them on at load. | 5 unit and sim tests, 1 real-browser check |
| F3 to F7 scoring | Air, grind, link, beat tiers (PERFECT 1.75, GOOD 1.5), multiplier, bank, bail bank | `src/scoring.js`, 17 unit tests (the GDD examples: 268, 408, 3894, 3492, 325) |

Not in the prototype: the grind balance and the grind bail (the bail bank is tested in `scoring.test.js`), vert ramps, drops, switch, sound, and clips.

**Tests:** 121 Vitest tests in 7 files, all pass (`npx vitest run --config prototypes/trick-input/vitest.config.js`).

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

### Real-browser checks: 15 of 15 pass

Keyboard A then Q (60 ms) in the air gives the Japan Grab (5 of 5). With the carve guard on (key 6), D held 200 ms before Q gives the neutral grab. W held 1 s then Q gives the neutral dance. A W tap 80 ms before Q gives Up. The gamepad stick left then Y gives the Japan Grab; the stick at 0.49 gives the neutral grab. On the Pixel 7 viewport: a 30 px flick right gives the Side Grab, a tap gives the Mute Grab, a flick up on SPIN gives ATL Rydin, and the layout has 5 buttons with TRICK in place of GROOVE. No console errors.

### Measured against the targets of the issue

Mean over the 5 synthetic players, 150 trials each (full table in `playtest/results.md`):

| Metric | Target | Keyboard | Phone | Gamepad |
|---|---|---|---|---|
| Tricks as wanted | 90% or more | **88.8%** (82.0 to 97.3) | **82.8%** (66.0 to 98.0) | **92.1%** (86.7 to 98.7) |
| Unwanted Up from push | under 5% | **2.9%** (0.0 to 5.6) | 0.0% | 0.0% (push is a button) |
| Unwanted Left/Right from carves | under 5% | **11.3%** (5.9 to 14.3) | 0.0% | **6.4%** (0.0 to 10.8) |
| Time to the first 3-link combo with a manual | under 3 min (human) | 6.1 s (bot, the shortest route) | not measured | not measured |

The route bot banks "Long Rail Grind + Manual + Japan Grab" (about 2360 points) on the first attempt for all 5 profiles. This proves that the route can be done. It does not measure how long a human needs to learn it.

### Findings

1. **Carves are the main risk on the keyboard and the gamepad.** A and D steer and also give left and right (R2). A carve that starts in the 210 ms window around a neutral trick press turns it into Left or Right. With carves at random times near the press, 11.3% of the neutral and up/down tricks with a carve came out Left or Right on the keyboard. This is over the 5% target. On the phone the steer stick is not a direction source, so the leak is 0%. The human playtest must measure whether real players carve in the window.

   The owner chose (2026-11-23) to add the carve guard as a toggle (key 6) and let the human data decide. In the model the guard helps little: on the keyboard the carve leak goes from 11.3% to 9.5%, and the tricks as wanted go from 88.8% to 82.5%, because the guard also blocks intended directions that a player holds early. On the gamepad the leak stays at 6.4% and the tricks as wanted go from 92.1% to 84.9%. Most modeled carves start inside the last 100 ms or after the press, where the guard does not act. Humans can differ, so the playtest tries both settings.
2. **Push taps are safe only if players pause before a trick.** The profiles stop most push taps 200 to 250 ms before the press, and the unwanted Up stays at 2.9%. With no pause, the share of neutral tricks that come out Up is about (`dirBefore` + `dirAfter`) / tap period: 37.5% at a tap every 0.6 s, 26.5% at 1.0 s. Shift gives no direction, so a player who pushes with Shift has no leak.

   | `dirBefore` | Tap every 0.4 s | 0.6 s | 1.0 s |
   |---|---|---|---|
   | 0.10 s | 41.5% | 31.0% | 21.0% |
   | 0.15 s (typical) | 57.5% | 37.5% | 26.5% |
   | 0.25 s | 80.0% | 50.5% | 31.0% |
3. **`flickMin` 24 px is too long for slow or short flicks in the model.** The phone misses are flicks under 24 px that resolve as taps. `flickMin` 16 gives 92.9% as wanted (1.8% of taps then jitter into a direction). `flickMin` 40 gives 52.5%. The owner chose (2026-11-23) to keep 24 px as the default and to add 16 px as a toggle (key 5), so testers try both on a real phone.
4. **`dirBefore` trades aim for leaks.** On the keyboard: 0.10 s gives 77.6% as wanted, 0.15 s gives 88.8%, 0.25 s gives 92.8% but 14.2% carve leak. `dirAfter` 0 drops the keyboard to 82.7%: the 60 ms after the press catches the late directions.
5. **A GRIND held early before a rail gives a short manual first.** At 8.6 m/s, 0.15 s (`manualDelay`) is about 1.3 m. A player who holds GRIND more than about 1.3 m before the rail gets "Manual + Rail Grind". The GDD allows this (Edge Cases), but a player can see it as a surprise. The first route bot did this. Watch for it in the human playtest.
6. **Frame rate.** Headless SwiftShader: 44 FPS on the desktop viewport and 26 FPS on the Pixel 7 viewport (software render at 2x pixel ratio). This is not a device number. At a low frame rate, CDP touch events arrive late; the playtest uses one-step flicks for this reason.

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

## Human playtest: checklist for the owner

The automated run cannot close these items. Do them, then record the verdict.

- [ ] Find 5 or more players. Include at least 2 on a real phone and 1 rink skater (Pillar 5).
- [ ] Give each player 10 minutes on the keyboard or the phone with no coaching after a 1-minute key explanation.
- [ ] For each trick press, ask or log the intended trick. Count the tricks as wanted (target 90% or more). The log panel (bottom right) and the R3 panel (top right) help.
- [ ] Count unwanted Up from push taps and unwanted Left/Right from carves (target under 5% each). Check finding 1 first: it is the largest risk.
- [ ] Time each player to the first banked 3-link combo with a manual (target under 3 minutes).
- [ ] On the phone, note flicks that came out as taps (finding 3) and the comfort of the flick ring. Each phone player plays half the time with the 16 px toggle (key 5, or open the page with `?touch&shortFlick`).
- [ ] Each keyboard player plays half the time with the carve guard (key 6, or `?carveGuard`). Count the carve leaks and the missed directions for both settings (finding 1).
- [ ] Ask each player to try one-button mode (key 1) and Relaxed timing (key 2) once.
- [ ] Watch for the early-GRIND manual before the rail (finding 5).
- [ ] Write the numbers in the table below and the verdict in `docs/playtest-metrics.md`.

| Player | Device and toggle | Tricks as wanted | Unwanted Up | Unwanted L/R | Time to 3-link + manual | Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |

The verdict (PROCEED, PIVOT, or KILL) goes in `docs/playtest-metrics.md` after the human playtest.
