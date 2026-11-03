# Autopilot for Three.js: the fork and the Skate ATL proof

Date: 2026-11-02. Follows the evaluation in PR #53 (`docs/research/2026-11-02-autopilot-evaluation.md` on branch
`claude/autopilot-eval-244444`; that file is not on `main` yet).

## Result

The fork adds engine `threejs` to Autopilot. The agent service talked to the live Skate ATL page in headless Chromium.
A probe ran 25 ops through the kit's `Game`. 24 ops answered. The 25th op, `codex_manifest`, answered
`unknown op` by design. No decision model, no language model, and no key took part.

The fork is public at https://github.com/William-Hill/autopilot, branch `threejs-engine` (head `e8dbbe8`). The user
chose a public fork. The Skate ATL side is on branch `claude/autopilot-threejs-hook` of this repository.

## 1. Where the work is

| Item | Place |
| --- | --- |
| Upstream start point | `ramenvr/autopilot` commit `31cb1e5cc02abcce1a91367abb87718803ab983a` (2026-11-02T16:22:13-08:00) |
| Fork clone | `~/Development/autopilot`, branch `threejs-engine` |
| Fork commits | `20e4e34` feat(threejs): add a browser bridge and a Three.js engine adapter; `e8dbbe8` fix(threejs): connect the bridge only to this machine by default |
| Skate ATL branch | `claude/autopilot-threejs-hook` in this repository |

Nothing went to `ramenvr/autopilot`: no issue, no pull request, no comment.

## 2. The design

Autopilot has three engine plugins. Each plugin connects out to the agent service at
`ws://127.0.0.1:8765/v1/bridge` and answers requests. The upstream repository has no `docs/protocol.md`, so I read
the protocol from `autopilot/bridge.py`, `autopilot/kit/game.py`, and the Godot addon
(`plugin/godot/addons/autopilot/playtest.gd` and `lib/*.gd`).

The fork adds two parts, as `CONTRIBUTING.md` ("Adding an engine") asks:

1. **The browser bridge**, `plugin/threejs/autopilot-bridge.js`. It is one ES module with no imports, not even
   `three`. It does the math on the plain arrays that Three.js keeps (`matrixWorld.elements`,
   `geometry.boundingBox`). It says hello as engine `threejs` with `share: false`, and it answers the same ops as the
   Godot addon. The kit frame is the same as Godot's, because Three.js and Godot use the same axes:
   `kit = 100 * (-z, x, y)`.
2. **The adapter**, `autopilot/engines/threejs.py` (a subclass of `OpEngine`), and its kit notes,
   `autopilot/engines/threejs.md`. A project is a folder whose `package.json` depends on `three`. The codex is the
   source text on disk, because a web page cannot read its project files.

Three.js has no standard player, movement, or UI. The game gives them to the bridge as hooks:

| Hook | What the bridge uses it for |
| --- | --- |
| `player()` | `pose`, `context.character`, `move`, the player's velocity in `transforms` |
| `movement()` | `movement` |
| `controls()` | `input` (an action by name), `context.controls` |
| `restart()`, `levels()`, `pause()`, `gameTime()` | `session`, `levels`, `pause`, the `t` of each answer |
| `move()` | `move` with `via: "game"` (else W/A/S/D relative to the camera) |
| `render()` | `capture` and `record`: draw a frame, then read the canvas |
| `objects`, `classOf()` | `rc` reads and calls; classes for `find` |

Input reaches the game as a player's input does:

- Keys go in as `KeyboardEvent`s with `code` and `key`.
- Gamepad keys go to a virtual standard gamepad. `navigator.getGamepads()` lists it first while it holds anything.
- The mouse goes in as pointer and mouse events on the canvas.

## 3. Skate ATL

- `src/main.js` imports `src/autopilot/connect.js` dynamically, and only when the page has `?autopilot=1`.
- `src/autopilot/hooks.js` maps the hooks to `window.__atl`: the skater state, `resetSkater`, the bindings, the fixed
  tick clock (`ticks * FIXED_DT`), and `renderer.render` for frames. Its `move` hook pushes and steers toward the asked
  direction, because a skater steers and does not strafe. `classOf` gives each level object its `kind` (rail, ledge,
  ramp, ground, building).
- `src/autopilot/autopilot-bridge.js` is a copy of the fork file at `e8dbbe8`, with a header that names the source.
- Nothing under `src/level/geo/`, `scripts/build-block.mjs`, or `levels/` changed. No file under `prototypes/` is
  imported.

### Build check

`vite build` puts the bridge in its own chunk, `connect-*.js` (30,960 bytes). The main chunk
loads it only through `import()` behind `autopilot === "1"`. The main chunk has no bridge code.

## 4. Evidence

All runs set `AUTOPILOT_SHARE=0`, removed `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY` from the environment, and used no
paid model.

### 4.1 Tests

