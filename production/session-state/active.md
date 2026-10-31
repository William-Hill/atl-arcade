# Active session

- Concept: Skate ATL — free skate in 3D (THPS meets Jet Set Radio), Three.js
- Prior prototype: beat-lock (Phaser) — PIVOT, see prototypes/beat-lock-concept/PIVOT-NOTE.md
- Hypothesis: free movement + grind + jump + style chain feels good; new player chains a 3-move combo within 3 minutes; accidental rail falls under 1 per minute.
- Riskiest assumption: a kinematic skate controller with rail snapping and a follow camera feels good in the browser, built by agents without a scene editor.
- Phase: M0 Greybox movement prototype. M0-01 to M0-09 are in pull requests. M0-10 (the human playtest) is next and is William's.

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
| M0-10 Human playtest | — | — | For William, not an agent task |

Duplicate: PR #27 (`m0-02-greybox-block`) is a second M0-02 from a parallel automated session. The stack above builds on #26, not #27. Close #27 or keep it as a reference; do not merge both.

### Final numbers on the `m0-09-playtest-harness` branch

- `npm test`: 14 files, 123 tests, all pass.
- `npm run e2e`: 16 Playwright tests, all pass, about 2 minutes (the beat alignment test runs 64 beats).
- `npm run build`: passes. The bundle is 4.9 MB raw because the Rapier WASM is inlined; split it before M1.
- `npm run playtest`: 3 sessions, 44.8 simulated seconds, median 59.9 FPS, score 1467, max combo 3, first 3-link combo at 3.47 s in the combo session, 1 scripted fall.

### Not verified

- No human has played it. The feel (carve radius, push cadence, balance speed, camera distance) is untuned. Every knob is in `src/sim/skate/constants.js`.
- A real gamepad. The e2e test injects a fake standard pad; no physical controller was connected.
- Audio through speakers. The beat clock ran in headless Chromium; the alignment numbers are from the mapping chain, not from a listening test.
- Performance on a GPU-less or low-end machine. The 59.9 FPS is this Mac's headless SwiftShader, capped at 60.
- Rails are not solid to a rolling skater that is not grinding: the capsule can roll through a rail. Known, deferred.

## Run the greybox prototype (M0-10)

1. Check out the top of the stack. It includes all of M0-01 to M0-09.

   ```sh
   git fetch origin
   git checkout m0-09-playtest-harness
   npm install
   npx playwright install chromium
   ```

2. Start the game and open http://localhost:5173 in Chrome. Press any key to start the click track.

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
