# MetaHuman bake-down spike (2026-11-27): makes a browser-size skater GLB from
# a conformed MetaHuman GLB and retargets the Nia (Mixamo) clips onto it.
#
# This is research code for docs/research/2026-11-27-metahuman-nia-spike.md.
# It does not touch the shipped skaters.
#
# What it does:
# 1. Imports the source skater (Mixamo rig + clips) and samples every clip in
#    world space.
# 2. Imports the MetaHuman GLB (body rig + head rig, RigLogic shapes baked as
#    blend shapes, for example Crossroads' duke-assembled-v01.glb).
# 3. Scales the MetaHuman to the source pelvis height.
# 4. Keeps the core deform bones (KEEP), adds the jaw and eye bones from the
#    head rig, and moves the weight of every other joint to its nearest kept
#    ancestor. 4 weights per vertex.
# 5. Builds 52 ARKit-named shape keys on the head from the MetaHuman shapes
#    (ARKIT map below) and deletes the other shapes.
# 6. Decimates the head (with its shape keys, through a Surface Deform
#    transfer), the body, the teeth and the lashes to the target counts.
# 7. Retargets each clip to the MetaHuman skeleton (world-space rotation
#    delta from a rest pose that is aligned to the source rest pose).
# 8. Adds a face track (all 52 shapes, low amplitude) to every clip, so the
#    morphs are active in a measurement.
# 9. Exports a GLB (4 weights, WebP textures) with or without the face shapes.
#
# Usage:
#   Blender -b --factory-startup -P scripts/blender/research/mh_bakedown.py -- \
#     --source assets/skaters/nia/skater.glb --mh duke-assembled-v01.glb \
#     --out out/nia-mh-high.glb [--phone out/nia-mh-phone.glb] [--report out/report.json]
#     [--garments nia-mh-clothed.blend --wheels clothes_report.json]
#
# --garments (2026-11-27, bare-body Nia): appends every object named garment_* from a .blend
# made by scripts/blender/research/nia_mh_clothes.py. The garments must be in the space of the
# MetaHuman GLB (the Save Pose DNA). Their weights use the MetaHuman body bone names, plus
# skate_wheel_* on the skates. The script hides the body under the cloth (deletes the covered
# body vertices), collapses the garment weights to the kept bones, decimates each garment to
# GARMENT_TRIS, and exports the garments with the body.
# --wheels: the wheel centers (clothes_report.json "wheels") replace the default wheel layout.
import bpy
import json
import math
import sys
import time
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg(name, default=None):
    if f"--{name}" in argv:
        return argv[argv.index(f"--{name}") + 1]
    return default


SOURCE = arg("source")
MH = arg("mh")
OUT = arg("out")
PHONE = arg("phone")
REPORT = arg("report")
HEAD_VERTS = int(arg("head-verts", "5000"))
BODY_TRIS = int(arg("body-tris", "25000"))
FPS = int(arg("fps", "30"))
DRACO = arg("draco", "1") == "1"
GARMENTS = arg("garments")
WHEELS = arg("wheels")
GARMENT_TRIS = {"jacket": 7000, "joggers": 6000, "skates": 7000, "croptop": 1500, "kneepads": 800,
                "wristband": 256, "hairbun": 1200}
report = {"started": time.strftime("%Y-%m-%d %H:%M:%S")}
T0 = time.time()


def log(*a):
    print(f"[mh_bakedown {time.time() - T0:7.1f}s]", *a, flush=True)


# ---------------------------------------------------------------------------
# The kept skeleton: 71 MetaHuman deform bones, then 8 skate wheel bones.
SIDES = ("l", "r")
KEEP = ["root", "pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05", "neck_01", "neck_02", "head"]
for s in SIDES:
    KEEP += [f"clavicle_{s}", f"upperarm_{s}", f"upperarm_twist_01_{s}", f"upperarm_twist_02_{s}", f"lowerarm_{s}", f"lowerarm_twist_01_{s}", f"lowerarm_twist_02_{s}", f"hand_{s}"]
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        KEEP += [f"{f}_0{i}_{s}" for i in (1, 2, 3)]
    KEEP += [f"thigh_{s}", f"thigh_twist_01_{s}", f"calf_{s}", f"calf_twist_01_{s}", f"foot_{s}", f"ball_{s}"]
