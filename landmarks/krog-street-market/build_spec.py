# Writes the Krog Street Market component tree, review targets, detail
# inventory, and lighting into object-sculpt-spec.json (img2threejs spec).
# Run from this folder: python3 build_spec.py
#
# Scope: the entrance front above and on the brick box: the sawtooth metal
# roof profile, the black steel canopy, the letter cards, the posts, and the
# pendant lights. The brick box and its facade come from the game (the OSM
# footprint and the facade shader). Units are meters; y is up from the
# ground; the front face is z = 0 and the front faces +z; x = 0 is the
# middle of the photographed front.

import copy
import json

s = json.load(open("object-sculpt-spec.json"))
by_id = {c["id"]: c for c in s["componentTree"]}
tpl = copy.deepcopy(by_id.get("tower-shaft") or s["componentTree"][0])
# Materials (flat game colors, de-lit by eye from the day photo).
base_mat = copy.deepcopy(next(m for m in s["materials"]))
want = {
    "metal": ("Corrugated metal", "#B9BEC3", 0.45, 0.8),
    "steel": ("Black painted steel", "#1E2023", 0.5, 0.4),
    "letters-white": ("White letters", "#F4F4F2", 0.5, 0.0),
    "brass": ("Brass pendant", "#D8A848", 0.2, 1.0),
}
have = {m["id"] for m in s["materials"]}
for mid, (name, col, rough, metal) in want.items():
    if mid not in have:
        m = copy.deepcopy(base_mat)
        m.update({"id": mid, "name": name, "baseColor": col, "color": col, "roughness": rough, "metalness": metal})
        m["albedo"] = {"dominant": col, "secondary": [col], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the day photo."}
        m["colorVariation"] = {"palette": [col], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}
        s["materials"].append(m)
s["materials"] = [m for m in s["materials"] if m["id"] in want]
mats = {m["id"]: m for m in s["materials"]}
AS = "assembled-solid"


def comp(cid, name, level, role, prim, dims, pos, parent, mat, topo, rat, imp=0.8, conf=0.7, extra=None, rot=(0, 0, 0)):
    c = copy.deepcopy(tpl)
    c.update({
        "id": cid, "name": name, "level": level, "role": role, "importance": imp, "confidence": conf,
        "primitive": prim, "topologyClass": topo, "topologyRationale": rat, "parent": parent,
        "materialId": mat, "material": mat, "materialLayers": [mat], "localFeatures": [],
    })
    c["dimensions"] = {"width": dims[0], "height": dims[1], "depth": dims[2], "units": "m", "confidence": conf}
    c["transform"] = {"position": list(pos), "rotation": list(rot), "scale": [1, 1, 1]}
    if parent:
        c["attachment"] = {
            "parentSocket": parent,
            "localStart": [0, pos[1] - dims[1] / 2, 0],
            "localEnd": [0, pos[1] + dims[1] / 2, 0],
            "contactType": "butt",
            "embedDepth": 0.05,
            "gapTolerance": 0.02,
        }
        c["actionProfile"]["animationRole"] = "static"
    else:
        c["attachment"] = None
    c["colorMaterialRecipe"] = {
        "materialId": mat,
        "baseColor": mats[mat]["baseColor"],
        "variation": "none (flat game vertex color)",
        "notes": "Flat toon color; the game bakes it into vertex colors.",
    }
    if extra:
        c.update(extra)
    return c


GD = tpl["geometryDescriptor"]
# The sawtooth roof profile in meters (x, y), from the front crop at about
# 79 px per meter: a low rise to a vertical step, a fall, and a tall rise to
# the right end. It extrudes 50 m back over the footprint.
PROFILE = [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]]
s["componentTree"] = [
    comp("roof-profile", "Sawtooth metal upper wall and roof", "macro", "body", "extrude", [1, 1, 1], [0, 0, -50], None, "metal", AS,
         "A constant cross-section along the depth of the hall: an extruded 2D profile, not boxes.", 1.0, 0.75,
         {"geometryDescriptor": {**GD, "profile2D": {"points": PROFILE, "depth": 50}}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)"}),
    comp("canopy", "Entrance canopy", "macro", "body", "box", [15.75, 0.63, 4.0], [1.05, 5.86, 2.0], None, "steel", AS, "A flat cantilever slab; a box.", 1.0, 0.75),
    comp("canopy-truss", "Canopy steel truss", "meso", "detail", "box", [15.4, 1.0, 3.6], [1.05, 5.05, 1.9], "canopy", "steel", AS,
         "The open steel truss under the canopy deck, read as a dark slab from street level (4.5 to 5.55 m); a box.", 0.8, 0.7),
    comp("post-a", "Canopy post A", "meso", "detail", "box", [0.25, 5.55, 0.25], [-4.5, 2.775, 3.6], "canopy", "steel", AS, "A square steel post; a box.", 0.6),
    comp("post-b", "Canopy post B", "meso", "detail", "box", [0.25, 5.55, 0.25], [8.0, 2.775, 3.6], "canopy", "steel", AS, "A square steel post; a box.", 0.6),
    comp("krog-street-letters", "KROG STREET letters", "meso", "detail", "plane-card", [9.8, 2.1, 0.02], [0.1, 7.36, 2.6], "canopy", "steel", "surface-relief",
         "Black block letters standing on the canopy, read as a flat card with a transparent canvas texture.", 1.0, 0.85),
    comp("market-letters", "MARKET letters", "meso", "detail", "plane-card", [5.3, 0.76, 0.02], [5.1, 5.86, 4.02], "canopy", "letters-white", "surface-relief",
         "White letters on the canopy fascia; a flat card with a canvas texture.", 0.9, 0.85),
]
for i, (x, z) in enumerate([(-2.2, 3.0), (-1.5, 1.6), (2.4, 3.0), (2.6, 1.6), (7.4, 3.0)]):
    s["componentTree"].append(comp(f"pendant-{i}", f"Pendant light {i}", "micro", "detail", "cylinder", [0.5, 0.4, 0.5], [x, 4.3, z], "canopy", "brass", AS,
                                   "A small round brass shade; a cylinder.", 0.6, 0.6))
s["repetitionSystems"] = []
s["featureReviewTargets"] = [
    {"id": "sawtooth-roof", "name": "Silver metal sawtooth: a low rise, a vertical step, a fall, and a tall rise to the right", "tier": "critical", "threshold": 0.7, "components": ["roof-profile"]},
    {"id": "krog-street-letters", "name": "KROG STREET in tall black block letters on top of the canopy", "tier": "critical", "threshold": 0.7, "components": ["krog-street-letters", "canopy"]},
    {"id": "market-letters", "name": "MARKET in white letters on the black canopy front", "tier": "important", "threshold": 0.6, "components": ["market-letters"]},
    {"id": "pendant-lights", "name": "Brass pendant lights under the canopy", "tier": "important", "threshold": 0.6, "components": ["pendant-0"]},
]
di = s["preSpecAssessment"]["detailInventory"]
base = copy.deepcopy(di["details"][0] if di["details"] else json.load(open("di.json"))["detailInventory"]["details"][0])


def det(did, kind, desc, ref, conf=0.75):
    d = copy.deepcopy(base)
    d.update({"id": did, "kind": kind, "description": desc, "mapsTo": {"type": "component", "ref": ref}, "confidence": conf})
    return d


di["details"] = [
    det("sawtooth-step", "contour", "The vertical step in the metal roof at about x = -8.6 m", "roof-profile", 0.8),
    det("tall-right-end", "contour", "The tall right end of the metal roof at about 10.2 m", "roof-profile", 0.8),
    det("krog-street", "linework", "KROG STREET block letters on the canopy top", "krog-street-letters", 0.9),
    det("market", "linework", "MARKET white letters on the canopy fascia", "market-letters", 0.85),
    det("pendants", "fastener", "5 brass pendant lights under the canopy", "pendant-0", 0.7),
    det("truss", "seam", "The dark steel truss under the canopy deck", "canopy-truss", 0.7),
    det("brass-gloss", "gloss", "Brass shades read as metallic", "pendant-0", 0.6),
]
s["preSpecAssessment"]["complexity"]["estimatedCounts"]["microFeatureGroups"] = 3
s["lightingFromPhoto"] = [
    {"role": "key", "type": "directional", "color": "#FFE7C4", "intensity": 1.5, "direction": [0.5, 0.8, 0.3], "notes": "The game sun"},
    {"role": "fill", "type": "hemisphere", "skyColor": "#CFE8FF", "groundColor": "#5A6A48", "intensity": 0.7},
]
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("components", len(s["componentTree"]))

# ---- strict-quality fields -------------------------------------------------
s = json.load(open("object-sculpt-spec.json"))
CLASS = {"metal": "metal", "steel": "metal", "letters-white": "plastic", "brass": "metal"}


def rgba(hexcol, a=1.0):
    h = hexcol.lstrip("#")
    return f"rgba({int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)}, {a})"


def shade(hexcol, k):
    h = hexcol.lstrip("#")
    return "#" + "".join(f"{max(0, min(255, int(int(h[i:i + 2], 16) * k))):02x}" for i in (0, 2, 4))


mats = {m["id"]: m for m in s["materials"]}
for c in s["componentTree"]:
    m = mats[c["materialId"]]
    c["colorMaterialRecipe"] = {
        "materialId": m["id"],
        "dominantAlbedo": rgba(m["baseColor"]),
        "secondaryAlbedo": rgba(shade(m["baseColor"], 0.85)),
        "materialClass": CLASS[m["id"]],
        "materialClassConfidence": 0.8,
        "notes": "Flat toon color; the game bakes it into vertex colors.",
    }
for m in s["materials"]:
    r = m.get("roughness")
    base = r if isinstance(r, (int, float)) else (r or {}).get("base", 0.7)
    ev = f"material-evidence/{m['id']}/{m['id']}_roughness.png"
    m["roughness"] = {"base": base, "map": ev, "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}
    if not m.get("ambientOcclusion"):
        m["ambientOcclusion"] = {"map": f"material-evidence/{m['id']}/{m['id']}_ao.png", "intensity": 0.5}
mats["metal"]["localOverrides"] = [{"id": "corrugation", "type": "normal-ribs", "region": "the whole metal wall", "amount": 0.2, "notes": "Fine vertical ribs; not modeled in the game (flat toon color)."}]
s["lightingFromPhoto"] = [
    {"role": "key", "type": "directional", "color": "#FFE7C4", "intensity": 1.5, "direction": [0.5, 0.8, 0.3], "notes": "The game sun"},
    {"role": "fill", "type": "hemisphere", "skyColor": "#CFE8FF", "groundColor": "#5A6A48", "intensity": 0.7},
    {"role": "environment", "type": "none", "notes": "The photo is at dusk; the game shows the landmark by day, so the lighting follows the game."},
]
pa = s["preSpecAssessment"]
resolved = [
    "Hidden roof and facades: the roof profile extrudes 50 m back; the game draws the facades from the OSM footprint.",
    "Entrance side: placed by the game on the east face, to the parking drive (approximate).",
    "Heights: OSM gives 6 m for the whole footprint; the metal profile starts at 5.5 m and overlaps the box top.",
]
pa["unknownsToResolveBeforeImplementation"] = []
s["assumptions"] = [a for a in (s.get("assumptions") or []) if isinstance(a, str)] + [f"Resolved unknown: {r}" for r in resolved]
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("strict fields written")

# ---- micro feature groups and lighting intent -----------------------------
s = json.load(open("object-sculpt-spec.json"))
feats = {"roof-profile": ["sawtooth-step", "corrugation"], "canopy": ["soffit-truss"]}
for c in s["componentTree"]:
    if c["id"] in feats:
        c["localFeatures"] = sorted(set((c.get("localFeatures") or []) + feats[c["id"]]))
s["lightingFromPhoto"].append({
    "role": "exposure",
    "type": "tone-mapping",
    "notes": "Exposure 1.0 and the game's default tone mapping (none, sRGB output). Ground shadow: the game has no shadow map on this level; the roof below gets no contact shadow from the tower (accepted for the frame rate gate).",
})
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("micro features and lighting intent written")

# ---- parent-relative transforms; dimensions drive the size -----------------
# The generator reads transform.position relative to the parent node, and a
# transform.scale key overrides the dimensions. The positions above are world
# positions (y up from the roof), so convert them here.
s = json.load(open("object-sculpt-spec.json"))
world = {}
for c in s["componentTree"]:
    t = c["transform"]
    wp = t.get("worldPosition") or t["position"]
    t["worldPosition"] = list(wp)
    world[c["id"]] = wp
for c in s["componentTree"]:
    t = c["transform"]
    wp = t["worldPosition"]
    pw = world.get(c["parent"]) if c.get("parent") else [0, 0, 0]
    t["position"] = [round(wp[i] - pw[i], 4) for i in range(3)]
    t.pop("scale", None)
    # A cylinder or cone runs from attachment.localStart to localEnd in the
    # parent's frame, and its radius comes from dimensions.radius.
    if c["primitive"] in ("cylinder", "cone"):
        dims = c["dimensions"]
        dims["radius"] = round(dims["width"] / 2, 4)
        if c["id"] == "hip-roof":
            # 4 radial segments: the vertex radius that gives a square of side `width`.
            dims["radius"] = round(dims["width"] / 2 * 2 ** 0.5, 4)
        h = dims["height"]
        if c.get("discAxis") and c.get("attachment"):
            ax = c["discAxis"]
            p0 = t["position"]
            c["attachment"]["baseRadius"] = dims["radius"]
            c["attachment"]["endRadius"] = dims["radius"]
            c["attachment"]["localStart"] = [round(p0[0] - ax[0] * h / 2, 4), p0[1], round(p0[2] - ax[2] * h / 2, 4)]
            c["attachment"]["localEnd"] = [round(p0[0] + ax[0] * h / 2, 4), p0[1], round(p0[2] + ax[2] * h / 2, 4)]
            continue
        if c.get("attachment"):
            # The factory reads the radii from the attachment, not the dimensions.
            c["attachment"]["baseRadius"] = dims["radius"]
            c["attachment"]["endRadius"] = 0.003 if c["primitive"] == "cone" else dims["radius"]
            if c.get("topWidth"):
                # A truncated hip: the top is a square of side topWidth.
                c["attachment"]["endRadius"] = round(c["topWidth"] / 2 * 2 ** 0.5, 4)
            c["attachment"]["localStart"] = [t["position"][0], round(t["position"][1] - h / 2, 4), t["position"][2]]
            c["attachment"]["localEnd"] = [t["position"][0], round(t["position"][1] + h / 2, 4), t["position"][2]]
    elif c.get("attachment"):
        h = c["dimensions"]["height"]
        c["attachment"]["localStart"] = [t["position"][0], round(t["position"][1] - h / 2, 4), t["position"][2]]
        c["attachment"]["localEnd"] = [t["position"][0], round(t["position"][1] + h / 2, 4), t["position"][2]]
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("transforms are parent-relative")

# ---- material pass: the letter cards --------------------------------------
s = json.load(open("object-sculpt-spec.json"))
for c in s["componentTree"]:
    if c["id"] == "krog-street-letters":
        c["canvasText"] = {"text": "KROG STREET", "color": "#1E2023", "background": "transparent", "drawnBy": "src/render/landmark-signs.js createSignTexture"}
    if c["id"] == "market-letters":
        c["canvasText"] = {"text": "MARKET", "color": "#F4F4F2", "background": "#1E2023", "drawnBy": "src/render/landmark-signs.js createSignTexture"}
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("letter cards recorded")

# ---- game budget --------------------------------------------------------------
s = json.load(open("object-sculpt-spec.json"))
s["performanceBudget"] = {"qualityPriority": "runtime-budget", "targetTriangles": 3000, "maxDrawCalls": 6, "textureSize": 1024, "fpsTarget": 60,
                          "optimizationPolicy": "A game landmark on a 2 km level with a 55 FPS gate in headless SwiftShader: few triangles, flat colors, baked into one mesh."}
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("budget written")
