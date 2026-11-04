# brick-loft, round 1, judge: overall 4 / 10

Lab building: `w270469054`, brick-loft pick 0, look `pbr`, height 9.7 m, BeltLine Eastside. Captures: `reports/lab/brick-loft-0-pbr/`. Round 0 captures: `reports/lab/brick-loft-0-pbr-r0/`.

Short verdict: the building is no longer a plain box. It has a roofline, a dark roof, a sign band, and awnings. It casts real shadows. But every "cream" part renders blue-gray, so the new sign boards and the name panel read as gray slabs. The building still stands on a lawn, and its shop front faces the back of a neighbor. At 250 m it still cannot be found. It is now near the gen-city-auto level, and still far below Tony Hawk 1+2 and the F-16 San Francisco build.

## Scores

| # | Criterion | Score | Reason |
|---|---|---|---|
| 1 | Silhouette and massing | 4 | A stair bulkhead and a raised parapet panel break the roofline (`street.png`, `aerial.png`). From the street the two boxes read as two chimneys, not as a frontispiece. The cornice is still one flat slab. |
| 2 | Mid-scale relief | 5 | A sign band, sign boards, awnings, and a name panel add depth at the base and the crown (`facade.png`, `street.png`). The lintels are paint only. The cornice has no profile. |
| 3 | Material definition | 4 | The frames, the sills, the lintels, and the sign boards all render as one cold blue-gray (`facade.png`: lintel 103,114,125; board 107,121,132; frame 63,71,80). Stone and steel do not read as two materials. The brick scan is the same as round 0. |
| 4 | Color and value variation | 5 | The teal awnings, the navy band, and the dark roof add accents (`facade.png`, `aerial.png`). The navy is near black (4,34,74). The face tone is not visible: the two faces differ only by sun and shade (`street.png`). |
| 5 | Life and story | 4 | Sign band, blank boards, awnings, and a bulkhead (`street.png`, `aerial.png`). No door, no planter, no lamp, no sidewalk. The shop front faces the back of the white neighbor, about 8 m away (`aerial.png`). |
| 6 | Read at distance | 4 | In `mid.png` the bulkhead and the awnings show, but the neighbor still hides half the building. In `far.png` the lab building still cannot be found. |
| 7 | Close-up quality | 6 | The window speckle is gone (`facade.png`). The frames and lintels are clean and sharp. The cornice band is still flat and untextured. Small black dots show near the awnings. |
| 8 | Lighting response | 5 | The building casts a shadow on the ground and the bulkhead casts one on the roof (`aerial.png`, `mid.png`). The front face is in shade in `facade.png`, so the sills and the awnings cast nothing visible there. The ground-line AO is still weak (`street.png`). |
| 9 | Image quality | 5 | The speckle is gone. New dotted ink lines on the name panel and on the sign band (`street.png`). Stair-step ink on the coping, the grass tile repeat, and the green blotches on the road stay (`aerial.png`). |

## Top 8 fixes, ranked by visual impact

### 1. Make cream render as cream

- **What is wrong.** In `facade.png` the lintels, the sills, the sign boards, and the belt course all sample at about 105, 118, 130: blue is higher than red. The style trim is cream `[0.9, 0.86, 0.78]`. The new sign boards (`facade.png`, bottom, x 140 to 310 and 690 to 860) and the name panel (`facade.png`, top center) read as gray slabs, not as stone. This one fault now hits every new part of round 1.
- **Reference.** Forza Horizon 5 and Spider-Man 2 keep a warm stone warm in shade. The shade takes some sky blue, but the hue of the material stays. THPS 1+2 uses a warm ambient on the city.
- **Technique.** Build direction change 6 now. In `createGeoLights()` in `src/render/geo-view.js`, change the hemisphere sky color `0xcfe8ff` to about `0xe6eef6`. In `src/render/look.js`, lower `ENV_LIGHT.wall` to 0.8, or tint the environment term for the facade by a warm factor. Check: a sill pixel in shade in `facade.png` has blue / red at most 1.05.

### 2. Put the building on paving, not on a lawn

