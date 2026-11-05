# Murals (pbr look)

The trail-facing walls of the BeltLine Eastside level carry murals
(`muralWalls()` in `src/level/geo/geo-mesh.js`). Each mural quad samples one
cell of a 4 x 4 atlas. The toon look keeps the canvas atlas drawn at runtime
(`src/render/murals.js`). The pbr look loads a painted atlas from
`assets/murals/`.

## The painted atlas

`scripts/assets/mural-atlas.mjs` paints 16 original designs in headless
Chromium with the 2D canvas (shapes, gradients, and lettering drawn from
code, a fixed seed, no image model, no photos, no third-party art):

    node scripts/assets/mural-atlas.mjs            # seed 1979, 2048 px, JPEG q 0.82

| cell | word       | design                      | wall   |
| ---- | ---------- | --------------------------- | ------ |
| 0    | ATL        | Peach sunset skyline        | brick  |
| 1    | BELTLINE   | Trail through the canopy    | stucco |
| 2    | SKATE ATL  | Skater over rainbow arcs    | brick  |
| 3    | DOGWOOD    | Dogwood branch              | brick  |
| 4    | ROLL ON    | Wheel sun over the Piedmont | stucco |
| 5    | PEACH      | Three peaches               | brick  |
| 6    | FLOW       | River flow with heron       | stucco |
| 7    | STRIDE     | Stride sequence             | brick  |
| 8    | GLIDE      | Thrasher at dawn            | stucco |
| 9    | A-TOWN     | Record sun and dancers      | brick  |
| 10   | SUNSHINE   | Magnolia sunshine           | stucco |
| 11   | GOOD VIBES | Porch row neighbors         | brick  |
| 12   | SMOOTH     | Smooth leaves               | stucco |
| 13   | SWAG SURF  | Crowd wave                  | brick  |
| 14   | RINK       | Night rink                  | brick  |
| 15   | SHINE      | Skyline night shine         | stucco |

The words are `MURAL_WORDS` (no neighborhood names, issue #80), so cell `n`
keeps its word in both looks. Contact sheet: `docs/murals/contact-sheet.jpg`.

Each design is drawn on a 1536 x 512 wall, then a per-pixel paint pass
(seeded value noise) adds:

- the wall under the paint: a running-bond brick (5.6 px courses, about a 7 m
  wall) or mottled stucco, showing through as mortar grooves and tone;
- brush strokes: anisotropic noise along a slowly turning stroke direction
  (about ±4.5 % value);
- a ragged, dry-brush edge 12-30 px in from the cell border, where the bare
  brick or stucco shows;
- weathering: chalky patches and a slight fade near the ground (at most 10 %);
- roughness: satin paint 0.68-0.8, chalky patches rougher, bare brick
  0.92-0.96.

### Why 3:1

`muralWalls()` sizes a mural as `w = min(len - 2, 3 (h - 0.8))`, so most
murals are about 3:1 (38 murals on this level: median 3.1, range 1.5 to 5.5),
but every cell is square. The canvas atlas is drawn square and gets stretched
three times wider on the wall. The painted designs are drawn at 3:1 and
squeezed into their square cells, so the median wall shows them at their
drawn proportions. Walls far from 3:1 still stretch (a 1.5:1 wall squeezes a
design to half its width).

The parent can remove the stretch on those walls in `muralMesh()` (geo-mesh.js,
not changed here) by cropping the cell to the wall's aspect around its
center, for example:

```js
const DESIGN_ASPECT = 3;
const aspect = Math.hypot(bx - ax, bz - az) / (m.y1 - m.y0);
const du = ((u1 - u0) * (1 - Math.min(1, aspect / DESIGN_ASPECT))) / 2;
const dv = ((v1 - v0) * (1 - Math.min(1, DESIGN_ASPECT / aspect))) / 2;
// then use u0 + du, u1 - du, v0 + dv, v1 - dv for the four corners
```

### Roughness map

`assets/murals/mural-roughness.jpg` (512 px, gray = roughness / 0.85) is
ready but is not on the material yet: `geo-view.js` builds the mural material
from `createMuralAtlas()` alone, and this PR does not change shared wiring.
The one change the parent needs in `createGeoView()` (geo-view.js):

```js
import { createMuralAtlas, createMuralRoughness } from "./murals.js";
// ...
get mural() {
  if (!muralMap) {
    const map = createMuralAtlas(1024, { look });
    const params = map.userData.muralSource === "painted" ? { map, roughnessMap: createMuralRoughness() } : { map };
    muralMap = litMaterial(look, params, { gradientMap, roughness: ROUGHNESS.mural, envLight: ENV_LIGHT.mural });
  }
  return muralMap;
},
```

Passing `{ look }` also matters without the roughness map: `murals.js` cannot
see the GPU tier, so with no `?look` or `?quality` in the URL (the high tier
picked by the GPU) it falls back to the canvas atlas. With `?look=pbr` or
`?quality=high` it loads the painted atlas.

No normal map: a texel is 2-7 cm on these walls (6.6 cm across a 33 m wall),
so brick mortar relief is below one texel, and the 8 cm mural offset already
gives an edge. The paint pass shades the mortar grooves into the color.

## Switches

- `?murals=canvas` keeps the canvas atlas in the pbr look.
- `?murals=painted` loads the painted atlas in any look.
- If `mural-atlas.jpg` fails to load, the texture gets the canvas atlas.

## Cost (one material, one texture, same meshes)

|                       | BEFORE (canvas, a317613)         | AFTER (painted, pbr look)                                  |
| --------------------- | -------------------------------- | ---------------------------------------------------------- |
| Download              | 0 B (drawn at runtime)           | 883 KB color (+34 KB roughness when wired)                 |
| GPU texture           | 1024² RGBA + mips = 5.6 MB       | 2048² RGBA + mips = 22.3 MB (+1.4 MB roughness when wired) |
| Triangles, draw calls | unchanged                        | unchanged (same mural meshes, one material)                |
| Main-thread work      | 16 canvas cells drawn at startup | one JPEG decode                                            |

`--size 1024` halves the texel density and brings the GPU cost back to
5.6 MB, if a lower tier ever needs the painted atlas.
