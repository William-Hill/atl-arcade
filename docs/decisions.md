# Decisions

## 2026-10-30 — Engine and starting point

Phaser 4.2.1 with Vite 8.3.5. Godot 4 web export rejected (heavier build, single-threaded on iOS Safari). PixiJS rejected (renderer only). True 3D rejected on art cost. The pseudo-3D road pattern comes from the RenderATL Rush `sim/road3d.js` approach (own code, rewritten here). No code copied from `yonifra/outrun2026` (no license).

## 2026-10-30 — Repo shape

One repo, one Phaser shell, many game modes: Skate ATL first, Atlanta Tycoon second. Production code lives under `src/` when it exists. `prototypes/` is throwaway.

## 2026-10-30 — Pivot to free skate in 3D, Three.js

The beat-lock prototype answered the wrong question. The vision is free skating in 3D (Tony Hawk's Pro Skater meets Jet Set Radio) with dance and style on the move. Phaser cannot do this. Three.js chosen over Godot 4 because: the game must live in the browser on the site; the neighborhood pipeline (geodata to geometry) is JavaScript end to end; the Rush `codex/196-3d-spike` already proves AutoSprite/Meshy GLB to Three.js with animation; and agents, not humans, build the levels, so the Godot editor advantage does not apply. The Phaser scaffold at the repo root stays until the Three.js shell replaces it.

## 2026-10-30 — Three.js shell versions (M0-01)

The Phaser scaffold is replaced by a Three.js + Vite shell at the repo root. Versions, all published at least 7 days before today:

| Package | Version | Published |
|---|---|---|
| three | 0.186.1 | 2026-09-24 |
| vite | 8.3.5 | 2026-10-21 |
| vitest | 5.0.5 | 2026-10-15 |
| @playwright/test | 1.63.0 | 2026-09-04 |

`three` 0.187.0 was published 2026-10-30 and is too new under the 7-day rule. `@playwright/test` is pinned to 1.63.0 because that is the version whose browser build is preinstalled in the agent container, so headless runs need no browser download.

Phaser is removed from `package.json`. The beat-lock prototype files stay on disk untouched as history, but they are no longer a Vite build input, because they import Phaser and nothing may depend on Phaser now. The prototype is not runnable from this repo any more; its findings live in `prototypes/beat-lock-concept/PIVOT-NOTE.md`.

Layout: pure simulation under `src/sim/` with no Three.js imports, rendering under `src/render/`. Vitest covers `src/**/*.test.js`. Playwright tests live in `e2e/` and write evidence to `e2e/__screenshots__/`.

## 2026-10-30 — Greybox level as data, Rapier for static collision (M0-02)

The greybox block is a plain data module, `src/level/greybox.js`: every object has a `kind`, a center `position`, a `size` for boxes, and a grind `spline` on rails and ledges. Splines are a polyline (`points`) or a quadratic Bezier (`start`, `control`, `end`); `src/level/splines.js` samples both into polylines and does the nearest-point and arc-length math the grind system needs. The quarter pipe is a circular profile in `src/level/ramp.js`, which builds one triangle list that both the renderer and physics use.

Collision: `@dimforge/rapier3d-compat` 0.21.0 (published 2026-09-25). Boxes are cuboids, rails are one capsule per polyline segment, the ramp is a trimesh. Colliders carry collision groups (`ground`, `wall`, `rail`, `ledge`) so the character controller and camera rays can filter. A debug overlay draws `world.debugRender()`; toggle with `?debug=1` or the H key.

Ground height for the skate controller comes from a pure sampler, `src/level/ground.js`, not from Rapier. It returns the highest surface under (x, z) and its normal, so the controller stays testable in Vitest with no WASM. Rapier handles walls, the camera raycast, and the overlay. If the sampler and Rapier disagree, the sampler wins for the skater's feet.

The Rapier WASM is inlined into the main bundle by Vite (about 4.9 MB raw, 1.8 MB gzip). Acceptable for the greybox; split it before M1.

## 2026-10-30 — Skate controller model (M0-03)

The controller in `src/sim/skate/controller.js` is pure and runs at a fixed 60 Hz step. While rolling it keeps a scalar `speed` and a heading `yaw`; the 3D velocity is derived from the surface tangent under the heading. While airborne it keeps a free 3D velocity under arcade gravity. Ground comes from the pure sampler (`env.sampleGround`), so Vitest runs the whole model with no WASM. Every number lives in `src/sim/skate/constants.js` with min / typical / max comments.

Surface rules: a rise above `maxStep` (0.25 m) is a wall and stops the skater; a drop beyond `dropThreshold` (0.3 m) is an edge and the skater falls; gravity acts along the surface tangent so ramps slow the climb and speed the descent; a near-vertical lip (`launchNormalY`) launches the skater straight up, so a quarter pipe behaves like a THPS vert ramp. Landing projects the air velocity onto the surface. Rails are not solid to the rolling skater yet; the grind system (M0-05) owns rails.

Scripted input (`src/input/scripted.js`) plays `{ frames, input }` entries one per fixed tick. The same script runs through the pure module in node and through the game loop in the browser, and the Playwright test asserts the end positions agree within 1 cm.

## 2026-10-30 — Follow camera (M0-04)

The camera math is pure (`src/sim/camera.js`) and its knobs live in `CAMERA` in `src/sim/skate/constants.js`. The camera orbit yaw chases the skater yaw with exponential smoothing by the shortest turn, so a U-turn or the rollback flip on the quarter pipe swings the camera around in about half a second instead of snapping. The position and the look-at point chase their goals with their own rates. Distance grows with speed up to a cap, and the look-at point leads the skater by up to 3 m at full speed.

Wall clipping: each frame the renderer casts one Rapier ray from the look-at point toward the smoothed camera position, filtered to the `wall`, `ground`, and `ledge` groups (rails are ignored). On a hit the camera moves to the hit point minus a margin, never closer than `minDistance`. Rapier ray casts return nothing until the query pipeline is built, so the physics world runs `updateSceneQueries()` (or one `step()`) right after creation.

The default view is the follow camera. `?view=orbit` keeps the orbit camera for inspection, and `?view=fixed` is the screenshot reference pose.

## 2026-10-30 — Grind system (M0-05)

`src/sim/skate/grind.js` is pure. Rails and ledges are sampled into polylines once (`prepareGrindables`). A snap needs the grind button, a horizontal distance to the spline under `snapRadius` (1.2 m), the spline between 0.35 m below and 0.9 m above the feet, and a heading within 60 degrees of the tangent (`minAlongDot` 0.5). The snap picks the nearest candidate and rides in the direction of the heading. Both rolling and airborne approaches snap; a THPS-style jump-on is not required for the greybox.

Balance is a deterministic meter: a constant lean push (`balanceDrift`) plus growth proportional to the lean (`balanceGravity`), minus the steer input times `balanceCorrect`. The lean side comes from the steer at the snap, else it alternates per snap. Past `balanceLimit` the skater falls off the side it leans toward at half speed. A fall ends the combo, never the run. After any exit a short `resnapCooldown` stops an instant re-snap.

Exits: a jump adds the jump speed to the tangent velocity; the spline end launches with the tangent velocity plus a small upward pop. `src/sim/skate/skater.js` orchestrates rolling, air, and grind, and counts snaps, exits, falls, and grind time in `stats` for the playtest metrics. The Playwright free-skate loop writes `reports/m0-05-falls.json`.

## 2026-10-30 — Combo, scoring, and style moves (M0-06)

`src/sim/skate/combo.js` is a pure, immutable combo state machine. Each move adds a link and the multiplier equals the link count. The combo stays open while a move is in progress (grind, air, style move) and for `linkWindow` (0.8 s) after; then pending points times the multiplier bank into the score. A bail (a rail fall) throws the pending points away and drops the style meter by half. Dance moves fill the style meter by 0.25 each; a full meter sets `signatureReady` (the signature move itself is out of M0 scope). An on-beat flag on a move multiplies its points by `beatBonus` (M0-07 supplies the judgment).

Moves in M0: Rail Grind or Ledge Grind (base 100 plus 60 per second, "Long" past 1.5 s), Hop (a jump or grind exit that lands after 0.2 s in the air, 50), Vert Air (a quarter-pipe launch that lands, 200), and two style moves on the roll-out, Shuffle (0.5 s, 120) and Spin (0.7 s, 160). A manual move type is supported by the module but has no input in M0. The controller tags each airborne state with `airFrom` so the run layer knows what to score.

`src/sim/skate/run.js` composes the skater and the combo and is what the game loop steps. The HUD (`src/ui/hud.js`) is plain DOM: banked score, combo string, pending points and multiplier, the last move tag, the style meter, and the balance meter while grinding. Style animations are placeholders on the capsule: Shuffle rocks around z, Spin turns once around y.

## 2026-10-30 — Beat clock and on-beat bonus (M0-07)

The beat clock is a rewrite, not an import, of the beat-lock prototype idea. The math is pure in `src/audio/beat-math.js`: `judge(t)` finds the nearest beat and the signed offset in ms, tags it PERFECT (20 ms) or GOOD (60 ms), and `inputTime` maps a DOM event `timeStamp` onto the audio clock through an anchor pair the scheduler refreshes every 25 ms. `src/audio/beat-clock.js` owns the Web Audio context, schedules a synthesized 4/4 click at 100 BPM 150 ms ahead, and corrects for output latency. The clock starts on the first key or pointer press because browsers block audio before a gesture. `?mute=1` keeps the clock silent for tests.

The beat never gates input. When a move lands (grind exit, hop landing, style move end) the run layer asks the clock for the judgment at that tick; an on-beat move earns `beatBonus` (1.5x) and the HUD shows the PERFECT or GOOD tag. A pulse dot in the HUD fades through each beat.

Alignment check: the Playwright test dispatches 32 real keydown events timed to the next 32 beats through the same anchor mapping and judges their timestamps. With rendering paused the result is mean -0.08 ms, sd 1.65 ms, 32 of 32 within 60 ms. With the software renderer running in headless Chromium every timer lands about a frame late (mean 12 ms, sd 9 ms), which is a test artifact: real input carries the OS event time. Both numbers are in `reports/m0-07-beat-alignment.json`.

## 2026-10-30 — Input module (M0-08)

`src/input/` has three layers. `bindings.js` holds one rebindable map: keyboard codes per action and standard gamepad button indexes per action, with `rebind()` returning a new map. `mapping.js` is pure: `mapKeyboard(downSet, bindings)` and `mapGamepad(snapshot, bindings)` produce the controller input shape, and `mergeInputs` ORs the buttons and keeps the stronger steer. `input.js` samples the keyboard and the first connected gamepad once per fixed tick, merges them, and reports which device was active last. The stick left (negative axis) steers left (positive), with a 0.15 deadzone rescaled to the full range. `scripted.js` is the adapter Playwright and Vitest use to drive the controller without devices.

Headless Chromium has no gamepad, so the Playwright test injects a fake standard pad through `navigator.getGamepads` and checks the skater pushes, turns, and jumps from it.

## 2026-10-30 — Playtest harness and metrics (M0-09)

`npm run playtest` runs `scripts/playtest.mjs`: it starts Vite in process, launches headless Chromium with the same flags as the e2e suite, and plays the three scripted sessions in `src/playtest/sessions.js` (a free-skate lap, three rail approaches, a combo line with a vert air). The sessions are pure data and a Vitest test replays them through the run layer in node first, so the browser never runs a script that cannot produce the expected moves. The harness writes `reports/playtest-<date>.json`, two screenshots per session, and one video per session. Videos are not committed (`reports/*.webm` is ignored); the JSON and screenshots are.

The gate is the median FPS over all sessions, at least 55, plus zero console errors. Headless Chromium renders through SwiftShader and is capped at 60 FPS by its frame scheduler; this Mac holds 59.9. Frame times come from the page's own `requestAnimationFrame` loop. Metric definitions live in `docs/playtest-metrics.md`.

A second automated session opened PR #27 for M0-02 in parallel with PR #26. The M0-03 to M0-09 stack builds on #26. Only one of #26 and #27 can merge; the stack needs #26.

## 2026-10-31 — Follow camera on the quarter pipe (M0-04 fix)

William's first play found camera faults on the quarter pipe. A node probe of the run showed four causes:

1. The look-at point led 2 m along the heading, which put it inside the ramp and deck while the skater climbed. The wall ray started there, hit at distance 0, and pulled the camera 12 m forward onto the ramp face in one frame.
2. When the ray cleared, the camera jumped 8 m back in one frame. The clip had no smoothing.
3. At the top the landing flips the skater yaw by 180 degrees, and the camera orbited through the side of the deck to follow it.
4. Back on flat ground the camera swung 180 degrees in about half a second, up to 0.93 m per frame.

Fixes: the look-ahead now leads only by the horizontal velocity along the camera heading, so it never points into a wall or back at the camera. The wall ray starts from a pivot one `lookHeight` off the surface along the ground normal. A new blocker snaps the camera in at once, and a cleared blocker lets it ease back out at `clipRelease`. While the ground normal y is under `vertNormalY` (0.9), on the transition or in the air above it, the camera holds its yaw and stays on the street side. The swing is capped at `maxYawRate` (3 rad/s). On the scripted quarter-pipe run the worst camera move is now 0.35 m per frame and the camera never comes closer than 7 m. The Playwright test fails on the old code with 218 off-screen samples.

## 2026-10-31 — Grind key and review fixes (M0-05)

Grind moves from Control to F. On Windows and Linux, Control plus W closes the tab, and Control plus S or D opens browser dialogs, so a held grind key could end the session. The keyboard now prevents the browser default for every bound key. The grind lean now tilts toward the side the skater falls off, and a grind tick clears the jump, landing, and wall flags that the snap tick set.

## 2026-10-31 — M0-10 verdict: PROCEED

William played the greybox and marked it PROCEED. Free skating on the greybox block already felt good. The worst parts were the quarter-pipe camera (fixed in PR #29 after the session) and the capsule standing in for the skater. The M0 hypothesis was not tested: the session did not cover combos or rails, so the 3-minute combo and the accidental-fall numbers stay open for the first M1 playtest. Issue #10 asks for a 15-minute session with sound; William waived that requirement for this verdict, and the sound session moves to the first M1 playtest with the hypothesis numbers. M1 (the GLB skater and one real Atlanta block) may start. Report: `prototypes/greybox-skate/REPORT.md`.

## 2026-11-02 — Autopilot bridge behind ?autopilot=1 (fork, experimental)

The user chose "fork first" for Autopilot (PR #53). A fork of `ramenvr/autopilot`, branch `threejs-engine`, adds engine `threejs`: a browser bridge module and a Python adapter. Skate ATL connects through `src/autopilot/`. `main.js` imports `src/autopilot/connect.js` dynamically, only in a dev build (`import.meta.env.DEV`) and only when the page has `?autopilot=1`. A production build has no bridge code, so a link cannot connect a player's page to a local port. The hooks map the bridge to `window.__atl`: the skater state, `resetSkater`, the bindings, the fixed tick clock, and a render call for frames.

`src/autopilot/autopilot-bridge.js` is a vendored copy of the fork file. It is our own code, not an npm dependency, so it adds nothing to `package.json`. Autopilot itself is less than 7 days old: do not install it as a dependency before 2026-11-05, and pin a version at least 7 days old then. The hello frame always says `share: false`, and every run sets `AUTOPILOT_SHARE=0`. Report: `docs/research/2026-11-02-autopilot-threejs-fork.md`.

## 2026-11-02 — Autopilot evaluation: do not adopt now

Aura Autopilot (https://github.com/ramenvr/autopilot, Apache-2.0, commit `31cb1e5`) is an automated playtest agent. It plays only Unreal 5, Unity 6, and Godot 4 projects, so it cannot connect to Skate ATL in the browser. It does not measure FPS. Every release is less than 7 days old, and a run needs an Aura account or a TypeSafe key. The offline evaluation installed it in a scratchpad virtual environment only; its offline tests passed (492 passed, 5 skipped). The plugin files are vendored, not enabled, in `.claude/vendor/autopilot/`. Two ideas need no Autopilot: verification claims with `CONFIRMED`/`DENIED`/`INCONCLUSIVE` in `npm run playtest`, and a blind describer subagent for screenshots. Report: `docs/research/2026-11-02-autopilot-evaluation.md`.

## 2026-10-31 — The first skater: Nia "Sway" Ellis

The first skater is Nia "Sway" Ellis, an original adult character from the West End. The dossier is `docs/characters/nia-sway-ellis.md`. Autosprite made the concept art (6 credits), because the Higgsfield account had only 7 credits. The user makes the 3D model in the Tripo web UI, because that account has more credits. Cascadeur animates the model through its MCP. If Cascadeur does not work, the Blender MCP animates it. Raw model files stay out of git in `assets/skaters/*/raw/`.

## 2026-10-31 — The Nia skater GLB (M1-01)

`assets/skaters/nia/skater.glb` is the shipped model: 2,123,152 bytes, 17,896 triangles, one skinned mesh, 65 `mixamorig:` joints, 1.700 m tall, the wheels at y = 0, no animations. The Blender MCP did the cleanup. The steps are in `assets/skaters/nia/provenance.json`.

- Facing: the GLB faces +z, the glTF convention. The controller faces +x at yaw 0. `src/render/skater-model.js` wraps the model and turns it by +90 degrees about y. Mixamo and Cascadeur clips keep the glTF convention.
- Textures: base color 2048, normal 1024, metallic-roughness 1024, all JPEG. The normal map stays, because it is only 314 KB and it carries the knit and the braids.
- Draco decoder: Vite serves `draco_wasm_wrapper.js` and `draco_decoder.wasm` from `node_modules/three` through `?url` imports. No CDN, and no copy in the repo. Three.js 0.186.1 accepts the explicit URLs in `setDecoderPath({ js, wasm })`.
- Test page: `skater.html?skater=nia&view=front`. The gameplay keeps the capsule until M1-02 (#12) binds the animations.
- Blender: the MCP add-on was installed only for Blender 5.1. The add-on file is now also in the Blender 5.2 add-ons folder and is on in the 5.2 preferences.

### Cascadeur check for M1-02

The Cascadeur MCP (`csc.glb.process_import`) cannot read the Draco GLB. It logs `GLB/GLTF: vector` and imports nothing. The same export without Draco (`assets/skaters/nia/raw/nia-nodraco.glb`, not in git) imports with success: 67 objects, the 65 `mixamorig:` joints, the `NiaRig` transform, and the `Nia` mesh. The check did not test the Cascadeur Quick Rigging Tool or an animation export.

Decision for M1-02: animate in Cascadeur from the GLB without Draco. Export the clips from Cascadeur without Draco, then compress the final GLB with Draco in Blender. To make the input again, import `skater.glb` into Blender and export it without Draco. If the Cascadeur rig setup fails, animate with the Blender MCP.

## 2026-10-31 — Nia animation set and state binding (M1-02)

The user chose to key every clip in Blender (0 credits) over Meshy dances or Meshy text-to-motion. The Meshy library has dances, but no clip for a push, a coast, a carve, a grind, or a manual. `scripts/blender/nia_clips.py` keys 15 clips on the Mixamo rig through the Blender MCP: idle, push, coast, carve_left, carve_right, jump, air_trick_1, air_trick_2, grind, manual, bail, and dance_1 to dance_4. Leg IK holds the wheels on the ground, and each clip is baked to plain bone keys. The clips are greybox quality. Real skaters must review them before release (AGENTS.md).

All clips are in `assets/skaters/nia/skater.glb` (2,290,112 bytes). The export removes the curves that stay at the rest pose. Without this step every clip wrote all 195 channels, and the glTF JSON was 659 KB. Now it is 75 KB. Three.js blends a bone with no track back to the rest pose.

`src/render/skater-anim.js` is the state to clip table. It is pure and has Vitest tests for the transitions:

| Controller state | Clip |
|---|---|
| style move "shuffle" | dance_1, then dance_3 on the next shuffle |
| style move "spin" | dance_2, then dance_4 (the renderer also turns the body) |
| grind | grind |
| air from a grind fall | bail (it holds for 0.9 s, also after the landing) |
| air off a ramp for 0.25 s or more | air_trick_1, then air_trick_2 on the next trick |
| other air | jump |
| `state.manual` | manual (M0 has no manual input, so this clip is not reachable yet) |
| speed under 0.3 m/s | idle |
| up to 0.4 s after a push | push |
| yaw rate over 0.6 rad/s | carve_left or carve_right |
| other rolling | coast |

The crossfade is 0.15 s, and 0.06 s into a bail, a push, a jump, or a dance. The game now shows Nia by default; `?skater=capsule` keeps the capsule.

The T-pose check renders the skater alone, from a camera in front of it, into a 96 x 96 mask. Then it compares the mask with the bind-pose mask (IoU). The gate is IoU under 0.8. Over the three scripted sessions the worst sample was 0.587. A second bind-pose mask gives over 0.95, so a T-pose frame fails the gate. The first run found a fault in the check itself: Three.js updates a skeleton once per frame, so a silhouette drawn after the main render used the bones of the previous render. The silhouette now calls `skeleton.update()` first.

## 2026-10-31 — ATL free skate, X Games rails and air, backward riding, wall probe (M1-02)

The user played the first clip set. The forward skate looked like a skateboard kick push, not a roller skate glide with rhythm and Atlanta swag. The user asked for Atlanta rink style in free skate and X Games style on rails and in the air. The research and the sources are in `docs/characters/skate-style-references.md`.

The clip set is now 20 clips, all keyed by `scripts/blender/nia_clips.py` (0 credits):

| Group | Clips | Style |
|---|---|---|
| Free skate | idle (claps on beats 2 and 4), push (ATL stride: side strokes, left and right), coast (glide, bounce on the beat, weight shift), ride_back (backward swizzle, looks over the shoulders), carve_left and carve_right (Cross Step) | Atlanta rink |
| Air | jump, land, air_mute, air_japan, air_liukang | X Games |
| Rails | grind_frontside, grind_soul, grind_unity, manual | X Games |
| Fail | bail | |
| Style moves | dance_prep and dance_crisscross (shuffle), dance_spin and dance_sitspin (spin) | Atlanta rink |

Changes in the state to clip table (`src/render/skater-anim.js`):

- The game cycles the air tricks (mute, japan, Liu Kang) and the grind stances (frontside, soul, unity). Each new air or rail takes the next one.
- A landing from a jump or an air trick plays `land` and holds it for 0.3 s.
- Groove clips play in phase with the game beat clock. The clips are keyed at 75 BPM, and the renderer scales them to `BEAT.bpm` (100 now).
- The switch button (R, gamepad LB) sets `state.backward`. On the ground the skater then rides backward: the model turns 180 degrees in 0.35 s and plays `ride_back`. The travel direction and the physics do not change. Air, rails, and dances face forward. A fall or a respawn resets the switch.

The skater went half into walls, because the wall test used only the center point. The controller now probes one body radius (`SKATE.bodyRadius`, 0.3 m) ahead and 35 degrees to each side. A probe point on a flat surface higher than `maxStep` is a wall, and the skater stops. On a ramp (a steep ground normal) the probe is off, so the quarter pipe still launches. A test shows the stop point at the building: 0.05 m from the wall before, 0.34 m now.

Not verified: no person played the new clips; real skaters did not review the moves; the stop 0.3 m short of a wall can also stop a skater who rides along a wall at less than 0.17 m.

## 2026-10-31: Player camera control in the follow camera (M1-02)

- Decision: a mouse drag on the canvas (left or right button) and the gamepad right stick turn the follow camera about the skater. The control turns the camera in yaw and in pitch (−0.3 to +0.75 rad from the rest angle).
- After 1.0 s with no look input, the camera goes back behind the skater (`CAMERA.lookHold`, `CAMERA.lookReturn`).
- The look input is separate from the skate input. The camera does not change the simulation, so the scripted tests stay deterministic.
- The wall ray still keeps the camera in front of walls when the player turns it.
- Why: the player asked for camera control in play. `?view=orbit` is a debug view and does not follow the skater.

## 2026-10-31: Diagonal push stroke and arm swing for the stride (M1-02)

- Decision: the push stroke goes diagonally out and back (the foot ends 0.38 m to the side and 0.36 m behind its rest point). The second pass pushed almost only to the side (0.07 m back).
- The arms swing in a sine wave against the legs: the front arm 62 degrees forward with a bent elbow, the back arm 42 degrees back. The shoulders turn 18 degrees with the arms, and the torso leans forward 16 to 21 degrees through the stroke.
- Why: the player saw that the feet went out to the side with no drive, and that the upper body was stiff. Real skaters push at about 45 degrees to the line of travel and swing the arms in opposition to the legs.

## 2026-10-31: Stroke thrust and a shorter coast (M1-02)

- Decision: a held push button gives a thrust over each 0.4 s stroke (a half sine wave, mean `SKATE.pushAccel` 8 m/s²). The old model added 2.4 m/s at once at each stroke start. A release stops the thrust at once.
- The roll friction is stronger: `coastDecel` 0.5 → 1.2 m/s², `coastDrag` 0.012 → 0.025 1/m. From 12 m/s, the coast to a stop takes about 6 s and 26 m. Before, it took 13.7 s and 61 m.
- On a ramp (ground normal y < 0.97), the friction is 20 % of the flat value (`rampFriction`), so the quarter pipe still gives vert air.
- Why: the player wants her to speed up while the button is held and lose momentum after a release.
- Tests: two ramp tests changed their input. The quarter pipe test now pushes on the run-in. The deck edge test starts at 6 m/s.

## 2026-10-31: ATL dances on the style buttons, and a new idle (M1-02)

- Decision: each style button has a list of dances. A press starts the next dance in the list. A held button repeats the dance.
  - Q: Bankhead Bounce, Walk It Out, the Prep, Swag Surf, Snap Lean, crisscross. Each dance lasts 2 beats (1.2 s at 100 BPM).
  - E: toe-stop spin, sit spin. Each spin lasts 1 beat.
- The sim picks the dance (`state.style.clip`), and the dance name goes into the combo string. The renderer plays a dance from its first frame at the game tempo.
- The idle is a relaxed lean with a hand on the hip, a toe tap on beat 4, and a head nod. The old idle raised the hands to clap, which read as a shoulder shrug.
- Not in the game: Whoop Rico (no source describes the moves), and moves with a content flag (see `docs/characters/atl-dance-references.md`). "Snap Lean" is the name for the lean-and-snap move, because the song "Lean wit It, Rock wit It" has no lyric check.
- Why: the player asked for classic Atlanta dances and a cooler idle. The old style moves lasted 0.5 s, which is too short to show a dance.

## 2026-10-31: The ATL ride glide for the coast (M1-02)

- Decision: the coast clip is one bar (4 beats). The stance is low and staggered, and the front skate switches every two beats. The body dips on each beat, the shoulders roll forward and down, and the arms hang loose.
- Why: the player saw that the glide after a push was upright and stiff. The ATL references describe a low, bouncy ride with swag and shoulder rolls (`docs/characters/atl-dance-references.md`, ATL Rydin).

## 2026-11-01: Coyote time for a roll off an edge (M1-02)

- Decision: a jump press up to 0.12 s (`SKATE.coyoteTime`) after the skater rolls off an edge still jumps. The jump sets the vertical speed to `jumpSpeed` (plus any upward speed).
- The window applies only when `airFrom` is "edge". A ramp launch, a grind exit, a fall, and a normal jump do not get it, so the player cannot jump twice.
- Why: the gamedev cheat sheet audit (`docs/gamedev-cheatsheet-audit.md`) found that a late jump press at a ledge was lost.

## 2026-11-01: Jump and grind input buffers (M1-02)

- Decision: a jump press stays live for 0.1 s (`SKATE.jumpBuffer`). A press just before a landing jumps on the first frame on the ground. One press gives one jump.
- A grind tap stays live for 0.15 s (`GRIND.buffer`). A tap just before a rail comes in range still snaps. A held grind button works as before.
- A snap onto a rail clears both buffers, so an old press does not fire after the grind.
- Why: the gamedev cheat sheet audit found that an early press was lost.

## 2026-11-01: Dance cleanup from references (M1-02)

- Swag Surf: the arms are now near shoulder height with the forearms hanging down, as over the shoulders of friends. The knees bend deep, and the body leans side to side. The first version raised the arms in a V, which a video check showed to be wrong.
- Walk It Out: a stronger twist (about 25 degrees) and a deeper double bounce, from the STEEZY steps.
- Snap Lean: the arms hang low and the snap is beside the hips, with a shoulder dip. No video was found, so the clip follows the text sources only.
- The Prep and crisscross: the clap is now low, in front of the chest, with the elbows near the ribs. The old clap raised the arms to shoulder height, which read as a shrug.
- Bankhead Bounce: no change. The player likes it.

## 2026-11-01: Walk It Out and Swag Surf rekeyed from video lessons (M1-02)

- Walk It Out: a wide, low stance. Both knees turn to one side, then to the other, on a double bounce. The fists stay at the chest. The source is the Howcast lesson by Randy Connor.
- Swag Surf: one side per beat. She stands up with the arms up, sweeps to the side, then drops and bends forward with the hands near the knees. The source is the HAS Dance University lesson.
- Why: the player said that the first versions were completely wrong. They came from text only.

## 2026-11-01: The coast is the ATL Ryde from a skate lesson (M1-02)

- Decision: the coast clip is the ATL Ryde step from the Dun Beezy lesson. The skates press out on the downbeat and drag in on the half beat, and one skate ends behind the other. The arms throw down on the downbeat and come up to the chest on the half beat.
- Why: the player asked for better references for the skate moves. The first ATL ride clip came from text only.
- Not done: the corner step (out with the right skate, two drags of the left skate). It needs a carve clip that plays on the corners.

## 2026-11-01: The ATL Ryde corner step for the carves (M1-02)

- Decision: the carve clips are the ATL Ryde corner step from the Dun Beezy lesson, 2 beats. In a left turn, the right skate steps out wide, the left skate drags twice behind on its toe, and the right skate comes back in. The body leans into the turn. `carve_right` is the mirror.
- This replaces the Cross Step clip, which came from a name only, with no source for the mechanics.

## 2026-11-01: The first real block from geodata (M1-03)

- Block: the Atlanta BeltLine Eastside Trail from Ponce City Market south to Krog Street Market. William picked it. The bbox is `33.7560,-84.3685,33.7735,-84.3580`, about 970 m by 1950 m. The first bbox was 600 m wide and cut out the bend of the trail around Historic Fourth Ward Park, so the bbox goes farther east.
- Source: OpenStreetMap through the Overpass API. Overture needs a GeoParquet reader that is not on this machine. See `docs/sources.md`.
- Pipeline: `scripts/build-block.mjs --bbox ... --out levels/beltline-eastside/` fetches once and caches the raw answer in `levels/beltline-eastside/raw/`. Later runs read the cache. `--offline` fails when there is no cache, and `--refresh` fetches again. A Vitest test rebuilds the committed `level.json` from the cache, byte for byte.
- Projection: a local equirectangular projection about the bbox center, in meters (+x east, +z south). Over the block the error is under 0.1 % of the great-circle distance (Vitest).
- Level format `geo-level/1`: `buildings` (footprint rings and a height), `strips` (street, sidewalk, path, and trail center lines with a width), and `areas` (parks). The file keeps center lines, not polygons. The runtime builds the meshes from them. `objects` is empty. Rails, ledges, and ramps on real features are M1-04.
- Flat world: there is no terrain height. Bridges and the trail bridges are on the ground. A digital elevation model is a later task.
- Surface heights: ground 0, park 0.02 m, street 0.03 m, path 0.05 m, trail 0.07 m, sidewalk 0.15 m. The small steps stop z-fighting. The sidewalk is a 0.15 m curb with side walls. Every step is under `SKATE.maxStep` (0.25 m), so she rolls over the curbs.
- Widths: from the `width` tag, else from the road class (trunk 14 m, secondary 12 m, tertiary 10 m, residential 8 m, service 4 m, driveway 3 m), else the lane count times 3.3 m. The trail is 4.3 m (14 ft). Sidewalks are 2 m. Crossings, steps, tunnels, and proposed roads are not in the level.
- Building heights: the `height` tag, else `building:levels` times 3.2 m plus 1 m, else a default by building type (house 7 m, apartments 15 m, office 18 m, garage 3 m, other 8 m). 1024 of the 1045 buildings use the default. Each building records its `heightSource`. Overture heights can replace the defaults later.
- Ground sampler: a pure polygon and strip sampler (`src/level/geo/geo-ground.js`) with a 16 m grid. It keeps the controller contract (`sampleGround(x, z)`), so the sim did not change. A sample takes about 0.5 microseconds in node.
- Draw calls: all flat surfaces share one toon material with vertex colors, and all buildings share a second one. The meshes merge per 250 m tile, so the block is 66 meshes (54,279 triangles) in place of 2063 features. The tiles let Three.js cull the meshes out of view.
- Colliders: one static Rapier trimesh per merged mesh, from the same triangles as the render. Buildings are in the wall group, so the follow camera ray stops at them. Surfaces are in the ground group.
- Light: the sun shadow box (90 m) follows the skater, because one shadow map cannot cover 2 km.
- Draw distance: 320 m, with fog from 150 m to 320 m. With an 800 m far plane the trail playtest ran at a median of 30 FPS in headless SwiftShader with video capture on. Each of these changes alone gave 59.9 FPS: no shadows, a 250 m far plane, or a pixel ratio of 0.5. The far plane costs the least in look. The 90th percentile frame is still 33 ms, so the margin is small. The 30 FPS run is `reports/playtest-beltline-eastside-2026-11-01-21-22-45.json`.
- Known issue: shadow acne (a dot pattern) shows on some building walls that face away from the sun. A `normalBias` of 0.04 did not remove it, so the change is not in.
- Shell: `?level=beltline-eastside` (alias `beltline`) loads the block. The greybox stays the default. The level JSON is a separate chunk, so the greybox page does not download it. `?cam=x,y,z,lookX,lookY,lookZ` sets the fixed camera and `?fog=0` removes the fog, for screenshots.
- Playtest: `npm run playtest` still runs the three greybox sessions, so the M0 numbers stay comparable. `npm run playtest:beltline` runs a 40 s ride on the trail, planned with the pure controller and a trail follower (`src/playtest/trail-script.js`).
- Political rules: the level has no traffic. Streets are skate surfaces only.

## 2026-11-01: Level detail from a kit (M1-08, #40)

- Method: "plan the streets first, then fill them from a kit" (the walled-city workflow by rewind02 on X). The street plan is the OSM data from M1-03.
- Scope: William asked for level detail, NPCs, and more playable skaters from six posts on X. He picked level detail first, and new M1 issues for the rest: #40 level detail, #41 NPCs, #42 a second skater. #42 changes the concept scope (version 1 had one skater).
- Building kit: 12 styles in `src/level/geo/styles.js` (brick loft, brick warehouse, stucco apartment, modern apartment, glass office, storefront, shotgun house, craftsman house, industrial shed, parking deck, church, garage). A building gets a style from its name (Ponce City Market and Krog Street Market are brick warehouses), then its OSM type, then its size and height, with a seeded hash. 11 of the 12 styles are in use on this block; no building maps to "church".
- Windows cost no geometry: the walls carry a facade attribute (style, bay, floor, face kind), and a toon shader draws windows, storefronts on the ground floor, and frames. Instanced windows would add more than 1 million triangles.
- Each style adds a parapet in its trim color. Storefront styles get awnings over the street-facing ground floor.
- Murals: 40 walls that face the trail within 35 m get a mural from a 16-design atlas drawn in code (`src/render/murals.js`). The designs are original: peaches, dogwood, a sun over a skyline, chevrons, and lettering such as ATL and O4W. Murals, not graffiti.
- Street props: the Blender MCP builds a kit of 9 low-poly props from primitives (`scripts/blender/street_kit.py`, `assets/kit/street-kit.glb`, 48 KB). The placement rules are in `src/level/geo/props.js`: trees each 12 m on both sides of the trail and each 16 m on sidewalks; lamps each 24 m and 36 m; benches each 60 m with a bin; roof units and water towers by roof area and style. Props go only on open ground or parks, at least 2.5 m apart. The block has 3317 props.
- Draw calls: the props merge into one mesh per 125 m tile. Tiles farther than about 260 m from the camera are hidden.
- Street props are solid: the ground sampler treats each one as a circle with a height over `SKATE.maxStep`. Roof props are not solid.
- Shadows: the shadow map is off on the geodata level. With it on, the trail playtest ran at a median of 20 to 30 FPS in headless SwiftShader with video capture. With it off, the ride ran at 59.9 FPS. The trees carry a dark disc and the skater a blob, so the look keeps a stylized shadow. The greybox keeps its shadow map.
- Not done: the image paint-over step (a Blender render painted over with image generation as the target look), pitched roofs on houses, and an outline pass (M1-06).

## 2026-11-01: More detail on the props and the windows (M1-08, #40)

- Why: William said the props looked "way too blocky and pixelated".
- Props: the Blender kit now has two levels of detail per prop. LOD0 is smooth shaded: a round tree with a trunk, 3 branches, and 6 canopy blobs (932 triangles); a 4-tier pine; a bench with slats and armrests; a lamp with a curved arm and a lantern; U-shaped bike racks; a bin with a lid; a water tower with braces. LOD1 is the first, simple kit.
- Trees get a seeded scale from 0.85 to 1.2.
- The props use a soft toon ramp, so the round canopies do not show each face.
- LOD: props merge into 50 m tiles, at two levels. A tile within 60 m of the camera shows LOD0, a tile within 200 m shows LOD1, and a tile past 200 m is hidden. `?lod0=<m>` and `?propdist=<m>` change the distances, and `npm run playtest -- --query "..."` passes a query to the page.
- Why the tiles are small: with 125 m tiles and LOD0 within 75 m or 110 m, the trail playtest ran at a median of 30 FPS, because one near tile put up to 60 detailed trees on screen. With 50 m tiles it ran at 59.5 and 59.9 FPS in two runs.
- Windows: the facade shader blends each window edge over one pixel (anti-aliasing with `fwidth`). Far windows fade to the mean wall color, so the grid does not shimmer. Each window has a sill, and a wide window has a center mullion.

## 2026-11-01: Landmark models with img2threejs (M2-01, #18)

- Why: William asked whether img2threejs can be used, and picked "landmarks first".
- Install: `npx img2threejs@0.1.1 install --host claude`. It links release v2.0.0 (published 2026-09-06, commit a669e9a) into `~/.claude/skills/img2threejs`. Both versions are older than 7 days. The skill is a tool, not a project dependency.
- Scope of the model: the OSM footprint and the facade shader already give the building mass and the windows. img2threejs models only what a box cannot show: the Ponce City Market tower top. The rooftop sign is game code (`src/render/landmark-signs.js`), because it is a flat card on a different roof.
- Reference: one Wikimedia Commons photo (Tyler Lahti, CC BY-SA 2.0). A close crop corrected the first analysis: the tower top is a square brick belvedere under a truncated hipped copper roof, not an octagonal lantern with a dome.
- Pipeline: the spec is written by `landmarks/ponce-city-market/build_spec.py`. `post_generate.py` gives the roof cone 4 segments, because the generator builds every cone with 8 and reads no per-part count. `run_pass.sh` runs the mechanical gates of one pass.
- Gate fixes that the reference needed: a polygon mask of the tower (the aerial crop has the city behind it), a render at the crop's aspect ratio, and a transparent background for the turntable gate.
- Result: blockout (0.72), structural (0.72), and form (0.74) passed. The material pass stopped at `request-input`: Tier 1 groups the render into at most 5 colors (k-means k=5), and the tower has 6 part colors, so the small gold finial never forms a group (delta-E 45.81). Changing the gold or enlarging the finial to pass would bend the model to the tool, so the model stays at the form-pass level.
- Game: `scripts/bake-landmark.mjs` bakes the factory into one vertex-colored template (`assets/landmarks/ponce-city-market-tower.json`, 1704 triangles, 110 KB). The game does not bundle the 470 KB factory. `src/level/geo/landmarks.js` places the tower near the north edge of the real roof and the sign on the east edge, facing the trail. Both positions are approximate.
- The tower is at its real size (8 m wide, 21 m above the roof), so it reads small on the 238 m by 188 m OSM footprint.
- Not done: the lighting, interaction, and optimization passes.

## 2026-11-02: Krog Street Market front with img2threejs (M2-01, #18)

- Reference: one Wikimedia Commons photo (LittleT889, CC BY-SA 4.0), a street-level view of the entrance. Scale from the brick wall: about 30 px per meter.
- Scope: the parts above and on the brick box. A sawtooth metal roof profile (extruded 50 m back), the black canopy with its truss, 2 posts, 5 brass pendants, and 2 letter cards ("KROG STREET" on a transparent card, "MARKET" on the fascia). The OSM box and a new "brick-market-hall" style (no parapet) give the brick walls.
- A close crop corrected the first analysis: the roof is a sawtooth (a rise to a vertical step, a fall, and a tall rise), not 2 gables.
- The letter cards keep their text through the bake (`cards` in the template), and the game draws them with `createSignTexture`. "KROG STREET" uses a condensed font (DIN Condensed, then Arial Narrow, then Impact).
- Placement: the front faces east, to the parking drive. On the west side, the OSM data has a sidewalk and Krog Street within 6 m, so a canopy there would hang over the street. Approximate.
- Review camera: the photo's own camera (about 1.6 m high, 36 m out, a 10.6 degree lens), so the render frames the crop.
- Tier 1 masks: neither the Ponce City Market nor the first Krog Tier 1 runs isolated the subject. Both masks fell back to almost the whole frame, so the silhouette IoU read 1.0. Those silhouette passes were not real evidence. With a transparent reference mask and a transparent render, the Krog front measured IoU 0.534, which led to the canopy truss (IoU 0.788). The Ponce City Market tower was not measured again this way.
- Result: blockout (0.72), structural (0.72), and form (0.73) passed. The material pass stopped at `request-input` on the same Tier 1 color limit: the 5 brass pendants are too small to form one of the 5 color groups (delta-E 55.78).
- Size in the game: 472 triangles, 3.6 KB gzip.

## 2026-11-02: Landmarks v2, the full img2threejs pipeline (M2-01, #18)

- Why: William said the landmarks did not reach the quality that img2threejs gives elsewhere. He picked "Full pipeline, real materials".
- Cause of the gap in v1: a flat vertex-color bake, a 3000-triangle budget, shallow specs, and only 3 of 8 passes.
- Specs: each spec is deeper now. The Ponce City Market tower has 152 parts (arched window frames with holes, stone panels, 22 dentils a face, a frieze, a cornice, a hip roof, a cap, and a finial). The Krog Street Market front has 58 parts (a canopy truss with 16 diagonals a side, 5 pendants with cords and bulbs). The budget is 20000 triangles.
- Passes: both models ran all 8 passes, each with gates and a review. Ponce City Market fidelity went from 0.78 (blockout) to 0.80 (optimization). Krog Street Market stayed at 0.78. Both state files are `complete`, with part coverage, action-ready, and emission evidence. The plugin gates are skipped, because no domain plugin applies.
- Tier 1 masks: the v1 silhouette IoU of 1.0 was not valid evidence (both masks fell back to the full frame). v2 uses a transparent polygon mask of the reference and a transparent render. Ponce City Market measures IoU 0.865, and Krog Street Market 0.9035.
- Review cameras: the cameras are fitted to the crop (Ponce City Market: 70 m out, a 9.5 degree lens; Krog Street Market: a 5.6 degree lens). They are fits, not solved physical cameras.
- Gate patch: Tier 1 groups the whole render into 5 colors, so a small part with its own color (the gold finial, the brass pendants) always failed. William picked "Patch the gate locally". The local patch (`tools/img2threejs-footprint-color.patch`, applied to `forge/stage4_review/diagnose_render.py` in `~/.img2threejs`) adds `--footprint-dir`. Each part is compared on its own visible footprint (a render with the part and a render without it, both unlit). Parts with fewer than 12 visible pixels are reported as unmeasured. Text cards are reported as `textured-card` and judged in the review. Ponce City Market measures 27 parts (max delta-E 10.38), and Krog Street Market 10 parts (max 7.88). An upstream issue draft is in `tools/img2threejs-footprint-gate-issue.md`. It is not sent.
- Materials in the game: the near level now uses physical materials (`src/render/landmark-materials.js`): canvas color, bump, and roughness maps for brick, stone, copper patina, and corrugated metal, with world-meter UVs. A RoomEnvironment reflection map, and a small shader term darkens the walls under an overhang (cornice, canopy). The game lights, no tone mapping, and no shadow map stay as before.
- LOD: each landmark is a `THREE.LOD`. Within 250 m it shows the physical-material groups. Past 250 m it shows the flat vertex-color toon mesh.
- Triangles: the generator subdivides every box and uses 32 by 20 sphere segments. `post_generate.py` sets each box to 1 segment, the Ponce City Market hip roof to 4 segments, and the Krog Street Market bulbs to 12 by 8 segments. A decimate ratio of 0.0625 collapsed the boxes, so it is not used. The tower is 4732 triangles (from 27232), and the front 3584 (from 8824). The bulb patch came after the Krog Street Market optimization review; the in-game render was checked after it.
- Size: `ponce-city-market-tower.json` is 1.33 MB (111 KB gzip). `krog-street-market-front.json` is 1.06 MB (84 KB gzip).
- Known limits: the Krog Street Market roof profile extrudes 50 m back as a plain metal slab, so an oblique view shows a long flat roof. The canopy posts are not solid in the game.

## 2026-11-02: Scanned textures on the landmarks (M2-01, #18)

- Why: the research on the X links (`docs/research/2026-11-02-x-links-level-and-assets.md`) found that procedural noise reads as fake next to a real scan. William said "Yes, do the textures".
- Source: 3 CC0 scan sets from Poly Haven: `red_brick` (brick, 1.4 m tile), `beige_wall_001` (stone trim, 3.0 m tile), and `corrugated_iron` (the Krog Street Market roof metal, 1.12 m tile). Each set has a color map, an OpenGL normal map, and a roughness map.
- Build: `scripts/landmark-textures.py` downloads the 1k maps and writes 512 px maps to `assets/landmarks/textures/`. The script multiplies the color map by the AO map, so the material needs no AO map. It also tints the color map in linear space, so its mean color is the spec base color. The img2threejs color gate reads the spec base colors, so this tint keeps the models inside the gate. No pixel clipped.
- Copper patina: Poly Haven has no CC0 patina scan. The copper keeps its canvas texture.
- Tiles: the maps tile at the real scan size, through the world-meter box UVs (`applyBoxUVs`). The normal maps use the per-pixel tangent frame of three.js, because the box UVs have no tangents.
- Load: `landmarkTexturesReady()` resolves when the maps load. The landmarks count in `info.towers` only after that, and the preview pages draw only after that, so the screenshots show the final look.
- Size: 9 maps, 418 KB in the build. `npm run playtest:beltline` median 59.9 FPS, gate 55 PASS.
- Not done: the img2threejs passes were not run again; the unlit color gate does not read the maps.

## 2026-11-02: Brick scan on the OSM building facades (M1-08 follow-up)

- Why: after the landmark scans, the tower brick was more detailed than the brick of the buildings around it. William said "Yes, do facades".
- What: the facade shader (`createFacadeMaterial` in `src/render/geo-view.js`) samples the same CC0 brick scan as the landmarks (`assets/landmarks/textures/brick/color.jpg`). It divides the scan by its mean color and multiplies the wall color by the result. Each building keeps its own wall color and gets brick courses, mortar, and brick-to-brick variation.
- Where: only on the styles with `brick: true` (`brick-loft`, `brick-warehouse`, `brick-market-hall`). The church style has a white wall color too, so it has no flag.
- Size: the shader turns the bay and floor coordinates into meters (style `bay` and `floorHeight`). It tiles the scan at its real size (1.4 m). A wall with a bay count rounded from its length gets up to about 25% stretch along the wall.
- Far: the detail fades out with the same factor that fades the windows, so far walls do not shimmer.
- No new file: the map is the one the landmarks load. `npm run playtest:beltline` median 59.9 FPS, gate 55 PASS.

## 2026-11-02: Quality tiers, real heights, signs, and ground detail (BeltLine level)

- Why: William asked for "PS4 level" quality on the BeltLine level, and for real heights, street signs, and props. William picked "Stylized high-end" (the Jet Set Radio concept at a higher quality, not photo realism) and "Quality tiers".
- Tiers: `src/render/quality.js`. A software GPU (SwiftShader, llvmpipe) gets the low tier, and every other GPU gets the high tier. `?quality=low|high` sets it. The headless playtest runs on SwiftShader, so the 55 FPS gate measures the low tier, as before.
- High tier: a 4096 px sun shadow map over 140 m around the skater (soft PCF), GTAO ambient occlusion, ink outlines from the GTAO depth and normal buffers (no extra scene pass), a soft bloom, MSAA x4, neutral tone mapping, cel clouds, a 650 m draw distance (fog from 260 m), and the ground scans. The skater blob shadow is off, because the skater casts a real shadow.
- Sky: the high tier has a gradient sky dome with a sun disc and cel clouds. The low tier keeps a flat horizon color. On both tiers the fog color is the horizon color.
- Heights: Overture Maps (release 2026-10-21.0) gives a height for 912 of the 1045 buildings, which had no OSM tag. The order is the OSM height tag, the OSM levels tag, the Overture height, the Overture floor count, and the type default. 112 buildings still use a default. Overture heights under 2.5 m are raised to 2.5 m (sheds and carports). The heights are estimates from Overture; this task did not check them against a survey.
- Street signs: 95 posts, one at each intersection of two named, non-service streets (`src/level/geo/signs.js`). The names use the US short forms ("Ponce de Leon Ave NE"). The posts are solid props (radius 0.12 m). A sign may stand on a sidewalk; every other prop stays off the pavement.
- Road markings (high tier only): a double yellow center line on trunk, primary, secondary, and tertiary streets 9 m or wider, and zebra crosswalks on each arm of the signed intersections (`src/level/geo/markings.js`). A center line goes on past a driveway or an alley. The markings are a visual only; the ground sampler and the physics do not see them.
- Ground: the surface shader multiplies the art color of each surface kind by a CC0 scan over its mean color, in world meters, with a second rotated sample against tile repeat. The scans are clean (no cracks or patches), for the "every neighborhood at its best" rule. The detail fades out from 90 m to 280 m. The surface kind comes from the vertex color, because each kind has its own art color.
- Low tier budget: the low tier gets the heights and the street signs. The sky dome and the road markings each cost 1 to 3 ms a frame in SwiftShader, which is enough to push the vsync-locked median from 60 to 30 FPS, so they are high tier only. Each markings tile joins the render copy of its surface tile, so it adds no draw call. `?sky=0`, `?signs=0`, and `?markings=0` turn the parts off for a check.
- Gate result: on 2026-11-02 the machine load average was 16.8 (other apps). Under that load, `npm run playtest:beltline` gave a median of 30 FPS for this branch and also for the base commit 41413e6 (average 37.8 FPS and 39.1 FPS). Earlier the same base gave 59.5 FPS twice. The gate must be run again on a quiet machine before merge.
- High tier speed: headless Chromium on the Apple M4 Max (ANGLE Metal), 1280 x 720, no frame cap: 311 FPS at the spawn, 338 FPS at Ponce City Market, 345 FPS at North Ave (`reports/beltline-quality/`).
- Not done: building facades are still extruded footprints with shader windows; roof shapes (Overture has a roof shape for 2 of 1077 buildings) and the trail-side props from the asset research are follow-ups. See `docs/research/2026-11-02-beltline-quality-roadmap.md`.

## 2026-11-02: Facade kit: interior mapping, ledges, and house roofs (BeltLine level)

- Why: the roadmap (`docs/research/2026-11-02-beltline-quality-roadmap.md`) puts the flat building boxes first among the gaps. William picked "Facade kit next".
- Interiors (high tier): the facade shader has an `INTERIOR` define (`createFacadeMaterial(..., { interiors })`). Each window cell is a box room. The view ray goes through a 0.22 m window reveal (the sill is the bottom of the reveal), then hits a side wall, the floor, the ceiling, or the back wall (4 m deep, 6 m for a ground-floor shop). The rooms get a color, a lit or dark state, furniture, and blinds from a hash of the cell. Shops get shelves of goods. The glass adds a sky reflection that grows at a low angle. The lit rooms add a little emissive light, so a shaded wall still shows its rooms. No new geometry and no new texture.
- Kit geometry (high tier): `src/level/geo/facade-kit.js`, pure, with Vitest tests. It adds a cornice under the parapet (0.35 m out), a coping on the parapet (0.1 m out), a belt course over the ground floor of a storefront style with 2 floors or more, and a gable roof (32 degrees, 0.45 m overhang) on a house style 12 m high or lower, with a near-rectangular footprint (72% of its smallest rectangle or more) and a span of 16 m or less. BeltLine level: 210 cornices, 351 copings, 139 belt courses, 664 roofs, about 34,000 triangles.
- Render only: each kit tile joins the render copy of its building tile, so it adds no draw call. The physics keeps the plain boxes, so a house roof has a flat collider at the wall top under the gable.
- The gable sits on the wall top, so a house is now taller than its OSM or Overture height by the roof rise (up to about 5 m for a 16 m span). The walls are not lowered, because the physics shares the wall mesh.
- Low tier: no change. The kit and the interiors are high tier only, because the low tier gate is near its limit in SwiftShader. `?kit=0` and `?interiors=0` turn them off for a check.
- High tier speed: headless Chromium on the Apple M4 Max (ANGLE Metal), 1280 x 720: 353 FPS at the spawn, 390 FPS at Ponce City Market, 394 FPS at North Ave (`reports/facade-kit/`).
- Low tier gate, 2026-11-02 18:04: run back to back on this machine, the base commit 41413e6 and this branch each gave a median of 30.1 FPS (average 39.1 FPS), gate 55: FAIL. The load average was 12 to 15 during both runs, and SwiftShader itself adds to that load. So this branch does not make the low tier slower, but the gate failure on this machine is not explained. The same base passed at 59.5 FPS earlier on 2026-11-02.

## 2026-11-02: Terrain and bridges from USGS 3DEP (BeltLine level)

- Why: step 2 of the quality roadmap. William picked "Terrain and bridges". The level was flat, and the real Eastside Trail runs on a rail grade over Ponce de Leon Ave, North Ave, and Ralph McGill Blvd.
- Data: `scripts/terrain-dem.py` gets the 3DEP bare-earth DEM for the level box at 2 m per pixel. It writes an 8 m grid in level coordinates, in cm over the lowest node (int16, base64), to `raw/terrain.json`. The BeltLine box has 50.4 m of relief over 270.1 m.
- Extent: the 3DEP service changes the extent that it is asked for, to keep square pixels in degrees. The first grid was stretched by about 20% from north to south. The script now reads the real extent from the GeoTIFF tags.
- Grid size: a 4 m grid gave 897,661 surface triangles and an 8 m grid 374,978 (the flat level has 36,419), so the level uses 8 m. A 16 m grid has a 95th-percentile error of 0.55 m against the 8 m grid, which is too much. The mesh tiles are now 125 m (were 250 m), so the camera culls more of the draped terrain: 269 meshes.
- Exact drape: the terrain is piecewise linear on two triangles per cell. `drapeMesh()` (`src/level/geo/terrain.js`) cuts each flat surface triangle on the terrain triangles and moves each vertex up by the terrain. A street 3 cm over the ground stays 3 cm over it everywhere, with no gap. The vertices weld within faces of one direction, so the ground has smooth normals and a curb keeps its hard edge.
- Buildings do not tilt: the walls go from 0.5 m under the lowest footprint corner to the data height over the mean ground of the corners (`buildingSpan`). The facade kit, the roof props, the murals, and the landmarks use the same span.
- Bridges: `build-block.mjs` keeps the OSM `bridge` and `layer` tags (26 strips). A deck runs straight from the ground at its first point to the ground at its last point, with a slab, two parapets, and a sine arch where a way under it has less than 4.5 m of clearance (at most a 12% mean grade).
- Embankments: an 8 m grid smooths a 30 m railroad embankment, so the DEM alone gave the trail bridges about 2 m of clearance. The raw 2 m DEM shows the trail at about 12 m and Ponce de Leon Ave at about 6 m. `raiseEmbankments()` raises the grid at each bridge end to 5 m over the lowest way under the deck, and falls back to the terrain over 40 m. Trail bridges now: Ponce de Leon Ave 6.1 m, North Ave 4.5 m, Ralph McGill Blvd 6.3 m at mid span. These are not survey clearances.
- Trail grade: the DEM under the trail has the cuts and fills next to it (a 47% ramp near the North Ave bridge). `gradeTrail()` sets the trail corridor to the mean ground of the at-grade trail within 60 m. The trail grade is now 1.2% at the median and 8.1% at the 95th percentile. The steepest point is 26.5%, at a bridge approach. The OSM footprint of 725 Ponce (`w741961703`) overlaps the trail line by about 1 m, so the sampler gives a 52 m wall there; that was true on the flat level too.
- Skater: the sampler adds the terrain and its normal, so the existing slope code accelerates her downhill. `sampleGround(x, z, y)` leaves out a bridge more than 2.5 m over the skater, so she rolls under a bridge and onto it from its approach.
- Cameras: a `?cam=` height is now over the terrain at that point, so the old screenshot cameras still see the same place.
- Speed, high tier (M4 Max, ANGLE Metal, 1280 x 720): 290 FPS at the spawn, 321 FPS at Ponce City Market, 302 FPS at North Ave (were 353, 390, 394).
- Speed, low tier: **slower**. Back to back on this machine (load average 11 to 17), `npm run playtest:beltline` gave the base 30 FPS median over about 1,550 frames, and the terrain 20 FPS median over 690 to 796 frames. SwiftShader draws 145,707 triangles a frame at the spawn (39.8 ms). The gate was at FAIL before this change too.
- Not done: a terrain LOD for the low tier; the bridge piers; the 725 Ponce footprint overlap.
- Low tier terrain LOD (William picked "Terrain LOD"): a surface tile more than 60 m from the camera shows a drape on a 16 m terrain (`coarseTerrainOf`, `?farterrain=0` turns it off). The physics keeps the exact tiles. SwiftShader at the spawn: 90,103 triangles and 29.6 ms a frame (145,707 and 40.2 ms without it). Gate: median 30 FPS (average 25.8 FPS, 1,090 frames); base median 30 FPS (average about 39 FPS, about 1,550 frames). FAIL, as before this change.

## 2026-11-02: Building height fixes (BeltLine level)

- Why: the stage accuracy research (PR #48) found 51 houses over 20 m from Overture, and towers next to Ponce City Market that were too short. William picked "Height fixes".
- Cap: an Overture height over `OVERTURE_CAP` for its OSM type is capped (house 12 m, bungalow 10 m, terrace 14 m, garage 6 m, shed 5 m). An OSM height or levels tag is not capped. 98 buildings are capped; no house is now over 20 m.
- Overrides: `levels/beltline-eastside/heights.json` has a height and a source URL for 4 buildings: Signal House (21 stories, 68.2 m), Overline Residences (18 stories, 58.6 m), the Kroger store under 725 Ponce (7 m), and 619 Ponce (4 stories, 17.8 m). The story counts come from the PR #48 research; I did not check the sources again.
## 2026-11-02: Procedural trees with wind (BeltLine level)

- Why: the roadmap (`docs/research/2026-11-02-beltline-quality-roadmap.md`, item 3) and the stage accuracy report (`docs/research/2026-11-02-stage-accuracy-and-characters.md`) rank the tree canopy high. William picked this work on 2026-11-02.
- What: `src/level/geo/trees.js`, pure and seeded, with Vitest tests. It builds 4 Atlanta species in 3 variants each: willow oak, loblolly pine, southern magnolia, and crape myrtle (most in bloom: pink, magenta, or white). Each tree has a LOD0 and a LOD1 template, in the street kit template shape.
- Crown: a set of jittered icosphere "puffs". Each puff normal points mostly away from the crown center, so the toon ramp shades the crown as one soft shape. The vertex colors are darker low and inside the crown (a baked occlusion). The colors are given in sRGB and stored linear, as the street kit GLB stores them.
- Size: 6 to 16 m tall, in place of 5.4 to 6 m for the kit trees. The oak and crape myrtle crowns on the trail clear a 1.8 m skater at the smallest scale (0.85); a test checks it.
- Placement and physics: no change. `src/level/geo/props.js` still places `tree_round` and `tree_tall`, and the colliders keep those kinds. The render swaps each placement for a species by a hash of its position (`treeKindFor`): `tree_tall` gets a pine (70%) or a magnolia, and `tree_round` gets an oak (60%), a crape myrtle (25%), or a magnolia.
- Wind: each vertex has a `sway` weight (0 at the trunk base). The prop material moves it in the vertex shader, with a phase from the world position. Kit props have a weight of 0. The shadow map does not get the wind (the move is under 0.3 m).
- Triangles, BeltLine level (1886 trees): LOD0 about 1.01 M in place of 1.34 M, and LOD1 about 119 k in place of 211 k. Per tree: oak 604/68, pine 436/48, magnolia 588/68, crape myrtle 436/64 (LOD0/LOD1).
- Both tiers get the trees. `?trees=kit` brings back the kit trees, and `?wind=0` turns the wind off, for an A/B check.
- Low tier gate, 2026-11-02 19:33, back to back, load average 23 to 36: this branch gave a median of 29.9 FPS (average 25.4, p5 15), and `?trees=kit` gave a median of 29.9 FPS (average 22.4, p5 12). Gate 55: FAIL for both. The trees do not make the low tier slower, but the gate must be run again on a quiet machine before merge.
- Not done: leaf cards with alpha, impostors past 200 m, and a canopy from real tree data (OSM has no trees in the box).

## 2026-11-02: KTX2 texture compression is deferred

- Why not now: the game has 13 JPG textures (4 at 1024 px, 9 at 512 px, 1.9 MB in all) and two small GLBs. KTX2 would save about 30 MB of GPU memory on a real GPU and nothing on SwiftShader, which transcodes KTX2 to plain RGBA. It also needs a native encoder (KTX-Software `toktx`), which the build does not have.
- When to do it: when the textures and models pass a size budget, for example more ground scans or more landmarks. Use gltf-transform with ETC1S for color maps and UASTC for normal maps, and `KTX2Loader` with the basis transcoder in `three/examples/jsm/libs/basis/`.
- Decided by William on 2026-11-02.

## 2026-11-02: Facade depth: window sills and storefront piers (BeltLine level)

- Why: the building walls are flat boxes, and the windows are only paint in the facade shader. Real ledges catch the light and give the wall depth. William picked "facade depth" on 2026-11-02.
- What: `src/level/geo/facade-kit.js` (`wallDepth`, `wallBox`), pure, with Vitest tests.
  - A sill under each upper-floor window: 0.12 m out, 0.1 m tall, in the trim color. It uses the same bays and floors as `extrudeFootprint()`, so each sill is under a window that the shader paints. The ground floor of a storefront style, the glass office, and the parking deck get no sills. A wall shorter than 1.5 m gets no sills.
  - A pier at each bay line of the ground floor of a storefront style with 2 floors or more: 0.36 m wide, 0.16 m out, from the ground to the belt course.
  - BeltLine level, on the PR #50 terrain and heights: 76,841 sills and 10,749 piers, about 854,000 triangles in all. Each part stands on the building span (`buildingSpan()` in `src/level/geo/terrain.js`), the same as the walls.
- Draw distance: the sills and the piers go in 412 depth tiles of 50 m (`DEPTH_TILE`), not in the building tiles. The view shows a depth tile only when the camera is under 120 m from its center (`DEPTH_DISTANCE`). At 120 m a sill is about one pixel tall. The near depth triangles: 9,264 to 21,318 at the three test views (`reports/facade-depth/`, measured before the rebase onto the terrain). After the rebase, the worst point of a 25 m grid over the level has 67,142; a test keeps it under 150,000.
- Ink: a sill is under 2 px tall at 30 m. With flat normals, the ink pass drew a crease on both of its edges, and the sill showed as a dashed black line. The sills now have soft shading normals: the top tilts 40 degrees up from the wall normal and the ends tilt 32 degrees. That is under the ink crease angle (about 49 degrees), so a sill gets no ink. The piers keep flat normals and get ink.
- High tier only, as the rest of the kit. `?depth=0` turns it off for an A/B check. The low tier does not build the kit, so the low tier gate cannot change, and it was not run again for this change.
- Render only: the physics keeps the plain boxes.
- Not done: recessed storefront glass (the wall boxes cannot have holes), and parapet changes (the parapet and the coping exist already).

## 2026-11-02: Toon pass, part 1: the skater and a halftone (BeltLine level)

- Why: item 4 of the stage report (`docs/research/2026-11-02-stage-accuracy-and-characters.md`) is the toon pass for the Jet Set Radio look. William picked it on 2026-11-02.
- Skater, both tiers (`src/render/toon.js`, with Vitest tests):
  - The GLB materials become `MeshToonMaterial` with a 3-step ramp (96, 180, 255). The map and the color stay.
  - A rim light on the edges that face away from the camera (strength 0.38). It does not show clearly in the test views, so its effect is not verified.
  - An ink outline from an inverted hull: a second `SkinnedMesh` on the same skeleton and geometry, with back faces, moved out along the view-space normal. Its width is the larger of 0.008 m and 0.0024 m per meter of distance, about 2 px from 5 m to 60 m. It is the only outline on the low tier, which has no ink pass.
- Halftone, high tier (`src/render/post.js`): the ink pass darkens a dark pixel with a 45 degree grid of dots (5 px cells). A dot grows as the linear luminance falls under 0.16. It fades out with the ink. No extra pass.
- `?toon=0` keeps the GLB materials and no hull. `?halftone=0` turns the halftone off.
- Not done in this part: a ramp for each city material and a rim light on the city. These need `src/render/geo-view.js`, which PR #50 also changes. Do them after PR #50 merges.
- Low tier gate, 2026-11-02 21:16 to 21:19, load average 15 to 18, in the order toon off, toon on, toon off, toon on: each run gave a median of 30 FPS, with averages of 34.0, 33.5, 34.2, and 34.2 FPS. Gate 55: FAIL for all four. The toon pass does not make the low tier slower. An earlier single pair gave 59.9 FPS for toon off and 30 FPS for toon on, but the repeat runs show that pair was noise. Evidence: `reports/toon/`.


## 2026-11-02: A second playable skater, and the pipelines compared (M1-10, #42)

- Scope change: version 1 had one skater in the concept. William asked for more playable characters, so M1 now has two: Nia "Sway" Ellis (West End) and Marcus "Tempo" Reid (Old Fourth Ward). Each new skater adds art cost and a skater review, so a third skater needs a new issue.
- Marcus: an original character, a middle-school band teacher and jam skater. The dossier is `docs/characters/marcus-tempo-reid.md`. Teal and navy are a contrast to the peach and forest of Nia.
- Pipeline: A (Tripo Studio, then `scripts/blender/skater_build.py`). Pipeline B (img2character) cannot retarget to the M1-02 Mixamo clips and does not write a GLB, so it was read from source and not installed. The comparison is `docs/characters/pipeline-comparison-m1-10.md`.
- Tripo Agentic Canvas was not available on the account (beta for Max and Team users first). The 3D Workspace made Marcus with the Nia settings, for 115 Tripo credits.
- Shared clips: both skaters use the same 24 clips and the same clip table. `nia_clips.py` takes `SKATER_CFG` (armature, mesh, rest feet), so one script keys every Mixamo skater. A move set for each skater is out of scope.
- Skater select: a row of buttons at the top right of the shell (`src/ui/skater-select.js`). A click loads the page again with `?skater=<id>` and keeps the other query values. An unknown value gives Nia. The buttons take no keyboard focus, so Space and the arrows stay with the game.
- Tests: the GLB tests, the five views, the contact sheets, and the T-pose gate run for each skater.
- Political rule: real Atlanta skaters must review both skaters and the move set before release.

## 2026-11-02: NPCs on the BeltLine (M1-09, #41)

- Module: `src/sim/npc/crowd.js` is pure and seeded (mulberry32). `createCrowd(level, { seed })` spawns the crowd and `stepCrowd(crowd, dt, niaPosition)` steps it at the fixed 60 Hz step. `src/sim/npc/path.js` gives fast arc-length lookups (binary search). A Vitest test shows that its points are the same as `pointAt` in `src/playtest/trail-script.js`. The lines come from `chainStrips`, and the spawn uses `projectOnLine`.
- Crowd: 28 NPCs on the trail (7 roller skaters, 6 joggers, 5 cyclists, 5 dog walkers, 5 families) and 12 walkers and joggers on 4 walk lines. Half of the trail NPCs start within 200 m of the spawn, so the player sees them; the other half spread over the full 2254 m trail.
- Walk lines: no sidewalk longer than 80 m is within 172 m of the spawn, but park paths in Historic Fourth Ward Park are within 12 m. The walk lines are the 4 sidewalk or park path chains nearest to the spawn (longer than 80 m, within 200 m).
- Steering: each NPC has an arc length and a side offset on its line. NPCs keep right (1.1 m from the trail center line), slow down behind a slower NPC, and pass in the middle when no NPC comes the other way. An NPC that cannot move for 2 s turns around. The NPCs move in order, and a move that would overlap another NPC does not happen. Thus no two NPC circles overlap. The test runs 60 s with 3 seeds, and 60 s with Nia on the trail.
- Nia: an NPC within 9 m of Nia steps to the side away from her and slows to 60 % of its speed. When she touches an NPC, it slides aside (if there is room) and wobbles for 0.8 s with a lean of 0.25 rad or less. NPCs have no fallen state, so nobody falls.
- The crowd does not change Nia's motion in this version. Why: the Playwright and playtest runs replay scripts from the pure controller and compare the end state to 0.01 m. If the crowd slowed Nia, the planner would also have to run the crowd. A soft slowdown for Nia is a follow-up.
- Render: `src/render/npc-view.js` builds low-poly figures from Three.js primitives with vertex colors (one figure per type: a skater with skates and a helmet, a jogger with a cap, a cyclist on a bike, a person with a dog on a leash, an adult with a child, a walker). One instanced mesh per type: 6 draw calls for 40 NPCs. A `tint` attribute picks the vertex color, the instance shirt color (10 colors), or the instance skin tone (6 tones). The figures bob and sway by speed. Each figure has a flat shadow disc, as the trees do.
- Draw cost: with all 40 NPCs drawn, the crowd added 6 draw calls and 11,152 triangles (47,212 to 58,364) at the spawn. Now `sync()` draws only the NPCs within 150 m of the camera (the fog starts at 150 m), and the heads are icosahedrons with 20 faces.
- FPS: `npm run playtest:beltline` ran at a median of 59.9 FPS in two runs with the crowd on (`reports/playtest-beltline-eastside-2026-11-03-03-38-34.json`). The gate is 55. Earlier runs failed at 20 to 30 FPS while another session ran headless Chromium at up to 848 % CPU (load average 26 to 36). In those runs the greybox, which has no NPCs, also failed at 30 FPS. An A/B in one page under that load gave the same median frame time with and without the crowd (33 to 67 ms).
- No Blender kit for the NPCs: the figures are code, so the kit GLB and its provenance do not change. Rigged models are a later task.
- Shell: the crowd is on for a geodata level. `?npcs=0` leaves it out, and `?npcseed=<n>` picks another crowd. `resetSkater` resets the crowd to its seed, so a scripted run sees the same crowd each time. `window.__atl.npcs` gives the count, the minimum gap, the bumps, and the NPCs in view. `window.__atl.setFixedCamera()` aims the fixed camera, for a screenshot of the moving crowd.
- Political rules: the crowd is friendly people on the trail. There is no crime, police, or traffic. A bump is soft and nobody falls.

## 2026-11-01: Face expressions for Nia are decals, not a face rig (M1-02)

- Decision: Nia's face changes with two small decal atlases: eyes (open, half, closed, happy) and mouth (neutral, smile, open). A shader projects them onto the front of the head in bind-pose space, so they follow the skin. Under the eye decal the normal map and the roughness map become flat skin, because they also carry the painted eyes.
- The mood comes from the body clip: a smile while she stands, coasts, or carves; an open mouth in the air; happy eyes in a dance; closed eyes on a bail. She blinks every 2.2 to 5 s, and she cheers for 1.2 s when a combo banks. The logic is pure (`src/render/face-anim.js`) with Vitest tests.
- Why: the Tripo mesh is one surface with the eyes and the lips painted on, so bones or shape keys have no lids or lips to move. A UV texture swap does not work, because the UV atlas cuts the face into many small islands.
- Limits: the decals are painted by a script, not by an artist. A light oval shows on the closed lids in a close-up. The follow camera keeps the face small, so the effect is mostly visible in close-ups and menus.

## 2026-11-03: Review fixes before the M1-02 merge

- Playwright evidence goes to `e2e/__screenshots__/`. One exception: `e2e/skater-anim.spec.js` writes the clip contact sheet to `assets/skaters/<name>/clips/`, which holds committed review evidence next to the asset. The five model views moved to `e2e/__screenshots__/nia-<view>.png`; the committed `assets/skaters/nia/views/` change only on purpose.
- The animation layer measures the yaw rate per simulation tick (`measureYawRate`), so a display above 60 Hz no longer flips the clip between coast and a carve on frames with no tick.
- The Q dance list names the Cross Step (clip `dance_crisscross`), which has a spec in `atl-dance-references.md`.

## 2026-11-03: The beat timing test runs last, with one retry (#63)

- Problem: the test "32 taps aligned to the audio clock..." in `e2e/beat.spec.js` measures timer jitter in ms. At a load average of 14 to 30 (other apps), it failed in about half of the full-suite runs, on `main` too (for example mean 6.15 ms, sd 4.15 ms). Every tap was within 60 ms in every run. A red suite that is normal hides real failures.
- Decision: the test has the tag `@beat-timing`. The `beat-timing` Playwright project runs only this test, with `retries: 1`. With 1 worker, Playwright runs the projects in config order, so it runs after the `chromium` project. Playwright does not document this order. The config does not use `dependencies`, because a failure in `chromium` then skips the beat test. The `chromium` project skips it. The 5 ms gates for the mean and the sd do not change.
- Why not a loose gate: the 60 ms game window can hide a clock drift of 20 to 50 ms, which a player feels. A gate that applies only at low load passes with no check on a busy computer, and the test then proves nothing.
- Why this does not hide real drift: a real drift fails both attempts. A pass on the retry shows as "flaky" in the Playwright output, so the noise stays visible.
- Evidence: the report `reports/m0-07-beat-alignment.json` records the attempt number and the 1, 5, and 15 minute load averages (`os.loadavg()`) before and after the taps. The retry writes over the report, so each attempt is also attached to the Playwright test result.
- Run only this test: `npx playwright test --project=beat-timing`.

## 2026-11-03: No building walls on the trail (#57)

- Problem: `scripts/build-block.mjs` extruded every OSM footprint as a solid from the ground. Roofs, raised sheds, and the "725 Ponce" edge made walls on the trail and on paths.
- Rule 1: the build skips a footprint with no walls down to the ground: `building=roof`, a `min_height` over 0, or a `building:min_level` over 0. On the BeltLine level this removes the canopies `w1365544414` and `w270468871` (one is on the Stone Mountain Trail).
- Rule 2: the build skips a footprint with `layer` over 0 when a trail or path center line goes into it. This removes the "Beltline Shed" (`w223977988`) over the paths `w431443667` and `w431795703`. A raised footprint beside the ways stays, for example New Realm Brewing (`w961282227`, `layer=1`).
- Rule 3: the build cuts a corridor (the trail half width plus 0.5 m) out of each footprint that the trail touches. The "725 Ponce" edge (`w741961703`) follows the trail and has no layer tag, so rules 1 and 2 do not apply to it. On this level, the cut changes only that footprint.
- Library: `polygon-clipping` 0.15.7 (2023-12-18) does the polygon difference. Only the build script uses it, so it is a dev dependency.
- Test: a Vitest test samples the full trail center line every 0.5 m with `createGeoGroundSampler` and finds no building.
- Not fixed: five paths still go into Ponce City Market (`w184803195`) and one footway goes into `w211747264`. These are raised walkways and building passages (`level=2`, `bridge=yes`, `tunnel=building_passage`). They are out of the scope of #57.

## 2026-11-03: Protect the ground under bridges with more than two points (#59)

- Problem: in `src/level/geo/terrain.js`, `gradeTrail` protected the middle half of each bridge segment. Near an inner joint of a bridge with more than two points, the grid had no protection, so the trail grade could move the ground under the deck.
- Fix: the new `bridgeMiddle` finds the nearest point on the full bridge polyline and its length along the line. The protected part is the middle half of the full length (0.25 to 0.75), within width / 2 + 2 m of the center line.
- Bridges with more than two points on the BeltLine level: `w741961708` (trail), `w182470306`, `w431443668`, and `w44851092` (paths), `w638312736` (sidewalk), and `w156324725`, `w29094065`, and `w29094070` (streets).
- Level data: the rebuild changes 61 terrain cells. The largest change is 2.35 m at about (-45, -717). The spawn height changes by 0.02 m.

## 2026-11-03: The toon material keeps the GLB material properties (#60)

- `toonMaterial()` now copies each property in `KEPT` when the source material has it: `map`, `opacity`, `transparent`, `alphaTest`, `side`, `vertexColors`, `emissive`, `emissiveIntensity`, `emissiveMap`, `normalMap`, `normalMapType`, and `normalScale`. Colors and vectors are copies.
- `toonSkater()` builds one outline hull for each skinned mesh and returns the list of hulls. A skater with separate skates or hair gets an outline on each part.
- Nia and Marcus each have one skinned mesh with a normal map. The toon material dropped the normal map before; now it keeps it. The change in the screenshots is small: on the BeltLine, 91 pixels (Nia) and 29 pixels (Marcus) of 42,000 in the skater area changed by more than 16 levels. Two runs of the same code differ by 5 to 16 pixels there.
- Known problem, not fixed here: `toonSkater()` replaces the face decal material of Nia (`attachFace()` in `loadSkaterModel()`), so the decal eyes and mouth do not show with `?toon=1`. This was true before this change.

## 2026-11-03: No absolute local paths in the landmark files (#62)

- Problem: the img2threejs tools write absolute paths (`/Users/<name>/Development/atl-arcade/.claude/worktrees/<w>/...` and `/Users/<name>/.img2threejs/releases/<sha>/img2threejs/...`). 60 tracked files in `landmarks/krog-street-market/` and `landmarks/ponce-city-market/` had them: the specs, `material-analysis.json`, `di.json`, the pass checks and reviews, the material evidence, and the generated factories in `src/`.
- Fix: `scripts/landmark-paths.mjs` writes a repository path relative to the landmark folder, an img2threejs skill path as `<img2threejs>/...`, and any other home folder path as `~/...`. A second run changes nothing.
- The writer is the img2threejs skill, outside the repository, so it does not change. `run_pass.sh` and `review.sh` of each landmark run `landmark-paths.mjs` on exit, also when a gate fails.
- Guard: `scripts/landmark-paths.test.js` fails when a text file in a landmark folder has an absolute home folder path. A manual img2threejs step that adds one must run `node scripts/landmark-paths.mjs landmarks/<name>`.
- The tools run in the landmark folder, so the relative paths resolve. `validate_sculpt_spec.py` and `orchestrate_passes.py check` give the same result before and after the change.

## 2026-11-03: Mobile playability is a top priority (#65)

- Decision: William made mobile playability the top priority for Skate ATL. The game must be playable on a phone browser (iOS Safari and Android Chrome) before Version 1 ships.
- This replaces the concept risk-table line "Desktop first, phones in version 2" (`docs/games/2026-10-30-skate-atl-concept.md`). The concept scope table also lists touch controls under "Full vision"; that line is replaced too.
- Effect on the milestones: the touch input and a phone quality tier move from M2-07 (#24) into M1 as their own issues. The rest of #24 (store and device polish) stays in M2.
- Effect on reviews: every audit and playtest from now on weighs a finding by its effect on a phone player first.
- Why: the goal is the official game of the City of Atlanta. Most residents reach a city link from a phone.
- Evidence and findings: `production/audits/2026-11-playability/REPORT.md`.

## 2026-11-03: Photo mode with a depth tilt-shift blur (#90)

- P or the PHOTO button (bottom right) opens and closes photo mode. Escape also closes it. While it is open, the fixed-step simulation and the skater animation stop, and the HUD hides. The map attribution stays on the screen.
- A free camera moves in photo mode: WASD or the arrows fly, E and Q go up and down, Shift goes fast, and a drag or the right stick turns it. It stays within 150 m of the place where photo mode opened and 0.4 m over the ground. On close, the follow camera places itself again; a fixed or an orbit camera gets its old pose back.
- The blur is a `ShaderPass` (`src/render/tilt-shift.js`) after the ink pass and before bloom. It reads the GTAO depth texture that the ink pass reads, so it adds no scene pass. A band (half height 0.08 in UV) stays sharp. Past the band the blur grows over 0.3 in UV, and 60% of it scales with the depth step from the focus depth (the depth at the band center). The blur is a 32-tap golden-angle disc with a radius of up to 14 px times the pixel ratio. A sample adds only as far as its own blur reaches, so the sharp band does not bleed out.
- The pass is disabled in normal play, and EffectComposer skips a disabled pass, so play has no cost and no blur. `src/render/post.js` does not change: `addTiltShift()` inserts the pass into the composer.
- The player moves the band with a slider, `[` and `]`, or the mouse wheel, and sets the strength with a slider or `-` and `=`.
- Save PNG draws one frame and reads the canvas in the same task, so the WebGL buffer still holds the frame (no `preserveDrawingBuffer`). The PNG holds the canvas only, with no HUD. The file name is `skate-atl-YYYYMMDD-HHMMSS.png`: no skater, score, position, or other player data.
- Low and phone tiers: photo mode, the free camera, and the PNG work; the sliders are disabled and a note says that the blur needs the high tier. The blur goes only on the full post chain (`post.kind === "full"`).
- The frame-time governor (#72) pauses while photo mode is open: the blur is slow and the game is stopped. If the governor drops the post chain, the blur goes with it.
- On a touch screen (#71) the PHOTO button moves to the top center, under the map attribution, and the touch controls hide while photo mode is open.
- The pure parts (band math, state, free camera, file name) are in `src/render/tilt-shift.js` and `src/ui/photo-mode.js` with Vitest tests. The DOM is in `src/ui/photo-panel.js`, with its CSS inside, so `src/shell.css` and `src/ui/hud.js` do not change.

## 2026-11-03: Phone render tier and the frame-time governor (#72)

- Tier: a new `phone` tier for a touch device whose short screen side is 900 CSS px or less (`isPhone()` in `src/render/quality.js`). A software renderer still gets `low`. `?quality=phone` forces it.
- Look: the low-tier scene (no shadow map, no sky dome, no facade kit, no interiors, no ground scans, no road markings) plus a lite post pass. The skater keeps the blob shadow. The toon ramp is on every tier already.
- Lite post (`createLitePost()` in `src/render/post.js`): one scene pass into a target with a depth texture, then one fullscreen pass for the ink and the halftone. Silhouettes come from the depth step. Creases come from the second difference of the inverse depth, which is near zero on a flat surface. No GTAO, no bloom, no MSAA, no normal buffer.
- Pixel ratio: each tier has a cap. Phone 1.5, low 2, high 2.
- Far terrain: the phone tier does not draw the coarse far-terrain drape. On the low tier the drape covers the skater near the spawn (#87).
- Governor (`src/render/governor.js`, pure, with Vitest tests): after a 3 s warmup it takes the median of 90 frame times. Over 25 ms (under 40 FPS) it steps down one rung: pixel ratio 1.5, then 1.25, then 1, then the post pass off. It waits 2 s after a step. It never steps up, so the frame rate cannot swing between two rungs. It runs on the phone and high tiers. The low tier is the floor of the playtest gate, so it has no governor. `?governor=0` turns it off, and `?govbudget=<ms>` sets the budget.
- Draw counts: `renderer.info` now counts the whole frame. Before, the post passes reset it, and `__atl.rendererInfo` showed only the last pass.
- Measurements (`reports/phone-tier/`), BeltLine spawn, governor off:
  - ANGLE Metal on an Apple M4 Max: phone 40–42 draw calls and 137k–139k triangles; high 151–157 calls and 424k–427k triangles. Both hold 60 FPS, so this GPU does not show the cost.
  - SwiftShader, Pixel 7 profile, no CPU throttle, load average 12–14: low 27.5 FPS (pixel ratio 2), phone 50.3 FPS (pixel ratio 1.5), high 1.9 FPS.
- Not verified: FPS on a real phone GPU. The acceptance target (median over 40 FPS on a mid-range phone) needs a real device.

## 2026-11-03: Touch controls for phones (#71)

- Scheme: a floating stick under the left thumb and four buttons under the right thumb. The stick steers left and right, pushes when up, and brakes when down. The buttons are JUMP (tap), GRIND (hold), GROOVE (style1), and SPIN (style2). A drag on the open part of the screen turns the camera.
- Why: the scheme maps onto the current controller input shape, so the simulation does not change. Auto-push was the other choice. It changes the push feel and needs a playtest first, so it waits for a human playtest on a phone.
- Code: `src/input/touch-map.js` is pure, with Vitest tests. `src/input/touch.js` is the overlay. It keeps the held state per pointer, so two thumbs work at the same time. `createInput({ touch })` merges the touch input with the keyboard and the gamepad, and `input.source` says "touch" while a thumb is down.
- When: the overlay shows on a touch screen (`maxTouchPoints > 0` or `(pointer: coarse)`). `?touch=1` forces it on, and `?touch=0` turns it off. On a touch screen the keyboard help is hidden, because the stick sits there.
- Sizes: JUMP is 88 px, GRIND 76 px, and the dance buttons 64 px. The stick base is 128 px. All stay inside the safe area (`viewport-fit=cover` and `env(safe-area-inset-*)`).
- Switch (R on the keyboard) has no touch button yet.
- Tests: `e2e/touch.spec.js` drives real touch events through CDP on the iPhone 15 and Pixel 7 profiles in Chromium. Touch only, the skater pushes, steers, grinds the straight rail, and jumps. `E2E_PORT` sets the e2e port, so two checkouts can run the suite at the same time.
- Not verified: a real phone, iOS Safari (WebKit is not installed), and the feel. A human playtest on a phone must tune `TOUCH` in `src/input/touch-map.js`.

## 2026-11-03: The skater slides along a wall (#58)

- Decision (the project owner, 2026-11-03): on a wall hit, the skater slides along the wall. A head-on hit still stops the skater (a bonk). This applies on the ground and in the air.
- Contact: a ring of 16 probes around the next position finds the side of a wall. The ring radius is `SKATE.bodyRadius / cos(π/16)` (0.306 m), so the polygon of probes contains the full body circle (0.30 m). The old probe looked only ahead (0 and ±35°), so on a shallow approach the body went up to 0.10 m into the radius before the probe saw the wall. On a ramp the ring is off, as the old probe was.
- Normal: 16 rays from the current position find the wall edge by bisection (10 steps). The rays reach 1.3 body radii plus the step, so the rays next to the nearest one also hit at a crawl. With a reach of 1 body radius, the heading after a slide was up to 0.19 rad off the wall line. The nearest edge point gives the side of the wall. When the two rays next to it also hit, the line through their edge points gives the horizontal normal, which is exact for a straight wall. At a corner the nearest point gives the normal.
- Response: the approach angle is the angle between the travel direction and the wall face. Above `wallBonkAngle` the skater bonks. Under it, the velocity goes onto the wall plane: the skater keeps the along-wall part, and the heading turns parallel to the wall. The scrub takes a share of that speed that grows with the approach angle, up to `1 - wallSlideKeep` just under `wallBonkAngle`. A graze keeps all of it.
- Clearance: after a slide the skater is pushed out to the ring radius + 1 mm from the wall edge line. If the slide position is not clear (a second wall or a step up), the skater bonks. A slide off an edge goes into the air, as a roll off an edge does.
- Slope: the slide moves the skater horizontally. The speed keeps its ratio to the horizontal velocity, so a slide on a slope does not lose the slope part of the speed. Thus the body never goes into a wall. A head-on approach still stops one body radius short.
- New constants in `src/sim/skate/constants.js`:

| Constant | Typical | Min | Max | Meaning |
|---|---|---|---|---|
| `wallBonkAngle` | 1.05 rad (60°) | 0.7 | 1.4 | approach angle above which a hit is head-on (a bonk) |
| `wallSlideKeep` | 0.8 | 0.5 | 1 | fraction of the along-wall speed kept just under `wallBonkAngle` |

- Measured on the greybox at 8 m/s: a 0.1 rad approach keeps 6.09 of 6.31 m/s, and the minimum clearance is 0.316 m. A 0.6 rad approach keeps 4.97 of 6.96 m/s. A 1.0 rad approach keeps 3.17 of 7.33 m/s. A 1.1 rad approach bonks.
- Cost: on the BeltLine level the ring and the slide take about 16 ground samples per tick (25 ms for 1200 ticks in Node).
- State: `wallSlide` is true on a tick where the skater slid. The controller stays pure and deterministic.
- Not done: real skaters have not reviewed the feel of the slide (AGENTS.md). The two constants are first guesses.

## 2026-11-03: The building source file (#88)

- Decision: each building in a level has one record in `data/buildings/<level>.json`. The record has the name, the address, the height, the floors, and the facade. Each fact has a `value`, a `source`, a `confidence` (`high`, `medium`, `low`, or `none`), and a `ref`. `scripts/building-sources.mjs` writes the file and `data/buildings/<level>.report.md`. `scripts/build-block.mjs` takes each height from the file, and stops with an error when a building has no record.
- Addresses: the open-data-atl catalog has a City of Atlanta address layer, "Official Address Points" (`dpcd-0a5785b3466a46c7a256f7fa9d628afd-0`, `https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/AddressPoint/MapServer/0`). `scripts/city-addresses.mjs` caches the 4455 current points in the box in `levels/beltline-eastside/raw/city-addresses.json`. A building gets the city address of the points inside its footprint. When one city address agrees with the OSM `addr:*` tags, the record uses that one; otherwise it uses the address with the most points. The OSM `addr:*` tags are the fallback. The tax parcel layer (25) is not used: it has owner names, and it adds no fact that the address points do not have.
- Result on `beltline-eastside` (1042 buildings): 813 city addresses, 51 OSM addresses, 178 with no address. 35 buildings have a city address and an OSM address that do not agree; the report lists them. The source file uses the city address for them.
- Heights: no City of Atlanta layer in the catalog has a building height. The zoning `HEIGHT` field is a limit, not a measure, so it is not used. The height order does not change: a researched override, the OSM `height` tag, the OSM `building:levels` tag, Overture (capped for small types), then the type default. 110 buildings keep the type default; none of them has an OSM tag or an Overture value.
- The M1-03 status line "1024 of 1045 heights are defaults" was out of date. The level on `main` already had 111 defaults of 1042, because the Overture heights were in the build.
- New override: FORTH Hotel (`w1229184074`, 800 Rankin St NE), 16 stories from Time Out (`https://www.timeout.com/atlanta/hotels/forth-hotel`), 52.2 m (was the 20 m hotel default). One height covers the full footprint, so the low part of the footprint is too tall. This is the only height change in the level.
- Facade: OSM has no `building:material` tag on this level. The facade fact is the game style from `chooseStyle` (source `style-rule`, confidence `low`). It is a game choice, not a surveyed material.
- Floors: 19 from OSM, 5 from research, and 1018 estimates from the height (confidence `low`).
- Level data: the rebuild changes the FORTH Hotel height and adds `stats.buildingSources`. The offline rebuild test fixture (`levels/beltline-eastside/level.json`) changes on purpose.

## 2026-11-03: First load on a phone (#74)

- Rapier WASM as a file: `@dimforge/rapier3d-compat` inlines its 3 MB WASM as base64 in `rapier.mjs`. The Vite plugin `tools/vite/rapier-wasm-file.js` swaps the base64 bytes for the URL of `rapier_wasm3d_bg.wasm`, which the same package ships. The build stops if the pattern does not match exactly once. The dev server does not prebundle Rapier (`optimizeDeps.exclude`), so the URL works in dev too. No new dependency.
- Bundle: `main.js` goes from 4,541 kB (1,742 kB gzip) to 437 kB (113 kB gzip). The WASM is 3,082 kB (1,188 kB gzip). Vercel compresses `application/wasm` (https://vercel.com/docs/compression).
- Early downloads: the physics WASM and the skater GLB start at the top of `src/main.js`, in parallel with the level JSON. `fetchSkaterModel()` reports the GLB bytes to the load screen. A test that started the GLB after the physics gave the same first frame and a later skater, so both start at once.
- Load screen: plain markup and inline CSS in `index.html`, so it shows at the first paint. `src/ui/loader.js` (pure part tested) moves the bar for the level, the physics, and the skater bytes, and fades the screen out after the first game frame.
- Check: `npm run loadcheck -- --gpu` serves `dist/` with `vite preview`, gzips `.wasm` as the host does, and opens the BeltLine level as a Pixel 7 on Fast 4G (9 Mbps, 60 ms) with a 4x CPU throttle. It prints the startup marks (`atl:level`, `atl:meshes`, `atl:scene`, `atl:physics`, `atl:world`, `atl:first-frame`).
- Result, 3 runs each, back to back, machine GPU, load average about 30:
  - Before: first game frame 5,943–6,023 ms, skater 8,893–8,957 ms, 5.51 MB, no load screen.
  - After: first game frame 5,806–5,921 ms, skater 6,351–6,457 ms, 5.08 MB, a load screen at about 0.2 s.
  - With the phone skater (1024 px), load average about 32: first game frame 5,527–5,777 ms, skater 5,658–5,878 ms, 4.00 MB.
- The 4 s target is not met. The marks show the path: `buildGeoMeshes` takes about 2.8 s of main-thread CPU at the 4x throttle, and the physics then waits about 1.1 s for the WASM compile. Next step: build the level meshes at build time or in a worker (#98).
- Phone skater: `assets/skaters/<name>/skater-1024.glb` has a 1024 px base color in place of 2048 px, with the same mesh, rig, and clips (William approved the `npx @gltf-transform/cli@4.1.1` step). Nia goes from 2,735,736 to 1,598,396 bytes, and Marcus from 2,071,416 to 1,493,828 bytes. A phone screen (the `isPhone()` test of the phone tier) or `?quality=phone` loads it, and `?quality=high` keeps 2048 px. The resize decoded the Draco meshes, so a second step compressed them again with the M1-01 quantization. The provenance files record both commands.

## 2026-11-03: The toon material keeps the face decal of Nia

- Problem: `toonSkater()` replaced the face decal material that `attachFace()` adds in `loadSkaterModel()`. The shader key went from `skater-face` to `skater-toon-rim`, so the decal eyes and mouth did not show with `?toon=1` (the default).
- Decision: `toonMaterial()` keeps the `onBeforeCompile` hook of the source material. The source hook runs first, then the rim hook. The shader key is `skater-face+skater-toon-rim`. A material with no hook keeps the key `skater-toon-rim`.
- Why a chain and not a new order: `attachFace()` runs in the loader and returns the `face.set()` handle. A chain keeps the loader and `toonSkater()` as they are, and it works for each future hook on a GLB material.
- The decal writes `diffuseColor` at `map_fragment`, and the rim reads it at `emissivemap_fragment`. Thus the rim also lights the decal colors. The toon shader has no roughness or metalness chunks, so those two decal lines do nothing there. The normal line works, because the toon material keeps `normalMap` (#60).
- Test hooks: `window.__atl.skaterModel.holdFace(eyes, mouth)` holds one face state, `freezePose(true)` stops the clips, and `materialKey` gives the shader key. The Playwright test `e2e/skater-face.spec.js` stops the idle clip, because the clip moves the head and changes the pixels with no decal.
- Evidence: `reports/toon-face/`.
- Review fix: `KEPT` also has `depthWrite`. For glTF alpha blend, GLTFLoader sets `transparent: true` and `depthWrite: false`, and the toon material now keeps both.
- Review fix: `toonSkater()` adds no outline hull to a skinned mesh with a transparent material, because the opaque hull shows through the mesh. Nia and Marcus have only opaque materials, so their hulls do not change.
- Review fix: the chained hook calls the source hook with the source material as `this`, so a hook that reads `this.userData` keeps its state. The rim state stays in `userData.rim` of the toon material.

## 2026-11-03: Phone layout: hints, HUD, credit, and landscape camera (#73)

- Hints: the start hint names the device ("Tap to start the beat" on touch). The developer hints (H for the colliders, `?view=orbit`) show only with `?dev=1` or `?debug=1`.
- HUD pills: each HUD text sits on its own dark pill (`--hud-pill`, black at 82%). The text keeps a WCAG contrast of 4.5:1 or more over a white or a black scene. The combo text uses a lighter pink (`#ff80c4`), because the brand pink gave 4.25:1 on the pill over white. All HUD text is 14 px or larger.
- Compact layout (`@media (max-width: 600px), (max-height: 500px)`): one top line with the short credit "© OpenStreetMap contributors", the score and the HUD column on the left, the beat pulse in the middle, and a smaller skater select on the right. Every position adds the safe-area inset.
- Credit: on a compact screen a tap on the short credit shows the full attribution text (OpenStreetMap, ODbL, Overture, USGS). A desktop shows the full text, as before.
- Review fix: the short credit sits on the dark pill, so the white text keeps 4.5:1 or more. It is 24 px high, the WCAG minimum for a tap target. A keyboard user can focus it, and `aria-controls` points to the full text. A tap or a click removes the focus, so the Space key still jumps.
- Landscape camera: a landscape screen 500 px high or less gets a 42 degree vertical field of view in place of 60 (`fovFor()` in `src/ui/layout.js`). The skater is about 1.5 times as tall, and the test measures at least 15% of the screen height at 844x390.
- Tests: `e2e/phone-layout.spec.js` checks at 390x844 and 844x390 that no item overlaps another with the longest HUD (a 3-move combo, the pending score, a move tag, and the balance meter), the font sizes, and the contrast.
- Not done: a fullscreen button and an orientation hint (MOB-9). A reduced-motion option (MOB-11). A shape cue for "style ready" (MOB-12). The skater select still reloads the page (MOB-13).
- Not verified: iOS Safari (WebKit is not installed) and a real notch or home bar.

## 2026-11-03: The camera tests check ticks, not frames

- Problem: two tests in `e2e/camera.spec.js` failed at a load average of about 20 to 60, on `main` too. They are "the follow camera keeps the skater on screen for a whole lap" and "the follow camera rides the quarter pipe without snapping or flipping". The recorder samples once every N render frames. A slow frame loop gives fewer frames, so `samples.length > 20` and `onRamp.length > 20` failed (11 to 20 seen). Each slow frame also carries up to 5 simulation ticks, so the camera jump per frame went over 1 m (1.46 m seen).
- Decision: the two tests sample every frame (`recorder.start(1)`) and check simulation ticks:
  - The largest tick gap between two samples is at most 5 (`maxStepsPerFrame` in `src/sim/fixed-step.js`), and the samples cover the lap less 10 ticks. Thus the off-screen check sees every rendered frame.
  - The on-ramp samples cover at least 80 ticks. The skater is on the ramp for about 95 ticks.
  - The camera jump limit is 1 m per tick, not per frame. The bug that this check found was a 12 m jump in 1 tick.
- Why not a loose gate: the intent does not change. Each frame that the player sees is checked for the skater on screen, and a camera snap still fails. Only the count of frames no longer depends on the machine.
- Game code: no change. `src/main.js` and the recorder stay as they are.
- Evidence: at a load average of 37 to 39, the old spec failed 4 of 4 runs (17, 19, 14, and 14 samples). At a load average of 120 to 45, the new spec passed 20 of 20 tests with `--repeat-each 5`.

## 2026-11-03: Score ceiling and move balance (#75)

- Problem: the multiplier was equal to the link count, with no repeat decay and no cap. A combo of n links of p points banked n × n × p. A held dance kept the combo open, so 120 s of one input held more than 1,400,000 points (GP-2 in `production/audits/2026-11-playability/fun-gameplay/FINDINGS.md`).
- Repeat decay: in one combo, the same move name earns 100 %, 50 %, then 25 % of its points (`COMBO.repeatDecay`). A repeat past the end of the list earns 0 points and does not raise the multiplier. The decay starts again in each new combo. The key is the move name, so each dance in the Q list and the E list counts as a different move.
- Multiplier cap: the multiplier is the count of links that earn points, from 1 to 10 (`COMBO.maxMultiplier`).
- Grind rate: `COMBO.grindPerSecond` goes from 60 to 300. The best dance (spin) earns 160 points in 0.6 s, or 267 per second. A grind earns `100 + 300 × t` points, which is more than 300 per second for each length `t`.

  | Grind | Old points (per second) | New points (per second) |
  |---|---|---|
  | 1 s | 160 (160) | 400 (400) |
  | 3 s | 280 (93) | 1,000 (333) |

- Ceiling: `src/sim/skate/balance.test.js` replays the three degenerate inputs from `fun-gameplay/balance-sim.json` for 120 s on flat ground. The test fails if the banked score plus the open combo is 25,000 points or more.

  | Input (120 s) | Links | Old points | New points | New multiplier peak |
  |---|---|---|---|---|
  | Push 1 s, then hold W+Q (`holdQLate`) | 99 | 1,470,150 | 789 | 3 |
  | Hold W, Q and E in turn each 1.2 s (`altQE`) | 148 | 3,432,120 | 21,380 | 10 |
  | Hold W, Space every 0.7 s (`hops`) | 171 | 1,462,050 | 264 | 3 |

- `altQE` stays the highest, because the Q and E lists have 8 dance names. The ceiling for one combo with only dances is 8 names × 1.75 × the dance points × 10. A grind, an air and the dances in one combo give more.
- Also: `comboTick` now reads the link window from its `k` argument (GP-10).
- Not verified: real skaters have not reviewed the balance. No human played the new numbers.

## 2026-11-03: The window rooms keep their look when the camera turns

- Problem: the windows on the BeltLine buildings flickered. The room hash in the facade shader (`src/render/geo-view.js`) used the view-space normal. Thus each camera turn gave a room a new color, light, blind, and furniture.
- Decision: the vertex shader makes a seed for each wall face from the model-space normal (rounded to 1/8) and the wall plane distance (rounded to 1 m, mod 97). A `flat` varying sends it to the fragment shader, so all pixels of a wall get the same exact value. The seed does not change with the camera.
- Second change: the blind slats (40 for each floor) fade to their mean where a slat is under about one pixel, so far blinds do not shimmer.
- Effect: two parallel walls of one building at the same plane distance (rounded) get the same rooms. This is rare and does not flicker.
- Shader cache key: `facade-v5`.
- Test: `e2e/window-rooms.spec.js` turns the fixed camera in place by 0.9 degrees and maps each pixel to the first frame. For a pure rotation the mapped pixel sees the same world ray. With the fix, 21 of 53568 pixels changed (0.04%). With the old shader, 2696 of 53568 pixels changed (5.03%), and the test failed. The limit is 0.5%.
- Not changed: the ink lines on thin far ledges (`src/render/post.js`) can still shimmer a little.

## 2026-11-03: The minimap (#86, #108)

- Decision: the minimap is a 2D canvas, not a second 3D render. `src/ui/minimap.js` draws the level one time to a base image: the park areas, the strips (sidewalk, street, path, and the trail last), and the building footprints. Each frame draws only the base image part around the skater, with a move and a turn, then the landmark icons and the skater arrow.
- Pure math: `src/ui/minimap-math.js` converts world coordinates to map pixels (`worldToMap`), makes the view transform for north up and heading up (`viewTransform`), and finds the icon points (`mapLandmarks`). Vitest tests it in `src/ui/minimap-math.test.js`.
- Base image: 1 px per meter, and the largest side is 2048 px or less. The Eastside level gives 971x1946 px. The view shows 240 m across.
- Draw cost: the map draws again only when the skater moves by 0.25 view pixels or more, or turns, or the mode changes (`needsRedraw`). A still skater gives no draws.
- Icons: the landmark buildings of `src/level/geo/landmarks.js` get a gold disc with initials ("PCM", "KSM"), and their footprints are gold. Each named park gets a green triangle. The skater is a white arrow. The trail is the widest line (9 m or more). Thus no item shows by color only. The canvas has `role="img"` and an `aria-label` that names the level, the mode, and the icons.
- Controls: the "N" button and the N key change north up and heading up. In heading up, an "N" mark on the edge shows north. The "×" button and the M key hide the map, and a "Map" button shows it again. The choice stays in `localStorage` (key `atl.minimap`). `?minimap=0` leaves the map out, and `?minimap=north` or `?minimap=heading` sets the mode.
- Layout: a desktop shows a 180 px map in the bottom right corner. The key help line on the bottom left gets a max width, so the map does not cover it. A touch screen shows the map in the top right corner under the skater select. A compact screen shows it 76 px from the top, with a size of `clamp(72px, 100vh - 268px - safe areas, 120px)`, so it ends above the touch buttons. Every position adds the safe-area inset.
- Only a geodata level has the map. The greybox has no footprints or trail.
- Tests: `e2e/minimap.spec.js` checks the trail pixels, the arrow, the icons, the keys, the saved choice, no draws for a still skater, and no overlap with the touch controls, the HUD, the credit, or the skater select at 390x844 and 844x390. `e2e/phone-layout.spec.js` also lists the map in its overlap check. Screenshots: `e2e/__screenshots__/minimap-desktop.png`, `minimap-desktop-close.png`, `minimap-phone-portrait.png`, and `minimap-phone-landscape.png`.
- FPS: not verified against the 55 FPS gate. At a load average of 15 to 19 (other sessions on the same machine), `npm run playtest:beltline` gave a median of 29.9 FPS with `?minimap=0` and 29.9 FPS with the map. Thus the map adds no measurable cost, but the gate run must be done again on an idle machine. Reports: `reports/playtest-beltline-eastside-2026-11-04-01-11-17.json` (no map) and `reports/playtest-beltline-eastside-2026-11-04-01-12-03.json` (map). In the browser, one map draw took 0.1 ms or less (p95 of 300 draws), and the base image took 3.5 ms one time.

## 2026-11-03: The far terrain uses the mesh bounds, not the tile square (#87)

- Problem: on the low tier, the coarse far terrain covered Nia to the waist at the BeltLine spawn. With `?farterrain=0` she showed in full.
- Root cause: `buildGeoMeshes()` puts an item in the 125 m tile of its first point. A long strip runs far out of that tile. The far mesh of tile `1,-3` spans x -153 to 361 and z -375 to 794, and its trail runs under the spawn (337.07, -1.3). `update()` measured the distance to the 125 m tile square, which is 264 m from the spawn. Thus it showed the coarse drape of that trail at the spawn. The coarse drape follows a 16 m terrain and sits above the exact ground that the physics uses.
- Decision: `update()` measures the distance from the camera to the x/z bounds of the near and far meshes of the tile (`meshBounds()`, `unionBounds()`, `boundsDistance()` in `src/level/geo/geo-mesh.js`). A tile shows its far mesh only when no vertex is within `FAR_TERRAIN_DISTANCE` (60 m) of the camera.
- Why not a render order or a depth offset: the drape really sits above the near ground. A draw order change hides the symptom at the spawn but not on other slopes.
- Cost: a tile with a long strip stays near for a longer distance. At the spawn, more than half of the tiles still use the far mesh (Vitest checks this).
- Test hook: `window.__atl.level.terrainLod` gives `{ tiles, far, nearestFar }`. `nearestFar` is the distance from the camera to the nearest far tile.
- Tests: `src/level/geo/geo-mesh.test.js` checks the bounds and tile `1,-3`. `e2e/far-terrain.spec.js` opens the spawn on the low tier, checks `nearestFar > 60`, and saves `e2e/__screenshots__/far-terrain-spawn-low.png`. Not verified: the `nearestFar` check against the old distance test. The old `geo-view.js` has no `terrainLod` hook, so the spec fails there before that check.
- Evidence: `reports/far-terrain/spawn-low-before.png` and `reports/far-terrain/spawn-low-after.png`.

## 2026-11-03: Street-sign names from the City of Atlanta centerlines (#78)

- Problem: the audit (#65, GEO-1 and GEO-4) found sign names that do not match the city data. Two signs said "Closed Lake Ave", an OSM mapper note on way 586825917.
- Source: the City of Atlanta street centerlines, open-data-atl catalog `atl-street-centerlines`. `scripts/city-streets.mjs` writes `levels/beltline-eastside/raw/city-streets.json` (199 segments, fetched 2026-11-03). The build runs offline after the fetch.
- Data model: the strip `name` stays the OSM name (ODbL data). The build adds `signName` (the name on the sign) and `nameSource` (`city`, `reviewed`, or `osm`) to each named street strip. The level attribution adds "Street names: City of Atlanta Department of City Planning".
- Rules (`scripts/street-names.mjs`), in this order for each named street strip:
  1. A city line within 40 m has the same name. The sign uses the OSM name.
  2. A city line within 40 m has the same name without the quadrant, or a spelling one letter apart. The sign uses the city label.
  3. The OSM name is in `REVIEWED`. The sign uses the OSM name.
  4. One city line within 15 m runs along 60% or more of the strip. The sign uses the city label.
  5. No city line matches. The OSM name is the fallback, with `nameSource: "osm"` and no `signName`. A sign does not show a fallback name. The crosswalks at that intersection stay.
- Capitals: the sign keeps the OSM capitals where the words are equal. Thus "Ralph McGill", not the city "Ralph Mcgill", and "Ponce de Leon", not "Ponce De Leon".
- Reviewed name: "John Lewis Freedom Pkwy NE". The city renamed Freedom Parkway in 2018, but the city layer still has "Freedom Pkwy North NE" and "Freedom Pkwy South NE". The audit confirms the new name.
- Changed sign names (old, then new):

  | Old name | New name | Rule | OSM ways |
  |---|---|---|---|
  | Closed Lake Ave | Brickworks Cir NE | 4 | w586825917 |
  | Brickworks Cir | Brickworks Cir NE | 2 | w218549750, w218549751, w218549752, w586825916 |
  | Bishop Way NE | Bishops Way NE | 2 | w243830594 |
  | Austin Ave NE | Lake Ave NE | 4 | w9246448 |
  | Ralph McGill Blvd | Ralph McGill Blvd NE | 2 | w28688645, w630643907 |
  | Patterson Way NE | Patterson Way | 2 | w232548873 |
  | Inman Ln | Inman Ln NE | 2 | w211062133 |
  | Inman Way | Inman Way NE | 2 | w211062141 |
  | Irwin Pl | Irwin Pl NE | 2 | w243830604 |
  | Kendall St | Kendall St NE | 2 | w93212526 |
  | Montag Cir | Montag Cir NE | 2 | w9239208 |
  | Village Pkwy | Village Pkwy NE | 2 | w562435149, w562435152, w93727868 |
  | Randolph St NE | Glen Iris Dr NE | 4 | w41545411, w41545414 |
  | Rankin St NE | Dallas St NE | 4 | w1229184077 |
  | Dallas St NE | Morgan St NE | 4 | w1466674340 |

- The last 3 rows are short OSM pieces on the same line as a longer city segment with the other name. The city layer puts the name change at a different node than OSM. The city layer is the source, so the city name wins.
- OSM fallback names with no sign: Prospect Way NE (w232548874), Garden Park Dr (w182470294), North Angier Ave NE (w1187794330), and Dallas St NE (w496236757). The city layer has no line near these strips. Ford Pl NE (w9277776) is a service road and has no sign in any case.
- Result: 95 signs before, 88 after. 24 old corner pairs went and 17 new pairs came. Examples: "Brickworks Cir / Closed Lake Ave" and "Closed Lake Ave / West Ashland Ave NE" became one sign "Brickworks Cir NE / West Ashland Ave NE". The false corner "Ralph McGill Blvd / Ralph McGill Blvd NE" became "Ralph McGill Blvd NE / Fortune St NE". "Austin Ave NE / Elizabeth St NE" became "Elizabeth St NE / Lake Ave NE".
- Test: `scripts/street-names.test.js` checks every sign name of the level against the city labels. Only a name in `REVIEWED` can differ. It also checks each rule on small fixtures. The byte-for-byte rebuild test in `scripts/build-block.test.js` covers the new raw file.
- Not done: the sign blades are still too small to read on a phone (GEO-5, #24).

## 2026-11-03: Goals, the run timer, and the results screen (#15)

- A run lasts 2:30 of sim time (`RUN_TIME = 150`). The clock counts fixed-step ticks, not wall time, so a slow frame does not shorten the run.
- When the time is out, an open combo can finish. The run ends when the combo banks or bails, or 10 s after the time (`overtime`). This is the THPS rule: the last combo counts.
- After the end the skater gets no input and rolls to a stop. The results screen shows. Enter or "Skate again" starts a new run. `resetSkater()` and `runScript()` also start a new run, so the old tests keep a full clock.
- `?run=free` turns the timer and the goals off.
- The goal module is `src/sim/skate/goals.js`. It is pure and reads the run. It does not change the score, the repeat decay, or the multiplier cap of #75.
- The goals are data per level: `src/level/goals.js` for the greybox, and `levels/beltline-eastside/goals.json` for the Beltline. The level build does not write `goals.json`. Each level has 5 goals: a score target, a combo target (one banked combo), 3 fact cards, and 2 named gaps.
- The medal comes from the score only: bronze, silver, and gold thresholds in the goal data. `computeResults(json, def)` makes the medal and the goal list from the run JSON only (`goalsJson`). The Playwright test compares the screen with that function.
- A named gap is a circle zone in x and z. The skater must be in the air inside the zone, then land with no bail, after 0.2 s of air or more (the same minimum as a scored hop). Optional `from` limits the take-off kind. Optional `landing` is a second zone for the landing point.
- Greybox gaps: "Plaza Stair Gap" (over the 4 stairs, land on the sidewalk past them) and "Quarter Pipe Air" (air off the ramp). Beltline gaps: "Freedom Parkway Underpass Hop" and "Stone Mountain Trail Bridge Hop". Both are hops on the trail under the real bridges (OSM strips with `bridge: true`). The Beltline level has no rails yet, so a gap there is a hop.
- Fact cards: the goal module reads only a count. `main.js` keeps a set of card ids. The fact cards of #17 must call `collectFactCard(id)` in `main.js` (also `window.__atl.goals.collectCard(id)`). A second call with the same id counts once. Card content and placement are for #17.
- The results panel sits under the minimap (z-index 4 under 5) and leaves the minimap column free: 212 px on the right on a wide screen, 146 px on each side on a compact landscape screen, and 212 px at the top on a phone in portrait. The touch controls hide while the panel shows. The replay button is 48 px high.
- The HUD timer sits next to the score on its own pill. It turns yellow for the last 10 s.
- The targets and the medal scores are first guesses. Nobody played them for balance, and real skaters have not reviewed the goals.

## 2026-11-03: Fact cards from the open-data-atl API (M1-07, #17)

- Each level can have a `facts.json` next to its `level.json`. The BeltLine level has 3 cards on the Eastside Trail. Each card names a dataset, one `query_dataset` input, and a one-line template. `level.json` does not change, so the byte-for-byte rebuild test does not change.
- The client is `src/facts/client.js`. It calls `POST /api/tools/query_dataset` on `https://agenticatl.ai`, fills the template from the rows, and runs the content review. The `fetch` function is injected, so Vitest and Node use the same code.
- Offline fallback: `src/facts/fixtures/beltline-eastside.json` holds the recorded responses. The game shows the fixture text at the first frame. A live text replaces a card text only when the live call works and the text passes the review. The game never waits for the network.
- The open-data-atl site sends no CORS header. Thus a browser on another origin cannot read the live response. The dev server proxies `/oda-api` to the site. A production build calls the site directly, and the browser blocks the call, so a production build uses the fixture until the site allows the game origin. This is a follow-up for the open-data-atl repository.
- Playwright uses the fixture: with no `?facts=` parameter, a browser with `navigator.webdriver` set uses the fixture. `?facts=fixture`, `?facts=live`, and `?facts=0` set the mode. The e2e test checks that no request goes to the site.
- Content review (AGENTS.md political rules), applied in code and by hand:
  1. The client does not query the crime, pedestrian crash, or traffic counter datasets.
  2. A card text with a crime, police, danger, decline, or stigma word fails the review.
  3. A card text is one line of 110 characters or fewer.
  4. Each card links to its dataset page on the open-data-atl site.
- The 3 cards, reviewed by hand on 2026-11-03:

  | Card | Text | Dataset |
  |---|---|---|
  | eastside-neighborhoods | The Eastside Trail links 3 neighborhoods here: Inman Park, Old Fourth Ward and Poncey-Highland. | atl-neighborhoods |
  | freedom-park | Freedom Park covers 124 acres of city park land. | atl-parks |
  | marta-rail | Inman Park-Reynoldstown MARTA rail station is within a mile of the trail. | marta-rail-stations |

- Collection: the skater collects a card within 2.5 m in the ground plane and 4 m in height. A card adds 250 points to the banked score, outside the combo, so a bail does not lose them. The pop-up shows the text for 2 s and does not pause play. The values are in `FACT_CARDS` in `src/sim/fact-cards.js`.
- Run state: `run.cards.count` is the number of cards collected in this run, and `window.__atl.facts.collected` gives the same number. The goal list (#15) reads it. A new run (`resetSkater`) starts at 0.
- Layout: a desktop shows the pop-up at the top middle, between the HUD column and the skater select. A phone in portrait shows it under the minimap. A phone in landscape shows it narrow, between the touch stick and the buttons. The e2e test checks for no overlap at 1280x720, 390x844, and 844x390.
- To record the fixture again, run `node scripts/fetch-facts.mjs`. Then review the printed texts by hand before you commit.
- The greybox level has no cards, because it is not a real neighborhood.

## 2026-11-03: Landmark signs and mural words (#79, #80)

Audit #65 found four problems: GEO-2, GEO-3, GFX-4, GFX-5, and EDU-2.

### Krog Street Market letters (GEO-3, GFX-4)

- Cause: the north wing of the Krog Street Market footprint (`r5413435`) goes 6 m east of the main east wall. The model stood 5 m south of that wing, so the wing box covered the right half of the "MARKET" card.
- Fix: a "ground" landmark now has `model.front` (the box in front of the wall that the model fills). `landmarkPlacements()` tries the anchors best first and takes the first one whose front box is out of every building box. The model also turns square to the wall (yaw 1.474 rad, not 1.571 rad), because the east wall is not exactly north-south.
- Result: the model moved 8 m south, from z = 849.2 to z = 857.2. "KROG STREET MARKET" reads in full.
- The letters face east, to the parking drive, as in `landmarks/krog-street-market/ref/reference.jpg`. The Eastside Trail is 110 m west, on the other side of the building and Krog Street. Thus the letters read in full from the parking drive, not from the trail. A change of the facing needs a new photo, and is not part of this fix.

### Ponce City Market rooftop sign (GEO-2)

- The sign now stands 45 m west of the tower and 12 m south of it, and faces south. Before, it stood on the east edge and faced east.
- Sources (Wikimedia Commons). Both photos look north from Historic Fourth Ward Park:
  1. "Ponce City Market from Historic Fourth Ward Park", Tyler Lahti, 2020, CC BY-SA 2.0. https://commons.wikimedia.org/wiki/File:Ponce_City_Market_from_Historic_Fourth_Ward_Park.jpg (this is also `landmarks/ponce-city-market/ref/reference.jpg`).
  2. "View of Ponce City Market across the stormwater detention pond at Historic Fourth Ward Park, December 2015", Marc Merlin, CC BY-SA 4.0. https://commons.wikimedia.org/wiki/File:View_of_Ponce_City_Market_across_the_stormwater_detention_pond_at_Historic_Fourth_Ward_Park,_December_2015.jpg
- A third photo shows the same sign close up: "Ponce City Market large neon sign Midtown, Atlanta, GA", Williamcasey, 2016, CC BY-SA 4.0. https://commons.wikimedia.org/wiki/File:Ponce_City_Market_large_neon_sign_Midtown,_Atlanta,_GA.jpg. It shows the sign on the roof of a lower wing, over the market entrance. This photo does not show the direction.
- The repository keeps no copy of photos 2 and 3. The links and the licenses are the record.
- The offset (45 m, 12 m) is an estimate from the photos, not a survey. The photos show red letters on an open steel frame. The game sign is still yellow letters on a dark panel. That is a different issue.

### Mural words (EDU-2)

- Before, the mural word came from a hash of the building id. 6 of 39 BeltLine murals said "SWEET AUBURN", and "KROG", "PONCE", "INMAN", "O4W", and "OLD 4TH WARD" went on any wall.
- The level has no neighborhood boundaries, so the game cannot know the neighborhood of a wall. Thus the atlas words now name no neighborhood: "DOGWOOD", "FLOW", "STRIDE", "SUNSHINE", "GOOD VIBES", and "SMOOTH" replace the 6 place words.
- "ATL" and "A-TOWN" name the city, and "BELTLINE" names the trail. They stay, because every mural is in the city and faces the trail.
- When the level gets neighborhood boundaries from open-data-atl, a mural can name its own neighborhood.
- Test: `src/render/murals.test.js` checks the words against a list of the neighborhood names near the trail.

### Facade kit over murals (GFX-5)

- Before, sills, storefront piers, and the belt course went through 35 of the murals.
- `muralWalls()` now returns the wall index and the span along the wall. `wallDepth()` puts no sill or pier within 0.3 m of a mural.
- The belt course is one ledge around the building. A cut in that ledge is complex, so on a storefront style the mural now starts above the belt course and the awnings. `BELT` and `awningHeight()` moved to `styles.js`, so the murals and the kit use the same numbers.
- Test: `facade-kit.test.js` samples every kit triangle near a mural every 0.2 m. No sample can be in the box in front of a mural. The test found 35 murals before the fix and 0 after.
- Not done: the 39 murals use 13 atlas cells at 256 px (GFX-6).

### Evidence

- `e2e/landmark-signs.spec.js` saves a screenshot of each sign and checks its pixels. The test fails on the old code (no card colors at the "MARKET" end, and the PCM sign edge-on) and passes on the new code.
- Before and after screenshots: `reports/2026-11-79-80-signs-murals/`.

## 2026-11-03: All props in one BatchedMesh, with an LOD for each prop (#89)

- Decision: the 3392 BeltLine props (trees, lamps, roof units, benches, bins, water towers) are one `THREE.BatchedMesh` (`src/render/prop-batch.js`). Each prop is one instance. With `WEBGL_multi_draw` the batch is one draw call. Three.js culls each instance against the view and the shadow camera.
- LOD: each prop picks LOD0 under `PROP_LOD0_DISTANCE` (60 m), LOD1 under `PROP_DRAW_DISTANCE` (200 m), or hidden, by its own distance from the camera. `setGeometryIdAt()` changes the shape. Before, the center of a 50 m tile picked the LOD for all props in the tile.
- Why not `InstancedMesh`: one instanced mesh for each kind and LOD gives about 34 draw calls (17 kinds), and Three.js culls an instanced mesh as one object, so every instance draws. The merged tiles took 7 to 16 calls. The batch takes 1.
- Wind: the prop material reads the world position from the batching matrix, and turns the world wind move into the template space with the inverse of the matrix (a yaw and a uniform scale). The trees sway as before.
- Normals: a kit template with no normals gets its own computed normals. Before, a tile with one such prop computed the normals of every prop in the tile.
- Unchanged: the colliders (`env.props`), the prop templates, the toon material, and the ink outlines.
- `__atl.level.props` now gives `instances`, `kinds`, `drawn`, and `lod0`. The `tiles` and `lod0Tiles` fields are gone.
- Measured (`reports/prop-perf/`, SwiftShader, 3 runs for each build, load average 9 to 27): the draw calls decrease by 6 to 15 (12% to 54%) on the low and phone tiers. The prop triangles decrease by 8% at the spawn and by 65% on the overview camera.
- Not verified: a decrease of the 90th percentile frame time. The effect is smaller than the run-to-run spread on this harness. Without any props the spawn view still draws 48 calls and 116,816 triangles, so the props are not the main cost of a frame. The phone tier holds a median of 59.9 FPS on all four cameras, before and after. The low tier does not hold 55 FPS at the spawn on either build at this load.
- High tier (ANGLE Metal, with the local markings hang fix on both builds): the draw calls decrease by 12 to 30 (8% to 32%), because the props also draw into the shadow map. The GPU holds 60 FPS on both builds.
- Not measured: a real phone GPU.

## 2026-11-03: The road markings match the street width by the sign name (#78 follow-up)

- Problem: after #123 the high tier (`quality=high`) did not load. `streetIntersections()` now gives the city sign names (`signName`), but `roadMarkings()` still found the street width by the OSM `name`. For a renamed street the width was `-Infinity`, so the crosswalk bars went to infinity. `drapeMesh()` then looped over an infinite range of terrain cells. The low tier has no road markings, so the low-tier tests did not find it.
- Fix: `widthOf()` in `src/level/geo/markings.js` matches `signName ?? name`. `drapeMesh()` in `src/level/geo/terrain.js` skips a triangle with a position that is not finite, so one bad triangle cannot stop the load.
- Measured: the BeltLine markings have 8476 triangles again (3192 with the defect). The high tier loads to 5 frames in 10.4 s in headless Chromium (before: no load in 105 s).
- Tests: `src/level/geo/markings.test.js` checks that each marking position and tile is finite on the real level, and that a street with a city name different from its OSM name gets finite crosswalks. Both tests fail without the fix.

## 2026-11-03: Poly Haven props

- Source: Poly Haven (https://polyhaven.com) has CC0 models, textures, and HDRIs. `docs/assets/polyhaven-shortlist.md` lists the assets that fit the game, the gaps (no cone, bollard, ramp, rail, or sign), and the assets that the political rules keep out.
- Format: a Poly Haven model becomes a toon prop in the format of `assets/kit/street-kit.glb`: vertex colors (COLOR_0), no textures, no materials. The texture gives a few flat colors (k-means), with the brightness range of the kit palette. This keeps the cel look and keeps the files small.
- First prop: `assets/props/painted_wooden_bench/painted_wooden_bench.glb`, 630 triangles, 30,804 bytes. `loadKitTemplates()` loads it. No Draco, because the kit loader has no Draco decoder.
- Not done: the bench is not in a level, and it has no LOD1. The Blender MCP add-on is at protocol 7 (the server expects 15), so its Poly Haven import is off. The models came from the Poly Haven API.

## 2026-11-03: Trees from the City of Atlanta canopy, six species, street rows, and card LOD (#137)

- Source: the City of Atlanta "Urban Tree Canopy 2018" raster (open-data-atl catalog `dpcd-9215c7539c5d4d13bdaf4d4627b020e5-4`). `scripts/city-canopy.py` cuts its zoom 16 tiles to a 2 m grid in level coordinates (`levels/beltline-eastside/canopy.json`, 79,687 bytes). 22.7% of the box is canopy. See `docs/sources.md`.
- Why not tree points: OpenStreetMap has 0 `natural=tree` and 0 `tree_row` in the box (2026-11-03). The catalog has no street tree inventory. Thus the raster gives the position and the crown size of each canopy tree. It does not give the species.
- Species: six toon species in `src/level/geo/trees.js`: oak (willow oak), pine (loblolly), magnolia, crape myrtle, dogwood, and a street tree (red maple). Each has a spring, summer, and fall color (`?season=spring|summer|fall`, summer is the default). A seeded hash picks the species from the mix of the setting (`SPECIES_MIX` in `src/level/geo/tree-placement.js`): street rows, trail rows, parks, and yards.
- Canopy trees: a point each 7 m on a seeded, jittered grid gets a tree when the raster shows canopy there. Outside a park, 60% of the points get a tree, so the parks are densest. The crown radius (3 m to 7 m) is the largest radius that the raster fills to 55%. 3772 canopy trees; Historic Fourth Ward Park and Freedom Park each get more than 30.
- Rows: the trail and sidewalk rows keep their spots from `props.js`, so the lamps, benches, bins, and signs do not move (a test compares them). Each row tree gets a species and a kind from its setting. 209 of the 1887 row trees are left out, because no species and scale keep the clearance rules there. Their spots stay taken.
- Clearance: no trunk on a street, sidewalk, path, the trail, a bridge, or in a building. A crown with its lowest leaves under 2.4 m does not hang over a skate surface. No crown goes into a building. `fitTree()` makes the tree smaller (to scale 0.75) or swaps it for a high-crown tree. The `clear` height of each species is the measured lowest leaf; a test checks it.
- LOD: LOD0 is the full puff tree (under 60 m). LOD1 is 3 crossed cards: a crown silhouette and a trunk, 60 triangles, with normals from the crown center so that the toon ramp shades it round. All trees stay in the one prop batch from #89, so the draw calls do not change. The wind sway works on both LODs.
- The canopy grid is a file of its own, not part of `level.json`. `src/level/levels.js` adds it to the level and adds its credit to the attribution. Thus a rebuild of `level.json` (for example by #131) does not drop it.
- Measured (`reports/trees/`, `scripts/prop-perf.mjs`, before = `origin/main` 4e64481). The draw calls do not change on any tier or camera. Triangles in one frame:
  - Low tier (SwiftShader): spawn 124,874 → 134,138 (+7.4%), overview 113,689 → 115,461 (+1.6%), street 94,921 → 95,525 (+0.6%), park 99,471 → 108,703 (+9.3%).
  - Phone tier (SwiftShader): spawn 164,129 → 173,393 (+5.6%), street 127,344 → 127,948 (+0.5%), park 139,090 → 148,322 (+6.6%). Calls 50, 50, 55 (the test budget is under 80).
  - High tier (ANGLE Metal): spawn 580,605 → 625,181 (+7.7%), street 483,281 → 484,489 (+0.2%), park 582,741 → 601,205 (+3.2%). The GPU holds 59.9 FPS on both builds.
- Not verified: the median FPS of 55 on the harness. The load average was 13 to 23 in every run. Both builds gave the same median (phone spawn, 3 runs: 30 FPS and a p90 of 50 ms on each build). Not measured: a real phone GPU.
- The high tier loads to 7 frames in 11.1 s headless (`scripts/high-tier-check.mjs`, load average about 9).
- Props at load: `levelProps()` takes about 165 ms in node (79 ms before), for 6955 props (3392 before).

- In the level: on the trail, each second pair of benches is the painted bench (`bench_painted` in `src/level/geo/props.js`, solid radius 0.65 m). The BeltLine level has 14 kit benches and 13 painted benches. `loadPropTemplates()` in `src/render/geo-view.js` adds the GLB to the kit templates.
- Not done: the painted bench has no LOD1, so it shows the 630-triangle shape at all distances. The Blender MCP add-on is at protocol 7 (the server expects 15), so its Poly Haven import is off. The models came from the Poly Haven API.

## 2026-11-04: The pbr look, leaf cards, and the art loop (rounds 0 to 2)

- Why: the user wants the city to reach the quality of two Three.js/WebGPU city demos (teleoperator.mindblown.ai, greggman.github.io/gen-city-auto), even if the cel look goes. The F-16 demo uses the same data pipeline as Skate ATL (OpenStreetMap footprints, USGS 3DEP terrain, city tree data, hand-built landmarks), so the gap is in the light, the surfaces, and the content, not in the data.
- The look switch (`src/render/look.js`): `?look=toon|pbr`. The high tier gets pbr; the phone and low tiers keep toon. Pbr: standard materials (roughness for each surface, no metal), an environment map made from the sky dome, Neutral tone mapping, smooth glass in the facade shader, and darker wall bases. AgX was tried first and made the art colors gray. The pbr look has no halftone dots. `__atl.tuneLook({...})` tunes the light from the console.
- Spike result: the light change alone gave a small visual change (`reports/2026-11-04-pbr-spike/`). The gap is the content.
- Leaf cards (`src/level/geo/trees.js` `CARDS`, `src/render/leaf-cut.js`): in the pbr look a near tree gets 18 small quads on each crown puff. The shader cuts 7 leaf ellipses out of each card. The shadow pass and the GTAO normal pass use the same cut, so the cards do not cast square shadows or draw square ink lines.
- Facade variation (pbr only): each window pane gets its own glass tone and roughness, and each floor gets a thin slab band.
- Frame rate, one sample on an Apple M4 Max at the Ponce City Market view: pbr 48.8 FPS, toon 51.2 FPS, both 131 draw calls.
- The art loop (`docs/art-loop/`), after gen-city-auto (MIT): a lab (`src/level/geo/lab.js`, `e2e/lab.spec.js`, `?lab=building&kind=&pick=&labview=`) renders one building at 6 fixed views; a judge agent scores it on 9 criteria; a director agent writes a ranked change list; an engineer agent builds the top changes. The lab moves the camera when a footprint blocks the view, raises the eye over a ground rise, looks at the kit's shop-front wall, and puts the sun shadow box at the camera target in a fixed view (before, the box followed the skater, so a fixed view far from the spawn had no shadows).
- Scores for brick-loft pick 0 (w270469054): round 0 3/10, round 1 4/10, round 2 5/10 (`docs/art-loop/reports/`). Part of the gain in rounds 1 and 2 came from the lab fixes, not the art.
- Not verified: no person looked at the rounds in a browser; the lab has only the day sky; the judge's round 2 regressions (window speckle, near-white grass, dashed cornice) are open.

## 2026-11-04: Art loop round 2 (brick-loft): the shade light, the aprons, and the front wall

- Cause of the blue-gray trim (r1 judge, fix 1): in shade the sky environment map is the only strong light. The sky colors are a saturated blue in linear values (zenith 0.03, 0.27, 0.81), and the ground disc was dark (0x6b6a5c). So the light on a wall in shade had blue / red of about 2.6, and the cream trim got blue / red of about 2.3. The hemisphere light is too weak in the pbr look (0.15 / pi) to be the cause.
- Fix (`src/render/look.js`): the environment map uses a copy of the sky material with 45 % of the sky chroma (`ENV_SKY.saturation`) and a ground disc at the value of a sunlit pavement (`ENV_SKY.ground` 0xa89880), as a stand-in for the warm bounce light. `ENV_LIGHT.wall` is 0.8 and the facade material now uses it, so the shade value of a wall stays within 3 % of the old value. The pbr hemisphere sky color is 0xe6eef6; the toon look keeps 0xcfe8ff. The visible sky dome does not change. The model (`wallSkyLight()`) gives cream in shade blue / red 1.03; `src/render/look.test.js` checks at most 1.05.
- Aprons (`src/level/geo/aprons.js`): a concrete strip of 1.8 m on each wall of a storefront building, and 3.5 m on the front wall, in the sidewalk color, 0.012 m over the ground. The view drapes it and merges it into the surface tiles. It is render-only and on the high tier only (`?aprons=0` turns it off). BeltLine: 4,506 triangles before the drape, 42,374 after.
- Front wall (`frontEdge()` in `src/level/geo/facade-kit.js`): with no street wall, a wall of at least 0.7 of the longest wall with the nearest street (the median of 3 sample lines, before a footprint) wins, then the most open ground. The sign band turns the corner onto a next wall that faces a street or 20 m of open ground. The lab building (w270469054) now has its front on the north wall, which faces the park and the road, not the south wall 8 m from a neighbor.
- Ink (`src/render/post.js`): a crease must hold for 2 pixels, so a face under one pixel wide (a sign band top, a name panel end) does not give a dotted line.

## 2026-11-04: Geometry content on the buildings (relief, crown, roof gear, shop base, walks)

- Why: the user compared the toon and the pbr looks and saw almost no change. The gap to the references is geometry content, not light. This pass adds real relief and street life. It does not change `src/render/look.js`, `src/render/post.js`, or `createGeoLights()`.
- Lintels and heads (`wallDepth()` in `src/level/geo/facade-kit.js`): a stone lintel box (0.08 m out) over each upper window of a brick style. It covers the lintel that the facade shader paints, on the same bay and floor grid. The other styles with sills get a thin head trim (0.05 m out, 0.1 m high). A lintel or a head that does not fit under the cornice and its bed molding (or the eave of a house) is not built. So the top floor of a 2-floor loft has no lintel: the cornice covers the frame top there.
- Stacked cornice: a bed molding (0.09 m, 0.2 m out) under the cornice and a cap step (0.12 m, 0.22 m out) on it, in the depth tiles. The bed molding stays over the mural top (0.6 m under the wall top).
- Crown (`crownPanel()`, judge round 2 fix 5): `crown.step` is 1.6 m. An even wall of 6 bays or more gets a 4-bay panel. A wall with 4 more bays than the panel also gets a 0.5 m step of one bay on each side, so the crown reads as a stepped parapet. The stair bulkhead is painted steel.
- Roof plan (`src/level/geo/roof-plan.js`, new, pure): one seeded plan for each flat roof places the bulkhead, the water tower (at the end away from the bulkhead), the roof units (in rows), and the vent stacks. Each part is square to the long walls, inside the footprint with a clear margin, and 0.6 m or more from every other part. `roofProps()` in `src/level/geo/props.js` takes the units and the tower from the plan (kit GLB kinds). The facade kit builds the vents in the depth tiles. `minRect()` moved to this module; `facade-kit.js` exports it again. BeltLine: 1,118 roof units (before: 657) and 23 water towers (before: 21).
- Shop base (`shopEntrance()`): in the door bay of the front wall, a painted door (the sign color) with a glass light and a trim surround, on a 0.15 m stone step that goes down to the plinth foot. A bronze wall lamp with a warm lantern on each inner pier. All in the depth tiles. A bay narrower than 1.85 m (the glass office) gets no door.
- Door bay and walk (`frontWalk()`, `frontEdges()`): for each bay center of the front wall, a march out along the wall normal finds the nearest street, sidewalk, path, or trail before another footprint (to 6 cm). The bay with the nearest street gets the door. `frontEdges()` now keeps its Map for each level object (a WeakMap), because the kit, the aprons, the props, and the lab use it.
- Walk and curb (`src/level/geo/aprons.js`, judge round 2 fix 1): a 2.5 m walk from the front apron to the street edge in front of the door, 0.025 m over the ground (over a park, under a street). A curb 0.18 m wide and 0.1 m high runs on the outer edge of the front apron (open at the walk) and on both sides of the walk. The walk and the curb are render-only: the skater rolls through the 0.1 m curb.
- Planters (`planterSpots()`, `streetProps()`): the kit planter at scale 0.8 at every second inner pier of the front wall, 1.0 m out, not at the door bay. Each planter has a solid circle (radius 0.6 m, 0.82 m high) in the ground sampler, so it is a ledge. No other street prop stands on a walk. BeltLine: 677 planters.
- Triangle counts on the BeltLine level (`facadeKit()`): building tiles 49,648 before, 51,144 after (budget 60,000). Depth tiles 706,568 before, 1,316,242 after; the largest depth tile 20,866 before, 40,726 after (limit 60,000); the worst sum of depth tiles under 120 m from a camera point 54,382 before, 101,058 after (limit 150,000). The heads (50,766 boxes) are most of the new depth triangles.
- Not done: jambs on the window surrounds (the depth budget), a door bay in the facade shader (the door is geometry in front of the shop glass), colliders for the steps and the curbs, a lintel on the top floor of a 2-floor building.

## 2026-11-04: Real PBR materials, building plinths, a lower sun, and the full map with a baked isometric layer

- **The look.** The user saw almost no difference between toon and pbr. The pbr look now has CC0 normal and roughness maps on the walls (brick, plaster) and the ground (asphalt, slabs, trail, grass), a light ink line (0.3), a color grade (`GRADE` in `src/render/look.js`), a darker ground albedo (`GROUND_ALBEDO`), and a lower, warmer sun (27 degrees, not 54). The toon look keeps its sun.
- **Building bases.** A building on a slope had its ground floor under the uphill ground. `buildingSpan()` in `src/level/geo/terrain.js` now puts the ground floor at the highest ground under the footprint, and a stone plinth fills the walls down to 0.5 m under the lowest ground.
- **Two shader bugs.** The window room hash read the interpolated wall color, so each pixel got a different room (the speckle). The hash now uses the color in steps of 1/32. The ground scans streaked on vertical faces (curb sides); only a face that points up gets them now.
- **The full map (M key).** `src/ui/fullmap.js` shows the whole level over the game, and the game stops. It has two layers: the plan (the minimap drawing) and a 3D layer. M opens the full map now; the × button hides the minimap.
- **The 3D layer.** We learned from Isometric Toronto (iso.sloptoronto.ca): one fixed orthographic camera (30 degrees down, turned 45 degrees) renders the whole level into one image, cut into tiles, so every place is where it is in the city and the tiles join with no seam. We do not use Google 3D Tiles (issue 93 and Google's terms) or a generative model: `scripts/bake-iso-map.mjs` renders our own level with the game renderer (`?view=iso`), and `scripts/iso-pyramid.py` makes the zoom levels. The BeltLine level is 17 x 9 tiles at 0.5 m per pixel, 2.5 MB in all, and bakes in about 25 s on the real GPU (`BAKE_GPU=1`). Bake the map again after a change to the level or the look.

## 2026-11-04: Street lines and curb bands, so the road reads at once

- Why: the user could not tell the sidewalks from the roads, and asked for real street lines. Most streets in the BeltLine level have no sidewalk strip beside them.
- `roadMarkings()` in `src/level/geo/markings.js` now adds 4 marks. It stays pure and render-only, and the view merges it into the surface tiles as before.
  1. A curb band on both edges of every street that is not a service road: 0.3 m wide, inside the street edge, in a color 6 % lighter than the sidewalk (`MARKING_COLORS.curb`). It is 1.2 cm over the street, under the paint (2 cm), so a line on a band does not flicker.
  2. A white edge line (0.12 m) on the main streets and the residential streets. It is 0.3 m in from the inner side of the curb band (0.6 m from the street edge), so a dark gap of asphalt shows between the band and the line.
  3. Dashed white lane lines (3 m dash, 9 m gap) on a main street with 2 or more lanes in one direction. A lane is 3.4 m, so a 14 m street has 4 lanes and a 19.8 m street has 5 (2 in each direction). The level has no oneway tag. A strip with `oneway: true` gets no yellow line and white lines between all lanes.
  4. A white stop bar (0.45 m deep) on the inbound half (the right side of the traffic) of each named arm, 1 m before the crosswalk.
- Divided roads (`medianSide()`): the level has no oneway tag, but John Lewis Freedom Parkway has one strip for each direction. A main street strip is one half of a divided road when 30 % or more of its length runs beside a parallel strip of the same name with a gap of 12 m or less. Such a half gets no double yellow line, a yellow edge line on the median side, and white lane lines between all lanes. On the BeltLine level only Freedom Parkway strips (13) match.
- Cuts: a line stops short of a node with a cross street or with 3 or more street arms (service roads do not count). On an arm with a crosswalk, the yellow line, the lane lines, and the edge lines stop at the stop bar, and the curb band stops at the crosswalk. A curb band elsewhere stops 0.5 m past the cross street edge.
- Curves: each line follows the centerline polyline. The quads of two segments share a miter edge, and a strip joins the next strip of the same street and width with a miter. A quad that folds over itself on the inner side of a tight turn is left out.
- Bridge decks keep only the center line, because the markings follow the ground under the deck.
- Cost on the BeltLine level: 8,416 marking triangles before, 17,280 after, before the drape.
- Not done: a real oneway tag in the level build, curb ramps at the crosswalks, and markings on bridge decks.

## 2026-11-04: Fast travel, a darker asphalt, and a bake with no reload

- **Fast travel** (a play-test aid): on the full map, a click picks a place or an icon, and T or "Travel here" moves the skater there (`src/level/geo/travel.js`, `teleportRun()` in `src/sim/skate/run.js`). The skater lands on the nearest trail, path, sidewalk, or street point, outside every building, at rest. The score stays; the combo ends. It is on in the dev server and off in a production build; `?travel=1` or `?travel=0` sets it.
- **Asphalt and sidewalk** (pbr look): `GROUND_ALBEDO` in `src/render/look.js` is now RGB. The asphalt is darker and less blue, and the slab sidewalk is near its art color, so a sidewalk is more than 3 times brighter than a road.
- **The bake** (`scripts/bake-iso-map.mjs`) runs Vite with no hot reload and no watch of `assets/map/`. The game imports the tiles, so each new tile file reloaded the page in the middle of a bake. A tile also gets 3 tries.

## 2026-11-03: Parked cars and calm traffic (#132)

- Decision: cars make the streets read as a living neighborhood. A pure traffic module (`src/sim/traffic/traffic.js`) drives calm traffic on the main streets: John Lewis Freedom Parkway, Ponce de Leon Avenue, North Avenue, and Highland Avenue with North Highland Avenue. A pure parking module (`src/sim/traffic/parking.js`) parks cars along the curbs. `?cars=0` turns all cars off, `?traffic=0` keeps only the parked cars, and `?carseed=<n>` picks another seeded traffic.
- Political rules: a car never hits, chases, or threatens the skater. A car slows and stops when the skater is in its lane ahead (30 m look-ahead), stops 2 m past the 2 m circle, waits 1.5 s after the skater leaves, and then goes on. A hard rule rejects any car move that brings the car body nearer than 2 m to the skater (when the skater is less than 3 m above or below the car, so a car on a bridge over the skater goes on). The kit has no police car, no emergency vehicle, no light bar, and no black and white two-tone.
- Lanes: each main street is a chain of street strips. A chain with an opposite carriageway parallel to it (5 m to 50 m away, on at least 40% of the samples) is one-way, and the opposite carriageway is on the left of the driver (right-hand traffic). This finds the Freedom Parkway carriageways (all 24 ways have `oneway=yes` in OSM, but the level has no `oneway` field). A two-way chain gets one lane in each direction, a quarter of the width right of the center line. A lane end links to the lane back (two-way), into a lane of the same street through the end point (a junction), to the nearest lane start at the level edge, or to its own start.
- Stop rules: a car stops at the stop line before each intersection with a named street (`streetIntersections()`), waits 1.2 s, and goes only when no other car is in the intersection and there is room past it. Thus cars from two streets never meet in an intersection, and a queue never blocks one. Speeds: 9 m/s on the trunk, 7.5 m/s on the secondary streets.
- Parked cars: the level has no `parking:lane` tags and no surface lots. The OSM fetch takes only buildings, highways, parks, and grass, and the raw data has 2 ways with a `parking:` tag. Thus the street width and class decide: a named residential, tertiary, unclassified, or living street 8 m wide or more gets cars on one curb (12 m or more: both curbs), in 30% of the 6.5 m slots. Never on a main street, a bridge, within 14 m of an intersection, within 10 m of the trail or a park path, or within 25 m of the spawn. The BeltLine level gets 503 parked cars.
- Not done: cars in parking lots. A lot needs `amenity=parking` areas in the OSM fetch and in the level build. That is a change to the level pipeline, which other sessions change now.
- Collision: `carGroundSampler()` wraps the level sampler. A point in a car body returns the car top, and the controller treats a rise over `SKATE.maxStep` as a wall, so the skater bonks or slides on a car as on any wall. The jump apex is 0.625 m and the lowest car is 1.45 m, so the skater cannot land on a car. A car more than 2.5 m over the skater (on a bridge) is left out. The props and the camera physics (Rapier) do not change.
- Height: a car takes its height from the street strips only (`streetsOnly()`), because building footprints, sidewalks, and the trail overlap the lanes in the map data. Before this rule a North Avenue car climbed 4.4 m onto a building. A car follows the highest street surface up to one step over its last height, so it rolls up a bridge ramp and stays under a bridge over its street. A car changes height by 0.06 m or less in one step, so a step in the street becomes a short ramp. A parked car gets a pitch from the street heights under its front and its back.
- Data findings for #131 (not changed here): the Freedom Parkway bridge way w29094070 starts 0.84 m above the road near (412, -108), and the terrain under way w219329882 rises 5 m over about 10 m near (-173, 267).
- Car kit (`src/render/car-kit.js`): a sedan, a hatchback, a pickup, a van, and a city bus in the MARTA colors (white, blue band, orange line, no logo, no text). Built in code from flat-shaded blocks, 122 to 182 triangles for LOD0 and 10 to 20 for LOD1. There is no generated model, so there is no `provenance.json`. A `paint` vertex attribute mixes the vertex color toward the instance body color (12 colors), so glass, tires, and lights keep their colors.
- Draw: all cars are one `BatchedMesh` (`src/render/car-view.js`), one draw call, as the props (#89). LOD0 under 70 m, LOD1 under 240 m, else hidden.
- Tests: `src/sim/traffic/traffic.test.js` (lanes, one-way detection, stop lines, determinism, no overlap in an intersection, yield and wait, a skater on a bridge, the 2 m circle for a skater who stands still and for one who skates around, the obstacle sampler, and a bonk with the real controller), `src/sim/traffic/parking.test.js`, and `src/render/car-kit.test.js`. `e2e/cars.spec.js` checks the counts, one draw call, `?cars=0`, a stop for the skater in the browser, and a bonk on a parked car, and saves `e2e/__screenshots__/cars-street.png`, `cars-traffic.png`, and `cars-street-phone.png`.
- Measured (SwiftShader, `scripts/prop-perf.mjs`, 3 runs for each build, `reports/car-perf/low.json`): one more draw call (storefront 13 to 14, overview 48 to 49; the spawn view varies from run to run on both builds). The cars add 160 to 240 triangles on those views, and 1,756 to 2,214 triangles on a street view with 8 to 12 cars at LOD0. The car sim and the car sampler add 0.04 ms to each 1/60 s step.
- High tier (SwiftShader, `/?level=beltline-eastside&quality=high&governor=0&view=fixed`): 5 frames in 8.3 s (before: 9.7 s, load average 32 to 37). Draw calls at the spawn: 177 to 181, because the cars also draw into the shadow map.
- Not done: the camera physics (Rapier) has no car colliders, so the follow camera can clip into a car.
- Not verified: the 55 FPS median. The load average was 16 to 32 during the low-tier run (6 to 20 FPS on both builds), and the phone-tier run did not load in 180 s. Run `scripts/prop-perf.mjs` again on a quiet machine.

## 2026-11-03: NPC skaters on the player controller (#134)

- Decision: the NPC skaters (`src/sim/npc/skaters.js`) ride the same pure skater controller as the player (`stepSkater()` in `src/sim/skate/skater.js`). A pilot turns the NPC state into a controller input on each tick: steer, push, brake, jump, grind, and the two dance buttons. The controller rules do not change.
- Why a pilot and not a fixed input list: an open-loop list (like `src/playtest/trail-script.js`) cannot steer around a player. The pilot is pure and closed-loop. With the same level, specs, and obstacles, it gives the same states, tick for tick.
- Routes: on the BeltLine, 5 NPC skaters ride back and forth on a 280 m window of the trail around the spawn. They keep right and make a left U-turn at each end. On the greybox (`?skaters=1` only, so the greybox screenshot does not change), 2 NPC skaters ride street lines, and one of them grinds the straight rail.
- Tricks: each NPC has a list of tricks on a timetable (jump, groove dance, spin dance). A trick waits for a straight, clear route. A dance waits for the next beat when the beat clock runs, so it starts on the beat. The BeltLine level has no rail splines, so the BeltLine NPCs do not grind. The greybox NPC shows the grind.
- Avoidance: the NPC keeps a lane offset clear of the obstacles 22 m ahead: the player (1.3 m side clearance), the crowd, and the other NPC skaters (0.6 m). It slows to a crawl on a collision course, stops in front of the player or the crowd, and turns around after 1 s held still. An NPC stops only for an NPC before it in the list, so two NPCs cannot block each other.
- The player: the NPCs are not obstacles for the player controller, so an NPC can never end the player's combo. `e2e/npc-skaters.spec.js` checks that a 15 s ride with dances gives the same end position and combo with and without the NPC skaters.
- The crowd: `stepCrowd()` takes an optional list of NPC skaters. The crowd sees them in its look-ahead (it slows down and passes), but not in its overlap test, so a skater never freezes the crowd.
- Models: `parseSkaterGltf()` in `src/render/skater-model.js` parses each GLB once. The player and the NPCs share the parse; each NPC is a `SkeletonUtils.clone()` with its own skeleton and the shared geometry, textures, and clips. Each NPC plays its clips through the player skater view (`createSkaterView()`).
- Outfits: `src/render/npc-skaters-view.js` shifts the hue of the clothes in the base color texture, in the fragment shader, before the toon pass. Nia: the green pants and wristband change; her jacket keeps its color, because it has the hue of her skin. Marcus: the teal jacket, the navy shorts, and the wheels change. Each NPC costs 2 draw calls (the skin and the ink hull) when it draws. The high tier draws the 5 nearest NPCs within 90 m of the camera. The low and phone tiers draw the 2 nearest within 45 m, because a skinned NPC and its hull cost about 36 K skinned vertices on a software GPU (`NPC_DRAW` in `src/render/npc-skaters-view.js`).
- `?skaters=0` turns the NPC skaters off.
- Downloads: the NPCs of one model share one GLB download (`npcBytes()` in `src/main.js`).
- Tests: `src/sim/npc/skaters.test.js` runs each NPC alone for 60 s, the full set for 60 s, the set with the seeded crowd, the set with a player who stands on the trail at three places, and the set with a player who rides the trail. There is no fall, no respawn, and no wall bonk in any run.
- Limits: the closest pass to a player who stands still is 0.94 m (the bodies touch at 0.65 m). The crowd does not stop for a skater, so a crowd NPC can brush a skater that waits (one event in the seeded minute, 0.16 m from the skater center).
- Not verified: the median FPS gate (55). The harness gave 10 FPS with the NPC skaters and 12 FPS without them at a load average of 18 to 23, so both runs fail. `e2e/npcs.spec.js` (a 10 s crowd ride in the follow view) timed out at 30 s with the NPC skaters after a merge of main. Cause: the outfit gives the NPC skin its own shader program, and SwiftShader stalled on the first frame with an NPC in view. The first ride took 16.6 s with the NPC skaters and 11.6 s without them. `warm()` in `src/render/npc-skaters-view.js` now compiles the programs after the NPC models load; the first ride then took 10.06 s, and all 8 rides took 9.9 to 10.1 s (load average 15 to 18). Measure the FPS gate again on a quiet machine.
- Not done: real skaters have not reviewed the NPC moves (AGENTS.md requires it before release). An NPC skater does not give a challenge yet (a later issue).

## 2026-11-04: Street furniture at the OpenStreetMap positions

- Decision: the BeltLine level puts a street prop at each bench, waste basket, bicycle parking, and street lamp that OpenStreetMap maps in the box. These props go before the fixed-interval rows. The fixed rows fill only where OSM has nothing near.
- Source: a second Overpass query in `scripts/build-block.mjs` (`furnitureQuery()`) fetches the nodes with `amenity=bench|waste_basket|bicycle_parking|drinking_water`, `highway=street_lamp`, and `barrier=bollard`. The answer goes to `levels/beltline-eastside/raw/street-furniture.json`, and the query and the time go to `raw/street-furniture-fetch.json`. The fetch of 2026-11-04 (OSM base `2026-11-04T14:19:13Z`) has 57 points: 23 benches (12 with `backrest=yes`), 7 waste baskets, 14 bicycle parking, 5 drinking water, 4 street lamps, and 4 bollards.
- Why a second query: a change to the main query fetches the buildings again. New OSM buildings then have no record in `data/buildings/beltline-eastside.json`, and the build stops. The second cache keeps the building data as it is. Use `--refresh-furniture` to fetch only the furniture again.
- Level data: `level.json` has a `furniture` list. Each point has the OSM node id (`n<id>`), the OSM kind, the level `x` and `z`, and the useful tags (`backrest`, `material`, `capacity`, and others). `stats.furniture` has the count for each kind.
- Kit props (`FURNITURE_PROP` in `src/level/geo/props.js`):
  - A bench with `backrest=yes` is the Poly Haven painted bench (`bench_painted`). Another bench is the kit bench (`bench`).
  - A waste basket is a `bin`. A bicycle parking is a `bike_rack`. A street lamp is a `lamp`.
  - A drinking fountain and a bollard have no kit prop. They get no prop.
- Turn: a bench front faces the nearest trail, path, or sidewalk. A bike rack turns along that way. A lamp arm reaches toward that way.
- Rules: the 2.5 m gap and the open-ground rule stay. When the OSM point is on pavement or too near another prop, the prop moves away from the nearest way, 0.5 m at a time, up to 3 m (`FURNITURE_SHIFT`). The street signs go first, then the mapped props, then the fixed rows, then the canopy trees.
- Fill: the fixed rows put no bench and no bin within 30 m, no trail lamp within 12 m, no sidewalk lamp within 18 m, and no bike rack within 90 m of a mapped prop of the same kind. Each distance is half the spacing of its row.
- Result on the BeltLine level: 43 of the 57 points are props (10 kit benches, 12 painted benches, 7 bins, 10 bike racks, and 4 lamps). 14 of the 43 moved off the pavement. 14 points are refused:
  - 9 have no kit prop (5 drinking fountains and 4 bollards).
  - 4 bicycle parking points are on pavement, and no spot within 3 m is open ground.
  - 1 bench (`n4879429399`) is less than 2.5 m from another prop.
- The reason is the reason at the OSM point. `streetProps(level, sample, report)` writes these counts to `report.furniture` and lists each refused point in `report.refusedPoints`.
- Prop counts with the canopy: before, 27 benches, 16 bins, 0 bike racks, and 696 lamps. After, 49 benches, 20 bins, 10 bike racks, and 700 lamps. The tree count does not change (5450). The fixed bike rack row put no rack on open ground before.
- Attribution: the furniture is OSM data under the ODbL 1.0. The level attribution does not change.
- Tests: `src/level/geo/props.test.js` checks that each mapped point is a prop of its kit kind within 3 m of the OSM point, that each bench faces its way, and that the fixed rows leave the mapped spots to OSM. `scripts/build-block.test.js` checks the query and the point data.

## 2026-11-04: Bridge decks meet their roads (#131)

### Root causes

- The terrain grid is 8 m, not 4 m. A deck end cannot meet the road at the OSM end: the ground there ramps down into the cut under the bridge. The deck end also used the ground height at its center point only. The deck is level across, and the approach road drapes on a ground with a cross slope, so the corners had steps up to 2.87 m (Parkway, (393.8, -43.3)).
- Under the decks the ground was up to 1.49 m above the deck (Parkway), and the slab was straight across a deck that sat on the ground.
- The deck end was square to the deck and the road end was square to the road (up to 10 degrees apart), so wedges of grass showed. The deck had no miter at a turn.
- A sidewalk deck next to a road deck had its own height line, up to 3.9 m lower (Highland Ave NE, south side). The two Parkway carriageways had lines up to 0.8 m apart, side by side.
- The parapets stopped in the road with no end, and the road parapets stood inside the sidewalk decks.
- The markings on a deck were draped on the ground, not on the deck.

### Decisions

- `src/level/geo/bridges.js` (new, pure): each deck goes on past its OSM end along the approach road to a joint J, up to 12 m (one grid diagonal). The run-on stops where the approach bends more than 20 degrees. The approach road mesh stops at J. A deck alongside a wider deck in parallel (a sidewalk, or the second carriageway) is hosted: it uses the line of its host. Ribbons are mitered. `project()` measures along a polyline between miter lines, so the height has no jump on the inside of a turn.
- `bridgeDeck()`: on the span, the line from the ground at J0 to the ground at J1, with the arch. On a run-on the deck blends from that line to the ground on the joint edge. So at J the deck is on the ground, the same as the road. The deck never goes under the ground. A free end on another deck (the footway spur at Ponce City Market) starts at that deck height.
- `gradeBridgeEnds()` (build step, after `raiseEmbankments()`, run twice): the ground goes on the deck line, level across the road, within one grid diagonal of each joint, and blends back over 24 m. Under each span the ground stays 5 cm under the deck line. Along a way that passes under a deck (a street, or the BeltLine trail under the Parkway) the grade sets no height: it only lowers the ground under a span. So no arch grows from a fill, and the trail outside the trail bridge approaches keeps its grade.
- The deck top is one drape on the deck height. The slab is on the straight line, 5 cm under the deck top. Each parapet ends at an end post and a 4 m wing wall that turns 30 degrees out and goes down into the ground. A parapet side inside another deck or in an at-grade way at the deck height gets no parapet. A half disk past each joint fills the wedge between the deck end and the next road. A disk fills the wedge where two roads of one kind meet end to end within 40 m of a bridge. The deck top has a vertex row on the center line, and the deck center lines are draped on the deck height, so the deck top never covers them.
- The deck markings follow the deck (`roadMarkings()` returns them in `deck`, not draped again).
- NPC check: after the merge of main, Kiana bonked 3 times on a bench in the crowd test. The cause: the grade raised the trail 11 cm at (339.12, -31.22), in the blend band of the Parkway joint. Her path moved, and a turn took her off the trail into the bench. The grade now keeps the ground along ways under a deck, and the test passes with no NPC script change.

### Evidence

- `src/level/geo/bridges.test.js` (13 tests): deck end on the ground at each of the joints within 2 cm, the deck mesh edge at J on the ground, no terrain over any deck from joint to joint, wing walls off the road, center lines across the Parkway joints, and 2 skater rolls at 3 offsets across each joint with no bonk and no fall.
- `e2e/bridges.spec.js`: high-tier pictures of 17 bridge ends, in `reports/bridges/before/` (origin/main) and `reports/bridges/after/`.
- The high tier loads to 5 frames in 8.2 s headless. Vitest: 645 tests pass (after the merge of main with the cars, the NPC skaters, and the trees).

### Limits

- Where the run-on of one deck meets the graded band of another (the Highland and Randolph corner, the Parkway west end with the Stone Mountain Trail), the deck rides the ground for a few meters. The height is continuous, but the grade has a crease of up to about 10 cm.
- The footway spur `w1118177210` goes from the footway deck (9.5 m) to the ground (4.8 m) in 10 m, as in the OSM data: a 47% ramp.
- The ground sampler is about 1.4 times slower (deck heights now read the terrain).
- Not checked: the low tier far terrain at the bridge ends.

## 2026-11-04: Road detail (#138) and sidewalk detail (#136)

### Road detail (#138)

- Lane tags: `scripts/build-block.mjs` keeps the OSM lane tags of each street (`laneTags()`): `lanes`, `lanesForward`, `lanesBackward`, `oneway`, `turnLanes` (turn:lanes or turn:lanes:forward), `turnLanesBackward`, and `cycleway` (the sides with a painted bike lane). 78 streets have a lane count, 27 have turn lanes, 10 have a bike lane, and 101 are one way. The rebuild from the cache changes only these fields and the new `crossings` list.
- Lanes (`src/level/geo/lanes.js` `laneLayout()`): with a lane tag, the lane count comes from OSM and a lane is at most 3.6 m. The room that is left is a shoulder outside the edge lines. John Lewis Freedom Parkway now has 2 lanes on each carriageway (OSM `lanes=2`), not 4. A street with no lane tag keeps the lane lines of before.
- Turn arrows: from `turnLanes`, one white arrow in each lane, 3 m before the stop bar (or the line cut), on the forward lanes at the strip end and on the backward lanes at the strip start.
- Bike lanes: a green band (1.5 m) inside the curb band on each tagged side.
- Decals: manhole covers (each 45 m on average), storm drains at the curb before each junction, and asphalt patches (each 70 m on average), seeded by the strip id. They are in the marking mesh, so they cost no draw call. Their colors are surface kinds in `SURFACE_COLORS`, so the pbr surface shader gives them the asphalt scan and the asphalt albedo (`GROUND_OF` in `src/render/geo-view.js`).
- Marking cost on the BeltLine level: 20,474 triangles (budget test: 12,000 to 25,000).
- Junctions (`src/level/geo/junctions.js`): each at-grade street strip is split at its junction nodes, and each piece stops where its edges clear the other arms (`armTrim()`). One patch fills each junction: the convex hull of the arm end corners, the arm corners at the node, and the bend corners before the trim. The patch is 4 mm over the street top. Two strips that meet end to end with no junction get a disk at the joint. The ground sampler sees each patch as a street. On the BeltLine level: 344 junctions, 751 pieces, 107 joint disks. The test samples a grid of 0.5 m around each junction: no gap, and under 0.2% of the points are on two pieces (where two junctions are closer than the trims; the patch draws over them).
- Medians (`src/level/geo/medians.js`): the two carriageways of John Lewis Freedom Parkway are 14 m strips with center lines about 12 m apart, so they overlap. The median is the band between the two yellow edge lines, less 0.45 m on each side: a raised grass island (the sidewalk height) with a concrete rim. 8 medians, 1,060 m in all, and 56 median trees (one each 18 m on a median 2.4 m wide or more). The Ponce de Leon Ave carriageways get no median: no run of 3 samples passes the test there.
- Not done: a narrower carriageway. A width from the lane count (9.6 m for 2 lanes) gives a real median, but it changes the bridge decks and the trail grade under the Parkway. Then `src/sim/npc/skaters.test.js` (Rae bonks twice) and the Freedom Parkway gap test fail. Do this in its own issue, with the bridge grade.
- Bridge line ends: a line end that a bridge deck trims gets a square end, not the miter of a joint (`endsOf()` in `roadMarkings()`).
- The bridge center line test now uses the Highland Ave NE bridge: the Parkway carriageways are one way, so they have no center line.

### Sidewalk detail (#136)

- Crossings: the build keeps the OSM footway and cycleway crossings in `level.crossings` (191 ways: id, points, `marked`).
- Cuts and ramps (`src/level/geo/curbs.js`): the part of a sidewalk whose center line goes across a street (at more than 30 degrees, not a service road) is cut out, and the last 1.5 m on each side is an end ramp (8% slope). At each crosswalk end and each OSM crossing end, a sidewalk along the street gets a 2.4 m cross ramp from its back edge down to the curb. On the BeltLine level: 108 cuts, 267 end ramps, and 166 cross ramps (127 from OSM crossings). The Overpass query fetches ways only (no `kerb` nodes), and 1 way has a `kerb` tag, so the ramps come from the crossings only.
- Physics: the ground sampler has each ramp as a slope that wins over the sidewalk it cuts, and each sidewalk as its pieces. The curb stays 12 cm (0.15 m sidewalk over a 0.03 m street), under `SKATE.maxStep`.
- Grind features (`src/level/geo/grindables.js`): each street prop at an OSM bench is a ledge (`ledge:bench:<node id>`, 22), and the street side edge of each sidewalk piece is a ledge (`ledge:curb:<way id>:<k>`, 195). `createLevelEnv()` returns them, and `createSkaterEnv(level, extra)` adds them. `findSnap()` skips a grindable with a ground box far from the skater.
- Tests (`src/level/geo/curbs.test.js`): the skater rolls up 5 or more curb cuts from the street with no bonk and no fall, pops 3 or more curbs onto the sidewalk with no bonk, and grinds 3 or more OSM benches and a curb.
- Paving: the sidewalk already has the concrete slab scan with its joints (pbr look). No brick: the level has no historic district tag yet.
- Not done: tree pits and bus stops. The sidewalks are 2 m wide (the default), so a tree pit leaves no room to walk, and the furniture query has no bus stops. Planters, benches, bike racks, bins, and lamps are as before.

### Evidence and limits

- Vitest: 850 tests pass (one full run had a 5 s timeout in `facade-kit.test.js` at a load average of 18; the test takes 3.2 s alone on this branch and 3.5 s on main).
- `e2e/beltline.spec.js` and `e2e/phone-tier.spec.js` pass. `e2e/streets.spec.js` loads the high tier and the low tier with no console error and with the bench and curb ledges, and takes the pictures in `reports/streets/before/` (main: 4 intersections and a crosswalk) and `reports/streets/after/` (the same, and a sidewalk). The iso map is baked again (153 tiles).
- Not verified: the median FPS gate (55). `npm run playtest:beltline` gave 15 FPS and 20 FPS at load averages of 19 to 22. The same harness on main, in a second worktree, did not load in 30 s at that load, so there is no comparison. Measure the gate again on a quiet machine.
- The level setup (`createLevelEnv()`) takes about 400 ms, against about 210 ms on main: the sidewalk layout (about 100 ms), the medians, the junctions, and the ledges. Each one is computed once for each level object.
## 2026-11-04: More detailed buildings: porches, shop boards, roof gear, lintels (#135)

### Decisions

- The level keeps 4 more OSM building tags (`buildingTags()` in `scripts/build-block.mjs`): `levels` (building:levels), `roofShape` (roof:shape), `material` (building:material), and `use` ({ key, value, name } from shop or amenity). The game reads them; the level keeps the OSM values.
- `floorCount()` (`src/level/geo/styles.js`): the OSM level count sets the floors of the facade shader and the kit when it gives a floor height of 2.6 to 6.5 m. `roofForm()`: the OSM roof shape comes first (flat or a gable shape), else a house gets a gable. An untyped brick building gets a brick style.
- Porches (`housePorch()`, `houseFronts()` in `src/level/geo/facade-kit.js`): a house whose front wall has a way within 30 m gets a porch on its door bay: a deck on a skirt, knee walls with a trim cap, 4 posts, a beam, a shed roof under the eave and the second floor sills, a stair down to the terrain in front, and a painted door. The porch, its stair, and its roof overhang stay 0.5 m or more from every way (street, sidewalk, path, trail) and every other building (`wallClear()`). When the full stair does not fit, the stair gets fewer steps. A wall with a mural gets no porch. 219 of 788 houses get a porch. The porches are in the depth tiles, so they show only within 120 m.
- Shop boards (`src/level/geo/shop-signs.js`, `src/render/shop-signs-view.js`): a building with a named use from the `SHOP_USES` list gets one board with the name, on the door bay of its front wall, on the line of the sign band. `NAME_DENY` keeps names off that do not show the city at its best. 7 BeltLine buildings get a board. The round 0 art direction forbids text on the blank boards; these boards are a different part, and they show only real OSM names.
- Roofs: solar rows (`roofPlan()` kind "solar", `roofSolar()`) on the flat roofs of 5 styles, with their own seed, so the other roof parts do not move. One frame and one face for each 2 m panel keep the main kit tiles at 53,866 triangles (budget 60,000). The industrial sheds get the water tower rate 0.5.
- Lintels: on the top floor of a low building the lintel went into the cornice, so `wallDepth()` left it out. Now it gets lower and stays under the bed molding (at least 0.1 m high). Lintels 1,872 to 3,298; heads 50,777 to 59,277.
- Window reveal: the facade shader darkens a 0.16 m band under the window head and a 0.07 m band at each jamb (`REVEAL` in `src/render/geo-view.js`).
- Plinths: `gradeFootprints()` (`src/level/geo/terrain.js`, build step after `gradeTrail()`) puts a pad under each building with a drop of 1 m or more along its walls. A node moves 2.5 m or less. Nodes within 1.5 m of a way and within 10.5 m of the trail keep their height. Plinth (base minus foot): median 1.80 to 1.24 m, over 3 m 146 to 49 buildings. Max change on the trail 0.03 m, on streets p90 0.14 m, on sidewalks p90 0.52 m (the 8 m grid tilts a sidewalk between nodes).
- NPC check: a first version graded before the trail grade and moved the trail by up to 0.44 m. Two NPC skater tests failed (a wall bonk). With the trail band kept, they pass with no NPC change.

### Evidence

- Vitest: new tests in `facade-kit.test.js` (porch span, clear depth, porch placement, porches off every way and building on the BeltLine level, solar rows, level counts), `styles.test.js`, `terrain.test.js` (gradeFootprints), `roof-plan.test.js` (solar), `shop-signs.test.js`, `shop-signs-view.test.js`, and `scripts/build-block.test.js` (buildingTags). The mural test covers the porches.
- Budgets (pure kit, `facadeKit()`): main tiles 51,144 to 53,866 triangles; worst near sum of the depth tiles 101,058 to 107,954 (limit 150,000).
- Before and after: lab PNGs for brick-loft, storefront, and craftsman-house in `reports/lab/<style>-135-{before,after}/`, and 3 streets in `reports/streets/135-{before,after}/` (`e2e/streets.spec.js`). Judge report: `docs/art-loop/reports/brick-loft-r3-judge.md` (the engineer wrote it; not an independent judge).
- The phone tier has no facade kit (`tier.detail` is false), so the porches, the boards, and the solar rows add no triangles there.

### Limits

- Not verified: the 55 FPS median on the harness. `npm run playtest:beltline` gave a median of 20 FPS (FAIL) at a load average of 37 from other sessions (`reports/playtest-beltline-eastside-2026-11-04-22-47-50.json`). Measure it again on a quiet machine. The phone tier adds no triangles (see Evidence).
- The planters stay small at 25 m: `PLANTER` is in `src/level/geo/props.js`, which the roads session owns.
- The porches and the boards have no colliders, like the rest of the kit.

## 2026-11-07: Landmark facts may cite public sources (landmark discovery GDD)

The landmark discovery feature (`design/gdd/landmark-discovery.md`) needs history facts, for example the 1926 Sears, Roebuck building at Ponce City Market. The Atlanta open data catalog has numbers about parks, stations and neighborhoods, but it has no landmark history. The rule in `AGENTS.md` ("facts sourced from the open data catalog") changes for landmark story cards: a fact comes from the open data catalog or from a cited public source (National Register / NPS, City of Atlanta, Atlanta History Center, Georgia Encyclopedia, Atlanta BeltLine Inc., or the landmark's own site). Every fact keeps a source name and URL, and stays positive or neutral. Wikipedia is a pointer only, never the source. Fact cards (`levels/<level>/facts.json`) keep the catalog-only rule. Research: `docs/research/2026-11-07-eastside-landmarks.md`.

## 2026-11-11: Camera effects as a pure module on top of the follow camera (#253)

The follow camera gets short effects for the big moments of a run, as RenderATL Rush has (`src/fx/cameraEvents.js` there): a speed FOV, a landing dip, a shake on a hard landing or a fall, a grind lean, a zoom punch and a flash on a gap or a big bank. The pure module `src/sim/camera-fx.js` reads the skater and the sim events and gives offsets. `src/render/follow-camera.js` applies them after the wall clip.

- The offsets are 0 at a standstill and under 1.5 m/s, so the base FOV from `fovFor` (#73) stays exact for the tests and the phone layout.
- The shake is a sum of sines, not `Math.random`, so a replay gives the same frames. While the wall clip holds the camera in front of a wall, the dip and the shake stop, because they move the camera off the clip ray. A photo uses the base FOV.
- The flash is a DOM layer, not a post pass, so it works on every quality tier and never goes into a photo mode save.
- `prefers-reduced-motion: reduce` or `?camfx=0` keeps only the speed FOV, at half size. The game has no settings toggle for it yet.

## 2026-11-14: Far tree impostors from the prop draw distance to 450 m (#281)

The props hide past `PROP_DRAW_DISTANCE` (200 m), so the city edge had no trees from a height. A far layer in `src/render/tree-impostors.js` now shows each tree past that distance as a camera-facing card: one `InstancedMesh`, one draw call, 2 triangles for each tree.

- The art is one atlas, `assets/trees/impostors.png`, with a cell for `tree_round` (the oak) and a cell for `tree_tall` (the pine). `scripts/bake-tree-impostors.mjs` renders our own procedural trees with Three.js; no generative model draws it (see `provenance.json`). The texture holds the toon shade, a bark mask, and the coverage, not a color. Each card gets the leaf and the bark colors of its LOD1 tree, so the cards follow `?season=`. The pine has its own cell; every other species uses the round cell.
- A card fades in with a screen-door dither from 180 m to 200 m, while the LOD1 tree still shows, so the cards are full when the LOD1 tree hides. A card fades out from 390 m to 450 m, so the tree line has no hard edge. The CPU picks the trees in the ring again when the camera moves 10 m.
- The cards stay out of the GTAO normal pass, so the layer is 1 draw call on each tier. The AO and the ink are faint at that distance.
- The layer ends at the far plane of the tier: 450 m on high, 320 m on phone. On phone the fog is full at 320 m, so there is no fade-out band (the dither showed as grain in the fog). The iso map bake does not show the layer. `?farTrees=0` turns it off.
- The low tier has no layer. `scripts/prop-perf.mjs` on low (SwiftShader, `reports/prop-perf/281-far-trees-low.json`) gave +1 draw call and a median FPS drop of 0.7 to 1.1 from about 7 FPS (about 10%), and the cards there are in thick fog. `?farTrees=1` turns the layer on there for a test.
- The high tier FPS check needs a real GPU (`--gpu`). SwiftShader draws about 1 frame in 4 s on high, so the cloud session could only check the draw calls there (+1 on each camera).
