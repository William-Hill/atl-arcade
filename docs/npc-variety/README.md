# NPC variety check (2026-11-07)

`npm run npc:variety -- --out DIR` (`scripts/npc-variety.mjs`) opens `?level=beltline-eastside` in headless Chromium for each look (pbr, toon) and tier (high, phone, low). It stops at 3 points on the trail (20 %, 45 %, 70 % of its length) and in one close view. At each stop it records the people on screen (`__atl.people.inView()`), the pairs with the same look within 40 m, and the walker heights.

## Before (epic/city-look at 93ba79c)

- High: 40 crowd NPCs, 120 walkers, 8 GLB people (pbr). Phone: 40, 50, 3. Low: 40, 70, 0.
- On screen: 12 to 57 people.
- pbr high, stop 1: 4 GLB people near the camera, only 2 models (2 repeat pairs). Stop 3 had 1 repeat pair: `before-pbr-high-2.jpg` shows two yellow-sundress women within about 20 m.
- The walkers had 3 box shapes with 1 fixed hair color each.

## After

| look | tier | crowd | walkers | GLB | on screen (stops 1-3, close) | near (< 40 m) | repeat pairs near |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pbr | high | 40 | 90 | 8 rigs + baked | 22, 18, 52, 13 | 3, 0, 10, 3 | 0 |
| pbr | phone | 40 | 45 | 3 rigs + baked | 12, 16, 34, 9 | 1, 2, 8, 1 | 0 |
| pbr | low | 40 | 60 | 0 (figures) | 24, 20, 39, 11 | 1, 4, 9, 2 | 0 |
| toon | high | 40 | 90 | 0 | 19, 19, 33, 13 | 2, 0, 5, 3 | 0 |
| toon | phone | 40 | 45 | 0 | 12, 12, 29, 9 | 2, 0, 4, 1 | 0 |
| toon | low | 40 | 60 | 0 | 27, 16, 29, 10 | 2, 3, 6, 2 | 0 |

Walker heights on screen: 1.53 to 1.91 m (range 1.52 to 1.94 m). GLB people: 1.65 to 1.82 m (manifest). Crowd adults: about 1.59 to 1.87 m.

The pbr rows are after the outfit variants. After the merge of #226 (every pbr walker a Meshy person) and before the variants, pbr high had 4 repeat pairs and pbr phone 4 at the busy stop (`merged-pbr-high-2-before-variants.jpg`). With `?pedrigs=0` (only baked walkers), pbr high: 0 repeat pairs at every stop (`after-pbr-high-close-baked.jpg`).

`variants-sheet.jpg`: the 15 retextures on the game meshes (row: person; column 0: its own texture where the render worked, columns 1-3: v1-v3). `stroller_dad_v1` (row 5, column 1) has lettering on the hoodie and is not shipped.

The walkers come and go with the camera, so the counts change from run to run. `report.json` has every stop.
