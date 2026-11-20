# Storefronts (BeltLine Eastside, pbr look)

Shop dressing for invented Eastside businesses in the spirit of the Eastside Trail, Edgewood Ave, North Highland, and Ponce: taqueria, BBQ, pizza, coffee, brewery, ice cream, books, records, skate shop, biscuits. Every name, sign, and icon is invented; no real business names, logos, or murals.

## Files

`assets/storefronts/` (all Draco GLBs, meters, glTF +y up, front at +z):

| File | Pieces | What |
|---|---|---|
| `sign_boards.glb` | 20 | `sign_board_<id>` 2.4 x 0.6 m fascia board, `sign_board_<id>_wide` 3.6 m (art centered, painted wings with rosettes). Gooseneck lamps with a lit lens on `lamps` businesses. |
| `blade_signs.glb` | 10 | `blade_sign_<id>` 0.72 x 0.54 m two-sided projecting sign (round, shield, or rect outline) on a wrought bracket with a scroll brace; reaches 1.0 m out. |
| `neon_signs.glb` | 8 | `neon_sign_<key>` 1.1 x 0.55 m dark acrylic plate on standoffs, emissive tube art (`sf_neon`); keys: taqueria, bbq, pizza, coffee, brewery, creamery, records, open. |
| `menu_boards.glb` | 6 | `menu_board_<id>` 0.6 x 0.98 m chalkboard menu in a wood frame with a chalk ledge (and a lamp where the shop has lamps). |
| `sandwich_boards.glb` | 4 | `sandwich_board_<id>` A-frame chalk board, art on both faces. |
| `cafe_barriers.glb` | 10 | `cafe_barrier_<id>` 1.8 m patio barrier with a two-sided banner of the shop board. |
| `patio_furniture.glb` | 11 + 8 LOD1 | bistro chairs (green, teal, red), bistro table, four-top table, slat chair, picnic table; sets `patio_set_bistro_<color>` (table + 2 chairs) and `patio_set_four` (table + 4 chairs) are empties whose children share the meshes. |
| `patio_umbrellas.glb` | 4 + 4 LOD1 | `patio_umbrella_<marigold,teal,tomato,sage>` 2.4 m market umbrellas with a base. |
| `string_lights.glb` | 4 + 4 LOD1 | `string_lights_<4,6,9>m` catenary strands (bulb every 0.5 m, sag 6%), `string_light_post` 3.3 m timber post in a planter. |
| `storefront-atlas.jpg` | 1 | the shared 1024 x 1024 sign atlas (38 regions, `storefront-atlas.json` has the rects). |

`provenance.json` lists every node with triangles and size, and the per-file bytes and textures. `stats.json` is the raw Blender output it is built from.

## Rebuild

```
node scripts/assets/storefront-atlas.mjs                       # sign art -> atlas (Chromium canvas)
~/tools/blender -b -P scripts/blender/storefronts.py -- assets/storefronts   # GLBs + stats.json
node scripts/assets/storefront-provenance.mjs                   # provenance.json
node scripts/assets/storefront-check.mjs --out lineup.png [--mode street] [--time dusk]   # load check + shots
node scripts/assets/storefront-context.mjs --out ctx.png [--bare]   # in the real pbr renderer
```

Businesses, colors, taglines, and which pieces each gets are data in `scripts/assets/storefront-businesses.json`.

## Facade grid assumptions

The sibling facade work (`assets/facades/`) was not available, so the pieces follow the shipped facade kit (`src/level/geo/facade-kit.js`, `styles.js`) and the brief:

- Ground floor 3.5-4.5 m (the kit storefront styles use 4.0-4.2 m; the context shot found a 5.0 m brick loft and the pieces still fit).
- Bays 3-6 m between 0.36 m piers. Use the 2.4 m board in 3-4.8 m bays and the `_wide` 3.6 m board in bays of 5 m and up.
- Sign band: from 0.84 x floor height to under the belt course (0.28 m tall, 0.18 m out). Center the board on the band; set it out by `KIT.sign.out + KIT.sign.boardOut` (0.09 m) so it covers the kit's painted board. The board body is 0.6 m tall, so it overlaps a 0.5 m band slightly.
- Blade signs: on the pier face (0.16 m out), bottom about 2.75 m over the sidewalk, so the sign clears heads (panel 2.75-3.3 m, bracket at 3.4 m).
- Neon: on the shop window, bottom 1.4-1.7 m. Menu boards: beside the door, bottom about 1.05 m.
- Patio: on the 3.5 m front apron (`aprons.js`): furniture 1.5-2.2 m out, barriers about 3.25 m out, sandwich boards about 1 m out. String lights from the wall under the belt course to a post at the apron edge.

Placement rule for every piece: wall pieces have their back on the wall plane (z = 0), x centered, y = 0 at their lowest point. Floor pieces stand on y = 0, centered. String strands are centered between their two anchors at y = 0 and hang below it; scale x to stretch them to a span (the bulbs stretch with them, so keep the scale within 0.75-1.5 or pick the next length).

## Materials and the pbr look

Six shared materials by name, so a loader can share them across files:

- `sf_sign`: atlas base color, roughness 0.5 (boards, blades, chalk, banners).
- `sf_neon`: atlas base and emissive, `KHR_materials_emissive_strength` 3.0, roughness 0.3 (neon art, the lamp lenses, the bulbs use 3.0 too). The pbr bloom threshold is 0.92 (`src/render/post.js`), so the tubes bloom at dusk and night, and in sun they read as lit color without washing out.
- `sf_paint`, `sf_metal`, `sf_wood`, `sf_fabric`: untextured, `COLOR_0` vertex colors, so every prop color costs no texture.

