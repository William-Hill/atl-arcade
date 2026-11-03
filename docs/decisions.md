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
