"""Read-only audit script. It queries the City of Atlanta and Atlanta BeltLine
datasets that the open-data-atl catalog lists (src/lib/catalog/seed.json in
https://github.com/William-Hill/open-data-atl) for the beltline-eastside bbox.
These are independent of OpenStreetMap. Run from the repository root:
  python3 production/audits/2026-11-playability/education-accuracy/scripts/fetch-city.py
"""
import json
import time
import urllib.parse
import urllib.request

DATA = "production/audits/2026-11-playability/education-accuracy/data/"
UA = "atl-arcade-audit/1.0 (Skate ATL accuracy audit, issue 65)"
ENV = "-84.3685,33.7560,-84.3580,33.7735"
LAYERS = {
    "beltline-trails": "https://gis.beltline.org/server/rest/services/ABI_Trails_public/FeatureServer/0",
    "beltline-access-points": "https://atlbeltline.interdev.com/arcgis/rest/services/Hosted/ABI_Trails_Access_pt_public/FeatureServer/26",
    "street-centerlines": "https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/FeatureServer/33",
    "parks": "https://services6.arcgis.com/QmEXbya2dRd48yU4/ArcGIS/rest/services/City_of_Atlanta_Parks_2026_View/FeatureServer/0",
    "landmark-buildings": "https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/MapServer/16",
    "historic-districts": "https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/MapServer/15",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


out = {}
for key, base in LAYERS.items():
    params = {"where": "1=1", "geometry": ENV, "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "returnGeometry": "true", "f": "json"}
    url = base + "/query?" + urllib.parse.urlencode(params)
    try:
        d = get(url)
        out[key] = {"url": base, "features": d.get("features", []), "error": d.get("error"), "exceeded": d.get("exceededTransferLimit")}
        print(key, len(d.get("features", [])), d.get("error"))
    except Exception as e:  # noqa: BLE001 - record and go on
        out[key] = {"url": base, "features": [], "error": str(e)}
        print(key, "ERROR", e)
    time.sleep(1)
json.dump(out, open(DATA + "city-open-data.json", "w"))
