# #190, second step: the pbr files that are not in the first frame load after it

Branch `claude/keen-hopper-rmz63b`, base `epic/city-look` at `7372b02`. Date: 2026-11-09.

## What #226 left open

PR #226 moved the cars (`vehicles_lod` and the rigged cars), the Meshy people and props, the landmark GLBs and the NPC-only skater after the first frame. The per-file list of the base build (`pbr-downloads.md`, "Before") shows that four groups still loaded before the first frame on the pbr look, and none of them is in the first frame:

| Group | Files | low / phone | high | Why it was not needed |
|---|---|---|---|---|
| GLB trees | `oak`, `magnolia`, `dogwood`, `myrtle`, `pine`, `street` | 1.02 MB | 1.02 MB | The pbr look adds the prop batch only after the first frame (#226). Only the download came first. |
| street kit | `street-kit`, `painted_wooden_bench` | 0.20 MB | 0.20 MB | The same prop batch. |
| murals | `mural-atlas.jpg`, `mural-roughness.jpg` | 0.89 MB | 0.89 MB | Until they load, the dry-brush cut reads 0, so the host wall shows (`withMuralEdge`). |
| pbr ground | `albedo-512/1024`, `normal-1024`, `orm-512` | 0.31 MB | 1.93 MB | The ground draws at once with the mean color of each scan; the maps swap in when they load. |

The first frame on the pbr look still needs: the skater GLB, the physics WASM, the JS, the facade kit (high, near the spawn, awaited for up to 3 s), the img2threejs landmark towers and the wall detail maps.

## What changed

- `src/render/late-load.js` (pure, `late-load.test.js`): `lateLoadPlan()` says which groups wait (pbr look only; `?lateload=0` turns it off for a check in one build). `createLateLoads()` starts each group after the first frame and records when it started and ended (`__atl.lateLoads`).
- `src/main.js`: three small calls (the plan, the prop templates, the `defer` option of `createGeoView`, and the `__atl` getter).
- `src/render/pbr-ground.js` and `src/render/murals.js`: the downloads start through a `defer` function. By default they start at once, as before.
- `scripts/perf.mjs`, `scripts/load-check.mjs`: a new number, the MB asked for before the first frame (`firstDownloadMB`, `beforeFirstFrameMB`). The resource timing buffer is now 2000 entries: the default of 250 lost the start times of the late files on high pbr (about 310 files). `load-check.mjs` takes `--down <Mbps>` and `--rtt <ms>`.
- `scripts/pbr-downloads.mjs`: the downloads of a perf run by group and by file, split at the first frame. `pbr-downloads.md` is its output for the two builds.
- `docs/perf/budget.json`: `firstDownloadMB` caps on the pbr look (about 10% over the new values).

## Before / after

All runs: headless Chromium, SwiftShader (software GPU, 4 CPUs), cold cache, `?look=pbr&governor=0&npcseed=1`, 2 runs per row (median). "Before" is the base build, "after" is this branch. The raw files are in `runs/`.

### Download (`scripts/perf.mjs --looks pbr --repeat 2`, 1280 x 720, localhost)

| Tier | Before the first frame, before → after | Total (whole ride), before → after |
|---|---|---|
| low pbr | 6.74 → **4.33 MB** (-36%) | 10.28 → 10.28 MB |
| phone pbr | 6.31 → **3.90 MB** (-38%) | 13.82 → 13.82 MB |
| high pbr | 8.57 → **4.54 MB** (-47%) | 18.38 → 18.38 MB |

No file is new and no file is gone: the same bytes come, later.

### First frame (the `atl:first-frame` mark, ms from the navigation)

| Tier | localhost (`perf.mjs`) | Fast 4G, 9 Mbps, 60 ms (`load-check.mjs --cpu 1`, Pixel 7) | 1.6 Mbps, 150 ms (`load-check.mjs --cpu 1 --down 1.6 --rtt 150`) |
|---|---|---|---|
| low pbr | 7420 → 7394 | 8872 → 8606 | not run |
| phone pbr | 6777 → 7220 | 8828 → 8580 | **25833 → 20136** (-5.7 s) |
| high pbr | 7728 → 8038 | 9888 → 9483 | **33259 → 23137** (-10.1 s) |

- On localhost and on Fast 4G, this machine's CPU sets the first frame: at 9 Mbps the 4 to 9 MB arrive before the level view is built. The changes there (-0.4 to +0.4 s) are inside the run-to-run noise (up to 0.9 s between two runs of the same build).
- On the 1.6 Mbps link the first frame waits for the network, and it comes 22% (phone pbr) and 30% (high pbr) sooner. The two runs of each row are within 0.2 s of each other.
- This machine is slower than the machine of the 2026-11-07 baseline: the same base build gave 7.7 s on high pbr here, against 5.9 and 6.6 s there. So the 6 s target of the issue is not measured here; compare the before and after columns only.

### The rest of the frame (`perf.mjs`, median)

| Tier | Draw calls | Triangles | Textures | Geometries | Heap MB |
|---|---|---|---|---|---|
| low pbr | 95 → 94.5 | 307,119 → 305,714 | 126.5 → 125 | 102.5 → 102 | 39.4 → 40.0 |
| phone pbr | 109 → 111 | 381,987 → 377,118 | 194 → 194.5 | 128 → 127.5 | 42.9 → 41.4 |
| high pbr | 331 → 332 | 1,083,900 → 1,091,882 | 224.5 → 229.5 | 177 → 179.5 | 53.6 → 54.6 |

The same within the noise of the ride: the scene at the end of the ride is the same.

## The look once everything has loaded

`node scripts/late-load-look.mjs --tiers high,phone` takes 3 fixed views (the mural nearest the spawn, the trail, a street) after every late group has loaded, with the deferral and with `?lateload=0`, and a second default run for the noise. The pictures are in `look/`.

LOOK_RESULTS

## Tried and rejected: compile the shaders while the physics builds

The profile of the high pbr first frame has 2.0 to 2.3 s in the first draw (`getUniforms`, the program link). A `renderer.compileAsync()` before the physics build (with a render target, so that the programs match the ones of the post chain) linked 24 of the 63 programs before the first draw, but the first frame was 0.3 to 1.1 s later, not sooner: SwiftShader does not expose `KHR_parallel_shader_compile`, still compiles at the first draw, and the GPU process takes CPU from the physics build. It may help on a real GPU; that needs a real-GPU run. The code is not in this PR.

## Not verified

- No real GPU, no real phone, no real network. The networks are Chromium emulations.
- The first frame on high pbr is over the 6 s target of #190 on this machine (7.7 s before and 8.0 s after on localhost). The base build is over it here too, so the cause is the machine and the CPU-bound first frame (the level view build, about 4 s, and the first draw, about 2 s), not the downloads.
- The deferred murals and ground maps show for one or more frames as the host wall and the mean ground color. On a 1.6 Mbps link this lasts until the files arrive (about 10 s on high pbr). No person looked at that change.
