# Skate features (assets/skate-features)

Grindable and skateable feature models for the pbr look: models and data only. The level (the parent session) places them.

- Generator: `scripts/blender/skate_features.py` (`blender -b -P scripts/blender/skate_features.py`). Writes one Draco GLB per feature, the shared trim sheet in `textures/`, and `features.json`.
- Manifest: `assets/skate-features/features.json`. Per feature: `file`, `bytes`, `lods` (node names, triangles, `distance`), `bounds`, `footprint` (`min`/`max` [x, z]), `kind`, `grind` (edges), `solids` (boxes), `surfaces` (ramp profiles and planar polygons), and per kind extras (`ramp`, `stairs`).
- Frame: glTF model space, +y up, +z forward (the front of a bench, the riding face of a ramp, the downhill side of a stair set), origin at the ground center of the footprint, meters. Long features run along x.
- Helper: `src/level/skate-features.js` (pure, tested in `skate-features.test.js`).
  - `featureLevelObjects(feature, { id, position, yaw })` → level objects `{ id, kind: "rail", edge, feature, radius, spline: { points } }` (`edge` is the manifest kind) in world space. `prepareGrindables({ objects })` takes them as is. Yaw is Three.js `rotation.y`.
  - `featureGround(placed)` → `(x, z) => { height, normal, id } | null`: the top of the solids, the ramp profiles, and the pyramid/bank planes, to merge into the level's ground sampler.
  - `featureFootprint()` → the four world corners, for claiming ground (props, trees) under a feature.
- Rendering: `src/render/skate-feature-models.js` `shareSkateFeatureMaterial(roots)` points every loaded mesh at one material, so the set uploads three textures once (GLTFLoader makes one material and texture set per file otherwise: 54 textures for the 18 files).
- Preview: `scripts/assets/skate-features-preview.html` (the real game, every feature on a concrete pad draped over a treeless lot beside the Beltline trail, default `?plaza=311.5,-85.2,-1.403`; `?features=id,..`, `?pad=0`, `?skatefeatures=0` for BEFORE; the level has no paved plaza areas, so without the pad the features would stand on grass) and `scripts/assets/skate-features-shots.mjs` (BEFORE/AFTER pairs). Stats and lineup: `node scripts/assets/skate-features-check.mjs --out lineup.png --json stats.json`.

## Grind edge kinds

| kind     | features                                        | note                                              |
| -------- | ----------------------------------------------- | ------------------------------------------------- |
| `rail`   | flat bars, round rails, down rails, kinked rail | `radius` is the bar half-width or the tube radius |
| `ledge`  | ledges, planter, manual pad, benches            | the waxed steel or stone edge                     |
| `coping` | quarter pipe, bank                              | the steel coping or edge angle at the lip         |

`grind.js` only reads `spline`, so every kind grinds. `physics/world.js` throws on spline-only objects that are not `kind: "rail"`, so `featureLevelObjects` emits every edge as `kind: "rail"` (a thin capsule collider along the edge) and keeps the manifest kind in `edge`. The solids/surfaces carry the riding height.
