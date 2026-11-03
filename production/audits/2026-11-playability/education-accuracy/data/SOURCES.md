# Data sources for the education accuracy audit

The audit scripts fetched these files on 2026-11-03. The files are evidence for `../FINDINGS.md` only. The game does not read them. The datasets that the game uses are in `docs/sources.md`.

| File | Source | License | Attribution |
|---|---|---|---|
| `osm-live-ways.json`, `overpass-landmarks.json` | OpenStreetMap, through the Overpass API (`https://overpass-api.de/api/interpreter`) | Open Database License (ODbL) 1.0, https://opendatacommons.org/licenses/odbl/1-0/ | "Map data (c) OpenStreetMap contributors", https://www.openstreetmap.org/copyright |
| `nominatim.json` | OpenStreetMap Nominatim search (`https://nominatim.openstreetmap.org/search`) | ODbL 1.0 | "Map data (c) OpenStreetMap contributors" |
| `tiger-roads.json` | US Census Bureau TIGERweb, Transportation MapServer, layers 2, 6, and 8 | Public domain (U.S. Government work) | "Roads: US Census Bureau TIGER" (credit is not required, but given) |
| `city-open-data.json` | Atlanta BeltLine, Inc. GIS, `ABI_Trails_public` FeatureServer (`https://gis.beltline.org/server/rest/services/ABI_Trails_public/FeatureServer/0`), and the other city layers named in the file | Public GIS data. Check the terms on each service page before the game uses a layer. | "Trail data: Atlanta BeltLine, Inc." |
| `streets.json`, `city-checks.json`, `ingame.json` | Derived by the audit scripts in `../scripts/` from the files above and from `levels/beltline-eastside/level.json` | Same as the source data. The OSM part is under the ODbL. | As above |

The scripts in `../scripts/` import modules from `src/`. A later change to `src/` can break them.
