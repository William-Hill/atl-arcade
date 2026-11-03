"""Read-only audit script. It fetches US Census TIGER road center lines for
the beltline-eastside bbox from TIGERweb (an independent source, not OSM),
and the live OSM geometry of the level's trail and sample streets from the
Overpass API. Run from the repository root:
  python3 production/audits/2026-11-playability/education-accuracy/scripts/fetch-tiger.py
"""
import json
import time
import urllib.parse
import urllib.request

DATA = "production/audits/2026-11-playability/education-accuracy/data/"
UA = "atl-arcade-audit/1.0 (Skate ATL accuracy audit, issue 65)"
BBOX = (-84.3685, 33.7560, -84.3580, 33.7735)  # west, south, east, north
BASE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/{}/query"


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def tiger():
    feats = []
    for layer in (2, 6, 8):
        params = {
            "where": "1=1",
            "geometry": ",".join(map(str, BBOX)),
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "NAME,MTFCC,OID",
            "outSR": 4326,
            "returnGeometry": "true",
            "f": "json",
        }
        d = get(BASE.format(layer) + "?" + urllib.parse.urlencode(params))
        for f in d.get("features", []):
            feats.append({"layer": layer, "name": f["attributes"].get("NAME"), "mtfcc": f["attributes"].get("MTFCC"), "paths": f["geometry"]["paths"]})
        time.sleep(1)
    return feats


def live_osm(ids):
    q = "[out:json][timeout:90];way(id:%s);out tags geom;" % ",".join(map(str, ids))
    data = urllib.parse.urlencode({"data": q}).encode()
    for url in ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"):
        try:
            return {"endpoint": url, "query": q, "result": get(url, data)}
        except Exception:  # noqa: BLE001 - try the next mirror
            time.sleep(2)
    raise RuntimeError("overpass failed")


if __name__ == "__main__":
    import sys
    t = tiger()
    json.dump({"source": "US Census TIGERweb Transportation MapServer layers 2, 6, 8", "bbox": BBOX, "features": t}, open(DATA + "tiger-roads.json", "w"))
    print("tiger features", len(t), "names", len({f["name"] for f in t}))
    ids = [int(x) for a in sys.argv[1:] for x in a.split()]
    if ids:
        o = live_osm(ids)
        json.dump(o, open(DATA + "osm-live-ways.json", "w"))
        print("live osm ways", len(o["result"]["elements"]))
