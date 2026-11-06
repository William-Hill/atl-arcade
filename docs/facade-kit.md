# Facade kit (pbr look)

`assets/facades/facade-kit.glb` is a kit of small instanceable building modules
for the Beltline Eastside level (Old Fourth Ward, Inman Park, Poncey-Highland):
storefronts, upper windows, cornices and parapet caps, belt courses, awnings,
balconies, fire escapes, wall AC units, roof units, and trim. It is built by
`scripts/blender/facade_kit.py` (Blender 5.2.3, headless, no Meshy). The pbr
look draws it in the game (see "In the game" below); the toon look keeps the
procedural kit.

    ~/tools/blender -b -P scripts/blender/facade_kit.py -- assets/facades --stats /tmp/fk-stats.json
    node scripts/assets/facade-kit-check.mjs --out lineup.png --lod1 lod1.png
    node scripts/assets/facade-kit-preview.mjs reports/facade-kit brick-loft:street storefront:corner
    npx vitest run scripts/assets/facade-kit-placement.test.js

## The file

- One GLB, 400 KB: 35 modules + 4 `_lod1` nodes = 39 mesh nodes, Draco
  (level 7, quantized position 14 / normal 10 / uv 12 / color 10 bits).
  Geometry is 66 KB, the textures 297 KB, the glTF JSON (extras) 37 KB.
- **One material** (`facade_kit`, single sided) with one trim-sheet atlas:
  baseColor 1024² JPEG, normal 1024² JPEG, metallicRoughness 512² JPEG
  (G = roughness, B = metalness). GPU memory with mips (RGBA8):
  5.6 + 5.6 + 1.4 = **12.6 MB once for the whole kit**.
- Each mesh has a `COLOR_0` "shade" (baked occlusion in the creases) and UVs
  into horizontal strips of the atlas. u tiles (2 m per atlas width,
  `REPEAT`), so a run scaled along x does not smear the strip.
- Atlas strips (v in px from the top): brick 0–154, stone/cast trim 154–266,
  stucco 266–362, painted wood/trim 362–442, dark metal 442–522, sage steel
  frame 522–586, galvanized gray 586–698, louver 698–762, glass 762–858,
  striped fabric 858–954, plain fabric 954–986, rubber 986–1002, concrete
  1002–1024.
- Every node carries `extras.kit` (Three.js: `mesh.userData.kit`):
  `kind` (`wall`, `wall-run`, `wall-corner`, `roof`), nominal `size` [x,y,z],
  `anchor` (in words), `fits` (the styles it is for), `scaleX`/`scaleY`
  (the allowed scale range), `tint` (true: multiply by a per-building color),
  and `lod1` (the name of the LOD1 node). A `_lod1` node has `lod_of`.

## Module frame

- Meters, glTF +y up. **+x along the wall** (the way the facade u grows),
  **+z out of the wall**. The origin is on the wall plane (z = 0); faces that
  would sit on the wall are not built.
- Wall modules: the origin is at the anchor below (bottom center for most).
  Roof modules: bottom center, on the roof surface.
- Corner modules (`*_corner`): the origin is the outside corner on the wall
  line. Wall A ends there going +x; wall B leaves it toward -z.
- On an outer ring from `orientRing(b.outer, false)` edge i has tangent
  `t = (q - p)/|q - p|` and outward normal `n = (-t.z, t.x)` (as `offsetRing`
  and `wallOf` in `src/level/geo/facade-kit.js`). The instance yaw is
  `atan2(-t.z, t.x)`: it turns module +x onto t and +z onto n.

## Modules

Sizes are the nominal `extras.kit.size` (what snapping uses); the bounds can
be a few cm bigger (sills and caps stick out).

