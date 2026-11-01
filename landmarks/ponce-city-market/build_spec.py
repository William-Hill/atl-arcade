# Writes the Ponce City Market component tree, review targets, detail
# inventory, and lighting into object-sculpt-spec.json (img2threejs spec).
# Run from this folder: python3 build_spec.py
#
# Scope: the tower top. The building mass, the facade, and the windows come
# from the game (the OSM footprint and the facade shader). The rooftop sign
# is game code too (src/render/landmark-signs.js): it is a flat card on a
# different roof, not part of this object. Units are meters; y is up; y = 0
# is the roof the tower stands on.

import copy
import json

s = json.load(open("object-sculpt-spec.json"))
by_id = {c["id"]: c for c in s["componentTree"]}
tpl = copy.deepcopy(by_id.get("tower-shaft") or s["componentTree"][0])
# Pass-2 colors from the blockout review: muted maroon brick, teal grey-green
# copper, a warmer white for the stone.
for m in s["materials"]:
    new = {"brick": "#7E3B33", "copper-patina": "#6E9C98", "trim": "#DCD6CA"}.get(m["id"])
    if new:
        m["baseColor"] = new
        m["color"] = new
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
s["componentTree"] = [
    comp("tower-shaft", "Tower shaft", "macro", "body", "box", [8, 10, 8], [0, 5, 0], None, "brick", AS, "A square brick shaft: planar faces at hard edges.", 1.0, 0.75),
    comp("lower-band", "Stone band under the belvedere", "meso", "trim", "box", [8.6, 0.6, 8.6], [0, 10.3, 0], "tower-shaft", "trim", AS, "A thin projecting slab; planar faces.", 0.7),
    comp("belvedere", "Brick belvedere", "macro", "body", "box", [8, 5, 8], [0, 13.1, 0], "lower-band", "brick", AS, "Same square plan as the shaft; a box.", 0.9, 0.75, {"localFeatures": ["arched-window-row"]}),
    comp("upper-band", "Stone cornice under the roof", "meso", "trim", "box", [9.2, 0.7, 9.2], [0, 15.95, 0], "belvedere", "trim", AS, "A projecting cornice slab under the eave; planar faces.", 0.8),
    comp("hip-roof", "Hipped copper roof", "macro", "detail", "cone", [9.6, 1.8, 9.6], [0, 17.2, 0], "upper-band", "copper-patina", AS,
         "A low pyramid of 4 planar faces: a cone with 4 radial segments, turned 45 degrees so the edges sit on the diagonals.", 1.0, 0.8,
         {"geometryDescriptor": {**GD, "radialSegments": 4}, "topWidth": 3.6}, rot=(0, 0.7853981634, 0)),
    comp("roof-cap", "Raised flat roof cap", "meso", "trim", "box", [3.4, 0.9, 3.4], [0, 18.55, 0], "upper-band", "copper-patina", AS, "A raised flat-topped square block on the flat top of the hipped roof (parented to the cornice, which is not turned); a box.", 0.7),
    comp("cap-trim", "Cap edge trim", "micro", "trim", "box", [3.6, 0.15, 3.6], [0, 19.0, 0], "roof-cap", "trim", AS, "A thin light edge on the cap; a box.", 0.5),
    comp("finial", "Gold finial and pole", "micro", "detail", "cylinder", [0.3, 1.6, 0.3], [0, 19.85, 0], "roof-cap", "gold", AS, "A round pole about 0.3 m wide (measured from the reference crop: about 2 px against a 55 px tower); a cylinder.", 0.7, 0.7),
    comp("finial-ball", "Gold finial ball", "micro", "detail", "sphere", [0.6, 0.6, 0.6], [0, 20.75, 0], "finial", "gold", "continuous-sculpt", "A small ball on the pole top; a sphere.", 0.6, 0.6),
]

# 12 arched windows, 3 per face. The generator repeats copies only on a circle,
# which does not fit a square tower, so each window is its own set of parts:
# a dark box, a dark disc on top for the round head, and a white surround.
for face, (nx, nz) in {"s": (0, 1), "n": (0, -1), "e": (1, 0), "w": (-1, 0)}.items():
    for i, off in enumerate((-2.4, 0.0, 2.4)):
        x = nx * 4.04 + (off if nz else 0)
        z = nz * 4.04 + (off if nx else 0)
        w, d = (1.0, 0.16) if nz else (0.16, 1.0)
        s["componentTree"].append(comp(f"arch-{face}{i}", f"Arched window {face}{i}", "micro", "detail", "box", [w, 2.2, d], [x, 12.9, z], "belvedere", "glass-dark", AS,
                                       "The straight part of a round-headed window recess; a thin dark box.", 0.8, 0.7))
        # The round head: a thin disc whose axis is the face normal.
        hx, hz = x + nx * 0.01, z + nz * 0.01
        head = comp(f"arch-head-{face}{i}", f"Arch head {face}{i}", "micro", "detail", "cylinder", [1.0, 0.16, 1.0], [hx, 14.0, hz], "belvedere", "glass-dark", AS,
                    "The round head of the window: a thin disc on the face normal.", 0.7, 0.7)
        head["discAxis"] = [nx, 0, nz]
        s["componentTree"].append(head)
        sw, sd = (1.6, 0.06) if nz else (0.06, 1.6)
        s["componentTree"].append(comp(f"arch-frame-{face}{i}", f"Window surround {face}{i}", "micro", "trim", "box", [sw, 3.4, sd], [x - nx * 0.04, 13.2, z - nz * 0.04], "belvedere", "trim", AS,
                                       "A flat white surround behind the window; a thin box.", 0.6, 0.6))
