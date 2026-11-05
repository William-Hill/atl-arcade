# brick-loft, round 2, judge: overall 5 / 10

Lab building: `w270469054`, brick-loft pick 0, look `pbr`, height 9.7 m, BeltLine Eastside. Captures: `reports/lab/brick-loft-0-pbr/`. Round 1 captures: `reports/lab/brick-loft-0-pbr-r1/`. Round 0 captures: `reports/lab/brick-loft-0-pbr-r0/`.

The lab camera now looks at the north wall (the wall that `frontEdge()` picks). So these views show a different wall than round 1.

Short verdict: the trim colors are now correct. Cream reads cream, sage reads sage, and the brick reads warm. The building now reads as a clean, bright Atlanta loft at every range, and it is easy to find in `far.png`. But the shop front still faces a lawn, the shop front is in flat shade with no AO, the crown still reads as two chimneys, and the window speckle is back. The grass is now near white. It is above gen-city-auto. It is still well below Tony Hawk 1+2 and the F-16 San Francisco build.

## Scores

| # | Criterion | Score | Reason |
|---|---|---|---|
| 1 | Silhouette and massing | 4 | No change in the geometry. The raised panel and the bulkhead still read as two brick chimneys of a similar size (`mid.png`, `street.png` top right). The cornice is one slab with a thin lip. |
| 2 | Mid-scale relief | 5 | Sills, lintels, piers, sign band, boards, and awnings all show (`facade.png`, `street.png`). The lintels are paint only. The front wall is in full shade, so the relief casts nothing and reads flatter than it is. |
| 3 | Material definition | 5 | Cream trim samples at 187,179,164 and the frames at 141,151,141 (`facade.png`). Stone, steel, and brick now read as three materials. The brick scan reads warm and real. The glass and the stone have one flat roughness. |
| 4 | Color and value variation | 6 | Warm brick, cream trim, sage frames, teal awnings, navy band (`facade.png`, `street.png`). The navy band (26,49,86) reads as navy, not black. Still no per-face tone. |
| 5 | Life and story | 5 | A concrete apron now rings the building (`aerial.png`, `mid.png`). The sign band and 6 awnings face open ground. But the shop front faces a lawn, not a street. No door, no planter, no lamp. The sign boards are blank. |
| 6 | Read at distance | 5 | In `far.png` (center) the brick block, the window grid, and the teal awnings read. In `mid.png` nothing hides the building. Part of this gain comes from the new lab camera. |
| 7 | Close-up quality | 5 | The brick texel density is good and the trim is clean (`facade.png`). The dark dot speckle is back in the window interiors (`facade.png`, x 440 to 580, y 350 to 520). |
| 8 | Lighting response | 4 | The north front is in full shade: no sill, lintel, or awning shadow (`facade.png`). No AO under the cornice, under the sills, or at the ground line (`street.png`). The cast shadow on the ground is short and pale (`aerial.png`, left of the building). |
| 9 | Image quality | 5 | The dotted ink lines on the name panel and the sign band are gone (`street.png`). The top edge of the cornice is still a dashed line (`street.png`, y 195 to 215). The coping has a heavy stair-step dotted outline (`aerial.png`). The speckle is back. |

## Top 8 fixes, ranked by visual impact

### 1. Put the shop front on a street, not on a lawn

- **What is wrong.** The front wall faces a big open lawn (`aerial.png`, the field below the building). The new apron is a pale pad in the grass with no link to any path or street (`aerial.png`, `mid.png`). In `street.png` the camera stands on grass and the ground rise hides the base and the apron.
- **Reference.** THPS 1+2 and Jet Set Radio Future always put a sidewalk, a curb, and a ledge between the shop and the street. The shop front is the skate line.
- **Technique.** In `frontEdge()` in `src/level/geo/facade-kit.js`, rank a wall that reaches a street sample within 60 m above a wall that only faces open ground. In `src/level/geo/aprons.js`, add a walk strip from the front apron to the nearest street or sidewalk, 2.5 m wide, in the sidewalk color. Add a curb edge on the front apron, so it reads as a sidewalk and not as a pad.

### 2. Add AO and contact shade to the facade