| module | size x·y·z (m) | anchor | fits |
|---|---|---|---|
| `storefront_glass_26/32/45` | 2.24 / 2.84 / 4.14 × 3.3 × 0.15 | wall base, bay center | storefront ground floor, bay 2.6 / 3.2 / 4.5 m minus a 0.36 m pier |
| `storefront_door_26/32/45` | same as glass | same | the door bay (one per front wall) |
| `window_brick_loft` | 2.10 × 2.90 × 0.14 | frame bottom center | brick-loft (window 0.55×0.62 cells, bay 3.4, floor 4.2), storefront upper floors |
| `window_brick_warehouse` | 3.00 × 2.85 × 0.14 | frame bottom center | brick-warehouse (0.6×0.5, bay 4.5, floor 5) |
| `window_stucco_apartment` | 1.56 × 1.98 × 0.10 | frame bottom center | stucco-apartment, craftsman-house, shotgun-house |
| `window_stucco_modern` | 2.00 × 2.28 × 0.22 | frame bottom center | modern-apartment (0.7×0.62, bay 2.6, floor 3.3) |
| `cornice_segment` / `cornice_corner` | 2.0 × 0.76 × 0.5 / 1.1 × 0.76 × 1.1 | wall top − 0.76 | parapet ≥ 0.5 m and height > 5 m, street walls |
| `parapet_cap_segment` / `_corner` | 2.0 × 0.2 × 0.45 / 0.67² | parapet top, `top + style.parapet` (the cap reaches 0.38 m back over the roof) | every wall of a flat-roof style with a parapet |
| `belt_course_segment` / `_corner` | 2.0 × 0.26 × 0.12 / 0.72² | belt line (top of the ground floor) − 0.13 | storefront styles with 2+ floors |
| `awning_fabric` (tint) | 2.84 × 1.02 × 1.2 | top edge at the bay center, under the sign band | storefront, stucco |
| `awning_metal` | 2.84 × 1.14 × 1.0 | canopy top at the bay center | brick, modern, glass |
| `balcony_juliet` | 2.02 × 1.07 × 0.32 | floor line, window bay center | stucco-apartment, brick-loft upper floors |
| `balcony_slab` (+lod1) | 3.0 × 1.27 × 1.4 | floor line (slab top), bay center | modern-apartment upper floors |
| `fire_escape_floor` (+lod1) | 3.4 × 4.8 × 1.1 | floor line, window bay center; scale y by `floorH / 4.2` (the stair rise) | brick-loft, brick-warehouse, stucco-apartment side/back walls |
| `fire_escape_top` (+lod1) | 3.4 × 1.0 × 1.1 | floor line of the top floor | caps the stack |
| `fire_escape_ladder` | 0.49 × 3.3 × 0.82 | floor line of the lowest platform | hangs under it |
| `ac_unit_wall` | 0.66 × 0.78 × 0.45 | bottom center, 0.45 m under a window bottom | side walls of apartments and houses |
| `hvac_rooftop` (+lod1) | 2.5 × 1.41 × 1.46 | bottom center on the roof | flat roofs > 300 m² |
| `hvac_condenser` | 0.92 × 1.04 × 0.92 | roof | one per 150 m², max 4 |
| `roof_exhaust` | 0.84 × 0.70 × 0.84 | roof | storefront roofs |
| `roof_vent` | 0.40 × 0.64 × 0.40 | roof | 2–4 on any flat roof |
| `trim_pilaster` / `_cap` (tint) | 0.4 × 1 × 0.08 / 0.5 × 0.26 × 0.16 | bay line, wall base; scale y to the run | storefront piers |
| `trim_downspout` / `_head` / `_shoe` (tint) | 0.14 × 1 × 0.145 / 0.32 × 0.62 × 0.2 / 0.1 × 0.5 × 0.41 | run base + 0.5 / roof line − 0.62 / wall base | next to a fire escape or a corner |
| `trim_sign_board` (tint) | 1.88 × 0.58 × 0.065 | bottom center on the sign band | blank: a shop-name decal goes on top (fictional names only) |
| `trim_gooseneck_lamp` | 0.34 × 0.42 × 0.79 | wall plate, 0.35 m over a sign board | over sign boards |

## Snapping rules

These follow the grid the game already draws, so a module covers the facade
shader's own window (src/render/geo-view.js) instead of fighting it.

1. **Bays.** A wall of length L has `bays = max(1, round(L / style.bay))` and
   `bl = L / bays` (as `shopFront` in facade-kit.js). Modules are centered at
   `(k + 0.5) · bl` along the wall. Walls under 1.5 m get nothing
   (`KIT.sill.minWall`).
2. **Floors.** Floor f starts at `base + f · floorH`
   (`buildingSpan(level, b).base`); `floors = max(1, round(height / style.floorHeight))` and `floorH = height / floors`, the same split as `facadeKit()` and the shader, so modules land on the shader's window cells.
   A window is not placed if its frame top would reach the wall top.