# From the head rig.
FACE_BONES = {"FACIAL_C_Jaw": "head", "FACIAL_L_Eye": "head", "FACIAL_R_Eye": "head"}
KEEP_ALL = KEEP + list(FACE_BONES)

# Mixamo (source) -> MetaHuman (target). Bones not in the map keep their rest
# rotation relative to the parent (spine_02, spine_04, neck_02, twists).
MAP = {"Hips": "pelvis", "Spine": "spine_01", "Spine1": "spine_03", "Spine2": "spine_05", "Neck": "neck_01", "Head": "head"}
for side, s in (("Left", "l"), ("Right", "r")):
    MAP.update({
        f"{side}Shoulder": f"clavicle_{s}", f"{side}Arm": f"upperarm_{s}", f"{side}ForeArm": f"lowerarm_{s}", f"{side}Hand": f"hand_{s}",
        f"{side}UpLeg": f"thigh_{s}", f"{side}Leg": f"calf_{s}", f"{side}Foot": f"foot_{s}", f"{side}ToeBase": f"ball_{s}",
    })
    for mx, mh in (("Thumb", "thumb"), ("Index", "index"), ("Middle", "middle"), ("Ring", "ring"), ("Pinky", "pinky")):
        for i in (1, 2, 3):
            MAP[f"{side}Hand{mx}{i}"] = f"{mh}_0{i}_{s}"
# Aim child of each target bone, to align the rest directions (A-pose vs T-pose).
AIM = {}
for s in SIDES:
    AIM.update({f"clavicle_{s}": f"upperarm_{s}", f"upperarm_{s}": f"lowerarm_{s}", f"lowerarm_{s}": f"hand_{s}", f"hand_{s}": f"middle_01_{s}",
                f"thigh_{s}": f"calf_{s}", f"calf_{s}": f"foot_{s}", f"foot_{s}": f"ball_{s}"})
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        AIM[f"{f}_01_{s}"] = f"{f}_02_{s}"
        AIM[f"{f}_02_{s}"] = f"{f}_03_{s}"

# ARKit 52 -> MetaHuman head shapes (summed at weight 1). Raw MetaHuman shapes
# are RigLogic correctives on top of joint motion; see the report for why a
# production bake must evaluate RigLogic (joints + shapes) for each pose.
ARKIT = {}
for side, s, w in (("Left", "L", "left"), ("Right", "R", "right")):
    o = "R" if s == "L" else "L"
    ARKIT.update({
        f"eyeBlink{side}": [f"eye_blink_{s}"],
        f"eyeLookDown{side}": [f"eye_lookDown_{s}"],
        f"eyeLookIn{side}": [f"eye_look{'Right' if s == 'L' else 'Left'}_{s}"],
        f"eyeLookOut{side}": [f"eye_look{'Left' if s == 'L' else 'Right'}_{s}"],
        f"eyeLookUp{side}": [f"eye_lookUp_{s}"],
        f"eyeSquint{side}": [f"eye_squintInner_{s}"],
        f"eyeWide{side}": [f"eye_widen_{s}"],
        f"browDown{side}": [f"brow_down_{s}"],
        f"browOuterUp{side}": [f"brow_raiseOuter_{w}"],
        f"cheekSquint{side}": [f"eye_cheekRaise_{s}"],
        f"noseSneer{side}": [f"nose_wrinkle_{w}"],
        f"mouthSmile{side}": [f"mouth_cornerPull_{w}"],
        f"mouthFrown{side}": [f"mouth_cornerDepress_{s}"],
        f"mouthDimple{side}": [f"mouth_dimple_{w}"],
        f"mouthStretch{side}": [f"mouth_stretch_{w}"],
        f"mouthPress{side}": [f"mouth_press_U{s}", f"mouth_press_D{s}"],
        f"mouthLowerDown{side}": [f"mouth_lowerLipDepress_{w}"],
        f"mouthUpperUp{side}": [f"mouth_upperLipRaise_{w}"],
    })
