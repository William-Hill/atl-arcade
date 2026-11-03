# Graphics and characters audit (#65)

Date: 2026-11-03. Branch: `audit-65-playability`. Renderers: SwiftShader (`shots/high-*`, `shots/low-*`) and ANGLE Metal, Apple M4 Max (`shots/metal-*`). Viewports: 1280x720, 390x844 (DPR 2 and 3), and 844x390 (DPR 3). Scripts: `scripts/asset-table.mjs`, `capture.mjs`, `capture2.mjs`, `capture-metal.mjs`. Logs: `shots/capture.json`, `shots/capture2.json`, `shots/capture-metal.json`.

## Scores

| Area | Score | Reason |
|---|---|---|
| Graphics | 3 / 5 | The high tier on a real GPU looks good and reads at phone size: shadows, ink, halftone, clean scans. Four things hold it back. The game has no phone tier. The low tier loses the Jet Set Radio look. There is no art bible. Murals and a landmark have defects. |
| Characters | 3 / 5 | Nia and Marcus are good and consistent models, with clear silhouettes and outlines on a phone. Five things hold them back. The clips are greybox and not reviewed. The toon pass removes the face decals. There is no brake clip. Marcus has no face decals. The NPCs are placeholder primitives. |

## Asset table

| Path | Size (bytes) | Triangles | Textures | Draco | KTX2 | provenance.json |
|---|---|---|---|---|---|---|
| assets/skaters/nia/skater.glb | 2,735,736 | 17,896 (1 skinned mesh, 65 joints, 24 clips) | base color 2048² JPEG (1,137,164), normal 1024² (313,937), rough-metal 1024² (226,129) | yes | no | yes (stale, see CHR-9) |
| assets/skaters/marcus/skater.glb | 2,071,416 | 17,006 (1 skinned mesh, 65 joints, 24 clips) | 2048² (690,214), 1024² (183,041), 1024² (160,568) | yes | no | yes |
| assets/skaters/nia/face/eyes.png, mouth.png | 79,580 + 49,277 | n/a | 1200x108 and 576x86 PNG (not power of two) | n/a | no | yes |
| assets/kit/street-kit.glb | 175,416 | 4,536 (18 meshes) | none (vertex color) | no | no | yes |
| assets/landmarks/ponce-city-market-tower.json | 1,329,537 (111 KB gzip, from decisions) | 4,732 (toon LOD) plus physical groups | uses the landmark textures | n/a (JSON) | no | yes |
| assets/landmarks/krog-street-market-front.json | 1,059,527 (84 KB gzip, from decisions) | 3,584 (toon LOD) plus groups | same | n/a | no | yes |
| assets/landmarks/textures/{brick,metal,trim} | 398,001 (9 files) | n/a | 512² JPEG color, normal, and roughness | n/a | no | yes |
| assets/ground/{asphalt,concrete,grass,trail} | 1,360,907 (4 files) | n/a | 1024² JPEG | n/a | no | yes |
| Murals (src/render/murals.js) | code | n/a | 1024² canvas atlas, 16 cells of 256 px | n/a | no | n/a (original code art) |
| NPCs (src/render/npc-view.js) | code | 11,152 for all 40 (from decisions) | vertex color | n/a | no | n/a |
| docs/characters/concept/{nia,marcus} | PNG | n/a | concept art | n/a | n/a | yes |

The skater GLB plus the city art is about 6.5 MB raw on the first load. The two landmark JSON files are about 2.4 MB raw, or about 0.2 MB with gzip. Rough GPU memory estimate, with mips: skater textures about 33 MB, ground about 22 MB, landmark maps about 13 MB, and the 4096² shadow map about 64 MB on the high tier. These are estimates, not measured.

**Asset-audit skill, applied by hand:**

- Naming: the project has no naming convention. The skill pattern `[category]_[name]_[variant]` does not apply.
- Size: no GLB is over 10 MB.
- Power of two: the two face decals are not power of two.
- Orphans: the Nia face `preview.png` (648,761 bytes) is not used in code. It is review evidence.
- Missing files: none.
- Verdict: WARNINGS.

