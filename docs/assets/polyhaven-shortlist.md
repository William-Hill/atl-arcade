# Poly Haven shortlist for Skate ATL

Source: `https://api.polyhaven.com/assets` on 2026-11-03. All assets are CC0.
The IDs below are Poly Haven asset IDs. Use them with `mcp__blender__import_asset`
(`source: "polyhaven"`) or with `https://polyhaven.com/a/<id>`.

Poly Haven does not have a traffic cone, a bollard, a skate ramp, a rail, or a sign.
Make these parts in code or with Meshy / Tripo.

## Models: grind and obstacle candidates

The triangle count is the Poly Haven `polycount`. Decimate an asset above 20,000
before you export it for the phone tier.

| ID | Triangles | Use in the game |
|---|---|---|
| `painted_wooden_bench` | 630 | Grind ledge, park bench |
| `modular_street_seating` | 25,156 | Plaza ledge and seat set |
| `wooden_picnic_table` | 10,210 | Park obstacle, manual pad |
| `concrete_road_barrier` | 80,776 | Construction barrier, grind edge (decimate) |
| `concrete_road_barrier_02` | 42,578 | Construction barrier, grind edge (decimate) |
| `planter_box_01` | 8,094 | Street planter, ledge |
| `planter_box_02` | 10,944 | Street planter, ledge |
| `planter_box_03` | 13,112 | Street planter, ledge |
| `metal_trash_can` | 13,960 | Street prop |
| `wooden_crate_01` | 6,576 | Stack obstacle |
| `wooden_crate_02` | 5,176 | Stack obstacle |
| `plastic_crate_01` | 18,320 | Stack obstacle |
| `cardboard_box_01` | 16,952 | Construction prop |
| `cement_bag` | n/a | Construction prop |
| `WetFloorSign_01` | 228 | Small knock-over obstacle |
| `Barrel_01` | 2,682 | Obstacle |
| `old_tyre` | 2,880 | Obstacle |

## Models: street dressing

| ID | Triangles | Use in the game |
|---|---|---|
| `street_lamp_01` | 30,610 | Street light |
| `street_lamp_02` | 20,338 | Street light |
| `fire_hydrant` | 86,316 | Sidewalk prop (decimate) |
| `utility_box_01` | 4,404 | Sidewalk prop |
| `utility_box_02` | 6,268 | Sidewalk prop |
| `water_manhole_cover` | 6,301 | Road detail |
| `exterior_aircon_unit` | 18,986 | Roof and wall detail |
| `modular_fire_escape` | 11,322 | Wall detail, wall-ride area |
| `modular_metal_gutter` | 16,490 | Wall detail |
| `modular_chainlink_fence` | 89,232 | Fence (decimate) |
| `rollershutter_door` | 1,104 | Storefront |
| `outdoor_table_chair_set_01` | 9,828 | Patio dressing |
| `boombox` | 10,168 | Music prop for the Jet Set Radio tone |
| `spray_paint_bottles_02` | n/a | Mural artist prop |
| `jacaranda_tree` | 312,356 | Street tree (heavy, use as a reference or a billboard) |

## Textures: ground and walls

Download at 1k for the phone tier. Use the albedo map as a base for flat toon colors.

- Road: `asphalt_01`, `asphalt_02`, `clean_asphalt`, `asphalt_floor`
- Sidewalk: `concrete_pavement`, `concrete_pavement_02`, `pavement_01`, `brushed_concrete`
- Plaza: `brick_pavement`, `herringbone_pavement`, `brick_crosswalk`
- Walls: `brick_wall_001`, `brick_wall_02`, `concrete_block_wall`
- Park: `grass_ground`, `leafy_grass`, `grass_path_2`

## HDRIs: sky and ambient light

Use a sky-only HDRI as the background, or for soft ambient light.

- Day: `kloofendal_48d_partly_cloudy_puresky`, `kloofendal_43d_clear_puresky`
- Golden hour: `qwantani_dusk_2_puresky`, `belfast_sunset_puresky`
- City reference: `canary_wharf`, `crosswalk`, `hotel_rooftop_balcony`

## Assets to keep out of the game

These conflict with the political rules in `AGENTS.md`:

- `security_camera_01`, `security_camera_02`, `security_light` (surveillance tone)
- `street_rat`, `baseball_bat`, `old_gas_mask`, `ammo_box` (stigma or weapon tone)
- `road_damaged`, `road_damaged_2`, `worn_asphalt` (decline tone)
- HDRIs with `abandoned`, `derelict`, or `night` alley scenes in the name

## Rules for each import

1. Convert the materials to the project toon material.
2. Apply Draco, and keep each GLB under 10 MB.
3. Write a `provenance.json` next to the GLB: source URL, asset ID, CC0, and date.
