# BeltLine level: the road to PS4-level quality

Date: 2026-11-02. Scope: the `beltline-eastside` level (Ponce City Market to Krog Street Market).
Direction: "Stylized high-end", picked by William. The target is the Jet Set Radio concept at the quality of a PS4 stylized game (for example Jet Set Radio Future or Sunset Overdrive). The target is not photo realism.

## What the level has now

| Part | State | Real data? |
|---|---|---|
| Street grid | 1006 strips at their real positions | Yes, OpenStreetMap |
| Street names | 95 signs at the real intersections | Yes, OpenStreetMap |
| Building footprints | 1045, real shapes and positions | Yes, OpenStreetMap |
| Building heights | 21 from OSM tags, 912 from Overture, 112 defaults | Mostly (Overture heights are estimates) |
| Building look | Extruded footprints, shader windows, brick scan on brick styles | No. A style is chosen by rules, not from photos |
| Landmarks | Ponce City Market tower and Krog Street Market front, hand-modeled | From reference photos |
| Ground | Asphalt, concrete, trail, and grass scans; center lines and crosswalks | Markings follow real street classes |
| Props | Trees, lamps, benches, bins, bike racks, roof units, placed by rules | Positions follow real streets, not a survey |
| Terrain | Flat (y = 0) | No. Atlanta is hilly |
| Light | High tier: sun shadows, AO, ink outlines, bloom, clouds | n/a |

## Why it still looks "basic"

These are the gaps, from the largest to the smallest effect on the screen:

1. **Building geometry.** Every building is a box with a flat roof. The windows are painted on by the shader, so they have no depth. A PS4 city has recessed windows, sills, cornices, storefront frames, balconies, and roof parapets in real geometry.
2. **Flat terrain.** The real Eastside Trail runs on grades and over bridges (Freedom Parkway, North Avenue, Ralph McGill Boulevard). The game level is flat, so it does not read as the real place.
3. **Vegetation.** The trees are low-poly blobs of one kit. Atlanta is "the city in a forest": a dense oak and pine canopy, hedges, and grass edges.
4. **Hero buildings.** Only 2 landmarks are modeled. A player recognizes a place from a few known buildings: Ponce City Market (the full building, not only the tower), the Telephone Factory Lofts, Studioplex, New Realm Brewing, the Historic Fourth Ward Park lake, and the Atlanta Art Park.
5. **Murals.** The BeltLine is famous for its murals. The game has procedural murals. Real murals need the permission of each artist.
6. **Life.** No people, no bikes, no scooters on the trail (issue #41).

## The plan, in order

Each step is a separate issue. Each step keeps the low tier at the 55 FPS gate.

1. **Facade kit (largest effect).**
   - Replace the painted windows with an interior-mapping shader: each window shows a fake room with depth, at no geometry cost.
   - Add real geometry for each style: window recesses and sills, a cornice, storefront frames, and parapets. Use instanced modules along the bays, so the cost stays low.
   - Use the Overture `roof_shape` where it exists (only 2 of 1077 buildings have one now), and pitched roofs for houses by type.
2. **Terrain and bridges.**
   - Get the elevation from the USGS 3DEP 1 m DEM (public domain).
   - Lift the ground, the strips, and the building bases onto it. Put the trail on its real grade, with the three bridges.
   - The skate controller already samples a ground height and normal, so slopes need tests, not a new controller.
3. **Vegetation.**
   - Stylized trees with leaf cards and a wind shader, in 3 sizes, instanced.
   - Grass and shrub edges along the trail and the sidewalks.
   - Use the CC0 tree packs from the asset research (`docs/research/2026-11-02-x-links-level-and-assets.md`) or the Polyfork kits.
4. **More hero buildings.** Run the img2threejs pipeline on 4 more landmarks, with reference photos under an open license.
5. **Murals.** Make an agreement with Art on the BeltLine or with the artists, or commission new murals. Do not copy a real mural without permission.
6. **Life.** NPC skaters, cyclists, and walkers on the trail (#41).
7. **Render technology.**
   - Evaluate the three.js WebGPU renderer for the high tier: it gives faster instancing and compute.
   - Compress the textures with KTX2 (Basis), so the download stays small as the scans grow.
   - Replace MSAA with TAA when the scene has more thin detail (fences, leaves).

## Limits to keep in mind

- **Browser:** the game must run at 60 FPS on a mid laptop, not only on a desktop GPU. The high tier must stay optional.
- **Download size:** each new scan or model adds to the first load. Each must be measured and kept under a budget.
- **Real data:** OpenStreetMap and Overture give positions and heights, not looks. A building looks like itself only when it is modeled from photos, one at a time.
- **Political rules:** clean scans only, no decline, murals by permission.
