# Overture building fields in the BeltLine Eastside level (#409)

Date: 2026-11-28. Issue: #409. Level bbox (WGS84): south 33.756, west -84.3685, north 33.7735, east -84.358.

## Result

No new Overture field passes the 10% rule with new data. `class` and `subtype` have high coverage, but they repeat the OpenStreetMap `building` tag that `scripts/build-block.mjs` already carries onto each building as `type`. The roof and facade fields are almost empty. Owner choice (2026-11-28): do not read more fields; #409 closes with this document.

## Coverage table

Overture release **2026-10-21.0** (the release in `scripts/overture-heights.py`). The bbox has 1,077 Overture buildings: 1,014 from OpenStreetMap and 63 from Microsoft ML Buildings. This is the same row count as `levels/beltline-eastside/raw/overture.json`.

| Field | Buildings with a value | Coverage | Most common values |
|---|---:|---:|---|
| `class` | 822 | 76.3% | house 649, detached 61, apartments 41, residential 15, retail 14, office 9 |
| `subtype` | 828 | 76.9% | residential 775, commercial 35, transportation 7, outbuilding 5, industrial 4, religious 2 |
| `roof_shape` | 2 | 0.2% | flat 1, gabled 1 |
| `roof_color` | 0 | 0.0% | none |
| `roof_material` | 1 | 0.1% | grass 1 |
| `facade_color` | 0 | 0.0% | none |
| `facade_material` | 0 | 0.0% | none |
| `height` (for reference) | 994 | 92.3% | already read |
| `num_floors` (for reference) | 19 | 1.8% | already read |

The current release, **2026-11-18.0**, gives the same counts for the seven fields. It has 1,089 buildings (12 more from Microsoft ML Buildings, with a height but no value for the seven fields), so the percentages are 0.8 to 0.9 points lower: `class` 75.5%, `subtype` 76.0%.

## Why `class` and `subtype` add no new data

- Overture copies `class` from the OSM `building` tag. For the 1,014 OSM rows, `class` is the same as the `building` tag in `raw/overpass.json` on 1,013 rows (`building=yes` gives no `class`). The one difference is a `building=yes` way with `class` parking.
- `build-block.mjs` already writes `type = tags.building` for each building that is not `building=yes`. `chooseStyle()` in `src/level/geo/styles.js` already reads `b.type`.
- `subtype` is a group of `class` values (house, detached, apartments to residential). It adds data only on 6 `building=yes` buildings: 4 commercial and 2 religious.
- The 63 Microsoft ML rows have no value for any of the seven fields.
- Total new data: 7 of 1,077 buildings (0.6%).

## Method

The same filter as `scripts/overture-heights.py`: all rows of `theme=buildings/type=building` with `bbox.xmin > west`, `bbox.xmax < east`, `bbox.ymin > south`, `bbox.ymax < north`, from the public bucket `s3://overturemaps-us-west-2/release/<release>/`. The OSM match uses `sources[1].record_id` (`w123@4` gives `w123`).

The cloud session network blocks `extensions.duckdb.org`, so DuckDB cannot load `httpfs`. The count used pyarrow 21.0.0 (`pyarrow.fs.S3FileSystem(anonymous=True)`) with the same bbox filter. It reads only the row groups whose `bbox` statistics touch the box (about 20 s). The row count (1,077) is the same as the DuckDB run in `raw/overture.json`.

## When to count again

Count again when Overture adds roof or facade data for Atlanta, or for a new level with more OSM roof and facade tags. Use the same table.

Data: Overture Maps Foundation, buildings theme, ODbL 1.0 (it contains OpenStreetMap data). See `docs/sources.md`.