ARKIT.update({
    "browInnerUp": ["brow_raiseIn_L", "brow_raiseIn_R"],
    "cheekPuff": ["cheek_blow_left", "cheek_blow_right"],
    "jawForward": ["jaw_fwd"],
    "jawLeft": ["jaw_left"],
    "jawRight": ["jaw_right"],
    "jawOpen": ["jaw_open"],
    "mouthClose": ["mouth_lipsTighten_UL", "mouth_lipsTighten_UR", "mouth_lipsTighten_DL", "mouth_lipsTighten_DR"],
    "mouthFunnel": ["mouth_funnel_UL", "mouth_funnel_UR", "mouth_funnel_DL", "mouth_funnel_DR"],
    "mouthPucker": ["mouth_lipsPurse_UL", "mouth_lipsPurse_UR", "mouth_lipsPurse_DL", "mouth_lipsPurse_DR"],
    "mouthLeft": ["mouth_left"],
    "mouthRight": ["mouth_right"],
    "mouthRollLower": ["mouth_lowerLipRollIn_L", "mouth_lowerLipRollIn_R"],
    "mouthRollUpper": ["mouth_upperLipRollIn_L", "mouth_upperLipRollIn_R"],
    "mouthShrugLower": ["jaw_chinCompress_L", "jaw_chinCompress_R"],
    "mouthShrugUpper": ["mouth_upperLipTowardsTeeth_L", "mouth_upperLipTowardsTeeth_R"],
})
# tongueOut is the 52nd shape. It lives on the teeth mesh.
TONGUE = {"tongueOut": ["tongue_out_IN"]}


def ancestors_map(rig, keep):
    """bone name -> nearest kept ancestor (or itself)."""
    out = {}
    for b in rig.data.bones:
        a = b
        while a is not None and a.name not in keep:
            a = a.parent
        out[b.name] = a.name if a else None
    return out


def select_only(*objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


# ---------------------------------------------------------------------------
# 1. Source clips, sampled in world space.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
src_objs = import_glb(SOURCE)
src = next(o for o in src_objs if o.type == "ARMATURE")
for o in src_objs:
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
prefix = "mixamorig:" if any(b.name.startswith("mixamorig:") for b in src.data.bones) else ""
src_names = {k: prefix + k for k in MAP}
src_rest = {k: (src.matrix_world @ src.data.bones[n].matrix_local) for k, n in src_names.items()}
src_actions = [a for a in bpy.data.actions]
if src.animation_data is None:
    src.animation_data_create()
clips = {}
for act in src_actions:
    src.animation_data.action = act
    f0, f1 = int(math.floor(act.frame_range[0])), int(math.ceil(act.frame_range[1]))
    frames = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        frames.append({k: (src.matrix_world @ src.pose.bones[n].matrix).copy() for k, n in src_names.items()})
    clips[act.name] = (f0, frames)
log(f"sampled {len(clips)} clips, {sum(len(c[1]) for c in clips.values())} frames")
report["clips"] = {k: len(v[1]) for k, v in clips.items()}
src_hips_z = src_rest["Hips"].translation.z
bpy.data.objects.remove(src, do_unlink=True)
for a in src_actions:
    bpy.data.actions.remove(a)

# ---------------------------------------------------------------------------
# 2. The MetaHuman.
mh_objs = import_glb(MH)
for o in mh_objs:
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)
mh_objs = [o for o in bpy.data.objects]
rigs = [o for o in mh_objs if o.type == "ARMATURE"]
body_rig = next(r for r in rigs if "pelvis" in r.data.bones and "FACIAL_C_Jaw" not in r.data.bones)
head_rig = next(r for r in rigs if "FACIAL_C_Jaw" in r.data.bones)
meshes = {o.name: o for o in mh_objs if o.type == "MESH"}
log("rigs", body_rig.name, len(body_rig.data.bones), head_rig.name, len(head_rig.data.bones), "meshes", list(meshes))
report["mh_source"] = {"body_joints": len(body_rig.data.bones), "head_joints": len(head_rig.data.bones),
                       "meshes": {n: {"verts": len(o.data.vertices), "shapes": len(o.data.shape_keys.key_blocks) - 1 if o.data.shape_keys else 0} for n, o in meshes.items()}}