- **What is wrong.** The storefront, the sign band, and the awnings face grass on every side (`street.png`, bottom; `aerial.png`, around the building). A shop on a lawn reads as wrong.
- **Reference.** THPS 1+2 and Jet Set Radio Future put a sidewalk, a curb, and a ledge at every shop front. The sidewalk is the skate space.
- **Technique.** Build direction change 4: `storefrontAprons(level)` in a new `src/level/geo/aprons.js`, 1.8 m of concrete around each storefront footprint, merged into the surface tile in `createGeoView()`. Make the apron 3 to 4 m on the front wall from `frontEdge()`.

### 3. Pick a better front wall, and wrap the sign band around the corner

- **What is wrong.** `frontEdge()` in `src/level/geo/facade-kit.js` picks the longest wall when no wall is within 4 m of a street. Here the two long walls are equal, and it picks the wall that faces the back of the white neighbor (`aerial.png`, the awnings at the bottom face). The open wall that faces the wide road gets no awnings. The sunlit short face in `street.png` (left, x 385 to 480) has shop glass with no band and no awning.
- **Reference.** In Spider-Man 2 and THPS 1+2 the shop front faces the open street. The sign band turns the corner on a corner shop.
- **Technique.** In `frontEdge()`, when no wall is a street wall, score each wall by the open distance along its outward normal: march from 4 m to 60 m and stop at the first street sample or footprint. Take the wall with the nearest street, and break a tie by the largest open distance. In `shopFront()`, also put the sign band on the first bay of each wall next to the front wall.

### 4. Make the crown read as a crown

- **What is wrong.** In `street.png` (x 437 to 517 and x 605 to 668, y 190 to 265) the bulkhead and the raised panel are two brick boxes of a similar size. They read as two chimneys. The panel is only 2 bays wide and 1.2 m high. The cornice under it is still one flat slab with no profile (`facade.png`, top).
- **Reference.** Atlanta lofts (Ford Factory Lofts, Stove Works) have a wide stepped parapet with a stone cap. Spider-Man 2 gives every cornice 2 or 3 stacked profiles and a row of brackets.
- **Technique.** In `crownKit()` in `src/level/geo/facade-kit.js`, use 3 bays when `bays >= 6`, and set `crown.step` to 1.6 m in `src/level/geo/styles.js`. Add a second, lower step of 0.5 m on each side of the panel, so the roofline steps twice. In `buildingKit()`, build the cornice as 3 stacked boxes (0.10 m, 0.25 m, 0.40 m out) instead of one slab. Give the bulkhead a dark metal door face and a flat metal cap, not a cream cap, so it reads as a different object.

### 5. Floor stripes and roof gear at a distance

- **What is wrong.** `far.png` is almost the same as round 0. The lab building cannot be found. All roofs are flat slabs and all walls have the same window dots.
- **Reference.** THPS 1+2 and JSRF keep big value blocks at range. Spider-Man 2 keeps the roof shapes in the far LOD.
- **Technique.** Build direction change 5. In `createFacadeMaterial()` in `src/render/geo-view.js`, make `mean` darker on the window band of each floor (`mean *= 1.0 - 0.18 * winRow`). In `roofProps()` in `src/level/geo/props.js`, give at least 1 roof unit when `area > 150`, and a water tower on brick-loft when `area > 200`.

### 6. Make the sign band a color, not a black line

- **What is wrong.** The navy band samples at 4, 34, 74 in shade (`facade.png`, y 515 to 550). At 30 m it reads as a black stripe (`street.png`, base of the long wall). The oxblood and deep green colors in `SIGN_COLORS` have the same problem: their values are 0.05 to 0.32.
- **Reference.** JSRF and THPS 1+2 use mid-value, saturated sign colors that read at range. The game palette is brighter than the real material, as the direction says for the brick.
- **Technique.** In `src/level/geo/styles.js`, raise `SIGN_COLORS` to a game value: about `[0.12, 0.42, 0.26]`, `[0.12, 0.2, 0.48]`, `[0.6, 0.14, 0.1]`, `[0.85, 0.6, 0.15]`. Keep the luma of each color at 0.7 to 1.3 of the brick luma, like the frame rule. Add a small gooseneck lamp box over each sign board in `shopFront()`.

