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