for o in bpy.data.objects:
    for idb in (o, getattr(o.data, "shape_keys", None)):
        if idb is not None and idb.animation_data:
            idb.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)


def find_mesh(part):
    return next((o for n, o in meshes.items() if part in n), None)


body = find_mesh("body_lod0")
head = find_mesh("head_lod0")
teeth = find_mesh("teeth_lod0")
lashes = find_mesh("eyelashes_lod0")
eyes = [find_mesh("eyeLeft_lod0"), find_mesh("eyeRight_lod0")]
cartilage = find_mesh("cartilage_lod0")
if cartilage:
    bpy.data.objects.remove(cartilage, do_unlink=True)

garments = []
if GARMENTS:
    with bpy.data.libraries.load(GARMENTS, link=False) as (src_lib, dst_lib):
        dst_lib.objects = [n for n in src_lib.objects if n.startswith("garment_")]
    for g in dst_lib.objects:
        mw = g.matrix_world.copy()
        bpy.context.scene.collection.objects.link(g)
        g.parent = None
        g.matrix_world = mw
        for m in list(g.modifiers):
            g.modifiers.remove(m)
        garments.append(g)
    for o in list(bpy.data.objects):
        if not o.users_collection:  # objects that came along with the append (old body, old rig)
            bpy.data.objects.remove(o, do_unlink=True)
    bv = [body.matrix_world @ v.co for v in body.data.vertices]
    report["garments_in"] = {g.name: len(g.data.polygons) for g in garments}
    report["mh_body_box_m"] = [[round(min(v[i] for v in bv), 4) for i in range(3)], [round(max(v[i] for v in bv), 4) for i in range(3)]]
    log("garments", report["garments_in"], "MetaHuman body box", report["mh_body_box_m"])
wheel_spec = json.load(open(WHEELS))["wheels"] if WHEELS else None

# 3. Scale to the source pelvis height, and face the same way as the source.
mh_hips_z = (body_rig.matrix_world @ body_rig.data.bones["pelvis"].matrix_local).translation.z
scale = src_hips_z / mh_hips_z
log(f"scale {scale:.4f} (source hips {src_hips_z:.3f} m, MetaHuman pelvis {mh_hips_z:.3f} m)")
report["scale"] = scale
fwd_src = Vector((0, -1, 0))  # glTF +Z forward imports as Blender -Y.
bl = body_rig.data.bones
mh_fwd = (bl["ball_l"].head_local - bl["foot_l"].head_local)
mh_fwd.z = 0
yaw = 0.0 if mh_fwd.normalized().dot(fwd_src) > 0 else math.pi
report["yaw_fix_deg"] = math.degrees(yaw)
tops = [o for o in bpy.data.objects if o.parent is None]
M_FIX = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Scale(scale, 4)
for o in tops:
    o.matrix_world = M_FIX @ o.matrix_world
select_only(*bpy.data.objects)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# ---------------------------------------------------------------------------
# 4. One armature with the kept bones.
body_anc = ancestors_map(body_rig, set(KEEP))
head_anc = ancestors_map(head_rig, set(KEEP_ALL))
head_rest = {n: head_rig.data.bones[n].matrix_local.copy() for n in FACE_BONES}
head_len = {n: head_rig.data.bones[n].length for n in FACE_BONES}
select_only(body_rig)
bpy.ops.object.mode_set(mode="EDIT")
eb = body_rig.data.edit_bones
for b in list(eb):
    if b.name in KEEP:
        p = b.parent
        while p is not None and p.name not in KEEP:
            p = p.parent
        b.parent = p
for b in list(eb):
    if b.name not in KEEP:
        eb.remove(b)
for n, parent in FACE_BONES.items():
    nb = eb.new(n)
    nb.length = max(head_len[n], 0.01)
    nb.matrix = head_rest[n]
    nb.parent = eb[parent]
