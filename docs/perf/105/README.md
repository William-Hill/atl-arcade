# Game feel: the phone frame time (#105)

Source: `scripts/perf.mjs --tiers phone --looks toon,pbr --repeat 3`, 2026-11-09, headless Chromium (SwiftShader), 1280 x 720, the BeltLine trail ride of 15 s (the same ride for each run). "Before" is `epic/city-look` at `7372b02`, built in a separate worktree. "After" is this branch. "After, `?fx=0`" turns off all the feel effects (shake, field of view, dust, sparks) and the #113 effects. Raw data: `phone-frame.json`.

| Phone tier | Frame mean (ms) | Frame p95 (ms) | Draw calls | `render` p95 (ms) |
|---|---|---|---|---|
| toon, before | 176.4 | 350.0 | 95 / 96 / 94 | 6.8 / 7.6 / 7.2 |
| toon, after | 175.2 | 355.5 | 95 / 96 / 96 | 7.8 / 6.8 / 9.0 |
| pbr, before | 1645.3 | 3577.6 | 112 / 112 / 112 | 32.7 / 22.9 / 21.2 |
| pbr, after | 1647.6 | 3583.2 | 114 / 113 / 113 | 31.5 / 28.4 / 23.5 |
| pbr, after, `?fx=0` | 1620.0 | 3488.8 | 112 / 109 / 111 | 21.0 / 25.3 / 26.9 |

The mean and p95 are the means of 3 runs.

- **The frame time does not get worse.** The differences (-0.7 % toon, +0.1 % pbr) are smaller than the spread between runs of the same build (up to 5 %).
- **Draw calls.** The dust and the sparks use the burst mesh of #113, so they add no mesh. A frame with particles has the 1 draw call of the burst mesh. On pbr the frame read has 1 or 2 calls more (113 to 114). A possible cause is the wider view at speed, which shows more objects; this was not proved. The phone cap is 185.
- **The `render` mean is not a useful number here.** It is above its p95 in every pbr run, so a few very slow frames set it. It goes from 58 to 148 ms between runs, also with `?fx=0` (58 to 140 ms). The p95 does not change.
- **The CPU side.** The per-frame code makes no new arrays or vectors when no effect runs (the review fixes of PR #236), and the attributes upload only when a mesh draws. The camera shake and the field of view are a few multiplications per frame. The sounds run on the audio thread.
- **The measured build** had 1 spark per slide tick on phone (2 on high) and a pool of 64. The final tuning has 2 on phone (3 on high) and a pool of 96. Sparks show only during a wall slide, and the burst mesh is still 1 draw call; a pool that is not full costs nothing. This tuning was not measured again.
- **Not measured**: a real GPU and a real phone. SwiftShader runs the GPU work on the CPU, so a GPU cost of a few particles cannot be seen here. Measure on a phone before release.
