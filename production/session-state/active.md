# Active session

- Concept: Skate ATL — free skate in 3D (THPS meets Jet Set Radio), Three.js
- Prior prototype: beat-lock (Phaser) — PIVOT, see prototypes/beat-lock-concept/PIVOT-NOTE.md
- Hypothesis: free movement + grind + jump + style chain feels good; new player chains a 3-move combo within 3 minutes; accidental rail falls under 1 per minute.
- Riskiest assumption: a kinematic skate controller with rail snapping and a follow camera feels good in the browser, built by agents without a scene editor.
- Phase: M1. M0 is done; the M0-10 verdict is PROCEED (`prototypes/greybox-skate/REPORT.md`).

## M1 status, 2026-10-31

| Issue | Branch | PR | Verified |
|---|---|---|---|
| M1-01 First skater (Nia) | `claude/m1-01-skater-cleanup-70c838` | PR open | Vitest on the GLB (size, Draco, triangles, joints, height); Playwright loads it skinned with no console errors and no off-host requests; five views in `assets/skaters/nia/views/` |
| M1-02 Face decals for Nia | `m1-02-nia-face` (from M1-02) | PR open | Vitest face mood and blink logic; Playwright close-ups of six eye and mouth states in `assets/skaters/nia/face/views/`; in the game she smiles while she stands and blinks |
| M1-02 Animation set and binding | `claude/m1-02-skater-animations` (from M1-01) | PR open | Vitest state -> clip table, switch, and wall probe; Playwright contact sheet per clip (20 clips) in `assets/skaters/nia/clips/`; no T-pose frame over 287 samples of the three scripted sessions (worst IoU 0.464); a Playwright test of the backward ride |

M1-01 not verified: no human looked at the model in the game, and the model has no animations yet. Cascadeur reads the GLB only without Draco (see `docs/decisions.md`). M1-02 not verified: no person played the second clip set (ATL free skate, X Games rails and air, backward ride); real skaters did not review the moves; the manual clip has no input yet; air_japan, air_liukang, carve_right, dance_crisscross, dance_spin, dance_sitspin, and manual did not show in the scripted sessions (the contact sheets cover them); the wall probe can stop a skater who rides along a wall at less than 0.17 m. Next: M1-03.

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
