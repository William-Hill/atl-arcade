"""Fetch building heights from Overture Maps for a level box.

  python3 scripts/overture-heights.py levels/beltline-eastside/

It reads the box from <level>/raw/fetch.json and writes
<level>/raw/overture.json: for each OpenStreetMap way or relation id, the
Overture height (m) and floor count. scripts/build-block.mjs reads that file
when an OSM building has no height tag and no levels tag.

The script needs duckdb (pip install duckdb). It reads only the row groups
in the box from the public Overture bucket, so it takes about 20 s.

Data: Overture Maps Foundation, buildings theme, ODbL 1.0 (it contains
OpenStreetMap data). See docs/sources.md.
"""

import json
import pathlib
import sys

import duckdb

RELEASE = "2026-10-21.0"
OSM_KIND = {"w": "w", "r": "r"}


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/overture-heights.py levels/<name>/")
    level = pathlib.Path(sys.argv[1])
    box = json.loads((level / "raw" / "fetch.json").read_text())["bbox"]
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    rows = con.execute(
        f"""
        SELECT height, num_floors, sources[1].dataset AS dataset, sources[1].record_id AS record
        FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
        WHERE bbox.xmin > ? AND bbox.xmax < ? AND bbox.ymin > ? AND bbox.ymax < ?
        """,
        [box["west"], box["east"], box["south"], box["north"]],
    ).fetchall()
    heights = {}
    other = 0
    for height, floors, dataset, record in rows:
        # An OSM record id is "w123@4" (way 123, version 4) or "r123@4".
        if dataset != "OpenStreetMap" or not record or record[0] not in OSM_KIND:
            other += 1
            continue
        if height is None and floors is None:
            continue
        osm_id = record.split("@")[0]
        heights[osm_id] = {
            "height": round(height, 2) if height is not None else None,
            "floors": floors,
        }
    out = {
        "source": "Overture Maps Foundation, buildings theme",
        "release": RELEASE,
        "license": "ODbL 1.0",
        "bbox": box,
        "rows": len(rows),
        "nonOsmRows": other,
        "heights": dict(sorted(heights.items())),
    }
    (level / "raw" / "overture.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"{len(rows)} rows, {len(heights)} OSM buildings with a height, {other} rows from other sources")


if __name__ == "__main__":
    main()
