# PBR look pass (#157, #160): before and after

Real renderer, Playwright headless (Chromium + SwiftShader), 1280×720,
`node scripts/art/pbr-frames.mjs` at the standard cameras of
`scripts/art/shots-today.json`, with the BASE params of that script
(`look=pbr`, `quality=high`, `date=06-21`, `weather=clear`, `npcs=0`,
`cars=0`, `view=fixed`).

- `before/`: `epic/city-look` at adf3577.
- `after/`: this branch.

| Frame | Time | Draw calls before → after | Triangles before → after | Luma p2 / p50 / p98 before | after |
| --- | --- | --- | --- | --- | --- |
| trail | 13:30 | 358 → 358 | 1,000,133 → 1,000,133 | 14 / 135 / 215 | 0 / 148 / 235 |
| street | 13:30 | 218 → 218 | 970,317 → 970,317 | 17 / 135 / 189 | 14 / 148 / 196 |
| pcm | 13:30 | 144 → 144 | 500,955 → 500,883 | 14 / 70 / 198 | 20 / 84 / 210 |
| skater | 13:30 | 526 → 526 | 1,472,245 → 1,472,245 | 14 / 148 / 221 | 0 / 164 / 230 |
| dusk | 20:36 | 404 → 404 | 1,077,889 → 1,077,889 | 12 / 48 / 180 | 0 / 50 / 189 |
| night | 22:30 | 226 → 226 | 978,603 → 978,603 | 13 / 37 / 183 | 7 / 26 / 179 |

Luma is Rec. 709 on the 8-bit sRGB frame (0–255). The art direction gate
for a day frame is p2 ≤ 20 and p98 ≥ 230.

The draw calls and the triangles count the whole frame (all post passes),
from `renderer.info` after the capture. The numbers include the
pedestrians (#171), so they are higher than the table in
`docs/art-direction-pbr.md`, which was measured before them.

## Other tiers (640×360, trail camera, `scripts/art/pbr-check.mjs`)

| Run | Draw calls | Triangles | Frame time (mean of 4, SwiftShader) | Page errors |
| --- | --- | --- | --- | --- |
| phone tier, before (2 runs) | 86 | 194,291 | 106 ms, 342 ms | none |
| phone tier, after (2 runs) | 86 | 194,291 | 97 ms, 91 ms | none |
| `?look=toon` high, after | 400 | 889,535 | — | none |
| `?quality=low`, after | 85 | 161,567 | — | none |
| `?quality=low&look=pbr`, after | 66 | 171,347 | — | none, 0 toon materials |

The frame times are from a shared 4-core machine with no GPU. They are
noisy and are not the FPS gate of #157.