Light sign backgrounds were darkened (cream to `#e2d3b6`, peach to `#ee9670`, honey to `#e6b840`) after the first pass: at the pbr sun of 3.2 a near-white board crossed the 0.92 bloom threshold and glowed by day.

## Sign art

`scripts/assets/storefront-atlas.mjs` paints the atlas in headless Chromium with the 2D canvas: each icon (sun-taco, smokestack, rail-crust slice, cup on rails, hop on a spur, peach cone, dogwood book, sunburst record, quad skate, biscuit with honeysuckle) is drawn from paths in code, and the lettering is DejaVu Sans/Serif set by the canvas. Neon is drawn as glow strokes on a dark plate. A small seeded grain keeps the boards from looking flat. No image model, photo, or third-party art. Region rects are in `storefront-atlas.json`, and the GLBs reference the atlas as an external `storefront-atlas.jpg`, so a browser fetches and decodes it once.

## Invented businesses

| id | Name | Kind | Concept | Extra pieces |
|---|---|---|---|---|
| `taqueria` | Taquería Vía Verde | taqueria | Family taqueria named for the green trail out front; sun-and-taco sign in turquoise and marigold. | neon, menu, lamps |
| `bbq` | Smokestack Sisters BBQ | bbq | Two sisters' barbecue joint in an old rail-side warehouse; a brick smokestack curling a smoke ribbon. | neon, menu, lamps |
| `pizza` | PieLine Pizza Co. | pizza | Slice shop with a pun on the trail; the slice's crust is drawn as a rail track. | neon, menu |
| `coffee` | Railbed Roasters | coffee | Small-batch roaster on the old rail bed; a steaming cup on two rails. | neon, menu, sandwich, lamps |
| `brewery` | Old Spur Brewing Co. | brewery | Taproom on a former rail spur with a big patio and house-made root beer for the kids; hop cone and spur track. | neon, lamps |
| `creamery` | Peach Drip Creamery | creamery | Ice cream parlor famous for Georgia peach; a dripping peach scoop on a waffle cone. | neon, menu |
| `books` | Dogwood Page Books | books | Neighborhood bookshop with a kids' story hour; an open book blooming a dogwood flower. | sandwich, lamps |
| `records` | Groove Ward Records | records | Record shop with a listening bar and Saturday DJ sets; a vinyl record with a sunburst label. | neon, sandwich |
| `skate` | Rollway Skate Supply | skate | Roller skate shop and rental counter right on the trail (the game's home base); a classic quad skate. | sandwich |
| `bakery` | Honeysuckle Biscuit Co. | bakery | Southern biscuit bakery; a split biscuit with a honeysuckle bloom. | menu, lamps |

All family friendly: the brewery has house sodas and root beer on its sign, and the bookshop has a story hour. The names nod to the BeltLine's rail history (rail bed, spur, PieLine) and to Georgia (peach, dogwood, honeysuckle).

## Browser budget

| File | Pieces (LOD0+LOD1) | Triangles per piece | Bytes | Textures | GPU texture memory |
|---|---|---|---|---|---|
| `sign_boards.glb` | 20+0 | 60-440 | 89.0 KB | atlas 1024 JPEG (shared) | 5.6 MB shared |
| `blade_signs.glb` | 10+0 | 204-300 | 41.9 KB | atlas 1024 JPEG (shared) | 5.6 MB shared |
| `neon_signs.glb` | 8+0 | 120-120 | 21.2 KB | atlas 1024 JPEG (shared) | 5.6 MB shared |
| `menu_boards.glb` | 6+0 | 72-168 | 28.4 KB | atlas 1024 JPEG (shared) | 5.6 MB shared |
| `sandwich_boards.glb` | 4+0 | 120-120 | 19.1 KB | atlas 1024 JPEG (shared) | 5.6 MB shared |
| `cafe_barriers.glb` | 10+0 | 208-208 | 36.1 KB | atlas 1024 JPEG (shared) | 5.6 MB shared |
| `patio_furniture.glb` | 11+8 | 116-788 | 34.6 KB | none (vertex color) | 0 |
| `patio_umbrellas.glb` | 4+4 | 224-224 | 32.4 KB | none (vertex color) | 0 |
| `string_lights.glb` | 4+4 | 204-1704 | 28.5 KB | atlas 1024 JPEG (shared) | 5.6 MB shared |
| `storefront-atlas.jpg` | - | - | 322.6 KB | 1024 x 1024 JPEG | 5.3 MB (RGBA8 + mips) |

Total download: 654 KB. GPU texture memory: one atlas, 5.3 MB, if the loader shares the texture (scripts/assets/storefront-preview.js shows how: one GLTFLoader, the first atlas texture reused on every material). Without sharing each textured file decodes its own copy (7 x 5.6 MB).

The in-context shot places 39 pieces (6 bays dressed) for 10.5k triangles and 1 texture. A dressed bay is about 0.6-2.5k triangles; patio sets, umbrellas, and strands carry LOD1 meshes at a quarter to a half of the triangles. Sign pieces are 60-440 triangles and have no LOD; they are small enough to drop at distance instead.

## Preview hook

`scripts/assets/storefront-context.mjs` opens the real game (`?level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1&cam=...`), then dynamic-imports `scripts/assets/storefront-preview.js` into the page, which adds the pieces to `window.__atl.scene`. Nothing in `src/` changes, and the game build never imports the hook. It picks the storefront front wall (`frontEdges()`) nearest the spawn with flat ground in front.

## Open points

- Wiring into the game (which buildings get which shop, distance culling, instancing) belongs to the parent session.
- The facade kit's own painted sign boards stay under ours; a kit flag to skip them on dressed bays would avoid the overlap.
- Gooseneck lamps reach over the belt course; on a style with a deep belt they can touch it.
