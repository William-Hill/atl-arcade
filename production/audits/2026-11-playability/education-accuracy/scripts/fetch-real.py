"""Read-only audit script. It fetches real positions from OSM Nominatim (at
most 1 request per second, with a User-Agent) and from the Overpass API, and
writes the raw answers to ../data/. Run from the repository root:
  python3 production/audits/2026-11-playability/education-accuracy/scripts/fetch-real.py
"""
import json
import time
import urllib.parse
import urllib.request

DATA = "production/audits/2026-11-playability/education-accuracy/data/"
UA = "atl-arcade-audit/1.0 (Skate ATL accuracy audit, issue 65)"

QUERIES = {
    # Free-text name searches.
    "Ponce City Market": "Ponce City Market, Atlanta",
    "Krog Street Market": "Krog Street Market, Atlanta",
    "Historic Fourth Ward Park": "Historic Fourth Ward Park, Atlanta",
    "Freedom Park": "Freedom Park, Atlanta",
    "Atlanta Art Park": "Atlanta Art Park, Atlanta",
    "Parque en el centro bonito": "Parque en el centro bonito, Atlanta",
    # Official street addresses (from the operators' own sites).
    "addr:675 Ponce de Leon Ave NE": "675 Ponce de Leon Avenue NE, Atlanta, GA 30308",
    "addr:99 Krog St NE": "99 Krog Street NE, Atlanta, GA 30307",
    "addr:680 Dallas St NE (H4W Park)": "680 Dallas Street NE, Atlanta, GA 30308",
    "addr:725 Ponce de Leon Ave NE": "725 Ponce de Leon Avenue NE, Atlanta, GA 30306",
}


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def nominatim():
    out = {}
    for key, q in QUERIES.items():
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 3, "addressdetails": 1, "viewbox": "-84.3685,33.7735,-84.3580,33.7560", "bounded": 0})
        out[key] = {"query": q, "url": url, "results": get(url)}
        time.sleep(1.1)
    return out


OVERPASS = """[out:json][timeout:90];
(
  nwr["building:part"](33.7715,-84.3670,33.7735,-84.3640);
  nwr["man_made"="tower"](33.7715,-84.3670,33.7735,-84.3640);
  nwr["tourism"="artwork"](33.756,-84.3685,33.7735,-84.358);
  nwr["name"="Ponce City Market"];
  nwr["name"="Krog Street Market"](33.75,-84.37,33.77,-84.35);
  way["name"~"Lake Avenue|Parque|Beltline Access|Stone Mountain Trail"](33.756,-84.3685,33.7735,-84.358);
  nwr["leisure"="park"]["name"~"Parque"](33.756,-84.3685,33.7735,-84.358);
);
out tags center;
"""


MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def overpass(query=OVERPASS):
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in MIRRORS:
        try:
            return {"query": query, "endpoint": url, "result": get(url, data)}
        except Exception as e:  # noqa: BLE001 - try the next mirror
            last = e
            time.sleep(2)
    raise last


if __name__ == "__main__":
    import os, sys
    if os.path.exists(DATA + "nominatim.json") and "--refresh" not in sys.argv:
        n = json.load(open(DATA + "nominatim.json"))
    else:
        n = nominatim()
    json.dump(n, open(DATA + "nominatim.json", "w"), indent=1)
    print("nominatim", {k: (v["results"][0]["lat"], v["results"][0]["lon"], v["results"][0]["display_name"][:60]) if v["results"] else None for k, v in n.items()})
    o = overpass()
    json.dump(o, open(DATA + "overpass-landmarks.json", "w"), indent=1)
    print("overpass elements", len(o["result"]["elements"]))
