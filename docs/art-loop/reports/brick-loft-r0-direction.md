# brick-loft, round 0, direction

Input: `docs/art-loop/reports/brick-loft-r0-judge.md` (overall 3 / 10) and the captures in `reports/lab/brick-loft-0-pbr/`. The lab building is `w270469054`: a 27.1 m x 8.7 m rectangle (area 237 m²), 9.7 m tall, 3 floors of 3.68 m (span base 39.16 m, top 50.19 m, on a slope). `street.png` and `corner.png` have the shadow fix. The other four PNGs are from before it.

Two judge items are closed: the sun shadows (lab bug, fixed) and the window speckle (no halftone in the pbr look). Do not spend this round on them.

Facts from the code that set the plan:

- The facade kit (`facade-kit.js`) is render-only and shows only on a tier with `detail: true` (high). The low and phone tiers see the box from `extrude.js` and the facade shader only.
- `buildGeoMeshes()` meshes are the physics trimeshes. The awnings from `awningsFor()` and the parapet from `extrudeFootprint()` are colliders now. New geometry goes in the kit, so the colliders do not change.
- The lab building has no roof gear because of the rules in `roofProps()` (`props.js`): a water tower needs `area > 300`, and `floor(237 / 400) = 0` roof units. On the BeltLine level, 39 buildings are brick-loft; they get 20 water towers and 52 roof units in total. The median brick-loft is 8 m tall (2 floors).
- `awningsFor()` puts awnings only on a wall whose midpoint + 4 m is on a street. The lab building has no such wall, so it has no awning.
- The flat roof color is `tint(color, 0.45)` in `buildGeoMeshes()`: a pale pink on a brick building (`aerial.png`).

## 1. Reference

The model is the Old Fourth Ward and Inman Park brick loft: a 1900 to 1940 factory or warehouse, now lofts, shops, and offices. Examples: the Stove Works on Krog Street, Studioplex on Auburn Avenue, the Ford Factory Lofts on Ponce de Leon Avenue, and the lofts along the Eastside Trail. The sizes below are typical values for this type, not a survey of one building.

Colors are linear RGB. The game palette is brighter than the real material on purpose (the Jet Set Radio look). The "game" value is the value to use in code.