3. **Windows.** The shader frame is `(window + FRAME)` cells (FRAME = 0.07),
   centered at `WINDOW_CENTER = 0.55` of the floor. So
   `scaleX = (window[0] + 0.07) · bl / size.x`,
   `scaleY = (window[1] + 0.07) · floorH / size.y`, and the frame bottom
   is `(0.55 − (window[1] + 0.07) / 2) · floorH` over the floor line.
   The module sizes are the style's own frame at its nominal bay, so the
   scale is 1.0 on a nominal bay.
4. **Storefronts.** Opening `bl − 0.36` (`KIT.pier.width`): pick the width
   (26/32/45) nearest to it, then `scaleX = opening / size.x`;
   `scaleY = (0.84 · floorH − 0.04) / 3.3` (the sign band starts at
   `KIT.sign.y0 = 0.84` of the floor). One door bay in the middle of the
   front edge, glass elsewhere, pilasters on the bay lines between.
5. **Runs.** Cornice, parapet cap and belt course are 2 m segments:
   `n = max(1, round(L / 2))`, `scaleX = L / n / 2` (0.75–1.25), centered at
   `(k + 0.5) · L / n`. A corner piece goes at each outside corner with a
   turn of 75–105°; other corners rely on the segment overlap.
6. **Scale limits.** Never scale past `extras.kit.scaleX/scaleY`; skip the
   module instead (the shader window still shows). z is never scaled.
7. **Tint.** `tint: true` modules are near-white in the atlas; set the
   instance color (`InstancedMesh.setColorAt`) to `style.trim` (trim) or the
   building's awning color (`AWNING_COLORS[seed % n]`).
8. **Roof.** Roof units sit on `top` (`buildingSpan().top`), at least 1.5 m
   plus their own clearance from every wall, not overlapping each other, in
   90° yaw steps. Houses, glass offices, parking decks and industrial sheds
   get no roof kit.

## Placement algorithm (for the parent session)

`scripts/assets/facade-kit-placement.js` implements the rules above as a pure
function with Vitest tests (`facade-kit-placement.test.js`); it does not
import Three.js:

```js
import { facadePlacements, byModule, instanceMatrix, LOD1, LOD1_DISTANCE } from "../../scripts/assets/facade-kit-placement.js";
const list = facadePlacements({
  ring: orientRing(b.outer, false),
  holes: b.holes ?? [],                       // courtyards: no roof units there
  style: STYLES[STYLE_INDEX[chooseStyle(b, level)]],
  base: span.base, top: span.top,             // buildingSpan(level, b)
  front: frontEdges(level).get(b.id) ?? null, // the storefront edge + wraps
  mural: murals.get(b.id) ?? null,            // muralWalls(level) by building id
  seed: hash32(String(b.id)),
});
// -> [{ module, wall, position: [x, y, z], rotationY, scale: [sx, sy, 1], tint }]
```

Per building:

1. Front walls = `front.edge` plus `front.wraps`: the storefront wall the game
   already finds from the real OSM/Overture street lines (`frontEdge`).
   Storefront styles get storefront bays, sign boards, pilasters, a belt
   course, and awnings (chance `max(style.awnings, 0.5)` per bay) on the
   primary front. A wrap wall gets only its corner bay (glass + sign board),
   like `shopFront()`.
2. Every wall ≥ 1.5 m gets the style window on every floor. Storefront styles
   skip the ground floor on every wall, because the shader paints shop glass
   there (and `wallDepth()` puts no sill there).
   With a `mural`, no wall module goes on the mural rectangle or within
   `MURAL_CLEAR = 0.3` m of it, and the fire escape avoids that wall.
3. Upper floors of front walls: a balcony on ~18% of the bays (modern: slab;
   stucco/brick loft: juliet). Other walls: an AC unit on ~10% of windows.
4. Brick and stucco apartments with 3+ floors: a fire escape on the longest
   non-front wall ≥ 8 m (50% chance), on its middle bay, with a downspout
   2.2 m beside it. The windows behind it are skipped.