**Art-bible gap check:** There is no art bible. `design/art/art-bible.md` and `docs/style-sheet.md` (#16) do not exist. Parts of an art bible are spread across the concept, `docs/decisions.md`, the character dossiers, and the code (the mural `PALETTE`). The missing sections are:

1. Visual identity statement. Only "Jet Set Radio, stylized high-end" exists.
2. City and Atlanta palette. Only per-character palettes exist.
3. Lighting and time of day.
4. Shape language and phone silhouette rules.
5. Environment rules. These are partly in the decisions log.
6. UI visual language. None exists.
7. VFX. The concept names "speed lines", but none exist.
8. Asset budgets: triangles, texture size, and first-load MB. Only "GLB under 10 MB" exists.
9. Style prohibitions. These are only in the political rules.

**Consistency-check skill:** The project has no entity registry and no GDDs, so the agent compared the docs with the assets by hand. The conflicts are CHR-7, CHR-9, and GFX-8.

## Findings

| ID | Sev | Finding | Evidence | Suggested fix | Issue | Phone impact |
|---|---|---|---|---|---|---|
| GFX-1 | P1 | No phone tier. `qualityFor()` gives "high" to every hardware GPU, phones included. The high tier is a 4096 shadow map, GTAO with 12 samples, an MSAA x4 half-float target, bloom, interiors, and facade depth, at a pixel ratio up to 2. | src/render/quality.js:16-18, src/render/renderer.js:7, src/render/post.js:72-91 | Add a phone tier: touch device plus small screen. Use a 1024 or 2048 shadow map or a blob shadow, no GTAO, no bloom, MSAA x2 or FXAA, and a pixel ratio of 1.5 or less. Keep the ink and the hull. | #24 | high |
| GFX-2 | P1 | The low tier loses the Jet Set Radio look. The city has no ink and no halftone, and the colors are flat. Only the skater hull outline is left. A phone that falls back to low looks like a pastel greybox. | shots/low-phone-rolling.jpg against shots/high-phone-rolling.jpg; shots/metal-low-phone-pcm.jpg | Add a cheap outline for the city on low (baked edge lines or inverted hulls on the tiles) and keep the toon ramp. | #16 | high |
| GFX-3 | P1 | There is no art bible or style sheet, so there are no phone readability rules and no asset budgets. | No design/art/art-bible.md; no docs/style-sheet.md | Write `docs/style-sheet.md` (#16) with the 9 sections listed above, including phone rules. | #16 | medium |
| GFX-4 | P1 | The Krog Street Market sign reads "KROG STREET MAR". The "MARKET" card is hidden in the canopy. The front also sits inside a plain OSM brick box. A named landmark shown wrong breaks "at its best". Same defect as GEO-3. | shots/high-desk-ksm-front.jpg, shots/low-desk-ksm-front.jpg, e2e/__screenshots__/beltline-krog-street-market-front.png | Move or resize the MARKET card, and hide the OSM wall behind the front. | #18 | low |
| GFX-5 | P2 | Kit geometry cuts through the murals: window sills, storefront piers, and the belt course. On a phone this shows as dashed black lines across the art. | shots/high-desk-mural-0.jpg, shots/high-desk-mural-2.jpg, shots/metal-high-phone-pcm.jpg | Skip sills, piers, and belt courses inside a mural rect, or move the mural out past 0.16 m. | — | medium |
| GFX-6 | P2 | The murals are blurry: 256 px for a wall up to 30 m wide. Only 16 designs exist, and 13 cells are used on 39 walls, so designs repeat. | shots/high-phone-mural-0.jpg, shots/capture2.json | Use a 2048 atlas or one texture per mural, and commission real murals. | — | low |
| GFX-7 | P2 | White crape myrtle crowns read as gray, dead-looking foliage. Confirmed on Metal. | shots/metal-high-desk-npc-family.jpg, shots/high-desk-mural-3.jpg | Make the white bloom warmer and brighter, or use a pink bloom only. | — | medium |
| GFX-8 | P2 | `PCFSoftShadowMap` was removed in three r186, so each load logs a warning and falls back to PCF. The decisions log says "soft PCF". | src/main.js:65, the Vite console log | Use `PCFShadowMap` (or `VSMShadowMap`) and correct the decision text. | — | low |
| GFX-9 | P2 | The HUD covers the art at 390 px: the attribution covers the score and the skater buttons, and the keyboard help covers about 20% of the screen. Same as MOB-3 and MOB-4. | shots/high-phone-rolling.jpg | See the mobile findings. | #24 | high |
| GFX-10 | P2 | Speckle noise in the windows on SwiftShader only. Metal is clean. | shots/high-phone-pcm.jpg against shots/metal-high-phone-pcm.jpg | No action. Note it for headless evidence. | — | low |
| GFX-11 | P2 | Asset weight on a phone: the 2048² base color (1.14 MB) is more than a skater needs at phone size. All textures are JPEG, not KTX2. | Asset table | Ship a 1024 base color for the phone tier, then KTX2 (deferred decision 2026-11-02). | — | medium |
| CHR-1 | P0 | Real skaters have not reviewed the 24 clips. The provenance files say "greybox, not reviewed by skaters". This blocks release under AGENTS.md. | assets/skaters/*/provenance.json "status" | Run the skater move-set review. | #22 | medium |
| CHR-2 | P1 | The toon pass removes Nia's face decals. `attachFace()` patches the cloned material at load, then `toonSkater()` replaces it with a new `MeshToonMaterial`. Blink, smile, and cheer do not render in the default game, and the painted eyes stay. | shots/capture2.json "face-decal-check": cache key "skater-face" becomes "skater-toon-rim"; src/render/skater-model.js:56, src/main.js:158 | Apply the face decal after the toon pass, or chain the face `onBeforeCompile` into `toonMaterial`. Add a test. | related to #60 (new) | medium |
| CHR-3 | P1 | The NPCs are box bodies with faceless 20-face heads and a box dog. This is a large style gap against the Tripo skaters, and the figures read as placeholders. | shots/high-desk-npc-jogger.jpg, shots/high-phone-npc-dogWalker.jpg (camera under the ground in these shots, but the figures are clear) | Build a stylized low-poly NPC kit in the skater style, with hair, a face decal, and the hull outline. | #41 (closed) | medium |
| CHR-4 | P1 | In phone landscape the skater is about 50 CSS px tall and hard to read. Portrait is fine, at about 20% of the screen height. | shots/metal-high-land-rolling-nia.jpg | Use a closer follow distance, a lower FOV, or both, for landscape phones. | #24 | high |
| CHR-5 | P2 | There is no brake clip. The controller brakes on the toe stop (`brakeDecel` 8), but the skater keeps the coast pose. `manual` is still unreachable. | src/render/skater-anim.js `clipFor`, src/sim/skate/controller.js:148 | Add a toe-stop brake clip and bind it to `input.brake`. | — | medium |
| CHR-6 | P2 | Marcus has no face decals (`FACE_DECALS` has `nia` only). The viewer face camera is set for Nia's height and cuts off Marcus's face. | src/render/skater-face.js:11-15, shots/viewer-marcus-face.jpg | Paint the Marcus decals, and fit the face camera to the model head bone. | #42 | low |
| CHR-7 | P2 | The player sees "Crisscross", but the docs and the 2026-11-03 decision name the rink move "Cross Step". | src/sim/skate/constants.js:110, docs/decisions.md:507 | Rename the move to "Cross Step". | — | low |
| CHR-8 | P2 | The viewer (`skater.html`) shows PBR materials and the game shows toon, so menus and close-ups do not match the game. | shots/viewer-* against shots/high-phone-spawn-toon1.jpg | Use the toon pass in the viewer (behind `?toon`). | #60 | low |
| CHR-9 | P2 | The Nia provenance is stale. It records 2,639,720 bytes ("fifth pass"); the file is 2,735,736 bytes after 4 later commits. The decisions log also gives 2,290,112 bytes and 15 clips (now 24). | assets/skaters/nia/provenance.json; `git log -- assets/skaters/nia/skater.glb` | Add the 4 missing clip passes to the provenance. | — | low |
| CHR-10 | P2 | The toon pass drops the normal map (the knit and braids detail). | shots/capture2.json "after.normalMap": false | Fix under #60. | #60 | low |

## Political check

The agent found no graffiti, police, crime, traffic, or litter. The streets have markings but no cars. The bins are clean. The scans have no cracks. The murals are original and positive ("ATL", "SWEET AUBURN", "KROG", "SKATE ATL", peach motifs). The crowd is friendly.

Three items show a place at less than its best:

- GFX-4: the Krog Street Market sign.
- GFX-7: gray, dead-looking trees.
- GFX-5: lines across the murals.

## Verified

- Every GLB is under 10 MB, and every asset group has a provenance.json.
- The triangle counts, texture sizes, Draco use, and KTX2 absence in the asset table, from `scripts/asset-table.mjs`.
- The toon pass removes the face decal and the normal map (runtime check).
- The high tier is selected for any non-software GPU. There is no phone logic in `src/render/quality.js` or `src/main.js`.
- High and low captures on SwiftShader and Metal at 1280x720, 390x844, and 844x390.
- The two skaters are visually consistent and read at phone portrait size.
- The 39 mural walls use 13 distinct cells.
- No political-rule violations in 87 shots.

## Not verified

- Phone FPS and real phone GPUs.
- How the dance clips look in the game. The KeyQ press did not start a dance in the capture; the clip stayed "coast".
- The NPC look on Metal at the trail. The camera missed the NPCs, so the NPC evidence is SwiftShader only.
- The rig deformation (candy-wrapper at the forearms), beyond the contact sheets.
- The exact GPU memory use. The numbers above are estimates.
- Whether the speckle in the windows also shows on mobile GPUs.
