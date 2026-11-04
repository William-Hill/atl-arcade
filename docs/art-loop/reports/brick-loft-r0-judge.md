# brick-loft, round 0, judge: overall 3 / 10

Lab building: `w270469054`, brick-loft pick 0, look `pbr`, height 9.7 m, BeltLine Eastside. Captures: `reports/lab/brick-loft-0-pbr/`. This is the first report for this style. There is no earlier score.

Short verdict: the building is a clean brick box with a painted window grid. The close view has good ideas (interior mapping, a brick scan, real sills and piers). But the building has no shadows, no signs, no awnings, no roof gear, and no street. It stands on a lawn. At 70 m and past, it is a flat red card. It is far below Tony Hawk 1+2 and below the F-16 San Francisco reference.

## Scores

| # | Criterion | Score | Reason |
|---|---|---|---|
| 1 | Silhouette and massing | 2 | A plain rectangular box with a flat roof and a thin cornice (`street.png`, `aerial.png`). No setback, no stair tower, no water tower, no roof gear. |
| 2 | Mid-scale relief | 4 | A cornice, a belt course, storefront piers, and sills exist (`facade.png`). The window frames are paint only, the wall has no pilasters, and the cornice is one flat slab with no profile. |
| 3 | Material definition | 4 | The brick scan reads at 8 m (`facade.png`), but as fine noise, with weak mortar lines. The trim is a flat cold gray. There is no metal, no stone, no concrete base. The storefront glass reflects well. |
| 4 | Color and value variation | 3 | One brick red on every face, and cold blue-gray trim (`facade.png`, `street.png`). Both visible faces have the same value. No accent color anywhere. The cream trim color in `styles.js` does not show. |
| 5 | Life and story | 1 | No sign, no awning, no door, no planter, no light, no mural, no roof equipment (`street.png`, `aerial.png`). The storefront faces a lawn. Nothing says Atlanta. |
| 6 | Read at distance | 3 | At `mid.png` the window grid still reads, but the building is a flat red box behind the neighbor. In `far.png` the lab building cannot be found: every building is the same value and shape. |
| 7 | Close-up quality | 5 | The brick texel density is acceptable and does not blur (`facade.png`). The interior rooms have parallax. But half of the upper windows show a dense speckle pattern, and the cornice is a flat untextured band. |
| 8 | Lighting response | 2 | No cast shadows at all: the cornice, sills, and piers cast nothing on the wall, and the building casts nothing on the ground (`street.png`, `facade.png`). The ground-contact darkening is faint. Only the glass reflection works. |
| 9 | Image quality | 4 | Speckle in the windows (`facade.png`), heavy dotted ink lines on far roofs (`mid.png`, `far.png`), a visible tile repeat in the grass (`mid.png`, `aerial.png`), green blotches on the road (`aerial.png`), and a bent wall base line (`corner.png`). |

## Top 8 fixes, ranked by visual impact

### 1. Turn on sun shadows near the camera

- **What is wrong.** Nothing casts a shadow. In `street.png` both buildings float on the grass with no shadow. In `facade.png` the cornice (top band) and the sills cast no shadow on the brick, so the relief that the kit builds is almost invisible.
- **Reference.** Every reference game uses a sun shadow cascade near the camera. Spider-Man 2 and Forza use 3 to 4 cascades. THPS 1+2 uses strong, hard sun shadows on every ledge, because they show the skater what is a ledge.
- **Technique.** `createGeoLights()` in `src/render/geo-view.js` already sets up a 2048 shadow map with a 45 m box. The comment says the shell turns it off on a geodata level. Turn it on for the `pbr` look and the high tier. Keep the box on the camera target, not only the skater. Let the kit tiles (`kit-*`) and the depth tiles cast. Set `sun.shadow.normalBias` so the 0.12 m sills do not acne. Use a lower sun angle than `offset (30, 50, 20)` so the cornice shadow is at least 0.5 m tall on the wall.

### 2. Give the ground floor life: awnings, signs, a door, and a sidewalk