| Suite | Result |
| --- | --- |
| Fork, `node --test plugin/threejs/test/*.test.mjs` | 16 passed, 0 failed |
| Fork, `pytest tests/test_threejs.py` (9 tests, one with the bridge over a real WebSocket in Node 26.5.0) | 9 passed |
| Fork, `ruff check .` | passed |
| Fork, the whole `pytest` suite, final run on `e8dbbe8` | 501 passed, 5 skipped, 0 failed |
| Skate ATL, `vitest run` | 160 passed (16 files; 9 tests are new in `src/autopilot/hooks.test.js`) |
| Skate ATL, `playwright test`, the whole suite | 22 passed (before the loopback fix) |
| Skate ATL, `playwright test e2e/autopilot.spec.js` | 5 passed (after the loopback fix) |

The first whole-suite run had `AUTOPILOT_SHARE=0` and gave 499 passed, 5 skipped, 2 failed:

- `tests/test_aura.py::test_a_shared_run_with_own_keys_keeps_its_memory_with_aura_for_this_install` tests a shared
  run, and `AUTOPILOT_SHARE=0` turns sharing off. On the unchanged upstream commit `31cb1e5` the same test fails with
  `AUTOPILOT_SHARE=0` and passes without it. The fork change does not cause it.
- `tests/test_tactics.py::test_too_short_a_retreat_takes_hits` depends on timing. It passed when it ran alone. The
  first run shared the CPU with a Playwright run.

The second and third whole-suite runs had no `AUTOPILOT_SHARE` value, as upstream CI does, with `HOME` set to an empty
scratch folder and no keys. These tests use stand-ins and no network (`CONTRIBUTING.md`). No Autopilot run (`serve`,
`play`) ran without `AUTOPILOT_SHARE=0`.

- The second run gave 500 passed, 5 skipped, 1 failed:
  `tests/test_vision.py::test_a_gemini_call_through_the_runs_proxy_is_counted_there_once`. It passed 3 of 3 times
  alone. It does not use the engines.
- The third run, on the final fork commit `e8dbbe8`, gave 501 passed, 5 skipped, 0 failed.

### 4.2 The live probe

The fork's `tools/web_probe.py` waited on port 8765. The fork's `plugin/threejs/headless.mjs` opened the Skate ATL dev
server page in headless Chromium. The page connected, and the probe ran each op once. I ran the probe twice, before
and after the loopback fix. Both runs answered 24 of 24 ops. The numbers below are from the second run. The report is
`reports/autopilot-probe-2026-11-02.json`. The still is `reports/autopilot-probe-2026-11-02-still.jpg`.

| Op | Answer from the live game |
| --- | --- |
| hello | `engine: threejs`, `engine_version: 186`, `project: atl-arcade`, `share: false` |
| `missing_ops` | `[]`: every op that the brain requires is there |
| `find` (things) | the greybox objects by path, for example `/Scene/greybox-block/rail-straight` |
| `find` class `rail` | the 3 rails |
| `pose` | at `(0, -2400, 90)`, yaw 90.0 (the spawn faces native +x, which is kit +Y), on the ground |
| `movement` | walk speed 1200, jump 500, gravity 2000 (cm and cm/s) |
| `view` | 19 things in view, nearest first, with the camera's yaw, pitch, and field of view |
| `screen` | the HUD texts, for example `hud.hud-score: "0"` |
| `key` hold W for 2 s, with `watch` | the skater moved 1150.8 cm; `watch` noted `/Scene/skater` "moved" |
| `move` toward kit -X for 2 s | moved 1485.45 cm, `via: game` (the steer hook) |
| `pointer`, `press SpaceBar` | answered |
| `capture` | a 960 x 540 JPEG of the canvas (the still) |
| `record` 2 s at 5 fps | 10 frames sent, 10 frames received |
| `pause` | paused, then resumed |
| `session` restart | the skater is back at the spawn |
| `codex_manifest` | `unknown op` (by design: the brain copies the codex from disk) |

The offline `autopilot codex --project <this worktree>` command also worked. It found the project as engine
`threejs` and copied 68 files into the codex.

### 4.3 What I did not verify

- I did not run a real Autopilot request (`play`, `serve`, or the MCP `start_run`). A request needs the Jev decision
  model (a TypeSafe key or an Aura plan) and a language model. Both cost money.
- I did not run a harness, a verdict, or a goal run. I do not know how well Jev plays a skater.
- I did not test the fork on Windows or Linux, or on Python 3.13.
- I did not test the `research.py` teleport. It has no Three.js branch, so it answers "no way to move an actor in a
  threejs game yet".
- I did not test `headless.mjs` from `launch_command` through `bench/run_autopilot.py`. I ran it by hand.
- I did not measure the cost of the bridge on the frame rate. `capture` reads the canvas back and causes a GPU stall
  (Chromium logged "GPU stall due to ReadPixels").

## 5. What works and what does not

Works:

- Hello, the required ops, and the engine ops (`find`, `transforms`, `pose`, `movement`) in the kit frame.
- Keys, game actions by name, the virtual gamepad, the pointer, timed holds, and key leases.
- The game's own `move` hook, `session` restart, `levels`, `pause`.
- `capture` and `record` from the canvas, `screen` and `ui` from the DOM, `rc` on the hook objects.
- The codex from disk, and the threejs section in the agent's prompt.

