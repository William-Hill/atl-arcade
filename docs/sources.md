# Data sources

Every dataset that the game uses is listed here, with its license and the attribution that the license requires. Add a row before a new dataset goes into a level.

## Datasets in use

| Dataset | Used for | License | Attribution | Where |
|---|---|---|---|---|
| OpenStreetMap, through the Overpass API (`https://overpass-api.de/api/interpreter`) | Building footprints and the height and level tags, street center lines, sidewalks, paths, the Atlanta BeltLine Eastside Trail, and parks in the `beltline-eastside` level | Open Database License (ODbL) 1.0, https://opendatacommons.org/licenses/odbl/1-0/ | "Map data (c) OpenStreetMap contributors", with a link to https://www.openstreetmap.org/copyright | Raw fetch: `levels/beltline-eastside/raw/overpass.json` and `raw/fetch.json` (query, endpoint, time, OSM base time). Derived level: `levels/beltline-eastside/level.json`. |

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
| Overture Maps buildings (`theme=buildings`) | ODbL 1.0 for the OSM part, CDLA Permissive 2.0 for other parts | Overture has many more building heights than OSM. A fetch needs GeoParquet from cloud storage (DuckDB or the `overturemaps` CLI), and neither is on this machine. A follow-up can add it as a second source for heights. |
| City of Atlanta open data, building footprints | Check the license on the dataset page before use | The issue asks for a cross-check "when available". This task did not do the cross-check. |

## Art made for this project (not datasets)

| Asset | Source | License |
|---|---|---|
| Street kit (`assets/kit/street-kit.glb`) | Built from Blender primitives by `scripts/blender/street_kit.py`. See `assets/kit/provenance.json`. | Original work for this project |
| Mural designs | Drawn in code from a fixed seed (`src/render/murals.js`) | Original work for this project |

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
