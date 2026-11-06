# Performance baseline and budget

Issue: #185. Branch base: `epic/city-look`. Date: 2026-11-06.

## How to run

```bash
npm run perf
```

This builds `dist/`, serves it with `vite preview` (WASM gzipped, as on Vercel), and opens `?level=beltline-eastside` in headless Chromium for each tier (`low`, `phone`, `high`) and each look (`pbr`, `toon`). Each run rides the same 15 s of the trail from the spawn (the playtest's trail script, `src/playtest/trail-script.js`), and writes `docs/perf/baseline.json` and the tables below. Add a second pass with `node scripts/perf.mjs --no-build --append --out docs/perf/baseline.json --md docs/perf/baseline.md`.

To check a PR against the budget (exit 1 when a cap is over):

```bash
npm run perf:check
```

Options: `--tiers low,phone`, `--looks toon`, `--seconds 15`, `--max-wall 150`, `--repeat 2`, `--extra "&peds=0"`, `--gpu` (the machine GPU, ANGLE Metal on a Mac), `--dist <folder>`, `--no-build`.

Every run uses `?perf=1&governor=0&run=free&mute=1&npcseed=1`, a 1280 x 720 viewport at pixel ratio 1 (the same pixels on every tier, so the tiers differ only in their settings), and a cold cache. The first-load check on an emulated Pixel 7 on Fast 4G stays in `npm run loadcheck` (`scripts/load-check.mjs`).

### What each number is

- **Mean ms, p95 ms, median FPS**: the frame time over the ride (`requestAnimationFrame` to `requestAnimationFrame`), without the first 5 frames.
- **Draw calls, triangles**: `renderer.info.render` for one whole frame (all post passes), at the end of the ride.
- **Geometries, textures**: `renderer.info.memory` at the end of the ride.
- **Heap MB**: the used JS heap (CDP `Runtime.getHeapUsage`) at the end of the ride. It moves with the garbage collector by 20 to 30 MB from run to run.
- **First frame ms**: the `atl:first-frame` mark, from the start of the navigation, on localhost with no network limit.
- **Download**: the bytes on the wire (gzip as the host serves it) by type, from the start until the end of the ride. The level JSON is in the JS chunks.
- **Cost by system** (`?perf=1`, `src/perf/frame-cost.js`): `performance.now()` around each system in `src/main.js`. Off by default: without `?perf=1` the calls go to a no-op object. `walkers`, `crowd`, `traffic`, `npcSkaters`, and `skater` are the sim steps; `walkersView`, `crowdView`, `trafficView`, and `npcSkatersView` are their view syncs; `views` is everything else in the frame (the skater view, HUD, minimap, sky, weather, the pbr light pass, signs, props); `render` is `renderer.render` and the post chain.

## Read this first: the GPU numbers are relative only

Headless Chromium in this cloud machine draws with **SwiftShader, a software GPU that runs on the CPU** (4 CPUs here). A frame that takes 3 s here can take 10 ms on a real GPU. So:

- The frame times and the `render` cost are good only to **compare two builds on the same machine**, in the same session. They say nothing about the FPS on a phone.
- The draw calls, triangles, geometries, textures, heap, and download bytes do **not** depend on the GPU. They are the numbers the budget caps.
- The sim costs (`walkers`, `traffic`, ...) are CPU time and are real, but this machine's CPU is not a phone CPU. A mid-range phone is about 2 to 4 times slower per core than this machine.
- At under 10 FPS, the fixed-step loop runs up to 5 sim steps in one frame. The table gives the sim cost per step (the cost of a frame at 60 FPS).
- On the high tier and on the pbr look, the software frames take seconds, so the ride stops at 150 s of wall time with only 8 to 73 frames (`finished: false` in the JSON). Those frame times are rough.

## Results

<!-- perf:begin -->
<!-- perf:end -->

## Budget

### Caps (checked by `npm run perf:check`)

`docs/perf/budget.json` caps the numbers that do not depend on the machine, about 10% over this baseline. A PR that goes over a cap fails the check. To raise a cap, the PR changes `budget.json` and says why in `docs/decisions.md`.

| Tier | Draw calls | Triangles | Textures | Heap MB | Download MB | JS MB |
|---|---|---|---|---|---|---|
| low | 185 | 310,000 | 235 (pbr 270) | 100 | 20.5 (pbr 26.5) | 1.0 |
| phone | 185 | 375,000 | 235 | 100 | 16.7 (pbr 28.5) | 1.0 |
| high | 870 (pbr 555) | 1,550,000 | 400 | 100 | 21.6 (pbr 40.4) | 1.0 |

### Targets (on real devices, to reach by version 1)

The caps stop the game from getting worse. The targets say where it must go. They need a real device run (not headless), and they are what the follow-up issues work toward.

| Tier | Device | Frame | Draw calls | Triangles | First download | First frame |
|---|---|---|---|---|---|---|
| phone (toon) | a mid-range phone (Pixel 6a, Galaxy A54 class) | 60 FPS: mean 16.7 ms, p95 20 ms | 150 | 300,000 | 10 MB | 4 s on Fast 4G (`npm run loadcheck`) |
| low (toon) | the headless playtest | median 55 FPS on the Mac (the playtest gate) | 150 | 300,000 | 15 MB | 4 s |
| high (pbr) | a laptop with an integrated GPU (Apple M1, Intel Iris Xe) | 60 FPS: mean 16.7 ms, p95 22 ms | 500 | 1,200,000 | 25 MB | 6 s |

CPU on the main thread at 60 FPS, as `?perf=1` measures it on this machine: all the sim steps together 2 ms, all the views 2.5 ms, so a phone at 2 to 4 times slower keeps under 10 ms of its 16.7 ms frame for the CPU side.

## Top 5 costs (follow-up issues)

The numbers are from the 2026-11-06 baseline above. Each one is a GitHub issue linked from #185.

1. **The pbr look's shading.** On the same tier and the same pixels, the pbr look's frame takes 8.5 times as long as the toon look on low (2153 ms against 252 ms), 12 times as long on phone (1940 against 159), and 3.6 times as long on high (11193 against 3130). The draw calls are about the same (138 against 164 on low), so the cost is in the pixels: standard materials with the env map and the height fog on every pixel. Relative only (software GPU), but it is the largest ratio in the run. The phone tier gets toon by default; keep it that way until a phone run says otherwise.
2. **The skater GLBs.** The player and the NPC skaters load two skater models: 7.6 MB and 6.2 MB (13.8 MB, 75% of the low/toon download of 18.3 MB). The phone tier loads the 1024 px variants and still gets 5.3 MB and 5.2 MB (10.5 MB of 15.1 MB). Compressed textures (KTX2) and meshopt, or a lazy load of the second model, would bring the phone tier near its 10 MB target.
3. **The high tier's draw calls and triangles.** 503 draw calls (pbr) and 786 (toon) against 138 to 165 on low and phone, and 1.41 M triangles against 0.25 to 0.34 M. The high toon frame has 56% more draw calls than the high pbr frame; the cause is not measured yet (candidates: the toon outlines, the halftone and ink passes of the full post chain, and the longer draw distance of the high tier, 650 m against 320 m).
4. **The sim and view CPU per frame, walkers first.** On high, the walkers take 1.5 to 1.7 ms per step (120 walkers) and their view 0.15 to 1.26 ms (pbr: the Meshy people); traffic 0.8 to 1.1 ms plus 0.45 to 0.75 ms for the view; NPC skaters 0.8 to 0.9 ms plus 0.85 ms. The other views take 2.5 ms. Together that is about 7.6 ms (toon) to 10 ms (pbr) of CPU per frame on high before the render, on this machine's CPU; on low toon it is about 4.5 ms. The `render` CPU (the Three.js side of the draw) is 7 to 35 ms per frame on top.
5. **The pbr look's extra downloads and the first frame.** The pbr look adds 6 to 17 MB to the download: high pbr is 36.7 MB (30.3 MB GLB, 4.5 MB textures) against 19.6 MB for high toon. The car GLB (`vehicles_lod`, 1.7 MB) is the largest after the skaters. The first frame on localhost with no network limit is 5.6 s (phone toon) to 12.6 s (high pbr).

## Not verified

- No run on a real GPU or a real phone. All the frame times are SwiftShader.
- The heap moves with the garbage collector from run to run.
- The phone tier here is the phone settings in a desktop viewport (1280 x 720 at pixel ratio 1), not a phone screen.
