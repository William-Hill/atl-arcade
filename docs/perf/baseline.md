# Performance baseline and budget

Issue: #185. Branch base: `epic/city-look`. Date: 2026-11-06.

## How to run

```bash
npm run perf
```

`npm run perf` writes `reports/perf/perf.json` (gitignored). To refresh this baseline (2 runs per tier and look, about 40 minutes with the software GPU), run `npm run perf:baseline`.

The script builds `dist/`, serves it with `vite preview` (WASM gzipped, as on Vercel), and opens `?level=beltline-eastside` in headless Chromium for each tier (`low`, `phone`, `high`) and each look (`pbr`, `toon`). Each run rides the same 15 s of the trail from the spawn (the playtest's trail script, `src/playtest/trail-script.js`), and writes the JSON (and, with `--md`, the tables below). `--append` adds a pass to an existing JSON.

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
Run 2026-11-06 17:46 UTC, swiftshader (software, CPU), 4 CPUs, viewport 1280x720 @1, ride 15 s of game time (stopped after 150 s of wall time), 2 run(s) per row (median shown).

| Tier | Look | Mean ms | p95 ms | Median FPS | Draw calls | Triangles | Geometries | Textures | Heap MB | First frame ms | Load avg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| low | pbr | 2227.8 | 4416.45 | 0.5 | 138.5 | 276,716 | 104 | 163 | 38.3 | 9082.5 | 2.7 3.8 |
| low | toon | 253.35 | 483.3 | 4.3 | 164 | 251,918 | 139.5 | 211 | 56.25 | 6596.5 | 4 4.2 |
| phone | pbr | 1897 | 4158.2 | 0.5 | 145 | 337,459.5 | 121 | 202.5 | 41.8 | 7496.5 | 4.4 4.4 |
| phone | toon | 157.05 | 308.35 | 6.7 | 165 | 312,072 | 136.5 | 213 | 63.55 | 5727.5 | 4.1 4 |
| high | pbr | 10233.95 | 16499.3 | 0.1 | 502.5 | 1,415,795 | 199.5 | 365.5 | 50 | 12491 | 4.4 4.2 |
| high | toon | 3086.3 | 6308.1 | 0.3 | 785 | 1,410,199 | 161.5 | 255 | 45 | 8350.5 | 3.6 3.8 |

Download (MB on the wire, gzip as the host serves it):

| Tier | Look | JS | GLB | Textures | WASM | Data | Other | Total |
|---|---|---|---|---|---|---|---|---|
| low | pbr | 0.78 | 20.85 | 1.35 | 1.18 | 0 | 0.01 | 24.16 |
| low | toon | 0.84 | 15.77 | 0.51 | 1.18 | 0 | 0.01 | 18.31 |
| phone | pbr | 0.78 | 22.55 | 1.35 | 1.18 | 0 | 0.01 | 25.86 |
| phone | toon | 0.84 | 12.59 | 0.51 | 1.18 | 0 | 0.01 | 15.13 |
| high | pbr | 0.78 | 30.27 | 4.45 | 1.18 | 0 | 0.01 | 36.68 |
| high | toon | 0.84 | 15.77 | 1.8 | 1.18 | 0 | 0.01 | 19.61 |

Cost by system (`?perf=1`, CPU ms on the main thread). A sim system (skater, walkers, crowd, traffic, NPC skaters) runs once per 1/60 s step; the table gives its cost per step, which is its cost per frame at 60 FPS. A view or the render runs once per frame; the table gives the mean per frame. `render` is the CPU side of `renderer.render` only: the software GPU works in another process.

| Tier | Look | render | skater | walkers | walkersView | crowd | crowdView | traffic | trafficView | npcSkaters | npcSkatersView | views | Steps per frame |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| low | pbr | 7.604 | 0.258 | 0.793 | 0.066 | 0.202 | 0.048 | 0.711 | 0.434 | 0.801 | 0.414 | 2.782 | 4.676 |
| low | toon | 15.087 | 0.093 | 0.559 | 0.11 | 0.131 | 0.046 | 0.543 | 0.2 | 0.387 | 0.322 | 1.96 | 4.664 |
| phone | pbr | 71.453 | 0.184 | 0.712 | 0.953 | 0.208 | 0.137 | 0.852 | 0.572 | 0.801 | 0.456 | 2.253 | 4.693 |
| phone | toon | 9.202 | 0.097 | 0.497 | 0.078 | 0.151 | 0.056 | 0.599 | 0.262 | 0.415 | 0.363 | 1.91 | 4.587 |
| high | pbr | 34.617 | 0.493 | 1.701 | 1.364 | 0.423 | 0.043 | 1.103 | 0.798 | 0.793 | 0.779 | 633.531 | 5 |
| high | toon | 17.487 | 0.256 | 1.38 | 0.125 | 0.17 | 0.057 | 0.774 | 0.457 | 0.826 | 0.766 | 2.404 | 4.736 |
<!-- perf:end -->

## Budget

### Caps (checked by `npm run perf:check`)

`docs/perf/budget.json` caps the numbers that do not depend on the machine, about 10% over this baseline. The draw calls and triangles come from the last frame of the ride, so the caps hold only for the default 15 s ride (a 5 s ride ends at another place with 194 draw calls on low toon). A PR that goes over a cap fails the check. To raise a cap, the PR changes `budget.json` and says why in `docs/decisions.md`.

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

1. **The pbr look's shading** (#191). On the same tier and the same pixels, the pbr look's frame takes 8.8 times as long as the toon look on low (2228 ms against 253 ms), 12 times as long on phone (1897 against 157), and 3.3 times as long on high (10234 against 3086). The draw calls are about the same (139 against 164 on low), so the cost is in the pixels: standard materials with the env map and the height fog on every pixel. Relative only (software GPU), but it is the largest ratio in the run. The phone tier gets toon by default; keep it that way until a phone run says otherwise.
2. **The skater GLBs** (#187). The player and the NPC skaters load two skater models: 7.6 MB and 6.2 MB (13.8 MB, 75% of the low/toon download of 18.3 MB). The phone tier loads the 1024 px variants and still gets 5.3 MB and 5.2 MB (10.5 MB of 15.1 MB). Compressed textures (KTX2) and meshopt, or a lazy load of the second model, would bring the phone tier near its 10 MB target.
3. **The high tier's draw calls and triangles** (#188). 503 draw calls (pbr) and 785 (toon) against 139 to 165 on low and phone, and 1.41 M triangles against 0.25 to 0.34 M. The high toon frame has 56% more draw calls than the high pbr frame; the cause is not measured yet (candidates: the toon outlines, the halftone and ink passes of the full post chain, and the longer draw distance of the high tier, 650 m against 320 m).
4. **The sim and view CPU per frame, walkers first** (#189). On high, the walkers take 1.5 to 1.7 ms per step (120 walkers) and their view 0.15 to 1.26 ms (pbr: the Meshy people); traffic 0.8 to 1.1 ms plus 0.45 to 0.75 ms for the view; NPC skaters 0.8 to 0.9 ms plus 0.85 ms. The other views take 2.5 ms. Together that is about 7.2 ms (toon) to 10 ms (pbr) of CPU per frame on high before the render, on this machine's CPU; on low toon it is about 4.4 ms. The `render` CPU (the Three.js side of the draw) is 7 to 35 ms per frame on top.
5. **The pbr look's extra downloads and the first frame** (#190). The pbr look adds 6 to 17 MB to the download: high pbr is 36.7 MB (30.3 MB GLB, 4.5 MB textures) against 19.6 MB for high toon. The car GLB (`vehicles_lod`, 1.7 MB) is the largest after the skaters. The first frame on localhost with no network limit is 5.7 s (phone toon) to 12.5 s (high pbr).

## Not verified

- No run on a real GPU or a real phone. All the frame times are SwiftShader.
- The heap moves with the garbage collector from run to run.
- On high pbr, run 2 had one frame of about 21 s inside `views` (its mean is 1264 ms, its p95 7.7 ms; run 1 had 2.5 ms). The high pbr run is the only one with both the sky dome and the pbr light pass, so the likely cause is an environment map bake (`src/render/pbr-look.js` bakes again when the sky colors move). Not confirmed. The median of 2 runs keeps half of it, so read the high pbr `views` cell as an outlier.
- The phone tier here is the phone settings in a desktop viewport (1280 x 720 at pixel ratio 1), not a phone screen.
