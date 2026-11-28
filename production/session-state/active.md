# Active session

- Concept: Skate ATL — free skate in 3D (THPS meets Jet Set Radio), Three.js
- Prior prototype: beat-lock (Phaser) — PIVOT, see prototypes/beat-lock-concept/PIVOT-NOTE.md
- Hypothesis: free movement + grind + jump + style chain feels good; new player chains a 3-move combo within 3 minutes; accidental rail falls under 1 per minute.
- Riskiest assumption: a kinematic skate controller with rail snapping and a follow camera feels good in the browser, built by agents without a scene editor.
- Phase: M1. M0 is done; the M0-10 verdict is PROCEED (`prototypes/greybox-skate/REPORT.md`).

## chooseStyle() level mismatch, 2026-11-28

Branch `fix/choosestyle-level-tag` from `feat/407-victorian-house`. Design: `docs/decisions.md`, 2026-11-28. `withStyleDistricts()` tags each building with its anchor district at load time, so `chooseStyle(b)` equals `chooseStyle(b, level)` for every building (16 differed before). Verified: Vitest `style-districts.test.js` and the full suite; lab captures `reports/lab/shotgun-house-7-pbr-level-tag/`, `reports/lab/storefront-8-pbr-level-tag/` (with the 1-tower copy of `e2e/lab.spec.js`, as for #407). NOT verified: no person looked at it; the full Playwright suite did not run.

## Victorian house style and historic district mix (#407), 2026-11-28

Branch `feat/407-victorian-house` from `main`. Sources: `docs/research/2026-11-28-inman-park-victorian.md`. Design: `docs/decisions.md`, 2026-11-28. `styles.js` edits are additive (#406 also edits `chooseStyle()`).

| Part | Where | Verified |
|---|---|---|
| `victorian-house` style, hip roof with front gable, corner turret, wrap porch on turned posts | `src/level/geo/styles.js`, `src/level/geo/facade-kit.js` (`victorianRoof`, `victorianTurret`, `victorianPorch`) | Vitest `victorian.test.js`; lab captures `reports/lab/victorian-house-0-pbr/`, `reports/lab/victorian-house-37-pbr/` |
| City historic district boundaries and the district mix | `scripts/historic-districts.mjs`, `levels/beltline-eastside/historic-districts.json`, `src/level/geo/historic-districts.js`, `src/level/levels.js` | Vitest `historic-districts.test.js` |
| Triangle budget | `src/level/geo/victorian.test.js` | Vitest (Victorian mean 1046, max 2319; shotgun mean 1040, max 3430) |

NOT verified: no person looked at the houses in the game; the lab captures used a copy of `e2e/lab.spec.js` that waits for 1 landmark tower, because in this container the PBR landmark textures never report loaded (on `main` too); the Chapter 20L district regulations were not read (the City site refused the fetch).

## One-button sets, SPIN rule, goal reachability, banned words (#336, #342), 2026-11-27

Branch `claude/gifted-darwin-mhhrm3` from `main` (wave 2 step 2, lane O). Design: `docs/decisions.md`, 2026-11-27. No change to `src/main.js`, the trick HUD, or `perfectHitStopMs` (lane H owns them).

| Part | Where | Verified |
|---|---|---|
| No direction in one-button mode: SPIN is Cross Step, GRIND is the neutral stance | `src/sim/skate/trick-step.js` (`kd`, `dirInput`, `oneButtonStance`) | Vitest `one-button-336.test.js`; Playwright `e2e/one-button-336.spec.js` |
| TRICK snaps take the grind set; the air snap buffer | `src/input/one-button.js` (`ob.stance`, `ONE_BUTTON_BUFFER`) | Vitest `one-button-336.test.js`, `one-button.test.js`; Playwright `e2e/one-button-336.spec.js` |
| Every goal and landmark challenge in one-button mode | `src/sim/skate/one-button-goals-336.test.js`, `e2e/skatepark-ride.js` (`stepperFor`), `e2e/landmark-rides.js`, `e2e/route-ride.js` | Vitest (5 goals, 13 challenges) |
| Banned word list, name check, "(edge) Grind" | `src/content/banned-words.js`, `src/landmarks/validate.js` | Vitest `src/content/banned-words.test.js` |

NOT verified: no person played one-button mode; no real phone, GPU, or gamepad; the full Playwright suite did not run (it runs on `main` before the Autopilot playtest).

## Trick HUD (#330) and PERFECT hit stop (#338), 2026-11-27

Branch `claude/determined-bell-1h3iho` from `main` (wave 2 step 2, lane H; lane O does #336 and #342 in parallel). Spec: `docs/ux/trick-hud.md`. Design: `docs/decisions.md`, 2026-11-27.

| Part | Where | Verified |
|---|---|---|
| E1 trick line, E2 chip, E3 hold bar and pips (pure text) | `src/ui/trick-hud-text.js`, `src/ui/hud.js`, `src/shell.css` | Vitest `trick-hud-text.test.js`; Playwright `e2e/trick-hud.spec.js` |
| Link direction, Busy event | `src/sim/skate/combo.js`, `run.js`, `trick-step.js` | Vitest `trick-hud-330.test.js` |
| E4 manual bar | `src/ui/manual-bar-math.js`, `src/ui/manual-bar.js` | Vitest `manual-bar-math.test.js`; Playwright `trick-hud.spec.js` |
| E5 ring and flick card | `src/input/touch.js`, `src/ui/flick-card.js`, `src/ui/trick-map.js` | Vitest `trick-map.test.js`; Playwright `trick-hud.spec.js`, `trick-touch.spec.js` |
| E6 trick list, dance origins | `src/ui/trick-list.js`, `src/content/dance-origins.js`, `src/ui/settings-menu.js` | Vitest `trick-map.test.js`; Playwright `trick-hud.spec.js` |
| `perfectHitStopMs` | `src/sim/skate/constants.js`, `src/sim/skate/hit-stop.js`, `src/main.js` | Vitest `hit-stop.test.js`; Playwright `trick-hud.spec.js` |

NOT verified: no person played it; no real phone, GPU, or gamepad (the gamepad test sends fake pad objects); no person signed off the grayscale screenshots; the full Playwright suite did not run.

## Trick rules on in the game (#328, #340, #343, #337), 2026-11-26

Branch `claude/quirky-heisenberg-xyd0i9` from `main` (step 1, alone, because it changes `src/main.js`). Design: `docs/decisions.md`, 2026-11-26 "The trick rules play in the game".

| Part | Where | Verified |
|---|---|---|
| `skaterEnv.tricks` on, `?gddRule`, Relaxed timing | `src/main.js`, `src/input/trick-constants.js` (`simTricks`) | Playwright `e2e/trick-game.spec.js` |
| One-button intent in the sim | `src/input/one-button.js` (`oneButtonFrame`), `src/sim/skate/skater.js` (`oneButtonContext`), `src/sim/skate/trick-step.js` | Vitest `one-button-328.test.js`; Playwright `trick-game.spec.js` |
| Touch GRIND stance at the flick resolve | `src/sim/skate/trick-step.js` (from #399) | Vitest `touch-grind-340.test.js`; Playwright `trick-touch.spec.js` (Makio) |
| Frame helper in the input timing tests | `src/input/direction.test.js`, `src/input/flick.test.js` | Vitest |
| Beats and points per dance | `src/sim/skate/tricks.js` (`danceNamed`) | Vitest `dance-337.test.js` |

NOT verified: no person played it; no real phone, GPU, or gamepad; the full Playwright suite did not run (it runs on `main` before the Autopilot playtest).

## #330 Trick HUD UX spec, 2026-11-26

Branch `claude/focused-turing-0gpscl` from `main` (lane D, docs only). Spec: `docs/ux/trick-hud.md`. Decisions: `docs/decisions.md`, 2026-11-26. No code in `src/`. Wave 2 implements it. Open questions for the owner are in section 12 of the spec.

## #264 and #365 Claim targets, 2026-11-24

Branch `claude/lucid-fermat-zrlawv` from `main`. Design: `docs/decisions.md`, 2026-11-24. Owner decision (#365): the skatepark combo zone is the whole pad plus 2 m, drawn as a gold double outline.

| Part | Where | Verified |
|---|---|---|
| Area zone (pad + margin), `inZone`, `activeOf`, grind meters | `src/sim/landmarks.js`, `levels/beltline-eastside/landmarks.json`, `src/landmarks/validate.js` | Vitest `src/sim/landmarks.test.js` (#365: west end of the rail lane claims; #264: active grind) |
| Goal line follows the challenge in progress, "Grind 6 of 15 m" | `src/landmarks/play.js`, `src/landmarks/guide.js` | Vitest `src/landmarks/play.test.js` |
| Rounded rectangle ring of an area zone | `src/render/landmark-rings-math.js`, `src/render/landmark-rings.js` | Vitest `src/render/landmark-rings-math.test.js`; Playwright `e2e/claim-targets.spec.js` |
| Grind target line on the rail or curb | `src/render/claim-target-math.js`, `src/render/claim-target.js`, `src/main.js` | Vitest `src/render/claim-target-math.test.js`; Playwright `e2e/claim-targets.spec.js` |
| Dance refusal reason | `src/sim/skate/skater.js` (`refused`), `src/ui/hud.js`, `src/shell.css` | Vitest `skater.test.js`, `hud.test.js`; Playwright `e2e/claim-targets.spec.js` |

#264 and #365 NOT verified: no person played it; no real phone or GPU; no new Autopilot run.

## #301 Intro and title screen, 2026-11-23

Branch `claude/elegant-ride-50px3u` from `main`. Design: `docs/decisions.md`, 2026-11-23.

| Part | Where | Verified |
|---|---|---|
| Plan, phases intro → title → play, flight and title camera (pure) | `src/ui/intro.js` | Vitest `src/ui/intro.test.js`, 28 tests |
| Logo, title screen, keys, taps, pad poll | `src/ui/front-screen.js` | Playwright `e2e/intro.spec.js` 5 of 5: high tier 1280 x 720 (key skip, settings, key start), intro ends by itself, phone tier Pixel 7 landscape (tap skip, tap start), reduced motion, `?intro=0` and WebDriver |
| Wiring | `src/main.js` (`front`, attract mode in `simulate()`, `__atl.front`) | as above |

#301 tests, cloud container: `npm test` 2050 of 2050 pass. `npm run build` passes. Regression e2e (intro, shell, settings, goals, callouts, touch, input, skater-model, teach): 40 of 42 pass; the 2 failures (`shell.spec.js` skater select, `teach.spec.js` touch portrait) fail the same way on `main`. `npm run playtest:beltline`: 4.3 fps on SwiftShader (`main`: 4.0 fps); the 55 fps gate needs a real GPU.

#301 NOT verified: no person played the intro; no real phone, GPU, or gamepad; the 55 fps gate on real hardware.

## #76 Teach the moves in the world, 2026-11-21

Branch `feat/76-teach-moves` from `epic/city-look`; draft PR, base `epic/city-look` (change the base to `main` after PR #304 merges). Design: `docs/decisions.md`, 2026-11-21.

| Part | Where | Verified |
|---|---|---|
| Steps, prompts, grind target, pin place (pure) | `src/ui/teach-steps.js` | Vitest `teach-steps.test.js`, 25 tests |
| Pin ride from the spawn to the skatepark rail | `e2e/teach-ride.js` | Vitest `teach-ride.test.js`, 2 tests: snap at 9.3 s, combo Rail Grind, Hop, Toe Spin |
| Prompt card, pin, touch glow | `src/ui/teach-prompt.js`, `src/ui/teach.css`, 6 lines in `src/main.js` | Playwright `e2e/teach.spec.js` 3 of 3: keyboard on the high tier 1280 x 720 (15.0 min), gamepad (simulated pad), touch on Pixel 7 portrait; pictures `e2e/__screenshots__/teach-*.png` |

#76 tests, cloud container: `npm test` 1860 of 1861 pass (the known 5 s timeout in `facade-kit.test.js`). `npm run build` passes. `npm run perf:check -- --no-build --tiers phone,high`: budget PASS; phone 97 draw calls in toon and 113 in pbr lite; the high tier rides stopped at the 240 s wall limit. The low tier did not run.

#76 NOT verified: no person played the prompts; no real phone, GPU, or gamepad; touch in landscape has no test; the browser grind ride starts 25 m before the rail (the full ride from the spawn runs in the pure simulation only); real skaters did not review the prompt words.
## #262 skatepark: ledge catch, quarter pipe lip, grind score, clipping, 2026-11-21

Branch `fix/262-skatepark` from `epic/city-look`; draft PR with base `epic/city-look` (base changes to `main` after PR #304 merges). Details: `docs/decisions.md`, 2026-11-21.

| Part | Where | Verified |
|---|---|---|
| Ledge catch | `src/sim/skate/skater.js`, `GRIND.catchAlongDot`, `GRIND.catchWindow` | Vitest `skatepark-262.test.js`; Playwright ledge catch ride (snap at 7.55 m/s at 70 degrees) |
| Quarter pipe lip launch, kicker pop | `src/sim/skate/controller.js` (`atLip`, `launchVert`, `popUp`), `SKATE.lipNormalY`, `COMBO.rampAirPoints` | Vitest; Playwright vert air ride (top 1.85 m over the pad) |
| Grind score by meters | `src/sim/skate/run.js`, `grind.js`, `COMBO.grindPerMeter` 35, `COMBO.longGrindMeters` 10 | Vitest `skatepark-262.test.js`, `balance.test.js` |
| Body out of walls | `src/sim/skate/controller.js` (`faceHeight`, `airWall`, `pushOut`, `leaveAt`) | Vitest sweep, 96 rides per feature; Playwright pictures `e2e/__screenshots__/skatepark-262-*.jpg` |

#262 tests, cloud container: `npm test` 1843 of 1845 pass (the 2 known 5 s timeouts in `facade-kit.test.js` and `geo-mesh.test.js`). Playwright `e2e/skatepark.spec.js` 8 of 8 pass (50.7 min, SwiftShader). The full e2e suite did not run.

#262 NOT done: the beat lines over the park features (render); an Autopilot run in the park; the upright body under the quarter pipe lip (render). Owner decision open: `grindPerMeter` 35 (keeps the score scale; #75 holds at 8 m/s and up) or 120 (#75 at every speed; grind combos score about 3 times more).

## #218 landmark icons on the maps and the Guide tab, 2026-11-12

Branch `claude/218-landmark-map-icons` from `epic/city-look`; no PR yet (the owner asks for it). Details: `docs/decisions.md`, 2026-11-12.

| Part | Where | Verified |
|---|---|---|
| Icon math (looks, sizes, 6 glyphs, icon list, Guide rows, panel text, https check, pulse) | `src/ui/landmark-icons.js` | Vitest `src/ui/landmark-icons.test.js`, 28 tests |
| Canvas icon, Guide tab and panel DOM | `src/ui/spot-icon.js`, `src/ui/landmark-guide.js` | Playwright (below) |
| Minimap and full map read the tracker | `src/ui/minimap.js`, `src/ui/fullmap.js`, `src/ui/minimap-math.js` (`mapParks` replaces `mapLandmarks`), `src/shell.css` | Playwright `e2e/landmark-map.spec.js` 11 of 11: the 4 states (Unknown, Found, Claimed, edge Found) on the minimap and the full map in the toon look and `?look=pbr`, at 1280 x 720 and 390 x 844, icons 22 px and 14 px on the minimap and 24 px on the full map; a click, a tap and the keyboard open the panel of each state; Escape, the close button and a tap outside close it; the Guide tab shows "2 of 13 claimed" and "5 of 15 found"; the free run text; the pulse and no pulse with reduced motion |
| Tracker and test hook in the game | `src/main.js` (after the `skateparkView` block), `src/level/levels.js` `loadLandmarks()` | `window.__atl.landmarks` in the dev server; the spec sets the states with it |

#218 tests, cloud container: `npm test` 1737 of 1739 pass (the 2 known 5 s timeouts in `facade-kit.test.js` and `geo-mesh.test.js`). `npm run build` passes. Playwright `landmark-map`, `fullmap`, `minimap`: 22 of 23 pass; the 1 failure is `minimap.spec.js` "the choice stays after a reload", which passes the 30 s test limit with 2 page loads and fails the same way on `epic/city-look`. The full e2e suite did not run. `npm run perf:check -- --tiers phone` (both looks): budget PASS, 95 draw calls in toon and 111 in pbr lite, heap 61.7 MB and 50.3 MB (cap 100); the low and high tiers did not finish inside the 10 minute limit of the first run and were not run again.

#218 NOT verified: M-3 (a person must judge the grayscale pictures `e2e/__screenshots__/landmark-map-grayscale*.png`); no person used the maps or read a panel; no real phone or GPU. This branch does not step the tracker: a spot changes only through the test hook until #219 merges. The panel is plain; the trading card, the results row and "Reset progress" are #220. `/ux-design` did not run for the Guide tab (the GDD UX flag).

For the merge with #219: both branches add the tracker after the `skateparkView` block in `src/main.js` and `window.__atl.landmarks`; keep one copy of each. Here the hook is on with `import.meta.env.DEV` only.

## #219 Landmark rings, banners, HUD goal line and chimes, 2026-11-12

Branch `claude/219-landmark-rings-banners` from `epic/city-look`; no PR yet (the owner asks for it). Design: `design/gdd/landmark-discovery.md` on `main`. Decisions: `docs/decisions.md`, 2026-11-12. #218 (map icons, the Guide tab) runs in another session at the same time: both branches create `landmarkTracker` in `src/main.js` after the `skateparkView` block and put `landmarkTestHook` at `window.__atl.landmarks`.

| Part | Where | Verified |
|---|---|---|
| Tracker in the game loop | `src/main.js` (data from `loadLandmarks()` of #218), `src/landmarks/play.js` | Vitest `play.test.js`; Playwright: a ride finds and claims, the claim is in `atl.landmarks` after a reload |
| Banners (Found, Claimed) | `src/ui/landmark-banner.js`, `#landmark-banner` in `src/shell.css`, `hold` in `src/sim/landmarks.js` | Vitest; Playwright in both looks at 1280 x 720, 390 x 844, 360 x 640 and 1024 x 550 |
| HUD goal line | `src/ui/hud.js` (`#hud-goal`), `goalLine()` in `src/landmarks/play.js` | Vitest; Playwright |
| Challenge rings | `src/render/landmark-rings.js`, `landmark-rings-math.js` | Vitest (V-1, tiers, shapes); Playwright: 4 shapes in both looks, +1 draw call with 5 Found spots on the phone tier and +0 with none, no red pixel |
| Chimes | `src/audio/chimes.js`, `chime-math.js` | Vitest (notes, start time, duck, queue); Playwright: on the beat grid, under 1 beat, the music ducks |
| Rides with the real controller | `e2e/landmark-rides.js`, `src/landmarks/rides.test.js`, `e2e/landmarks.spec.js` | All 13 challenges claim in the pure simulation; 4 run in the browser in both looks (Freedom Parkway gap, Ralph McGill grind, Telephone Factory line, skatepark combo) |

#219 tests, cloud container: `npm test` 1771 of 1773 pass (the 2 known 5 s timeouts). Playwright `e2e/landmarks.spec.js` 19 of 19 pass (about 29 minutes, SwiftShader); pictures `e2e/__screenshots__/landmarks-*.jpg`. `fact-cards`, `goals` and `phone-layout` have 4 failures that fail the same way on `epic/city-look` in this container (see `docs/decisions.md`). The full e2e suite did not run. Release build: `window.__atl.landmarks` is `null`. `npm run perf:check`: budget PASS (phone tier 95 draw calls in toon, 111 in pbr lite; no cap changed).

#219 NOT verified: no person played a challenge, heard a chime or read a banner; no real GPU or phone (P-2 open); the high tier ran once by hand (pbr, night), not in the spec; real skaters did not review the challenges. The 13 rides are scripts with exact timing: they show each position can be ridden, not that a tier fits a person.

#219 open points for the owner (in `docs/decisions.md`, "GDD points decided here"): the ring grows wider far from the camera; the banner at 30 vh ends just over the skater's head; the Claimed fill by the trail is an ochre near the landmark gold; the first run of a new save shows the Freedom Parkway banner at the spawn; a chime before the first key or tap is dropped. Not in #219: the results row and cards (#220), the claim burst and petals (#221), the map icons and the Guide tab (#218), "Reset progress" and the "Progress is not saved" notice in the settings menu (E-5, E-8).

## #246 pbr lite on the phone tier, 2026-11-10

Branch `claude/246-pbr-lite-phone` from `epic/city-look`; no PR yet (the owner asks for it). Decision (the owner): the pbr look stays on phones as "pbr lite"; see `docs/decisions.md`, 2026-11-10, and `docs/perf/246/README.md`.

| Part | Where | Verified |
|---|---|---|
| Ranked costs | `scripts/phone-look-perf.mjs`, `scripts/phone-look-split.mjs`, `docs/perf/246/*.json` | SwiftShader runs on the audit's 4 phone profiles: the Blender tree leaf cards are 79 % of the extra frame by the spawn, then the pbr ground shader |
| Pbr lite | `src/render/pbr-lite.js`, `trees.js` (`cards: 6`), `pbr-ground.js` (`GROUND_CUTS`), `murals.js` (1024 px atlas) | pbr / toon 4.0x to 10.3x before, 3.1x to 5.6x after (12 rows); download 15.77 to 14.16 MB; Playwright screenshots of toon, full pbr and pbr lite at 2 cameras (`e2e/__screenshots__/pbr-lite-*.jpg`, `docs/perf/246/*.jpg`) |
| Budget | `docs/perf/budget.json` `phone/pbr`, `vsToon` in `scripts/perf-lib.mjs` | `perf:check` (phone tier, both looks): PASS for pbr lite, exit 1 for the old phone pbr (`&pbrlite=0`) |
| Governor step to toon | `src/render/governor.js`, `src/render/look-down.js`, `src/ui/hud.js` | Vitest; Playwright: a 1 ms budget reloads pbr lite into toon and shows the HUD line once |
| Frame-time readout | `?fps=1`, `src/perf/frame-readout.js` | Vitest; Playwright screenshot |

#246 tests, cloud container: `npm test` 1587 of 1589 pass (the 2 failures are the known 5 s timeouts in `facade-kit.test.js` and `geo-mesh.test.js`). Playwright `pbr-lite`, `phone-tier`, `settings`, `late-load`, `leaf-cut`: 18 pass (the 5 `ground-pbr` tests skip themselves). The full e2e suite did not run. On the phone tier, `leaf-cut.spec.js` with `look=pbr` now draws the pbr lite trees.

#246 NOT verified: the frame time on a real phone. This machine has no GPU; every frame time is SwiftShader and only compares looks. The #246 acceptance (a real mid-range phone under the #24 target) is open; the owner's steps are at the end of `docs/perf/246/README.md`. No person looked at pbr lite on a phone screen. Not done: 512 px textures for the Meshy people. The audit file `mobile-pbr/FINDINGS.md` is not on this branch.

## #107 animation code, 2026-11-06

Branch `claude/107-anim-blends` from `epic/city-look`; PR into `epic/city-look`. Code only: per-transition fade times (`fadeFor()` in `src/render/skater-anim.js`), a weight blender with no reset in the middle of a fade (`src/render/anim-blend.js`), the carve lean (body bank and additive carve pose), and foot IK on stairs and ramps (`src/render/foot-ik.js`, off on the phone tier). Evidence: `e2e/skater-blend.spec.js`, contact sheets `e2e/__screenshots__/anim-107-*.png`; details in `docs/decisions.md`. Not done: the wall slide, bonk, and hard landing clips (Blender and the gitignored `.blend` files); real skaters did not review it.

## Landmark discovery (epic #223), 2026-11-10

| Issue | Branch | PR | Verified |
|---|---|---|---|
| #216 Landmark data file, facts with sources, validator | `claude/clever-hamilton-qxs6up` (from `epic/city-look`) | no PR yet | `npm run validate:landmarks` passes: 12 claim spots and 2 edge markers; Vitest `src/landmarks/validate.test.js` 17 of 17 pass; `npm run build` runs the validator first and passes; 7 quotes fetched again from the source pages and found |
| #222 Historic Fourth Ward Skatepark as a skate spot | `claude/222-h4w-skatepark` (from `epic/city-look`) | no PR yet | Vitest: 22 new tests (`skatepark.test.js`, `skatepark-view.test.js`, `validate.test.js`), `npm test` 1569 of 1570 (the known `facade-kit.test.js` 5 s timeout); `npm run validate:landmarks` 13 claim spots and 2 edge markers; `npm run build` passes; Playwright `e2e/skatepark.spec.js` 6 of 6: in the toon look and the pbr look the skater rides the pyramid, the quarter pipe, the kicker and the bank, grinds the 9 m rail, the 6 m ledge and the 3 m rail, and banks 2740 points in the zone, with no fall through the ground and the page within 1 cm of the pure simulation; pictures `e2e/__screenshots__/skatepark-*.jpg`; `npm run perf:check` budget PASS (phone tier 94 to 108 draw calls, cap 185) |

| #217 Pure landmark module (states, find check, challenges, claim points, banner queue, save) | `claude/217-landmark-module` (from `epic/city-look`) | no PR yet | Vitest `src/sim/landmarks.test.js` 75 of 75 pass (AC-2, AC-4, AC-5, AC-6, F-1 to F-8, E-1, E-2, E-4, E-6; 5 tests with the real controller on the Beltline level); `git diff epic/city-look -- src/sim/skate` is empty; `npm test` 1621 of 1622 pass (the `facade-kit.test.js` timeout) |

#217 not verified: the module is not in `src/main.js`, so nothing ran in a browser; no person played a challenge; the grind, line and combo spots of the real file ran with scripted observations only. Claim points of the file: 3500 (not 5800); outfit unlocks at 5, 9 and 12. See `docs/decisions.md`, 2026-11-10, "The pure landmark module". Next: #218 (the maps) and #219 (rings, banners, chimes) call `createLandmarkTracker` and put `landmarkTestHook` at `window.__atl.landmarks` in a dev build.

#216 not verified: no person played a challenge or read a fact. 8 GDD spots are out (4 art spots, the skatepark, Excelsior Mill, Atlanta Art Park, Parque en el centro bonito); see `docs/decisions.md`, 2026-11-10, and `docs/research/2026-11-10-landmark-facts.md`. `npm test` in the cloud container: 1546 of 1548 pass; the 2 failures are 5 s timeouts in `facade-kit.test.js` and `geo-mesh.test.js` (6 to 8 s on this machine), and they fail the same way on `epic/city-look`. The GDD itself is still in PR #228.

#222: the park is "Thomas Taylor Memorial Skatepark" (the 2024 name), at the center of OSM way 182470291 ([264.4, 3.3]); the pad shape and the layout are approximate, because the OSM outline is not in `raw/` and the Overpass API is not reachable from the cloud container. Data: `levels/beltline-eastside/skatepark.json`; code: `src/level/skatepark.js`, `src/render/skatepark-view.js`; notes: `docs/skate-features.md` ("In a level") and `docs/decisions.md`, 2026-11-10. #222 not verified: no person skated the park or tried the 2000 point combo; no real GPU or phone; real skaters did not review the layout. The spot is in `landmarks.json` (13 claim spots now), but the game finds and claims spots only after #217. For #217: the footprint area `skatepark:h4w-skatepark` is in the loaded level, not in `level.json`.

## M2 early work, 2026-11-03

| Issue | Branch | PR | Verified |
|---|---|---|---|
| #90 Photo mode with a depth tilt-shift blur | `claude/90-photo-mode-876a18` | PR open | Vitest on the band math, the state, the free camera, and the file name (18 tests); Playwright on the high tier opens it with P, checks that the ticks and the skater stop, moves the band and the strength with the sliders and the keys, measures the blur (the far strip loses detail, the band keeps it), saves a PNG named `skate-atl-YYYYMMDD-HHMMSS.png`, flies and turns the free camera, and closes with the button and with Escape; Playwright on the low tier opens it with the button, with no blur, and the follow camera returns on close; evidence `e2e/__screenshots__/photo-mode-{high,low,saved}.png`; full suite 52 of 52 pass |

#90 after the merge of `main` (touch controls #71): `npm test` 403 of 403 pass; `npm run e2e` 59 of 61 pass under load, and the 2 failed camera tests (`camera.spec.js` lap and quarter pipe) pass when they run alone (4 of 4); the 3 photo-mode tests pass, with a new touch test (`e2e/__screenshots__/photo-mode-touch.png`). On a touch screen the PHOTO button moves to the top center, under the map attribution, and the touch controls hide in photo mode.

#90 FPS gate: FAIL on this Mac; the cause is other sessions' load, not photo mode. After the merge of `main` with #95 (governor, phone tier):
- Alone after a 25-minute wait (load average 4.40 at the start; other sessions started Playwright again during the run): median 20 FPS, `reports/playtest-beltline-eastside-2026-11-03-22-30-49.json`.
- A/B back to back (load average 10 to 14): `origin/main` (0fbdea0) median 20 FPS; this branch median 29.9 FPS, `reports/playtest-beltline-eastside-2026-11-03-22-32-55.json`.
- Earlier runs on this branch under load average 17 to 105 gave 15, 15, 29.9, and 10 FPS. An earlier A/B (load 31 to 64) gave 20 FPS on `main` (89dbb96) and 20 FPS on this branch.
- Run the playtest again on an idle machine before merge.

#90 e2e after the merge with #95, under load average 70 to 105: 60 of 65 pass. The 5 failures are in specs that this change does not touch (`skater-anim.spec.js` Marcus T-pose, 3 tests in `skater-face.spec.js`, and the `@beat-timing` test with its retry). They were not run again alone. The 3 photo-mode tests pass alone after the merge.

#90 not verified: no person used photo mode; the free camera has no gamepad move and no touch move (a drag or the right stick only turns it); the blur ran only in headless SwiftShader, not on a real GPU or a phone; PR #95 and PR #96 are not merged yet, so a rebase can be necessary. See `docs/decisions.md` for the design.

## M1 status, 2026-10-31

| Issue | Branch | PR | Verified |
|---|---|---|---|
| M1-01 First skater (Nia) | `claude/m1-01-skater-cleanup-70c838` | PR open | Vitest on the GLB (size, Draco, triangles, joints, height); Playwright loads it skinned with no console errors and no off-host requests; five views in `assets/skaters/nia/views/` |
| M1-03 Geodata pipeline (BeltLine Eastside Trail, Ponce City Market to Krog Street Market) | `claude/m1-03-geodata-beltline` (from M1-02) | PR open | Vitest on the projection, the extrusion, the sampler, the merged meshes, the build script, and an offline rebuild byte for byte; Playwright loads the level with a collider on each of 66 merged meshes, rides 10 s on the trail and 3 s on a real street and a real sidewalk (node and browser within 1 cm), and saves 8 screenshots (`e2e/__screenshots__/beltline-*.png`); `npm run playtest:beltline` median 59.9 FPS, gate 55 PASS (`reports/playtest-beltline-eastside-2026-11-01-21-39-03.json`) |
| M2-01 (part) Ponce City Market and Krog Street Market landmarks with img2threejs | `claude/m2-01-landmark-pcm` (from M1-08) | PR open | Vitest on the roof placement; Playwright checks 2 landmark models and 1 sign; img2threejs v2: all 8 passes with gates and reviews for both models, state `complete` (`landmarks/*/.img2threejs/state.json`), IoU 0.865 and 0.9035, visible-footprint color gate (local patch); physical materials within 250 m; in-game renders in `landmarks/krog-street-market/renders/v2-game/`; `npm run playtest:beltline` median 59.9 FPS, gate 55 PASS (`reports/playtest-beltline-eastside-2026-11-02-15-02-02.json`) |
| M1-08 Level detail (#40): building kit, murals, street props | `claude/m1-08-level-detail` (from M1-03) | PR open | Vitest on the styles, the facade attribute, the parapets, the murals, the prop rules, and template placement; Playwright checks 3317 props in merged tiles and saves the screenshots; detailed LOD0 props and anti-aliased windows; `npm run playtest:beltline` median 59.5 FPS, gate 55 PASS (`reports/playtest-beltline-eastside-2026-11-01-23-16-18.json`) |
| M1-02 Face decals for Nia | `m1-02-nia-face` (from M1-02) | PR open | Vitest face mood and blink logic; Playwright close-ups of six eye and mouth states in `assets/skaters/nia/face/views/`; in the game she smiles while she stands and blinks |
| M1-02 Animation set and binding | `claude/m1-02-skater-animations` (from M1-01) | PR open | Vitest state -> clip table, switch, and wall probe; Playwright contact sheet per clip (20 clips) in `assets/skaters/nia/clips/`; no T-pose frame over 287 samples of the three scripted sessions (worst IoU 0.464); a Playwright test of the backward ride |
| #88 Building source file (address, height, source, confidence) | `claude/88-building-source-file` (from `main`) | PR open | Vitest: one record for each of 1042 buildings, a source and a confidence for each fact, each of 864 address points inside its footprint, the source file and report rebuild byte for byte, the level rebuild byte for byte; `data/buildings/beltline-eastside.report.md` lists the counts per source and 35 city/OSM address disagreements; Playwright screenshots of FORTH Hotel before and after (`e2e/__screenshots__/beltline-forth-hotel-before.png`, `beltline-forth-hotel.png`) |

M1-01 not verified: no human looked at the model in the game, and the model has no animations yet. Cascadeur reads the GLB only without Draco (see `docs/decisions.md`). M1-02 not verified: no person played the second clip set (ATL free skate, X Games rails and air, backward ride); real skaters did not review the moves; the manual clip has no input yet; air_japan, air_liukang, carve_right, dance_crisscross, dance_spin, dance_sitspin, and manual did not show in the scripted sessions (the contact sheets cover them); the wall probe can stop a skater who rides along a wall at less than 0.17 m. Next: M1-03.

M1-03 not verified: no person played the block; 110 of 1042 building heights are defaults by building type (see #88); the world is flat (bridges sit on the ground); no rails, ledges, or ramps yet (M1-04); the FPS margin on the block is small (90th percentile frame 33 ms); shadow acne shows on some walls.

#88 not verified: the FPS gate. `npm run playtest:beltline` failed 5 times on 2026-11-03 (median 20, 20, 20, 15, and 15 FPS; gate 55). With the old `main` level data it also gave 20 FPS. The renderer is SwiftShader (CPU), and other sessions held the CPU (load average 17 to 72). The last pass, 59.9 FPS at 03:42 UTC, ran on a quiet machine. `npm test`: 386 of 386 pass. `npm run e2e`: 50 passed, 2 failed in `e2e/camera.spec.js` (the greybox level, not this change); `main` failed 4 of 4 there under the same load. No person checked the city addresses on the street. The facade fact is a game style, not a surveyed material. 110 buildings keep a type default, Stove Works (7510 m^2, 6 m) among them.

## M0 status, 2026-10-30

Every PR targets `main`. Each one branches from the previous one, so the diffs include the earlier PRs until those merge. Merge in order from #25.

| Issue | Branch | PR | Verified |
|---|---|---|---|
| M0-01 Three.js + Vite shell | `m0-01-threejs-shell` | #25 (from the cloud session, reviewed and fixed here) | Vitest, Playwright, build |
| M0-02 Greybox block + Rapier | `m0-02-greybox-level` | #26 | Vitest, Playwright screenshot against a committed reference, collider count |
| M0-03 Skate controller | `m0-03-skate-controller` | #28 | 19 Vitest tests, node-vs-browser replay within 1 cm |
| M0-04 Follow camera | `m0-04-follow-camera` | #29 | Vitest, scripted lap with no off-screen frame, wall clip |
| M0-05 Grind system | `m0-05-grind-system` | #30 | Vitest on all 5 grindables, straight rail end to end, `reports/m0-05-falls.json` |
| M0-06 Combo and style | `m0-06-combo-style` | #31 | Vitest, 3-link combo read from the HUD, two distinct animations |
| M0-07 On-beat bonus | `m0-07-beat-clock` | #32 | Vitest, 32-tap alignment mean -0.08 ms sd 1.65 ms (`reports/m0-07-beat-alignment.json`) |
| M0-08 Input mapping | `m0-08-input-mapping` | #33 | Vitest, keyboard, fake gamepad |
| M0-09 Playtest harness | `m0-09-playtest-harness` | #34 | `npm run playtest`: median 59.9 FPS, gate 55 PASS, `reports/playtest-2026-10-31-02-51-50.json` |
| M0-10 Human playtest | `m0-10-human-playtest` | PR open | William played it; verdict PROCEED; hypothesis not tested |

PR #27 (`m0-02-greybox-block`) was a duplicate M0-02 from a parallel session. It is closed.

### Review fixes, 2026-10-31

William's first play found camera faults on the quarter pipe; the fix is on M0-04. The ship-it review then answered 39 bot review threads (CodeRabbit, Codex) and a local code review. Each fix sits on the branch that introduced the code, and every branch merged the one below it:

- M0-01: README names the Chromium install step.
- M0-02: barriers close every exit from the block, with a 4 m wall behind the deck.
- M0-03: a jump into a building no longer lands on its roof; a lost skater respawns.
- M0-04: the camera never goes past a close wall; the hint names the follow camera.
- M0-05: grind moves from Ctrl to F (Ctrl+W closed the tab); the grind lean tilts the right way; flags no longer repeat on the rail.
- M0-06: bank events record once; the HUD shows moves from every tick; a respawn bails the combo.
- M0-07: the beat clock resumes a suspended context; a hint asks for a key or a click to start the beat.
- M0-08: the input map binds grind to F and blocks browser defaults for bound keys.
- M0-09: the harness stops on a page error or a stuck session and always closes the browser and the server.

### Final numbers on the `m0-09-playtest-harness` branch

- `npm test`: 18 files, 151 tests, all pass.
- `npm run e2e`: 18 Playwright tests, all pass, about 2 minutes.
- `npm run build`: passes. The bundle is 4.9 MB raw because the Rapier WASM is inlined; split it before M1.
- `npm run playtest`: median 59.9 FPS over 2579 frames, gate 55 PASS, `reports/playtest-2026-10-31-13-59-39.json`. The score changes between runs because moves that land on the beat earn a bonus, and the beat runs on wall-clock time.

### Not verified

- No human has played it. The feel (carve radius, push cadence, balance speed, camera distance) is untuned. Every knob is in `src/sim/skate/constants.js`.
- A real gamepad. The e2e test injects a fake standard pad; no physical controller was connected.
- Audio through speakers. The beat clock ran in headless Chromium; the alignment numbers are from the mapping chain, not from a listening test.
- Performance on a GPU-less or low-end machine. The 59.9 FPS is this Mac's headless SwiftShader, capped at 60.
- Rails are not solid to a rolling skater that is not grinding: the capsule can roll through a rail. Known, deferred.
- There is no GitHub Actions CI. The only PR check is the CodeRabbit review. Every test result above is from local runs on this Mac.
- A gamepad cannot start the beat on its own. Browsers need one key press or click first; the HUD asks for it.

## Run the greybox prototype (M0-10)

1. Check out the top of the stack. It includes all of M0-01 to M0-09.

   ```sh
   git fetch origin
   git checkout m0-09-playtest-harness
   npm install
   npx playwright install chromium
   ```

2. Start the game and open http://localhost:5173 in Chrome. Press any key or click once to start the click track.

   ```sh
   npm run dev
   ```

3. Controls. Keyboard: A/D or arrows steer, W, Up, or Shift push, S or Down brake, Space jump, hold F to grind, Q and E dance, H shows the colliders. Gamepad (standard): left stick steer, A jump, X push, Y and B dance, RT grind, LT brake.

4. Views for inspection: `?view=orbit` (drag to look), `?view=fixed&debug=1` (the reference pose with colliders), `?mute=1` (no click).

5. Checks before the playtest, all from the repo root:

   ```sh
   npm test
   ```

   ```sh
   npm run e2e
   ```

   ```sh
   npm run playtest
   ```

6. Play for 15 minutes with sound, then write `prototypes/greybox-skate/REPORT.md` with the five answers (hypothesis check, best moment, worst moment, surprise, verdict) and the latest `reports/playtest-*.json` numbers. Record the verdict in `docs/decisions.md`. M1 starts only on PROCEED.

## #305 Fighting game text callouts, 2026-11-20

Branch `feat/305-callouts` from `epic/city-look`; draft PR, base `epic/city-look` (the base changes to `main` after PR #304 merges). Design and verification: `docs/decisions.md`, 2026-11-20.

| Part | Where | Verified |
|---|---|---|
| Queue, beat timing, card look (pure) | `src/ui/callout-math.js` | Vitest `callout-math.test.js`, 24 tests |
| DOM and type | `src/ui/callouts.js`, `src/ui/callouts.css` | Playwright `e2e/callouts.spec.js` 5 of 5; screenshots `e2e/__screenshots__/callout-*.jpg` |
| Hooks: first key, run end, replay | `src/main.js` (about 40 lines) | Same spec (a real key, a real run end, a real replay) |
| Hooks: landmark claim, combo bank | `src/main.js` | NOT verified by the spec: it pushes the claim and combo callouts through `window.__atl.callouts`, not through a real claim or a real bank |

NOT verified: the 55 FPS gate (3.5 FPS in this container with or without the callouts); the motion at full speed; a real phone.