- **What is wrong.** The shop front is in shade, so no relief shadow shows (`facade.png`). The sills, the lintels, the cornice, and the awnings float. The wall meets the ground with no dark line (`street.png`, y 455 to 465).
- **Reference.** The F-16 San Francisco build bakes AO into its facades. Spider-Man 2 and Forza Horizon 5 keep a dark contact line under every ledge, even in full shade.
- **Technique.** In `createFacadeMaterial()` in `src/render/geo-view.js`, darken the wall by about 25 % in a 0.15 m band under each sill, lintel, and the cornice, and by 35 % in a 0.6 m band over the ground line. Give the kit parts in `src/level/geo/facade-kit.js` a vertex color AO on the underside. As a second step, tune the existing `GTAOPass` in `createPost()` in `src/render/post.js` for the `pbr` look at `quality=high` (radius, scale, and blend intensity). Do not add a second AO pass: it would do the same work twice and darken the image.

### 3. Remove the window speckle again

- **What is wrong.** Small dark teal dots cover the window interiors (`facade.png`, x 440 to 580, y 350 to 520; also faint in x 690 to 850). Round 1 had none (`brick-loft-0-pbr-r1/facade.png`).
- **Reference.** No reference game shows noise on glass.
- **Technique.** Render `facade.png` with the ink pass off. If the dots go away, the new 2-pixel crease rule in `src/render/post.js` makes them: require the crease on 2 pixels in the same direction, not on any 2 neighbors, and skip pixels whose normal change is below the edge threshold. If the dots stay, check the interior sample in `createFacadeMaterial()` in `src/render/geo-view.js` for a mip or a noise term that lost its clamp.

### 4. Fix the near-white grass

- **What is wrong.** The grass in the foreground of `street.png` samples at 244,241,215. It reads as white sand, not grass. In round 1 it sampled at 182,199,188 (`brick-loft-0-pbr-r1/street.png`). The lawns in `mid.png` and `aerial.png` are also pale and gray-lime.
- **Reference.** Forza Horizon 5 and THPS 1+2 keep grass a mid-value, saturated green. It frames the buildings, it does not compete with them.
- **Technique.** The warm ground disc and the whiter hemisphere in `src/render/look.js` lift the surface too. `createSurfaceMaterial()` already gets `ENV_LIGHT.ground`, which is separate from the wall value. Lower `ENV_LIGHT.ground` in `src/render/look.js`, or scale the hemisphere term on the surface material. Target a lit grass pixel near 120,160,95.

### 5. Make the crown read as a crown

- **What is wrong.** The raised panel and the bulkhead are two brick boxes of a similar size (`mid.png`, top; `street.png`, x 780 to 860). They read as two chimneys. The lab roof has only the bulkhead (`aerial.png`). The other brick-loft in `far.png` (foreground, with a water tower) shows that the roof gear works.
- **Reference.** Atlanta lofts (Ford Factory Lofts, Stove Works) have a wide stepped parapet with a stone cap. Spider-Man 2 gives each cornice 2 or 3 stacked profiles.
- **Technique.** As round 1 fix 4: in `crownKit()` in `src/level/geo/facade-kit.js`, use 3 bays when `bays >= 6`, set `crown.step` to 1.6 m in `src/level/geo/styles.js`, and add a lower 0.5 m step on each side. Build the cornice as 3 stacked boxes. Give the bulkhead a dark metal face and cap. In `roofProps()` in `src/level/geo/props.js`, give this footprint a water tower or a roof unit.

### 6. Clean the ink on the cornice and the coping

- **What is wrong.** The top edge of the cornice is a dashed black line (`street.png`, x 280 to 930, y 195 to 215). The coping in `aerial.png` has a thick stair-step dotted outline. The other buildings in `aerial.png` have the same outline.
- **Reference.** Jet Set Radio Future draws clean, continuous ink lines with a steady width.
- **Technique.** In `src/render/post.js`, scale the depth threshold with the view distance and fade the line width with distance. For thin parts (coping, cornice lip), use the normal edge only and skip the depth edge. Or skip the ink on the kit tiles in the `pbr` look.

### 7. A door, planters, and lamps at the base