# Skate wheel bones. With --wheels: at the measured wheel centers, weighted (the skates garment).
# Without: no weights, at a default layout, as on the shipped skaters.
for w in (wheel_spec or []):
    wb = eb.new(w["name"])
    c = M_FIX @ Vector(w["center"])
    wb.head = c
    wb.tail = c + (M_FIX.to_3x3() @ Vector((0.03, 0, 0)))
    wb.parent = eb["foot_" + w["name"].split("_")[2].lower()]
for s, S in (() if wheel_spec else (("l", "L"), ("r", "R"))):
    foot = eb[f"foot_{s}"]
    ball = eb[f"ball_{s}"]
    fwd = (ball.head - foot.head)
    fwd.z = 0
    fwd.normalize()
    right = fwd.cross(Vector((0, 0, 1)))
    for pos, d in (("front", 0.11), ("rear", -0.06)):
        for k, side in (("a", -1), ("b", 1)):
            wb = eb.new(f"skate_wheel_{S}_{pos}_{k}")
            c = Vector((foot.head.x, foot.head.y, 0.036)) + fwd * d + right * (0.012 * side)
            wb.head = c
            wb.tail = c + right * 0.03
            wb.parent = foot
bpy.ops.object.mode_set(mode="OBJECT")
rig = body_rig
rig.name = "MHRig"
rig.data.name = "MHRig"
report["bones"] = len(rig.data.bones)
log("bones", len(rig.data.bones))


def collapse_weights(obj, anc, limit=4):
    """Moves each group weight to the kept ancestor, keeps the top `limit`."""
    names = {g.index: g.name for g in obj.vertex_groups}
    per_vertex = []
    for v in obj.data.vertices:
        acc = {}
        for g in v.groups:
            t = anc.get(names[g.group])
            if t is None or g.weight <= 0:
                continue
            acc[t] = acc.get(t, 0.0) + g.weight
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:limit]
        tot = sum(w for _, w in top) or 1.0
        per_vertex.append([(t, w / tot) for t, w in top])
    obj.vertex_groups.clear()
    groups = {}
    for i, ws in enumerate(per_vertex):
        for t, w in ws:
            if t not in groups:
                groups[t] = obj.vertex_groups.new(name=t)
            groups[t].add([i], w, "REPLACE")


def rebind(obj):
    for m in list(obj.modifiers):
        if m.type == "ARMATURE":
            obj.modifiers.remove(m)
    mat = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = mat
    m = obj.modifiers.new("Armature", "ARMATURE")
    m.object = rig


for obj, anc in ((body, body_anc), (head, head_anc), (teeth, head_anc), (lashes, head_anc), *((e, head_anc) for e in eyes)):
    collapse_weights(obj, anc)
    rebind(obj)
bpy.data.objects.remove(head_rig, do_unlink=True)
log("weights collapsed")

if garments:
    from mathutils.bvhtree import BVHTree
    wheel_names = [b.name for b in rig.data.bones if b.name.startswith("skate_wheel_")]
    g_anc = dict(body_anc)
    g_anc.update({n: n for n in wheel_names})
    # Hide the body under the cloth: delete the body vertices that a short ray out along
    # the normal hits a garment (the Mask step of nia_mh_clothes.py, applied).
    trees = []
    for g in garments:
        if g.name in ("garment_hairbun",):
            continue
        trees.append((g.name, BVHTree.FromPolygons([g.matrix_world @ v.co for v in g.data.vertices], [tuple(p.vertices) for p in g.data.polygons])))
    import bmesh
    bm = bmesh.new(); bm.from_mesh(body.data)
    bm.normal_update()
    mw = body.matrix_world
    dead = []
    for v in bm.verts:
        p = mw @ v.co
        n = (mw.to_3x3() @ v.normal).normalized()
        for name, t in trees:
            if t.ray_cast(p + n * 0.0005, n, 0.06)[0] is not None:
                dead.append(v); break
    before = len(bm.verts)
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(body.data); bm.free()
    report["body_hidden_verts"] = [len(dead), before]
    for g in garments:
        collapse_weights(g, g_anc)
        key = g.name.replace("garment_", "")
        tris = sum(len(p.vertices) - 2 for p in g.data.polygons)
        target = GARMENT_TRIS.get(key, 2000)
        if tris > target:
            m = g.modifiers.new("Decimate", "DECIMATE"); m.ratio = target / tris
            select_only(g); bpy.ops.object.modifier_apply(modifier="Decimate")
        rebind(g)
    log("garments bound", {g.name: sum(len(p.vertices) - 2 for p in g.data.polygons) for g in garments}, "body hidden", report["body_hidden_verts"])