| Part | Real (linear) | Game (linear) | Roughness |
|---|---|---|---|
| Red brick, body | 0.34, 0.07, 0.035 | style `walls` (0.55 to 0.70, 0.27 to 0.36, 0.22 to 0.26) | 0.88 |
| Mortar | 0.45, 0.42, 0.36 | from the brick scan | 0.9 |
| Cast stone (sills, lintels, coping, base) | 0.75, 0.68, 0.51 | style `trim` 0.90, 0.86, 0.78 | 0.75 |
| Steel window frames, painted | 0.045, 0.08, 0.053 | 0.20, 0.30, 0.24 (mid sage, see the Don'ts) | 0.45 |
| Roof membrane | 0.155, 0.162, 0.17 | 0.30, 0.30, 0.31 | 0.9 |
| Sign band, painted | deep green, navy, oxblood, mustard | see change 2 | 0.6 |
| Canvas awning | saturated solid colors | `AWNING_COLORS` in `geo-mesh.js` | 0.85 |

### At 2 m (the skater against the wall)

- The brick courses: 0.065 m high, with 0.01 m mortar joints. One brick in 20 is darker (an iron spot) or lighter.
- The sill: a cast-stone block, 0.12 m out and 0.10 m high, a little wider than the window. It casts a sharp shadow line on the brick below it.
- The lintel: a cast-stone band 0.20 to 0.25 m high over each window, or a brick soldier course (bricks on end).
- The steel window: a frame 0.06 m wide in the brick reveal (0.20 m deep), and a grid of panes about 0.4 m x 0.5 m.
- The storefront: a stone or tile kick plate 0.45 m high under the glass, glass to about 2.9 m, then a sign band 0.6 to 0.9 m high. Brick or stone piers 0.4 m wide stand between the bays.
- The ground: a concrete apron or a sidewalk meets the wall. A planter or a bench stands at a pier.

### At 30 m (the street view)

- Three zones. A base: the shop floor with glass, a sign band, awnings, and a belt course. A body: the repeated window grid in brick. A crown: a cornice, a parapet, and a stone coping that reads as a light line against the sky.
- The bay rhythm: 3.4 m bays. Windows about 1.9 m wide and 2.6 m high, in rows.
- The roofline steps up at the center of the main front: a raised parapet panel 1.0 to 1.5 m higher, over 2 or 3 bays, often with a stone name panel. A stair bulkhead (about 3 m x 4 m x 2.8 m) or a water tower stands on the roof.
- The two visible faces differ in value: one face in sun, one in shade, and the brick tone changes a little from face to face.

### At 300 m (the skyline)

A 27 m building is about 100 px wide and 37 px tall at 300 m (1280 px, a 60 degree view). A 3.7 m floor is about 13 px. So at this distance only these cues survive:

- The silhouette: the box, the raised center parapet (4 px), the bulkhead or the water tower against the sky.
- The value of the roof against the parapet: a darker roof inside a light coping and parapet line.
- The floor stripes: a darker band for each row of windows.
- The color block: warm red brick against the cream, stucco, and blue of the neighbors.

## 2. Gap list

### At 2 m to 8 m

- The wall is two colors: brick and one trim color (`facade.png`). There is no second material: no stone base, no dark steel, no lintel.
- The frames are paint, in the trim color, and the trim reads blue-gray in shade (`facade.png`, all windows).
- The cornice and the parapet are one flat band with no profile and no coping shadow (`facade.png`, top).
- The storefront has glass to the ground and no kick plate, no sign band, no door, and no awning (`facade.png`, bottom row).
- The brick has the same tone on every face (`facade.png`, `street.png`).

### At 25 m to 35 m

- The roofline is one straight line. There is nothing on the roof (`street.png`, `corner.png`).
- The base zone is a row of identical glass bays on grass (`street.png`). Nothing says "shop". There is no color accent on the building.
- The crown reads as a cream band, which is good (`street.png`). It is the only zone that works.
- The building is mostly hidden in `corner.png` (center right, behind the gray-blue neighbor). This is a lab framing issue, not an art issue.

### At 70 m to 300 m

- `mid.png`: the lab building is a red box with a dotted grid, with no roof shape. The neighbor covers half of it.
- `far.png`: the lab building cannot be found. Every roof is a flat slab, and the brick buildings have no silhouette cue.
- `aerial.png`: the roof is a flat pale pink slab (center left). The pink comes from `tint(color, 0.45)`. The coping does not read as a line, because the roof is lighter than the coping.

## 3. Ranked change list

The engineer builds changes 1 to 3 this round. Each one is about 1 to 2 hours. Changes 4 to 8 are for later rounds.

### Change 1: The crown. A raised center parapet, a stair bulkhead, and a dark roof

Impact: silhouette (judge score 1), life (5), and read at distance (6). This is the only change that the 300 m view can see.

**Files and functions**

1. `src/level/geo/styles.js`: add to the `brick-loft` style:
   ```js
   roofColor: [0.3, 0.3, 0.31],
   crown: { step: 1.2, bulkhead: [3.0, 3.6, 2.8] },
   ```
   Also add `roofColor: [0.32, 0.31, 0.3]` and the same `crown` to `brick-warehouse`.
2. `src/level/geo/geo-mesh.js`, `buildGeoMeshes()`: use `roofColor: style.roofColor ?? tint(color, 0.45)`. The physics does not use the color, so the colliders do not change.
3. `src/level/geo/facade-kit.js`: add a new exported pure function `crownKit(m, ring, top, style, si, wall, seed)`. Call it from `buildingKit()` after the coping, when `style.crown` is set and the building is not a house. `wall` is `wallColor(style, b.id)`. `seed` is `hash32(\`${b.id}:crown\`)`.
4. Add the keys `crown` and `bulkhead` to the `counts` objects in `buildingKit()` and `facadeKit()`. Without them, `counts[k] += c[k]` gives `NaN`.

**What `crownKit()` builds**

- The raised center parapet (a frontispiece):
  1. Find the longest wall of the ring. Count its bays as `wallDepth()` does: `bays = max(1, round(len / style.bay))`.
  2. If `bays < 4`, skip it.
  3. Take the center 3 bays when `bays` is odd, or the center 2 bays when `bays` is even. The lab building has 8 bays, so the panel is 2 bays (6.8 m) wide. The edges of the panel are on bay lines, so they are on the window grid.
  4. Build a solid box from the parapet top (`top + style.parapet`) to `top + style.parapet + crown.step`. It goes from 0.3 m inside the wall line to 0 m (flush with the wall), in the `wall` color. Build its front, back, top, and two end faces, so it has no hole from the roof side. `wallBox()` builds no back face, so add a small helper `solidBox()` or call `quad()` 5 times.
  5. Put a coping on it: a box 0.1 m out on all sides, `KIT.coping.height` high, in `style.trim`.
  6. Put a stone name panel on its front: a box 0.04 m out, 60 % of the panel width, 50 % of `crown.step` high, centered, in `style.trim`. It stays blank. Do not write text on it.
- The stair bulkhead:
  1. Use `minRect(ring)`. Put the box at one end of the long axis. The end comes from `seed & 1`. The box center is `long / 2 - 1.5 - bulkhead[0] / 2` from the rectangle center.
  2. The size is `bulkhead[0]` along the long axis, `min(bulkhead[1], short - 2.4)` across, and `bulkhead[2]` high, from `top` up.
  3. Skip it if the across size is under 2.0 m, or if any of the 4 corners, moved 1.0 m out, is outside the ring. Use `pointInRings()` from `geo-ground.js`.
  4. Build 4 side faces and a top face in the `wall` color. Add a coping on top in `style.trim` (0.06 m out, 0.12 m high).

**Constants**: `crown.step` 1.2 m, panel depth 0.3 m, name panel 0.04 m out, bulkhead 3.0 m x 3.6 m x 2.8 m, bulkhead margin 1.0 m from the walls, roof color 0.30, 0.30, 0.31.

**Far views and tiers**

- At 300 m, the panel is about 4 px over the roofline and the bulkhead is about 10 px. The dark roof makes the light parapet and coping a closed ring in `aerial.png`.
- The kit faces use `FACE.cornice`, so the facade shader uses the vertex color only. They work the same in the toon look and the pbr look. They cast and receive shadows (the kit tiles have `castShadow: true`).
- The low and phone tiers have no kit, so they get the dark roof only. The colliders do not change: the kit is render-only.

**Test (Vitest, `src/level/geo/facade-kit.test.js`)**

Use a 27.1 m x 8.7 m rectangle ring, `top = 9.7`, the `brick-loft` style.

1. `crownKit()` returns `{ crown: 1, bulkhead: 1 }`.
2. The highest vertex within 0.5 m of the wall line is at `top + parapet + step + coping height` (9.7 + 0.9 + 1.2 + 0.14 = 11.94), within 0.01 m. The highest bulkhead vertex is at 9.7 + 2.8 + 0.12 = 12.62.
3. The panel vertices that are on the wall line lie between the bay lines of bays 3 and 5 (a0 = 3 x 3.3875 m, a1 = 5 x 3.3875 m along the long wall).
4. Every bulkhead vertex is inside the ring and at least 0.9 m from every edge.
5. The function is deterministic: two calls give the same `positions` array.
6. A 10 m x 6 m ring (3 bays) gives `crown: 0`. A `craftsman-house` building gets no crown from `buildingKit()`.
7. In `geo-mesh.test.js`: the roof vertices of a brick-loft building have the color 0.30, 0.30, 0.31.

**Lab PNG**: `street.png` shows a stepped roofline with a cream name panel at the center of the long front. `aerial.png` shows a gray roof with a bulkhead box and a light parapet ring.

### Change 2: The base. A sign band and awnings on the front wall

Impact: life (judge score 1) and the base zone. It also gives the building its color accent.

**Files and functions**

1. `src/level/geo/geo-mesh.js`: export a pure helper `streetWalls(ring, isStreet)`. It returns the wall indices whose midpoint + 4 m along the outward normal is on a street, with walls under 4 m left out. This is the test in `awningsFor()` now. Make `awningsFor()` use it. The output of `awningsFor()` must not change. The current tests check that.
2. `src/level/geo/facade-kit.js`: add a new exported pure function `frontEdge(ring, isStreet)`. It returns `{ edge, street }`:
   - `edge` is the longest wall in `streetWalls()`, with `street: true`;
   - if `streetWalls()` is empty, `edge` is the longest wall, with `street: false`.
3. `src/level/geo/facade-kit.js`: add a new exported pure function `shopFront(m, ring, style, si, base, floorH, front, seed)`. Call it from `buildingKit()` when `style.storefront && floors >= 2`. It goes into the kit mesh `m`, not the depth mesh, because a sign band must show at 30 m to 70 m.
4. `facadeKit(level)` makes `isStreet` the same way as `buildGeoMeshes()`: `createGeoGroundSampler(level)` and the street kinds. Pass `front` into `buildingKit()` as a new last parameter. Without it, `buildingKit()` builds no shop front, so the current tests stay valid.
5. Add the keys `sign` and `awning` to both `counts` objects.
6. `src/level/geo/styles.js`: export `SIGN_COLORS`:
   ```js
   export const SIGN_COLORS = [
     [0.06, 0.22, 0.13], // deep green
     [0.05, 0.09, 0.22], // navy
     [0.32, 0.05, 0.04], // oxblood
     [0.62, 0.42, 0.07], // mustard
   ];
   ```

**What `shopFront()` builds, on the wall `front.edge` only**

- A sign band in each bay:
  - It spans from 0.24 m past the pier center on one side to 0.24 m before the pier center on the other side, so it fits between the piers (pier half-width 0.18 m).
  - It goes from `base + 0.84 * floorH` to `base + floorH - KIT.belt.height / 2 - 0.04`. The shop glass and its frame end at 0.825 of the floor in the shader. On the lab building this is 3.09 m to 3.50 m over the base. On a 4.2 m floor it is 3.53 m to 4.02 m.
  - It is 0.07 m out from the wall, less than the pier (0.16 m), so the piers frame it.
  - The color is `SIGN_COLORS[seed % SIGN_COLORS.length]`, one color for each building.
- A cream sign board on every second bay, from bay 0: a box 0.02 m in front of the band, 70 % of the band width, 60 % of its height, centered, in `style.trim`. It reads as a shop name at 30 m. It has no text.
- Awnings, only when `front.street` is false, because `awningsFor()` already covers a street wall:
  - Use the same shape as `awningsFor()`: 1.3 m out, 0.5 m drop, a 0.3 m valance, from `awningHeight(style)`, and from bay fraction 0.12 to 0.88.
  - Use the same color: `AWNING_COLORS[hash32(\`${b.id}:awning-color\`) % 5]`.
  - Put one on each bay where `rand() < max(style.awnings, 0.5)`, with `rand = seededRandom(seed)`. If the result has fewer than 2 awnings, put one on the 2 center bays.
  - The kit awning is render-only. The current street awnings stay colliders. A skater can jump through a kit awning; this is accepted for this round, because it is above 2.4 m.

**Far views and tiers**

- At 30 m, the band is about 18 px high: a clear color stripe over the glass. At 300 m, it is a 1 to 2 px colored line at the base, which is still a zone cue.
- The faces use `FACE.cornice` and vertex colors, so they are the same in the toon look and the pbr look.
- The low and phone tiers have no kit, so they do not see this. Nothing breaks.
- The mural rule holds. On a storefront style, a mural starts over the belt course, and the band and the awnings stay under it.

**Test (Vitest)**

- `frontEdge()` with `isStreet = () => false` on the 27.1 m x 8.7 m ring returns the index of a 27.1 m wall and `street: false`.
- `frontEdge()` with an `isStreet` that is true only in front of a short wall returns that short wall and `street: true`.
- `shopFront()` on the lab ring (`floorH = 3.68`, `base = 0`):
  - It gives `sign: 8`, one for each bay.
  - Every sign vertex has y in [0.84 x 3.68, 3.68 - 0.14] and is at most 0.10 m in front of the wall plane.
  - No sign vertex is within 0.18 m of a pier center along the wall.
  - `awning` is at least 2 when `street` is false, and 0 when `street` is true.
- Determinism: two runs give equal arrays.
- In `geo-mesh.test.js`: `awningsFor()` gives the same vertex count as before the refactor, for every building on the BeltLine level.

**Lab PNG**: `facade.png` shows a colored band with cream boards between the piers, over the shop glass. `street.png` shows awnings on the long front of the lab building.

### Change 3: The materials. Stone lintels, a stone kick plate, sage steel frames, and a tone for each face

Impact: material (judge score 4), color (3), and close-up (5). This is the only change of the top 3 that the low tier also gets, because it is in the facade shader.

**Files and functions**

1. `src/level/geo/styles.js`: add `frame: [0.2, 0.3, 0.24]` to `brick-loft` and `brick-warehouse`. A style with no `frame` uses its `trim`, so the other styles do not change.
2. `src/render/look.js`: add the pure constants and function below, next to `WALL_AO` and `wallOcclusion()`. The shader uses the same formula, as it does for `WALL_AO`.
   ```js
   // The brick tone of one wall face: a value shift and a small red-yellow
   // shift, from a hash h in 0..1. The mean over h is 1, so the palette stays.
   export const BRICK_TONE = { value: 0.06, warm: 0.03 };
   export function brickTone(h, { value, warm } = BRICK_TONE) {
     const k = 2 * h - 1;
     return [1 + k * value + k * warm, 1 + k * value, 1 + k * value - k * warm];
   }
   ```
3. `src/render/geo-view.js`, `createFacadeMaterial()`:
   - Add a uniform `uFrame[n]` from `s.frame ?? s.trim`.
   - **The tone for each face.** On a brick style (`a.w > 0.5`), take `h = facadeHash(vWallSeed + float(st))` and multiply `wallCol` by the `brickTone(h)` formula, with the constants from `BRICK_TONE`. Do this before the brick detail and before the far `mean`, so the far color has the same tone.
   - **The frame in steel.** Draw `frame` in `uFrame[st]` and `sill` in `uTrim[st]`. Now both use `uTrim[st]`. The mullion also uses `uFrame[st]`.
   - **A stone lintel over each upper window** (not on the shop floor):
     ```glsl
     float lintelY = 0.55 + win.y * 0.5 + 0.035; // the frame top
     float lintel = (1.0 - smoothstep(fw.x + 0.04 - aa.x, fw.x + 0.04 + aa.x, d.x))
                  * (1.0 - smoothstep(0.03 - aa.y, 0.03 + aa.y, abs(cell.y - lintelY - 0.03)));
     ```
     Draw it in `uTrim[st]` like the sill. On a 4.2 m floor it is about 0.25 m high. It fades with `far0` like the rest of the cell.
   - **A kick plate under the shop glass.** Set the shop glass to `vec2(0.84, 0.66)` with center `0.46`. Now it is `vec2(0.84, 0.74)` with center `0.42`. The top of the glass stays at 0.79, so change 2 does not move. The bottom moves from 0.05 to 0.13 of the floor (0.48 m on the lab building). Draw the strip under the frame, from v = 0 to the frame bottom, in `uTrim[st] * 0.85` (a darker cast stone). Put the shop center in one constant `SHOP_CY`. Use it in the 4 places that now write `0.42`: `d`, `sillY`, `cy` in the interior block, and the room hit.
   - **The far mean.** Add the trim area to `mean`, so the near and the far colors match: `mean = mix(mix(wallCol, uTrim[st], 0.08), uGlass[st] + vec3(0.09), win.x * win.y * 0.9)`.
   - Change `customProgramCacheKey` to `facade-v7...`.

**Constants**: `BRICK_TONE.value` 0.06, `BRICK_TONE.warm` 0.03, frame 0.20, 0.30, 0.24, lintel 0.06 of a cell high and 0.04 of a cell wider than the frame, shop glass `vec2(0.84, 0.66)` at 0.46, kick plate `trim * 0.85`.

**Far views and tiers**

- Every new mark is inside the window cell, so `far0` fades it to `mean` where a cell is under a few pixels. Nothing shimmers at 70 m.
- The face tone is a low-frequency change: 1 value per face. It survives at 300 m and it separates the two visible faces.
- The code is outside `#ifdef PBR_LOOK`, so the toon look and the low tier get it too.
- The shader cost is a few ALU operations and no new texture.

**Test**

- `src/render/look.test.js`:
  - `brickTone(0.5)` is `[1, 1, 1]`.
  - `brickTone(0)` and `brickTone(1)` stay inside [0.91, 1.09].
  - The mean of `brickTone(i / 100)` for i = 0 to 100 is 1 within 0.001, on every channel.
  - `brickTone(1)[0] > brickTone(1)[2]`: the light faces are a little warmer.
- A styles test (in `facade-kit.test.js`, or a new `styles.test.js`): for each brick style, the luma of `frame` is between 0.7 and 1.0 of the luma of its darkest wall color. Use luma = 0.2126 r + 0.7152 g + 0.0722 b. The brick-loft values give 0.27 / 0.33 = 0.83. This test enforces the rule "no black outlines on frames".
- **Lab PNG**: in `facade.png`, the frames are sage, and the sills and lintels are cream. The shop windows have a stone strip under them. In `street.png`, the two faces of the lab building have a different brick tone.

### Change 4: A concrete apron around a storefront building (later)

- **File and function**: a new pure module `src/level/geo/aprons.js`, `storefrontAprons(level)`. It returns `[{ tile, mesh }]`, like `roadMarkings()` in `markings.js`. For each building with a storefront style, it makes `flatPolygon(offsetRing(ring, 1.8), [ring], y)` in `SURFACE_COLORS.sidewalk`, so the surface shader picks the concrete scan.
- In `createGeoView()`, drape the mesh and merge it into the render copy of the surface tile, the same way as `markingTiles`. The physics meshes do not change.
- Set `y` between the ground top and the sidewalk top (`surfaceTop()`), so it does not z-fight with a sidewalk.
- **Tiers**: gate it with `tier.detail`, like the markings.
- **Test**: each apron has the building as a hole; the area is about `perimeter x 1.8 + 4 x 1.8²` for a rectangle.
- **Lab PNG**: `street.png` shows the building on concrete, not on grass.

### Change 5: Floor stripes and roof gear at a distance (later)

- In `createFacadeMaterial()`, make `mean` darker on the window band of each floor: `mean *= 1.0 - 0.18 * winRow`, where `winRow` is 1 between the sill line and the lintel line of the cell. Then the floors read as stripes at 250 m.
- In `roofProps()` (`props.js`), for a style with `roof_unit > 0`, give at least 1 unit when `area > 150`. Make the water tower test `area > 200` for `brick-loft`. Keep the units out of the bulkhead rectangle of change 1.
- **Test**: `roofProps()` gives at least 1 prop for the lab footprint. The props of the full level stay the same for every building with `area > 400`.

### Change 6: Keep cream cream in the shade (later)

- In the pbr look, the cream trim in shade takes the blue of the sky environment (`facade.png`).
- In `src/render/look.js`, warm the hemisphere sky color (`0xcfe8ff` in `createGeoLights()`) to about `0xe6eef6`. Set `ENV_LIGHT.wall` to 0.8.
- **Lab PNG check**: a sill pixel in shade in `facade.png` has a blue / red ratio of at most 1.05.

### Change 7: A door bay (later)

- Mark the center bay of the front wall (change 2) as a door. In the shader, the door is a taller, narrower opening on the shop floor. In the kit, add a 0.15 m step box. The door needs a flag for each bay. The cheapest way is a fifth vertex attribute or a bay index in `facade.z`. Plan it as its own round.

### Change 8: A soldier course and a second brick (later)

- Add a soldier course: a band of 0.22 m in a darker brick tone (x 0.85) under the cornice and over the belt course, in `createFacadeMaterial()`.
- Add a second brick scan (a dark iron-spot brick) and pick one for each building.

## 4. Don'ts

- Do not draw frames darker than the brick. A near-black frame turns into a black outline at 30 m. Keep the frame luma at 0.7 to 1.0 of the wall luma.
- Do not add random noise or grime to fake age. The building is in good repair and Atlanta looks its best. Every dark mark must come from a named edge: a sill, a lintel, a coping, a sign board, or the ground line.
- Do not paint graffiti, boarded windows, broken glass, rust streaks, or "for lease" signs. Murals are good, and they stay in the mural system (`muralWalls()`).
- Do not write text on the sign boards or the name panel. A real business name is a trademark issue, and a fake one can look like a real shop.
- Do not put a window, a panel edge, or a bulkhead across a building corner. Align every new part to the bay grid.
- Do not put new geometry in `buildGeoMeshes()` or `extrudeFootprint()`. Those meshes are the colliders. Use the facade kit.
- Do not use a pink or a pale roof on brick. The roof must be darker than the coping, so the coping reads as a light line from above.
- Do not add detail under 0.3 m that does not fade with `far0` or with the depth-tile distance.
- Do not change the lab building or the camera to make a better picture. Fix the art.