5. The roof line, as `buildingKit()`: cornice at the wall top on the front
   walls of a tall parapet style (all walls if it has no storefront), and a
   parapet cap at `top + style.parapet` on every wall when the style has a
   parapet (none otherwise). Corner pieces go at the outside corners: a cap
   corner at each, a cornice corner between two cornice walls.
6. `fire_escape_floor` scales y by `floorH / FIRE_ESCAPE_RISE` (4.2 m, the
   stair rise; the 4.8 m nominal height includes the top handrail), so each
   stair lands on the next platform.
7. Roof units on flat roofs (rule 8), never in a courtyard (`holes`) or
   within 1.5 m + clearance of its edge.

Wiring guidance (done as described in "In the game" below):

- One `InstancedMesh` per module per depth tile (`DEPTH_TILE = 50`);
  `byModule()` groups the list. All share the one material, so at most ~39
  draw calls per tile, in practice 10–20. Merge tiles if draw calls matter
  more than culling.
- `<module>_lod1` past `LOD1_DISTANCE = 60` m; drop the small wall modules
  (AC units, lamps, downspout parts, sign boards) past ~120 m; past the
  existing `lod0` distance the shader facade alone is enough.
- Where the kit is on, turn off the procedural parts it replaces on those
  walls: sills (`wallDepth`), piers and sign bands (`shopFront`), and the
  `KIT.awning` awnings. The preview does it the blunt way with `?kit=0`
  (which also drops cornices, crowns and pitched house roofs).
- Under `?look=pbr` only; the toon look keeps the procedural kit.

## In the game

- `src/level/geo/facade-kit-glb.js` (pure): `facadeKitPlacements(level,
  fronts, { signs })` runs `facadePlacements()` for every building that is not
  a claimed landmark footprint, with `floors = floorCount()` (the shader's
  floors, OSM levels included) and the door bay of `frontEdges()`, and groups
  the modules by the 50 m depth tile of `facadeKit()`. It returns the tiles,
  the per-building `covers` (`kitCovers()`), and the shop-name boards on the
  GLB sign boards. A GLB sign board under a shop sign (`shop-signs.js`) is
  left out.
- `GLB_SKIP` keeps the procedural awnings, cornice, coping, and belt course:
  those are in the building tiles, drawn at every distance, so the roof line
  does not go bare past `DEPTH_DISTANCE`.
- `buildingKit()` / `wallDepth()` / `shopFront()` / `shopEntrance()` take the
  `covers`: no sill, lintel or head on a window with a GLB frame, no pier on a
  bay line with a GLB pilaster, no sign band on a bay with GLB shop glass, no
  procedural door with a GLB door (the step and lamps stay). The shader glass
  stays: the modules frame it (they have no face on the wall plane).
- `src/render/facade-kit-view.js`: `loadFacadeKit()` (Draco) runs in
  `main.js` while the meshes build; one `InstancedMesh` per module per depth
  tile, visible closer than `DEPTH_DISTANCE` (120 m, with the procedural depth
  tiles), the `_lod1` node of a tile past `LOD1_DISTANCE` (60 m, by tile
  center). The shop names on a tile's GLB sign boards are in the same tile
  group, so they hide with their boards.
- `createGeoView(..., { kitGlb })`: `kitGlb` is the loaded nodes or null; on
  with `look === "pbr"`, `kit` and `depth`. A failed load passes null: the
  procedural kit stays whole (nothing is turned off before the GLB is in).
  On a mural wall, no window frame goes from `mural.floor0` up (the shader
  blanks that wall, as `wallDepth()` drops its sills). `?kitglb=0` leaves the GLB kit out (the procedural kit is whole
  again), `?kit=0` drops both, `?depth=0` drops both depth-tile kits.
  `window.__atl.level.facadeGlb` has the counts (instances, tiles, near, lod1,
  drawCalls, triangles, loaded).
- `node scripts/assets/facade-kit-wired.mjs OUT_DIR [kind:labview ...]`:
  labeled BEFORE (`?kitglb=0`) and AFTER shots from the same camera, with the
  costs, and the toon and `?kit=0` checks.

## Preview in the real renderer