s["repetitionSystems"] = []
s["featureReviewTargets"] = [
    {"id": "tower-top-silhouette", "name": "Square brick belvedere under a low hipped roof with a wide eave", "tier": "critical", "threshold": 0.7, "components": ["belvedere", "hip-roof", "upper-band"]},
    {"id": "copper-roof-color", "name": "Blue-green copper roof against red brick and white bands", "tier": "critical", "threshold": 0.7, "components": ["hip-roof", "lower-band", "upper-band"]},
    {"id": "arched-windows", "name": "3 round-headed dark openings per belvedere face in white surrounds", "tier": "important", "threshold": 0.6, "components": ["arch-s0", "arch-head-s0", "arch-frame-s0"]},
    {"id": "finial", "name": "Gold finial above the roof cap", "tier": "important", "threshold": 0.6, "components": ["finial"]},
]

di = s["preSpecAssessment"]["detailInventory"]
base = copy.deepcopy(di["details"][0])


def det(did, kind, desc, ref, conf=0.75):
    d = copy.deepcopy(base)
    d.update({"id": did, "kind": kind, "description": desc, "mapsTo": {"type": "component", "ref": ref}, "confidence": conf})
    return d


di["details"] = [
    det("belvedere-arches", "fastener", "12 arched window openings, 3 per face, set in the brick belvedere", "arch-s1"),
    det("copper-roof", "gloss", "Blue-green patinated copper hipped roof, satin, with a wide eave", "hip-roof", 0.8),
    det("white-bands", "bevel", "2 white stone bands: under the belvedere and under the roof eave", "upper-band", 0.8),
    det("roof-cap", "bevel", "Small square copper cap at the roof apex", "roof-cap", 0.6),
    det("finial", "linework", "Gold finial pole above the cap", "finial", 0.7),
    det("finial-ball", "gloss", "Small gold ball on top of the finial pole", "finial-ball", 0.6),
]
s["preSpecAssessment"]["complexity"]["estimatedCounts"]["microFeatureGroups"] = 3

s["lightingFromPhoto"] = {
    "key": {"type": "directional", "color": "#FFE7C4", "intensity": 1.5, "direction": [0.5, 0.8, 0.3], "notes": "The game sun"},
    "fill": {"type": "hemisphere", "sky": "#CFE8FF", "ground": "#5A6A48", "intensity": 0.7},
    "rim": {"type": "none", "notes": "No rim light in the game"},
    "environment": {"type": "none"},
    "notes": "The photo is at dusk; the game shows the landmark by day, so the lighting follows the game, not the photo.",
}

json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("components", len(s["componentTree"]))

# ---- strict-quality fields -------------------------------------------------
s = json.load(open("object-sculpt-spec.json"))
CLASS = {"brick": "stone", "trim": "stone", "copper-patina": "metal", "steel": "metal", "sign-yellow": "metal", "gold": "metal", "glass-dark": "glass"}


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
mats["brick"]["localOverrides"] = [{"id": "band-joint-ao", "type": "ambient-occlusion", "region": "the brick just under each stone band", "amount": 0.25, "notes": "In the game this is a darker vertex-color row."}]
mats["copper-patina"]["patina"] = {"amount": 0.8, "color": "#5FA391", "notes": "Aged copper: the blue-green patina is the base color."}
s["lightingFromPhoto"] = [
    {"role": "key", "type": "directional", "color": "#FFE7C4", "intensity": 1.5, "direction": [0.5, 0.8, 0.3], "notes": "The game sun"},
    {"role": "fill", "type": "hemisphere", "skyColor": "#CFE8FF", "groundColor": "#5A6A48", "intensity": 0.7},
    {"role": "environment", "type": "none", "notes": "The photo is at dusk; the game shows the landmark by day, so the lighting follows the game."},
]
pa = s["preSpecAssessment"]
resolved = [
    "Hidden north and west facades: out of scope; the game draws the facades from the OSM footprint.",
    "Tower position along the block: placed by the game at about 70 % of the main block length, at the back edge (approximate).",
    "Heights: the main block is 50 m (OSM height tag); this model stands on the roof at y = 0.",
]
pa["unknownsToResolveBeforeImplementation"] = []
s["assumptions"] = [a for a in (s.get("assumptions") or []) if isinstance(a, str)] + [f"Resolved unknown: {r}" for r in resolved]
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("strict fields written")

# ---- micro feature groups and lighting intent -----------------------------
s = json.load(open("object-sculpt-spec.json"))
feats = {"hip-roof": ["wide-eave"], "sign-frame": ["sign-legs"], "tower-shaft": ["band-joint-ao"]}
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

# ---- material pass: the sign letters ---------------------------------------
# The letters are a canvas texture drawn at run time by
# src/render/landmark-signs.js (plain block type, not the logo artwork).
s = json.load(open("object-sculpt-spec.json"))
for m in s["materials"]:
    if m["id"] == "sign-yellow":
        m["canvasText"] = {"text": "PONCE CITY MARKET", "color": "#F2C230", "background": "#2B2E33", "font": "900 block sans-serif", "drawnBy": "src/render/landmark-signs.js createSignTexture"}
json.dump(s, open("object-sculpt-spec.json", "w"), indent=2)
print("sign canvas text recorded")
