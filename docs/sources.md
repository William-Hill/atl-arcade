# Data sources

Every dataset that the game uses is listed here, with its license and the attribution that the license requires. Add a row before a new dataset goes into a level.

## Datasets in use

| Dataset | Used for | License | Attribution | Where |
|---|---|---|---|---|
| OpenStreetMap, through the Overpass API (`https://overpass-api.de/api/interpreter`) | Building footprints and the height and level tags, street center lines, sidewalks, paths, the Atlanta BeltLine Eastside Trail, parks, and the street furniture points (benches, waste baskets, bicycle parking, drinking water, street lamps, bollards) in the `beltline-eastside` level | Open Database License (ODbL) 1.0, https://opendatacommons.org/licenses/odbl/1-0/ | "Map data (c) OpenStreetMap contributors", with a link to https://www.openstreetmap.org/copyright | Raw fetch: `levels/beltline-eastside/raw/overpass.json` and `raw/fetch.json` (query, endpoint, time, OSM base time). The street furniture: `raw/street-furniture.json` and `raw/street-furniture-fetch.json` (fetched 2026-11-04). Derived level: `levels/beltline-eastside/level.json`. |
| Overture Maps Foundation buildings, release `2026-10-21.0` (`s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/`) | The height (or floor count) of 912 OSM buildings in the `beltline-eastside` level that have no OSM height or levels tag. Only rows with an OpenStreetMap source are used; the 63 Microsoft ML rows are not. | ODbL 1.0 (the OSM-sourced part) | "Heights: Overture Maps Foundation" in the level attribution, next to the OSM attribution | `scripts/overture-heights.py` writes `levels/beltline-eastside/raw/overture.json`. `scripts/build-block.mjs` reads it. |
| City of Atlanta, Department of City Planning GIS, "Official Address Points" (`https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/AddressPoint/MapServer/0`; open-data-atl catalog `dpcd-0a5785b3466a46c7a256f7fa9d628afd-0`) | The street address of 813 buildings in the `beltline-eastside` level (issue #88). Only `STATUS='Current'` points; only the address fields. | City of Atlanta open data, provided as is; no license stated | The `ref` of each address in `data/buildings/beltline-eastside.json` | `scripts/city-addresses.mjs` writes `levels/beltline-eastside/raw/city-addresses.json`. `scripts/building-sources.mjs` reads it. |
| City of Atlanta, Department of City Planning GIS, "Street centerlines" (`https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/FeatureServer/33`; open-data-atl catalog `atl-street-centerlines`) | The street names on the signs of the `beltline-eastside` level (issue #78). Only the `LABEL` field and the line. 199 segments in the bbox, fetched 2026-11-03. | Public City of Atlanta GIS service; no license stated | "Street names: City of Atlanta Department of City Planning" in the level attribution | `scripts/city-streets.mjs` writes `levels/beltline-eastside/raw/city-streets.json` (with `fetchedAt`). `scripts/build-block.mjs` reads it and writes `signName` and `nameSource` on each street strip (`scripts/street-names.mjs`). |
| City of Atlanta, Department of City Planning GIS, "Urban Tree Canopy 2018 Raster Image" (produced by Georgia Tech with the Department of City Planning), tile service `https://tiles.arcgis.com/tiles/5RxyIIJ9boPdptdo/arcgis/rest/services/Urban_Tree_Canopy_2018_WTL1/MapServer`; open-data-atl catalog `dpcd-9215c7539c5d4d13bdaf4d4627b020e5-4` | The position and the crown size of 3772 canopy trees in the `beltline-eastside` level (issue #137). Zoom 16 tiles (about 2 m per pixel on the ground), cut to a 2 m grid. The raster has no species. Fetched 2026-11-03. | Public City of Atlanta GIS service; no license is stated ("Cite City of Atlanta - Department of City Planning GIS", from the catalog) | "Tree canopy: City of Atlanta Department of City Planning (Urban Tree Canopy 2018)" in the level attribution (`canopy.json` `attribution`, added by `src/level/levels.js`) | `scripts/city-canopy.py` keeps the 15 tiles in `levels/beltline-eastside/raw/canopy-tiles/` and writes `levels/beltline-eastside/canopy.json` (with `fetchedAt`). `src/level/geo/tree-placement.js` reads the grid. |
| USGS 3D Elevation Program (3DEP), bare-earth DEM, from the 3DEPElevation ImageServer (`https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer`) | The ground elevation of the `beltline-eastside` level: an 8 m grid of the 2 m DEM (each node is the mean of the pixels within 4 m). | Public domain (U.S. Government work) | "Elevation: USGS 3DEP" in the level attribution (credit is not required, but given) | `scripts/terrain-dem.py` writes `levels/beltline-eastside/raw/terrain.json`. `scripts/build-block.mjs` raises the bridge embankments and copies the grid into `level.json`. |

### OpenStreetMap: what the ODbL asks of us

1. Attribution. The game shows "Map data (c) OpenStreetMap contributors, ODbL 1.0" at the top right of the screen on every level that comes from OSM (`#attribution` in `index.html`). The level file carries the same text in its `attribution` field.
2. Share-alike. `level.json` is a derived database of OSM. It is under the ODbL too. The repository keeps the raw fetch and `scripts/build-block.mjs`, so anyone can make the derived database again.
3. The rendered game is a "produced work". It needs the attribution only. It does not have to be under the ODbL.

### The `beltline-eastside` fetch

- Bbox (south, west, north, east): `33.7560,-84.3685,33.7735,-84.3580`. It runs from north of Ponce City Market to south of Krog Street Market, and wide enough east to hold the bend of the trail around Historic Fourth Ward Park.
- Fetched 2026-11-01. The OSM base time is in `raw/fetch.json`.
- 1045 buildings. Only 6 have a `height` tag and 15 have a `building:levels` tag. The other 1024 get a height from their `building` type (see `docs/decisions.md`).

## Datasets looked at and not used yet

| Dataset | License | Why not now |
|---|---|---|
| City of Atlanta open data, building footprints | Check the license on the dataset page before use | The issue asks for a cross-check "when available". This task did not do the cross-check. |
| OpenStreetMap `natural=tree` and `natural=tree_row` (Overpass) | ODbL 1.0 | Issue #137. On 2026-11-03 the `beltline-eastside` box had 0 of each (the city box had 2200 trees and 6 tree rows). There is nothing to place yet. A later fetch can add them. |
| A City of Atlanta street tree inventory with species | — | Issue #137. The open-data-atl catalog (367 datasets on 2026-11-03) has no tree point list; the canopy raster is the only tree dataset. Thus the species are set by placement rules, not by data. |

## Art made for this project (not datasets)

| Asset | Source | License |
|---|---|---|
| Street kit (`assets/kit/street-kit.glb`) | Built from Blender primitives by `scripts/blender/street_kit.py`. See `assets/kit/provenance.json`. | Original work for this project |
| Mural designs | Drawn in code from a fixed seed (`src/render/murals.js`) | Original work for this project |
| Landmark scan textures (`assets/landmarks/textures/`) | Poly Haven `red_brick` (Rob Tuytel), `beige_wall_001` and `corrugated_iron` (Dimitrios Savva, Rico Cilliers, Jenelle van Heerden), resized and tinted by `scripts/landmark-textures.py`. See `assets/landmarks/textures/provenance.json`. | CC0 1.0 |
| Ground scan textures (`assets/ground/`) | Poly Haven `asphalt_track`, `brushed_concrete_03`, `concrete_floor_03`, and `leafy_grass`, with the AO map multiplied in, by `scripts/ground-textures.py`. See `assets/ground/provenance.json`. | CC0 1.0 |

## Reference photos (not in the game)

These photos are visual references for landmark models. No pixels of them are in the game.

| Photo | Author | License | Used for |
|---|---|---|---|
| [Ponce City Market from Historic Fourth Ward Park](https://commons.wikimedia.org/wiki/File:Ponce_City_Market_from_Historic_Fourth_Ward_Park.jpg) | Tyler Lahti | CC BY-SA 2.0 | The tower top of `assets/landmarks/ponce-city-market-tower.json`. A 1280 px copy and small crops are in `landmarks/ponce-city-market/ref/` and `crops/`, under the same license. |
| [Krog Street Market](https://commons.wikimedia.org/wiki/File:Krog_Street_Market.jpg) | LittleT889 | CC BY-SA 4.0 | The entrance front of `assets/landmarks/krog-street-market-front.json`. A 1280 px copy and small crops are in `landmarks/krog-street-market/ref/` and `crops/`, under the same license. |

## Code libraries (not datasets)

These are not datasets. They are here so that the license list is in one place.

| Library | Version | License | Used for |
|---|---|---|---|
| earcut | 3.2.4 | ISC | Roof and park polygon triangulation (`src/level/geo/extrude.js`) |
| img2threejs (skill, not a dependency) | v2.0.0, commit a669e9a, with the local patch `tools/img2threejs-footprint-color.patch` | Apache-2.0 | Landmark reconstruction in `landmarks/` |