`node scripts/assets/facade-kit-preview.mjs OUT_DIR kind:labview ...` opens
the game on a lab building view (`?lab=building&kind=…&labview=…` on the
representative pbr URL), saves a BEFORE shot, reloads with `?kit=0`, imports
`scripts/assets/facade-kit-preview.js` into the page, and adds the instanced
kit to `window.__atl.scene` for every building within 140 m of the camera,
then saves an AFTER shot. No shared game file is changed; it uses only the
existing `__atl.scene` and `__atl.cameraPosition` debug handles.

## Budget

| node | tris | Draco bytes | size x·y·z (m) |
|---|---:|---:|---|
| `ac_unit_wall` | 110 | 1,599 | 0.66·0.78·0.45 |
| `awning_fabric` | 82 | 1,552 | 2.87·1.06·1.20 |
| `awning_metal` | 64 | 1,175 | 2.88·1.18·1.00 |
| `balcony_juliet` | 270 | 2,243 | 2.02·1.17·0.32 |
| `balcony_slab` | 478 | 3,260 | 3.00·1.27·1.40 |
| `balcony_slab_lod1` | 158 | 1,676 | 3.00·1.27·1.40 |
| `belt_course_corner` | 28 | 606 | 0.72·0.26·0.72 |
| `belt_course_segment` | 18 | 446 | 2.00·0.26·0.12 |
| `cornice_corner` | 98 | 1,446 | 1.10·0.76·1.10 |
| `cornice_segment` | 214 | 2,227 | 2.00·0.76·0.50 |
| `fire_escape_floor` | 836 | 6,580 | 3.44·5.72·1.10 |
| `fire_escape_floor_lod1` | 258 | 2,895 | 3.44·5.72·1.10 |
| `fire_escape_ladder` | 112 | 980 | 0.49·3.30·0.02 |
| `fire_escape_top` | 608 | 4,487 | 3.44·1.92·1.10 |
| `fire_escape_top_lod1` | 210 | 2,174 | 3.44·1.92·1.10 |
| `hvac_condenser` | 188 | 2,006 | 0.92·1.04·0.92 |
| `hvac_rooftop` | 314 | 3,074 | 2.57·1.41·1.46 |
| `hvac_rooftop_lod1` | 106 | 1,335 | 2.57·1.41·1.46 |
| `parapet_cap_corner` | 26 | 633 | 0.67·0.20·0.67 |
| `parapet_cap_segment` | 16 | 444 | 2.00·0.20·0.45 |
| `roof_exhaust` | 120 | 1,459 | 0.84·0.70·0.84 |
| `roof_vent` | 76 | 932 | 0.40·0.64·0.38 |
| `storefront_door_26` | 190 | 2,285 | 2.24·3.30·0.22 |
| `storefront_door_32` | 200 | 2,318 | 2.84·3.30·0.22 |
| `storefront_door_45` | 220 | 2,479 | 4.14·3.30·0.22 |
| `storefront_glass_26` | 94 | 1,362 | 2.24·3.30·0.15 |
| `storefront_glass_32` | 104 | 1,431 | 2.84·3.30·0.15 |
| `storefront_glass_45` | 134 | 1,685 | 4.14·3.30·0.15 |
| `trim_downspout` | 26 | 545 | 0.14·1.00·0.14 |
| `trim_downspout_head` | 30 | 607 | 0.32·0.62·0.20 |
| `trim_downspout_shoe` | 60 | 727 | 0.10·0.46·0.33 |
| `trim_gooseneck_lamp` | 138 | 1,532 | 0.34·0.37·0.79 |
| `trim_pilaster` | 10 | 368 | 0.40·1.00·0.08 |
| `trim_pilaster_cap` | 22 | 479 | 0.50·0.26·0.16 |
| `trim_sign_board` | 50 | 862 | 1.88·0.58·0.07 |
| `window_brick_loft` | 134 | 1,722 | 2.50·3.29·0.14 |
| `window_brick_warehouse` | 144 | 1,722 | 3.40·3.24·0.14 |
| `window_stucco_apartment` | 112 | 1,538 | 1.94·2.25·0.10 |
| `window_stucco_modern` | 102 | 1,404 | 2.12·2.40·0.22 |

Shared by all nodes: 3 textures (1024² color, 1024² normal, 512² ORM),
297 KB in the file, 12.6 MB GPU with mips. Whole file 400 KB (target 1.5 MB).
Largest module 836 tris (target 2k). Generation credits: 0 (Blender only).