# ---------------------------------------------------------------------------
# 5. ARKit shapes on the head and the teeth.


def build_named_shapes(obj, table, prefix):
    """Adds one key per table entry: the sum of the component deltas (each
    relative to its own relative key). Deletes every other key."""
    keys = obj.data.shape_keys.key_blocks
    base = keys[0]
    n = len(base.data)
    found, missing, comp_max = {}, {}, {}
    sums = {}
    for name, parts in table.items():
        have = [p for p in parts if f"{prefix}{p}" in keys]
        if len(have) != len(parts):
            missing[name] = [p for p in parts if p not in have]
        if not have:
            continue
        acc = [Vector((0.0, 0.0, 0.0)) for _ in range(n)]
        for p in have:
            kb = keys[f"{prefix}{p}"]
            rel = kb.relative_key
            m = 0.0
            for i in range(n):
                d = kb.data[i].co - rel.data[i].co
                acc[i] += d
                m = max(m, d.length)
            comp_max[p] = round(m, 4)
        sums[name] = acc
        found[name] = have
    for kb in list(keys)[1:]:
        obj.shape_key_remove(kb)
    for name, acc in sums.items():
        kb = obj.shape_key_add(name=name, from_mix=False)
        for i in range(n):
            kb.data[i].co = base.data[i].co + acc[i]
    report.setdefault("component_max_delta_m", {}).update(comp_max)
    return found, missing


head_found, head_missing = build_named_shapes(head, ARKIT, "head_lod0_mesh__")
teeth_found, teeth_missing = build_named_shapes(teeth, TONGUE, "teeth_lod0_mesh__")
report["arkit"] = {"head": len(head_found), "teeth": len(teeth_found), "missing_parts": {**head_missing, **teeth_missing},
                   "map": {**head_found, **teeth_found}}
log(f"ARKit shapes: head {len(head_found)}, teeth {len(teeth_found)}, missing parts {head_missing} {teeth_missing}")

# ---------------------------------------------------------------------------
# 6. Decimate. A mesh with shape keys is decimated as a copy without keys,
# then each key is carried over with a Surface Deform bound to the original.


def decimate_plain(obj, ratio):
    select_only(obj)
    m = obj.modifiers.new("Decimate", "DECIMATE")
    m.ratio = ratio
    bpy.ops.object.modifier_move_to_index(modifier="Decimate", index=0)
    bpy.ops.object.modifier_apply(modifier="Decimate")


def decimate_with_keys(obj, ratio, extra_targets=()):
    """Returns a decimated copy of obj with the same shape keys. Each new
    vertex takes the deltas of the nearest point on the source surface
    (barycentric weights of the source polygon). extra_targets (the lashes)
    take the deltas the same way. A Surface Deform transfer was tried first;
    it gave deltas of about 1e12 m on the MetaHuman head (degenerate binds)."""
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc

    src_me = obj.data
    keys = [kb.name for kb in src_me.shape_keys.key_blocks[1:]]
    basis = [v.co.copy() for v in src_me.shape_keys.key_blocks[0].data]
    deltas = {k: [kb.co - basis[i] for i, kb in enumerate(src_me.shape_keys.key_blocks[k].data)] for k in keys}
    polys = [list(p.vertices) for p in src_me.polygons]
    tree = BVHTree.FromPolygons(basis, polys)

    new = obj.copy()
    new.data = obj.data.copy()
    bpy.context.collection.objects.link(new)
    select_only(new)
    bpy.ops.object.shape_key_remove(all=True)
    for m in list(new.modifiers):
        new.modifiers.remove(m)
    if ratio < 1.0:
        decimate_plain(new, ratio)

    def carry(target):
        me = target.data
        if me.shape_keys:
            select_only(target)
            bpy.ops.object.shape_key_remove(all=True)
        mw = obj.matrix_world.inverted() @ target.matrix_world
        binds = []
        for v in me.vertices:
            loc, _n, fi, _d = tree.find_nearest(mw @ v.co)
            vids = polys[fi]
            w = poly_3d_calc([basis[i] for i in vids], loc)
            binds.append(list(zip(vids, w)))
        target.shape_key_add(name="Basis", from_mix=False)
        rot = mw.inverted().to_3x3()
        for k in keys:
            d = deltas[k]
            kb = target.shape_key_add(name=k, from_mix=False)
            for vi, bind in enumerate(binds):
                off = Vector((0.0, 0.0, 0.0))
                for i, w in bind:
                    off += d[i] * w
                kb.data[vi].co = me.vertices[vi].co + rot @ off

    carry(new)
    for t in extra_targets:
        carry(t)
    name = obj.name
    bpy.data.objects.remove(obj, do_unlink=True)
    new.name = name
    rebind(new)
    return new