### 7. A door, planters, and lights at the base

- **What is wrong.** The shop floor is 8 equal glass bays (`street.png`, `facade.png`). There is no door, no step, no planter, no wall lamp.
- **Reference.** THPS 1+2 puts a door, a step, and a planter ledge at every shop. These are also the skate lines.
- **Technique.** Build direction change 7 (a door bay in the shader and a 0.15 m step in the kit). In the props pass, place a planter at every second pier of the front wall from `frontEdge()`.

### 8. Clean the ink outline on the kit parts

- **What is wrong.** Dotted black ink lines show on the name panel (`street.png`, x 623 to 650, y 255) and along the top of the sign band and the piers (`street.png`, x 487 to 723, y 372). The coping in `aerial.png` has a stair-step black outline.
- **Reference.** JSRF draws clean, continuous ink lines. No reference game shows broken dashes on architecture.
- **Technique.** In `src/render/post.js`, raise the depth threshold of the edge test for small depth steps, scaled by the view distance, so a 0.04 m name panel or a 0.07 m band does not trigger a dashed edge. Or skip the ink on the kit tiles in the pbr look. Fade the line width with distance.

## Broken

- **Cream renders blue-gray.** Every trim and kit part in the cream trim color reads blue-gray (`facade.png`, see fix 1).
- **Dotted ink lines** on the name panel and the sign band (`street.png`, see fix 8).
- **Black dots** on the shop floor in `facade.png`: near x 655, y 620 and near x 1240, y 630, and one on the sill near x 685, y 440.
- **Kick plate not visible.** No capture shows the bottom of the shop glass. `facade.png` cuts off at the glass. I cannot verify the kick plate.
- **Lab framing.** The neighbor still hides the lab building in `corner.png` and `mid.png`. In `far.png` it cannot be found.
- **Green blotches on the road** stay in `aerial.png` (left road).
- **Kit awnings have no collider.** The direction accepts this for this round. The skater can pass through them.

## Change since round 0

| # | Criterion | R0 | R1 | Delta |
|---|---|---|---|---|
| 1 | Silhouette and massing | 2 | 4 | +2 |
| 2 | Mid-scale relief | 4 | 5 | +1 |
| 3 | Material definition | 4 | 4 | 0 |
| 4 | Color and value variation | 3 | 5 | +2 |
| 5 | Life and story | 1 | 4 | +3 |
| 6 | Read at distance | 3 | 4 | +1 |
| 7 | Close-up quality | 5 | 6 | +1 |
| 8 | Lighting response | 2 | 5 | +3 |
| 9 | Image quality | 4 | 5 | +1 |
| | **Overall** | **3** | **4** | **+1** |

Part of the gain in lighting and image quality comes from the lab fixes (the shadow box and no halftone), not from the art changes.

### Change 1, the crown: worked, in part

- The dark roof works. The light coping now reads as a closed ring around a gray roof (`aerial.png`, compare `brick-loft-0-pbr-r0/aerial.png`, which has a pale pink roof).
- The bulkhead works. It breaks the roofline in `street.png` and `mid.png` and casts a shadow on the roof in `aerial.png`.
- The raised panel is too small. In `street.png` it reads as a second chimney, and its name panel reads gray. It does not show in `far.png`.

### Change 2, the base: worked, in part

- The sign band and the awnings show on the long wall (`facade.png`, `street.png`, `mid.png`). They are the biggest single gain for life and color.
- The front wall faces the back of a neighbor (`aerial.png`). The navy band reads near black. The sign boards read gray, not cream.

### Change 3, the materials: weak

- The frames changed color (`facade.png`), and the lintels are new and clean. But the frames read blue-gray, not sage, and the lintels and sills read blue-gray, not cream. The cause is the light (fix 1), not the shader change.
- The face tone does not show. The two faces in `street.png` differ by sun and shade only.
- The kick plate is not in any capture.
