"""Make face key points for the next conform attempt (Crossroads face_pins.py rule).

For each named landmark, take the MetaHuman vertex nearest to the ray hit on the fit
(posed_combined_lod0_mesh order) and pin it to the ray hit on the target. UE target = (x, -y, z) * 100.

  Blender -b --factory-startup -P nia_mh_face_pins.py -- <work> <attempt measured> <out keypoints.json> name1,name2,...
"""
import bpy, sys, json
from mathutils import Vector, kdtree
argv = sys.argv[sys.argv.index("--") + 1:]
work, att, out, names = argv[0], int(argv[1]), argv[2], argv[3].split(",")
m = json.load(open(f"{work}/measure/a{att:02d}/measurements_attempt{att:02d}.json"))["diagnostics"]
bpy.ops.wm.open_mainfile(filepath=f"{work}/fit/posed-import.blend")
fit = bpy.data.objects["posed_combined_lod0_mesh"]
rig = bpy.data.objects["posed_body_rig"]
for pb in rig.pose.bones:
    pb.matrix_basis.identity()
for x in fit.modifiers:
    x.show_viewport = False
bpy.context.view_layer.update()
vs = [fit.matrix_world @ v.co for v in fit.data.vertices]
kd = kdtree.KDTree(len(vs))
for i, v in enumerate(vs):
    kd.insert(v, i)
kd.balance()
prev = json.load(open(out)) if False else None
pins = {}
for n in names:
    lm = m["lm_" + n]
    co, idx, dist = kd.find(Vector(lm["fit"]))
    t = lm["tgt"]
    pins["face_" + n] = {"vertex": int(idx), "ue_cm": [t[0] * 100, -t[1] * 100, t[2] * 100],
                         "fit_hit_to_vertex_mm": round(dist * 1000, 2),
                         "pin_move_mm": round((Vector(t) - co).length * 1000, 2)}
json.dump({"native_vertex_count": len(vs), "pins": pins}, open(out, "w"), indent=1)
print("PINS_DONE", json.dumps({k: (v["vertex"], v["fit_hit_to_vertex_mm"], v["pin_move_mm"]) for k, v in pins.items()}))