Does not work, or works only in part:

- `view` has no line-of-sight test. A rail behind a building is listed as visible.
- `view` gives no `openings`, `ways_up`, `sonar`, or `look`. The kit's `walk_to` uses these to find ramps.
- `context.camera` is empty in Skate ATL, because the camera is not in the scene graph.
- `timestep` changes nothing: the browser sets the frame rate.
- There is no codex export (`codex_manifest`), no Autopilot tab, and no first-run setup in the page.
- The browser WebSocket cannot send an `Authorization` header, so the bridge cannot send a token.
- Object paths use sibling order (`#2`). They can change when the game adds or removes objects.

## 6. Line counts

| File | Lines |
| --- | --- |
| `plugin/threejs/autopilot-bridge.js` | 1,436 (a formatter wrapped it; 1,227 lines that are not blank or comment only) |
| `autopilot/engines/threejs.py` | 195 (the Godot adapter: 253) |
| `autopilot/engines/threejs.md` | 56 (Godot: 97) |
| `plugin/threejs/headless.mjs` | 55 |
| `plugin/threejs/README.md` | 81 |
| `tools/web_probe.py` | 148 |
| Tests: `tests/test_threejs.py`, `plugin/threejs/test/*.mjs` | 231 + 225 + 128 |
| Skate ATL: `src/autopilot/hooks.js`, `connect.js`, `hooks.test.js`, `e2e/autopilot.spec.js` | 118 + 32 + 144 + 79 |
| Skate ATL: `src/autopilot/autopilot-bridge.js` (the vendored copy plus a 6-line header) | 1,442 |
| Skate ATL: `src/main.js` | 9 lines added |

For comparison, the Godot addon has about 11,684 lines of GDScript in its main files.

## 7. Risks

1. **The protocol can change.** Upstream is 4 days old. The protocol has a version (`protocol: 1`), but there is no
   `docs/protocol.md`, and the Godot addon is the only specification. A change upstream can break the bridge with no
   warning. Mitigation: pin the fork to `31cb1e5`, and run `tests/test_threejs.py` after each merge from upstream.
2. **The 7-day rule.** Every Autopilot release is less than 7 days old. The first release, `b143178`, meets the rule
   on 2026-11-05. Skate ATL adds no npm dependency: the bridge is a vendored file of our own code. The Python side is
   a separate clone, not a dependency of this repository. Do not install Autopilot into this repository before
   2026-11-05.
3. **Data sharing.** Autopilot shares runs by default. The bridge always says `share: false`, and every run must set
   `AUTOPILOT_SHARE=0`. I did not verify the redaction in `redact.py`.
4. **Remote control of the page.** Whatever the bridge connects to can read the game, press keys, and call functions.
   The bridge connects only to loopback addresses unless the game passes `allowRemote: true`. Skate ATL does not pass
   it. A security review flagged the first version of this.
5. **The cost of a real run.** A real request needs the Jev decision model and a language model (Claude Opus by
   default, with fast mode at 2 times the price). Ask before any such run.
6. **A fork to maintain.** Until upstream takes the change, each upstream release needs a merge and a test run.

## 8. Next steps for the user

1. Choose if a paid run is worth it: one verification request on the greybox block, with `AUTOPILOT_SHARE=0`.
2. Review the draft upstream issue below. Post it yourself if you want it. I posted nothing.

## 9. Draft upstream issue (not posted)

Title: `Engine support for Three.js / browser games`

> **Problem.** Autopilot supports Unreal 5, Unity 6, and Godot 4. Many small games run in the browser with Three.js.
> They cannot connect to Autopilot today.
>
> **Proposal.** Add engine `threejs` with the two parts that CONTRIBUTING.md ("Adding an engine") asks for:
>
> 1. A browser bridge: one ES module with no dependencies (`plugin/threejs/autopilot-bridge.js`). The game imports it
>    behind a URL flag. It answers the engine-neutral ops (`find`, `transforms`, `pose`, `movement`) and the required
>    ops in the kit frame. Three.js has no standard player, movement, or UI, so the game gives them as hooks. Keys go
>    in as KeyboardEvents and a virtual standard gamepad. Frames come from the canvas.
> 2. An `OpEngine` adapter (`autopilot/engines/threejs.py`) and its kit section (`threejs.md`). The codex is the
>    source text on disk, because a page cannot read its project files.
>
> **Status.** A fork has a working version with tests. The tests include one that runs the bridge in Node over a real
> WebSocket against `serve_local`. A probe with no model drove each op on a live Three.js game in headless Chromium.
>
> **Questions for the maintainers.**
>
> 1. Is a browser engine in scope for this repository?
> 2. `docs/protocol.md` is referenced in `bridge.py` but is not in the repository. Is a written protocol planned? The
>    bridge followed the Godot addon.
> 3. The browser cannot send an `Authorization` header on a WebSocket. Is a token in the hello frame acceptable?
> 4. The bridge has no codex ops, so the brain copies the codex from disk. Is that acceptable for an engine?
> 5. `research.py` teleport needs one branch per engine. Is a generic `teleport` op preferred?
