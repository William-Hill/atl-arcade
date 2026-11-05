# Ground textures for the PBR look (#158)

Full PBR tiled sets for the four surfaces the skater rides on, for the pbr
look (`?look=pbr`). The toon version is #91 (albedo + normal only).

| Set | Surface kinds | CC0 scan (Poly Haven) | Tile |
|---|---|---|---|
| `sidewalk` | `sidewalk`, `path` | `brushed_concrete_03` | 2.0 m |
| `brick` | none yet (a district style can map `sidewalk` or `path` to it) | `brick_pavement_02` | 2.0 m |
| `asphalt` | `street` (and the street markings) | `asphalt_pit_lane` | 2.0 m |
| `trail` | `trail` (the BeltLine) | `concrete_floor` | 2.08 m |

Files: `assets/textures/ground-pbr/<set>/`

- `albedo_<tier>.jpg|.ktx2`: sRGB base color, light taken out, scaled so its
  mean is the pbr color of the surface (`SURFACE_COLORS[kind] x
  GROUND_ALBEDO[set]`, the same value the current shader gives a pixel
  before the `0.72` material color).
- `normal_<tier>.jpg|.ktx2`: OpenGL (+Y) tangent normal, linear.
- `orm_<tier>.jpg|.ktx2`: R ambient occlusion, G roughness, B metalness (0), linear.
- `set.json`: `tileMeters`, `meanLinear`, `roughMean`, the candidate scores, file sizes, KTX2 quality.
- `provenance.json`: sources, authors, license (CC0), tool, settings, date, 0 paid credits.

Tiers: `high` 1024 px, `phone` 512 px. Rebuild with
`python3 scripts/ground-pbr.py --ktx2 <path>/toktx` (numpy, Pillow, KTX-Software 4.3).

## How the sets are made

`scripts/ground-pbr.py` downloads 3 or 4 CC0 candidate scans per surface (2k:
diffuse, AO, OpenGL normal, roughness), scores each for light baked into the
albedo (a gradient across the tile, shadow in the joints that follows the
AO, a side light that follows the normal slope), for edge seams, and for
blotches that read as a repeat, and keeps the best. Then:

1. De-light: divide out the large-scale luminance (wrap-around blur at 1/6
   tile), then fit the high-pass log luminance to log AO and to the normal
   slope and remove the fitted part. The AO goes to ORM R, where the
   renderer applies it to the sky light only, not to the sun.
2. Anti-repeat (`flatten`): scale the mid band of the log luminance (1/48 to
   1/6 tile) down and squash high-pass outliers (tanh at 2 to 3 sigma), so
   no single stain, scratch or patch of light bricks marks the tile.
3. Scale each channel to the pbr palette mean.
4. Pack ORM, resize to the tiers (Lanczos), JPG 90 4:4:4, KTX2 (UASTC).

## Integration in `src/render/geo-view.js` (not done here)

`scripts/assets/ground-pbr-preview.js` (`surfaceMaterial()`) is a working
copy of this change on the game's surface material; port it as follows
when the merge of `main` into `epic/city-look` is done:

1. `GROUND`: one entry per set, with the three map URLs of the tier
   (`new URL("../../assets/textures/ground-pbr/asphalt/albedo_high.jpg", import.meta.url)`,
   one static URL per file so Vite bundles them) and its `set.json`.
   Keep the grass entry of `assets/ground/grass` (not in this issue).
2. `GROUND_OF`: `street -> asphalt`, `sidewalk` and `path -> sidewalk`,
   `trail -> trail`; brick by district style when the levels have it.
3. `loadGroundDetail()`: load albedo with `SRGBColorSpace`, normal and ORM
   with `NoColorSpace`, `RepeatWrapping`, anisotropy 8. Pick the tier from
   `tier.detail` / quality (`phone` maps on the phone tier).
4. `createSurfaceMaterial()` with `DETAIL` on a mapped kind (only on a face
   that points up, as now):
   - color: `diffuseColor.rgb = diffuse * albedo * wet`, in place of
     `art color x groundDetail() x GROUND_ALBEDO` (the albedo already has the
     mean of that product, so `GROUND_ALBEDO` and the color-detail scan go).
   - roughness: `roughnessFactor = orm.g` (in place of the rough map; keep
     `GROUND_MIN_ROUGHNESS` as a floor, then the wet factor).
   - metalness: `metalnessFactor = orm.b` (0).
   - normal: the same `detailNormal(normal, tu, tv, n, k)` with
     `vGroundXZ / tileMeters` (u along world x, v along world z, as on main);
     `DETAIL_NORMAL.ground` 1.0 works for all four sets.
   - AO: after `#include <aomap_fragment>`,
     `reflectedLight.indirectDiffuse *= orm.r; reflectedLight.indirectSpecular *= orm.r;`.
5. Texture units: 3 maps a set. Three sets plus grass (normal + rough) plus
   the environment and the sun shadow is 13 of the 16 units of a WebGL2
   fragment shader; brick as a fifth set needs a texture array or an atlas.
6. Keep the far fade (90 to 280 m) on the normal and roughness; the albedo
   needs no fade (its mip chain goes to the palette color).

To use KTX2: `KTX2Loader` with `setTranscoderPath` to the three basis
folder (copy `basis_transcoder.{js,wasm}` into `public/` for the build) and
`detectSupport(renderer)`; the textures come back with their color space
from the file.

## Preview and evidence

- `scripts/assets/ground-pbr-preview.html` (Vite dev server): the game
  with the sets on its surface material; params in the header of
  `ground-pbr-preview.js` (`sets`, `tier`, `format`, `swatch`, `groundpbr=0`).
- `node scripts/assets/ground-pbr-shots.mjs --out <dir>`: BEFORE/AFTER at
  skating height on the trail and a street, the KTX2 and phone variants,
  and swatches of each set; then
  `python3 scripts/assets/ground-pbr-evidence.py <dir>` for the contact
  sheet, tiling sheets, BEFORE/AFTER pairs and the tables below.