- **What is wrong.** The storefront in `facade.png` (bottom third) and `street.png` (left building, ground floor) is a row of identical glass bays with gray piers. No awning, no sign band, no door, no planter. The building stands on a lawn with no sidewalk. `awningsFor()` in `src/level/geo/geo-mesh.js` only puts an awning on a wall within 4 m of a street, so this building gets none.
- **Reference.** THPS 1+2 and Jet Set Radio Future make the ground floor the richest part of every building: signs, awnings, doors, bins, planters, and skate ledges. Spider-Man 2 puts a unique sign on every shop.
- **Technique.**
  1. In `src/level/geo/geo-mesh.js`, let `awningsFor()` fall back to the longest wall when no wall faces a street.
  2. In `createFacadeMaterial()`, add a sign band: a colored strip above the shop windows, under the belt course, on the `shop` level. Color it from a small palette by `vWallSeed`.
  3. Mark one bay per storefront wall as a door: a taller, narrower opening in the shader, and a step box in `wallDepth()` in `src/level/geo/facade-kit.js`.
  4. Add planters and benches at the piers from the street kit (the props pass already places kit props).
  5. Put a concrete apron (1.5 to 2 m) around every storefront building, so it meets paving, not grass.

### 3. Break the box: roof gear and a real roofline

- **What is wrong.** In `aerial.png` (center) the roof is a flat pale pink slab with nothing on it. `styles.js` gives brick-loft a 0.6 water tower chance and roof units, but none show. In `street.png` the roofline is one straight line.
- **Reference.** The F-16 San Francisco build and Spider-Man 2 fill every flat roof with HVAC boxes, vents, stair bulkheads, and water tanks. gen-city-auto adds roof boxes for almost no cost. A brick loft in Atlanta (Ponce City Market, Stove Works) has stepped parapets, a stair tower, and roof monitors.
- **Technique.** In `src/level/geo/props.js`, check why this 9.7 m building gets no water tower and no unit (the `area > 300` and `rand()` rules, and `spot()` with a 2.5 m margin on a thin footprint). Raise `roof_unit` to about 1/150. Always add a stair bulkhead box on loft roofs. In `buildingKit()` in `src/level/geo/facade-kit.js`, add a stepped or raised parapet over the center bay of the longest wall. Darken the roof color (`tint(color, 0.45)` in `geo-mesh.js` makes a pink roof): use a gray membrane or tar color.

### 4. Fix the trim color and add a second material on the wall

- **What is wrong.** `styles.js` sets the trim to cream `[0.9, 0.86, 0.78]`, but in `facade.png` every frame, sill, pier, belt, and cornice is a cold blue-gray. The whole facade is two colors: brick red and blue-gray. The sky environment light and the blue hemisphere light tint the rough trim.
- **Reference.** Real Atlanta lofts use cream limestone or cast stone for sills and lintels, dark green or black steel for the window frames, and a concrete or granite base. Forza Horizon 5 gives every building at least three materials.
- **Technique.** In `createFacadeMaterial()`, split the trim into two colors: a stone color for sills, lintels, belt, and cornice, and a dark metal color (green-black, roughness 0.4, metalness 0.6) for the window frames and mullions. Add a lintel band over each upper window. Add a 0.6 m stone base at the wall bottom. In `src/render/look.js`, lower `hemisphere` sky color saturation, or warm the sky environment, so cream stays cream.

### 5. Per-face and per-building color variation on the brick

- **What is wrong.** Both visible faces of the lab building in `street.png` have the same red. In `mid.png` the brick buildings on the left are the same red too. The brick has no large-scale variation: no darker band, no lighter weathered top.
- **Reference.** Spider-Man 2 and the F-16 build use a facade atlas with many brick types and a per-building hue shift. Real brick changes from face to face with the sun angle, and from course to course.
- **Technique.** `styles.js` has three brick colors, but each building gets one. In `createFacadeMaterial()`, add a hue and value shift for each face from `vWallSeed` (plus or minus 6 percent). Add a low-frequency noise (2 to 5 m) to the brick tint. Add a soldier course (a band of vertical brick, a darker tone) under the cornice and over the storefront. Add a second brick scan (a dark iron-spot brick) and pick one by building id.

### 6. Make the building read at 70 m and 250 m

- **What is wrong.** In `mid.png` the lab building is a red box with a dotted grid. In `far.png` it cannot be found. Every building in `far.png` has the same gray value, the same black ink outline, and the same window dots.
- **Reference.** THPS 1+2 and JSRF use strong value contrast and bold color blocks so a building reads from far away. Spider-Man 2 keeps cornice and roof shapes in the far LOD and bakes the lights into a low-res atlas.
- **Technique.** In `createFacadeMaterial()`, the far fade (`far0`) blends the window cell to a mean color. Keep a darker band for each floor of windows in the mean, so the floors still read as stripes. Keep the cornice and sign band colors at full strength at distance. In `src/render/post.js`, fade the ink outline faster with distance (`fadeNear` and `fadeFar` are set from `GEO_FOG_NEAR` and `GEO_FAR` in `src/main.js`): at 250 m the black lines on every roof edge make the city look like a wireframe. Add a little aerial perspective (a blue haze by distance) so the depth reads.

