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
- Not done: Krog Street Market (the reference photo is downloaded), and the lighting, interaction, and optimization passes.