def renormalize(obj, limit=4):
    select_only(obj)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=limit)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)


head_ratio = min(1.0, HEAD_VERTS / len(head.data.vertices))
head = decimate_with_keys(head, head_ratio, extra_targets=(lashes,))
renormalize(head)
teeth = decimate_with_keys(teeth, 0.3)
renormalize(teeth)
body_tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
if body_tris > BODY_TRIS:
    decimate_plain(body, BODY_TRIS / body_tris)
    renormalize(body)
for o in (lashes, *eyes, *garments):
    renormalize(o)


def mesh_stats(o):
    d = o.data
    return {"verts": len(d.vertices), "tris": sum(len(p.vertices) - 2 for p in d.polygons),
            "shapes": len(d.shape_keys.key_blocks) - 1 if d.shape_keys else 0}


def key_check(o):
    """The largest coordinate of the basis and the largest shape delta (m)."""
    d = o.data
    basis = max(abs(c) for v in d.vertices for c in v.co)
    worst = 0.0
    if d.shape_keys:
        b = d.shape_keys.key_blocks[0].data
        for kb in d.shape_keys.key_blocks[1:]:
            worst = max(worst, max((kb.data[i].co - b[i].co).length for i in range(len(b))))
    return round(basis, 4), round(worst, 4)


report["meshes"] = {o.name: {**mesh_stats(o), "max_coord_and_delta_m": key_check(o)} for o in (body, head, teeth, lashes, *eyes, *garments)}
log("meshes", report["meshes"])

# ---------------------------------------------------------------------------
# 7. Retarget.
rest_w = {b.name: rig.matrix_world @ b.matrix_local for b in rig.data.bones}
inv_map = {v: k for k, v in MAP.items()}


def dir_of(mats, a, b):
    d = mats[b].translation - mats[a].translation
    return d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))


# Rest alignment (A-pose -> T-pose): walk the skeleton from the root. Each
# reference rest is the rest carried by the parent's reference rest, then
# turned about its own head so that its aim child points along the source
# rest direction. Bones without an aim child keep the carried rotation.
ref_w = {}
order = [b for b in rig.data.bones]  # parents come before children
align = {}
for b in order:
    n = b.name
    m = rest_w[n].copy() if b.parent is None else ref_w[b.parent.name] @ (rest_w[b.parent.name].inverted() @ rest_w[n])
    if n in AIM and n in inv_map:
        tc = AIM[n]
        child_ref = (m @ (rest_w[n].inverted() @ rest_w[tc])).translation
        d_t = (child_ref - m.translation).normalized()
        d_s = dir_of(src_rest, inv_map[n], inv_map[tc])
        q = d_t.rotation_difference(d_s).to_matrix().to_4x4()
        loc = m.translation.copy()
        m = q @ Matrix.Translation(-loc) @ m
        m.translation = loc
        align[n] = round(math.degrees(d_t.angle(d_s)), 1)
    ref_w[n] = m
report["rest_alignment_deg"] = align


def rot(m):
    return m.to_quaternion().to_matrix().to_4x4()


rig_inv = rig.matrix_world.inverted()
rest_arm = {b.name: b.matrix_local.copy() for b in rig.data.bones}
pose_bones = rig.pose.bones
for pb in pose_bones:
    pb.rotation_mode = "QUATERNION"