### 7. Remove the speckle in the windows

- **What is wrong.** In `facade.png`, upper row windows 1, 3, 5, 6 (from the left) and middle row windows 3, 4, 6 show a dense dot speckle over the glass. It reads as static noise. The same speckle shows on the dark band under the cornice (top of `facade.png`) and in the dark windows in `street.png` (right building, ground floor).
- **Reference.** No reference game shows screen-space noise on glass. JSRF uses halftone only on characters, never on architecture.
- **Technique.** The likely cause is the halftone in the ink pass in `src/render/post.js` (`HALFTONE`, cell 5 px, on any pixel under luma 0.16), which hits the dark rooms and the blinds. The blind slats in `createFacadeMaterial()` (40 per floor) can add to it. Turn the halftone off in the `pbr` look, or mask it to non-facade pixels. Then check the slat fade (`slatW`). Confirm with `?halftone=0`.

### 8. Fix the ground around the building

- **What is wrong.** The building stands in a flat pale green field with a visible tile repeat (`mid.png`, right half; `aerial.png`, center). The grass is washed out, near white-green, with no value change. In `aerial.png` the wide road on the left has green blotches on the asphalt.
- **Reference.** Forza Horizon 5 blends three or more ground layers by a noise mask and adds decals at every building base. The F-16 build uses a baked AO pass under every building.
- **Technique.** In `createSurfaceMaterial()` in `src/render/geo-view.js`, add a third, larger sample (40 to 80 m) with a value change to break the repeat. Raise the grass saturation and lower its value, so the buildings stand out. Add a dark contact band on the ground around each footprint (a ring mesh with alpha, or a term in the surface shader from a distance field). The ground-contact term on the walls (`WALL_AO.base` 0.62 in `src/render/look.js`) is too weak to see in `street.png`. Lower it to about 0.45 and spread it to 1.2 floors.

## Broken

- **No shadows.** The shadow map is off on geodata levels (see `createGeoLights()` in `src/render/geo-view.js`). This is a setting, but it reads as a bug in every capture.
- **Window speckle.** Dot noise on dark glass in `facade.png` (see fix 7).
- **Green blotches on the road** in `aerial.png` (left road, around x 300 to 500, y 200 to 330). The grass detail or the grass color shows through the asphalt. Check the color match in `createSurfaceMaterial()` (`distance(vColor.rgb, uKindColor[i]) < 0.01`) and the terrain drape order.
- **Bent wall base.** In `corner.png` the base line of the pale blue building (center left, x 250 to 600, y 470 to 490) bends and steps. The wall base follows the terrain and the ground does not match.
- **Lab framing.** In `corner.png` the camera target is hidden by a neighbor. The brick lab building is only a sliver behind the pale blue building (center, x 605 to 800). In `mid.png` the neighbor covers half of it too. In `far.png` the lab building cannot be found. Move the corner and mid cameras to a side with a clear line of sight, or hide the neighbors in front of the target.
- **Storefront on a lawn.** The storefront ground floor faces grass on all sides (`street.png`). Either the footprint data has no street near it, or the style choice is wrong for this site.
- **Trim color.** The style trim is cream, but it renders blue-gray (`facade.png`). The lighting changes the art color too much.
- **Window frames lean.** In `facade.png` the frames are drawn as paint, so the reveal looks right only from the front. The interior mapping reveal and the painted frame do not line up at the edges (for example, the right edge of the third upper window). Check the frame width (`fw`) against the `reveal` depth.

## Lab note (after the round)

- No shadows: the cause was the lab, not the light setup. The high tier has a sun shadow map, but its 70 m box followed the skater at the spawn, far from the lab building. Now a fixed camera puts the shadow box at its target (`shadowFocus` in `src/main.js`). Round 1 captures have shadows.
- The dot speckle on the glass came from the halftone of the ink pass. The pbr look has no halftone now.
- The lab cannot yet isolate the building, so neighbors can hide it in the `corner`, `mid`, and `far` views. The lab moves the camera when a building blocks the line of sight, but the check uses the footprints only, not the trees.
