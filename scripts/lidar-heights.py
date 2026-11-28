"""Measure a LiDAR height for each building of a level (spike).

  python3 -I scripts/lidar-heights.py levels/beltline-eastside/

It reads the LAZ nodes of scripts/lidar-fetch.py and the buildings of
<level>/level.json, and writes <level>/raw/lidar-heights.json: for each
building id, the roof heights over the ground and the point counts.

For each footprint:
1. The roof points are the class 6 (building) points with one return
   (a solid surface) inside the footprint, shrunk by INSET m. A point with
   more than one return is most often a tree over the roof, which the
   classifier marked as building.
2. The ground is the median z of the class 2 (ground) points in a ring
   from RING[0] to RING[1] m outside the footprint.
3. The heights are percentiles of (roof z - ground): p50 (the main roof),
   p90 (the value the level uses), and p99 (the top: towers, stair cores).

A building with fewer than MIN_POINTS roof points gets no height.

Data: USGS 3DEP, Georgia statewide 2018 LiDAR, public domain. The flights
are from 2018, so a building from after 2018 has no roof points, or the
points of the building that stood there before.

It reads the footprints of the committed level.json. The heights do not
change a footprint, so the output stays the same after a rebuild.
scripts/building-sources.mjs and scripts/build-block.mjs read the output
(the order of the height sources is in build-block.mjs buildingHeight()).

Needs (tested versions): numpy 2.5.5, shapely 2.2.0, pyproj 3.8.0,
laspy 2.7.0, lazrs 0.8.2.
"""

import glob
import json
import math
import pathlib
import sys

import laspy
import numpy as np
import shapely
from pyproj import Transformer

INSET = 0.75
RING = (1.5, 8.0)
MIN_POINTS = 12
EARTH_RADIUS = 6371008.8


def check_fetch(level):
    """Stops when the download of scripts/lidar-fetch.py is not complete.

    lidar-fetch.py writes raw/lidar-fetch.json only after all downloads
    succeed, with "bytes" for each set it downloaded (a --count run has no
    "bytes"). Each set must have one .laz file for each node.
    """
    report_file = level / "raw" / "lidar-fetch.json"
    if not report_file.exists():
        sys.exit(f"lidar-heights: no {report_file}; run scripts/lidar-fetch.py first")
    report = json.loads(report_file.read_text())
    for name, s in report["sets"].items():
        if s["nodes"] == 0:
            continue
        files = len(glob.glob(str(level / "raw" / "lidar" / name / "*.laz")))
        if "bytes" not in s or files != s["nodes"]:
            sys.exit(f"lidar-heights: {name} has {files} .laz files for {s['nodes']} nodes; run scripts/lidar-fetch.py again")


def load_points(level):
    xs, ys, zs, cs = [], [], [], []
    # Class 6 with more than one return becomes class 106 (left out).
    for f in sorted(glob.glob(str(level / "raw" / "lidar" / "*" / "*.laz"))):
        las = laspy.read(f)
        c = np.asarray(las.classification).astype(np.int16)
        c[(c == 6) & (np.asarray(las.number_of_returns) > 1)] = 106
        keep = (c == 2) | (c == 6)
        xs.append(np.asarray(las.x)[keep])
        ys.append(np.asarray(las.y)[keep])
        zs.append(np.asarray(las.z)[keep])
        cs.append(c[keep])
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(zs), np.concatenate(cs)


def to_local(x3857, y3857, origin):
    """EPSG:3857 to the level frame (+x east, +z south), as in projection.js."""
    lon, lat = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform(x3857, y3857)
    deg = math.pi / 180
    m_lat = EARTH_RADIUS * deg
    m_lon = m_lat * math.cos(origin["lat"] * deg)
    return (lon - origin["lon"]) * m_lon, -(lat - origin["lat"]) * m_lat


class Grid:
    """Points binned by a CELL m grid, for fast box queries."""

    CELL = 10.0

    def __init__(self, x, z):
        self.x, self.z = x, z
        ix = np.floor(x / self.CELL).astype(np.int64)
        iz = np.floor(z / self.CELL).astype(np.int64)
        key = ix * 1_000_003 + iz
        order = np.argsort(key, kind="stable")
        self.order = order
        self.keys, self.starts = np.unique(key[order], return_index=True)
        self.ends = np.append(self.starts[1:], len(order))

    def query(self, minx, minz, maxx, maxz):
        out = []
        for ix in range(math.floor(minx / self.CELL), math.floor(maxx / self.CELL) + 1):
            for iz in range(math.floor(minz / self.CELL), math.floor(maxz / self.CELL) + 1):
                i = np.searchsorted(self.keys, ix * 1_000_003 + iz)
                if i < len(self.keys) and self.keys[i] == ix * 1_000_003 + iz:
                    out.append(self.order[self.starts[i] : self.ends[i]])
        return np.concatenate(out) if out else np.empty(0, dtype=np.int64)


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 -I scripts/lidar-heights.py levels/<name>/")
    level_dir = pathlib.Path(sys.argv[1])
    level = json.loads((level_dir / "level.json").read_text())
    check_fetch(level_dir)
    x, y, z, c = load_points(level_dir)
    lx, lz = to_local(x, y, level["origin"])
    print(f"{len(x)} points (ground and building)", flush=True)
    ground = c == 2
    grid = Grid(lx, lz)
    out = {}
    for b in level["buildings"]:
        poly = shapely.Polygon(b["outer"], b.get("holes") or [])
        if not poly.is_valid:
            poly = poly.buffer(0)
        inner = poly.buffer(-INSET)
        ring = poly.buffer(RING[1]).difference(poly.buffer(RING[0]))
        minx, minz, maxx, maxz = ring.bounds
        idx = grid.query(minx, minz, maxx, maxz)
        if len(idx) == 0:
            continue
        px, pz = lx[idx], lz[idx]
        roof = idx[(~ground[idx]) & shapely.contains_xy(inner, px, pz)] if not inner.is_empty else np.empty(0, dtype=np.int64)
        gnd = idx[ground[idx] & shapely.contains_xy(ring, px, pz)]
        rec = {"roofPoints": int(len(roof)), "groundPoints": int(len(gnd)), "area": round(poly.area, 1)}
        if len(gnd) >= 3:
            g = float(np.median(z[gnd]))
            rec["ground"] = round(g, 2)
            if len(roof) >= MIN_POINTS:
                h = z[roof] - g
                p50, p90, p99 = np.percentile(h, [50, 90, 99])
                rec.update({"p50": round(float(p50), 2), "p90": round(float(p90), 2), "p99": round(float(p99), 2)})
        out[b["id"]] = rec
    measured = sum(1 for r in out.values() if "p90" in r)
    result = {
        "source": "USGS 3DEP, Georgia statewide 2018 LiDAR (GA_Statewide_B2_2018, GA_Statewide_B3_2018), public domain",
        "method": f"single-return class 6 points inside the footprint shrunk {INSET} m; ground = median class 2 z in a {RING[0]} to {RING[1]} m ring; heights are percentiles of roof z - ground; at least {MIN_POINTS} roof points",
        "buildings": len(level["buildings"]),
        "measured": measured,
        "heights": out,
    }
    (level_dir / "raw" / "lidar-heights.json").write_text(json.dumps(result, indent=1) + "\n")
    print(f"measured {measured} of {len(level['buildings'])} buildings")


if __name__ == "__main__":
    main()
