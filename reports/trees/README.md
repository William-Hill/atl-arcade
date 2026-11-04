# Trees (#137): before and after

Before: `origin/main` at 4e64481. After: branch `claude/137-trees`. Data from `scripts/prop-perf.mjs`.

| Shot | Before | After |
|---|---|---|
| Street (North Avenue sidewalk), low tier | `street-low-before.png` | `street-low-after.png` |
| Street, high tier (GPU) | `street-high-gpu-before.png` | `street-high-gpu-after.png` |
| Park (Historic Fourth Ward Park), low tier | `park-low-before.png` | `park-low-after.png` |
| Park, high tier (GPU) | `park-high-gpu-before.png` | `park-high-gpu-after.png` |
| Spawn and overview, low tier | `spawn-low-*.png`, `overview-low-*.png` | |

| Tier | Camera | Calls | Triangles before | Triangles after |
|---|---|---|---|---|
| low | spawn | 49 | 124,874 | 134,138 |
| low | overview | 48 | 113,689 | 115,461 |
| low | street | 49 | 94,921 | 95,525 |
| low | park | 54 | 99,471 | 108,703 |
| phone | spawn | 50 | 164,129 | 173,393 |
| phone | street | 50 | 127,344 | 127,948 |
| phone | park | 55 | 139,090 | 148,322 |
| high (GPU) | spawn | 215 | 580,605 | 625,181 |
| high (GPU) | street | 185 | 483,281 | 484,489 |
| high (GPU) | park | 243 | 582,741 | 601,205 |

The draw calls are the same before and after. The FPS figures are in the JSON files. The load average was 13 to 23, so they do not show the cost of the trees. The `gate-*` files are from an earlier tree change.