- **What is wrong.** The shop floor is 8 equal glass bays (`street.png`, `mid.png`). No door, no step, no planter, no wall lamp. The sign boards are blank cream bars.
- **Reference.** THPS 1+2 puts a door, a step, and a planter ledge at every shop. These are also skate lines.
- **Technique.** As round 1 fix 7: a door bay in `createFacadeMaterial()` and a 0.15 m step in `shopFront()` in `src/level/geo/facade-kit.js`. Place a planter at every second pier of the front wall, on the apron, in `src/level/geo/props.js`. Keep the sign boards and the name panel blank: the round 0 direction (`brick-loft-r0-direction.md`, "Do not") forbids text on them, and this report does not lift that rule.

### 8. Raise the sign colors

- **What is wrong.** The navy band samples at 26,49,86 (`facade.png`, y 610 to 650). It now reads as navy at 8 m, but at 70 m it reads as a dark line (`mid.png`).
- **Reference.** JSRF and THPS 1+2 use mid-value, saturated sign colors that read at range.
- **Technique.** As round 1 fix 6: raise `SIGN_COLORS` in `src/level/geo/styles.js` to a game value, with each luma at 0.7 to 1.3 of the brick luma.

## Broken

- **Window speckle is back** (`facade.png`, see fix 3).
- **Near-white grass** in `street.png` (244,241,215), see fix 4.
- **Dashed ink** on the cornice top edge (`street.png`) and the coping (`aerial.png`), see fix 6.
- **Ground rise hides the base.** In `street.png` the grass crest still cuts the base at about y 460. The apron and the kick plate do not show in any ground view.
- **Sign band corner wrap not verified.** No capture shows a return wall clearly. In `mid.png` an awning sits on the last front bay at the corner, but the short wall is not visible.
- **Kit awnings have no collider.** The skater can pass through them. The direction accepts this for now.

## Change since round 1

| # | Criterion | R1 | R2 | Delta |
|---|---|---|---|---|
| 1 | Silhouette and massing | 4 | 4 | 0 |
| 2 | Mid-scale relief | 5 | 5 | 0 |
| 3 | Material definition | 4 | 5 | +1 |
| 4 | Color and value variation | 5 | 6 | +1 |
| 5 | Life and story | 4 | 5 | +1 |
| 6 | Read at distance | 4 | 5 | +1 |
| 7 | Close-up quality | 6 | 5 | -1 |
| 8 | Lighting response | 5 | 4 | -1 |
| 9 | Image quality | 5 | 5 | 0 |
| | **Overall** | **4** | **5** | **+1** |

The gain in read at distance comes mostly from the new lab camera, not from the art. The loss in lighting comes in part from the new view: round 1 showed a sunlit wall, round 2 shows a wall in shade.

### Fix 1, warmer shade light: worked, with a side effect

- Worked. A cream sill in shade samples at 187,179,164 (`facade.png`). Blue / red is 0.88. In round 1 it was 107,122,133 (`brick-loft-0-pbr-r1/facade.png`). The sage frames now read sage (141,151,141). The brick reads warm orange-red.
- Side effect. The grass is near white (`street.png`, 244,241,215). The cast shadows are short and pale (`aerial.png`).

### Fix 2, the concrete apron: worked, in part

- The apron shows as a clean concrete ring, wider on the front (`aerial.png`, `mid.png`).
- It is a pad in a lawn. No path or street meets it. In `street.png` the ground rise hides it.

### Fix 3, frontEdge() and the corner wrap: worked, in part

- The front wall now faces open ground, and nothing hides it (`street.png`, `mid.png`, `far.png`). In round 1 it faced the back of a neighbor about 8 m away.
- The open ground is a lawn, not a street (`aerial.png`).
- The corner wrap is not verified. No capture shows a return wall.

### Ink pass, 2-pixel crease: worked, in part

- The dotted lines on the name panel and the sign band are gone (`street.png`; compare `brick-loft-0-pbr-r1/street.png`).
- The cornice top edge and the coping are still dashed (`street.png`, `aerial.png`).
- The window speckle came back (`facade.png`). Check if the new crease rule is the cause (fix 3).