if rig.animation_data is None:
    rig.animation_data_create()
pelvis_rest = rest_w["pelvis"].translation
src_hips_rest = src_rest["Hips"].translation
actions = {}
for name, (f0, frames) in clips.items():
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    for fi, fm in enumerate(frames):
        frame = f0 + fi
        pose_w = {}
        for b in order:
            n = b.name
            if b.parent is None:
                pose_w[n] = ref_w[n]
                continue
            p = b.parent.name
            chained = pose_w[p] @ (ref_w[p].inverted() @ ref_w[n])
            if n in inv_map:
                s = inv_map[n]
                r = rot(fm[s]) @ rot(src_rest[s]).inverted() @ rot(ref_w[n])
                loc = chained.translation.copy()
                if n == "pelvis":
                    loc = pelvis_rest + (fm[s].translation - src_hips_rest)
                m = r.copy()
                m.translation = loc
                pose_w[n] = m
            else:
                pose_w[n] = chained
        for b in order:
            n = b.name
            pa = rig_inv @ pose_w[n]
            if b.parent is None:
                basis = rest_arm[n].inverted() @ pa
            else:
                p = b.parent.name
                basis = (rest_arm[p].inverted() @ rest_arm[n]).inverted() @ (rig_inv @ pose_w[p]).inverted() @ pa
            pb = pose_bones[n]
            loc, q, _ = basis.decompose()
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=n)
            if n in ("pelvis", "root"):
                pb.location = loc
                pb.keyframe_insert("location", frame=frame, group=n)
    actions[name] = act
    log(f"retargeted {name}: {len(frames)} frames")

# ---------------------------------------------------------------------------
# 8. A face track in every clip, and NLA tracks with the clip names.
face_objs = [o for o in (head, lashes, teeth) if o.data.shape_keys]


def face_action(obj, name, f0, f1):
    key = obj.data.shape_keys
    if key.animation_data is None:
        key.animation_data_create()
    act = bpy.data.actions.new(f"{name}_{obj.name}_face")
    key.animation_data.action = act
    for i, kb in enumerate(key.key_blocks[1:]):
        for f in range(f0, f1 + 1, 3):
            kb.value = 0.15 + 0.15 * math.sin(2 * math.pi * (f / FPS) * (0.5 + 0.07 * i) + i)
            kb.keyframe_insert("value", frame=f)
    key.animation_data.action = None
    return act


def push_nla(id_owner, act, name, start):
    ad = id_owner.animation_data
    tr = ad.nla_tracks.new()
    tr.name = name
    strip = tr.strips.new(name, start, act)
    strip.name = name
    return tr


rig.animation_data.action = None
for name, act in actions.items():
    f0 = clips[name][0]
    f1 = f0 + len(clips[name][1]) - 1
    push_nla(rig, act, name, f0)
    for o in face_objs:
        fa = face_action(o, name, f0, f1)
        push_nla(o.data.shape_keys, fa, name, f0)
for o in face_objs:
    for kb in o.data.shape_keys.key_blocks[1:]:
        kb.value = 0.0

# ---------------------------------------------------------------------------
# 9. Textures and export.


def shrink_images(max_px, small_px=512):
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        n = img.name.lower()
        target = small_px if any(k in n for k in ("eye", "lash", "teeth")) else max_px
        if img.size[0] > target:
            img.scale(target, target)


def export(path, morphs):
    select_only(rig, *[o for o in (body, head, teeth, lashes, *eyes, *garments)])
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_all_influences=False,
        export_morph=morphs,
        export_morph_normal=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_image_format="WEBP",
        export_image_quality=85,
        export_draco_mesh_compression_enable=DRACO,
        export_draco_mesh_compression_level=7,
        export_apply=False,
    )
    log("wrote", path)


shrink_images(2048)
export(OUT, True)
report["out"] = OUT
if PHONE:
    shrink_images(1024, 256)
    export(PHONE, False)
    report["phone"] = PHONE
report["seconds"] = round(time.time() - T0, 1)
if REPORT:
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=1)
log("done")
