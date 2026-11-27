"""Make one MetaHuman GLB for Nia from the auto-rig DNA files (research spike).

The output has the same layout as Crossroads duke-assembled-v01.glb, so that
scripts/blender/research/mh_bakedown.py reads it: a body rig, a head rig with FACIAL_* joints,
and the LOD0 meshes (head, body, teeth, eyes, lashes) with every DNA blend shape as a shape key
named <dna mesh>__<channel>. No textures, no correctives, no animation.

Needs the Poly Hammer Character DNA add-on (bl_ext.user_default.character_dna).

  Blender -b --factory-startup -P scripts/blender/research/nia_mh_assemble.py -- <head.dna> <out.glb>

The add-on finds the body DNA next to the head DNA (<name>_Body.dna for <name>_Head.dna).
"""
import sys, importlib, json
import bpy
from mathutils import Matrix

head_dna, out = sys.argv[sys.argv.index("--") + 1:][:2]
import addon_utils
addon_utils.enable("bl_ext.user_default.character_dna", default_set=False)
sys.modules["character_dna"] = importlib.import_module("bl_ext.user_default.character_dna")
from character_dna.utilities import get_active_rig_instance
from character_dna.dna_io.misc import create_shape_key
from character_dna import utilities as U

bpy.ops.wm.read_homefile(use_empty=True)
r = bpy.ops.character_dna.import_dna(filepath=head_dna, include_body=True, import_face_board=False,
                                     import_mesh=True, import_bones=True, import_shape_keys=True,
                                     import_materials=False, import_vertex_groups=True,
                                     **{f"import_lod{i}": i == 0 for i in range(8)})
print("IMPORT", r)
inst = get_active_rig_instance()
if inst.head_dna_reader is None:
    inst.initialize()
R = inst.head_dna_reader
inst.auto_evaluate = False; inst.auto_evaluate_body = False; inst.auto_evaluate_head = False
lin = next(c.linear_modifier for c in [U.get_active_head()] if c)
made = 0
for mi in R.getMeshIndicesForLOD(0):
    mo = inst.head_mesh_index_lookup.get(mi)
    if not mo:
        continue
    dn = R.getMeshName(mi)
    for ti in range(R.getBlendShapeTargetCount(mi)):
        ch = R.getBlendShapeChannelName(R.getBlendShapeChannelIndex(mi, ti))
        if len(f"{dn}__{ch}") > 63:
            continue
        if create_shape_key(index=ti, mesh_index=mi, mesh_object=mo, reader=R, name=ch, prefix=f"{dn}__", linear_modifier=lin):
            made += 1
inst.destroy_references() if hasattr(inst, "destroy_references") else None
arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
print("ARMATURES", [(a.name, len(a.data.bones)) for a in arms])
hrig = next(a for a in arms if "FACIAL_C_Jaw" in a.data.bones)
brig = next(a for a in arms if "pelvis" in a.data.bones and "FACIAL_C_Jaw" not in a.data.bones)
for rig in (brig, hrig):
    rig.hide_set(False); rig.hide_viewport = False
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    for c in [c for pb in rig.pose.bones for c in pb.constraints]:
        c.mute = True
for o in bpy.data.objects:
    for idb in (o, getattr(o.data, "shape_keys", None) if o.type == "MESH" else None):
        if idb is not None and idb.animation_data:
            idb.animation_data_clear()
def flat(name, rgb, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    return m
# Flat colors only: the skin texture bake from the Tripo source is not part of this spike.
MATS = {"head_lod0": flat("nia_skin_head", (0.20, 0.10, 0.06), 0.55), "body_lod0": flat("nia_skin_body", (0.20, 0.10, 0.06), 0.55),
        "teeth_lod0": flat("nia_teeth", (0.80, 0.76, 0.68), 0.4), "eyeLeft_lod0": flat("nia_eye", (0.06, 0.03, 0.02), 0.1),
        "eyeRight_lod0": flat("nia_eye", (0.06, 0.03, 0.02), 0.1), "eyelashes_lod0": flat("nia_lash", (0.02, 0.015, 0.01), 0.8)}
for o in bpy.data.objects:
    if o.type == "MESH":
        for k, m in MATS.items():
            if k in o.name:
                o.data.materials.clear(); o.data.materials.append(m)
keep = [o for o in bpy.data.objects if o.type == "MESH" and "lod0" in o.name
        and not any(k in o.name for k in ("eyeshell", "eyeEdge", "saliva", "cartilage"))]
for o in bpy.data.objects:
    o.select_set(o in keep or o in (brig, hrig))
    if o.type == "MESH" and o not in keep:
        o.hide_render = True
bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_animations=False, export_skins=True,
                          export_morph=True, export_morph_normal=False, export_def_bones=False,
                          export_all_influences=True, export_yup=True, export_apply=False,
                          export_materials="EXPORT")
info = {"shape_keys": made, "meshes": {o.name: {"verts": len(o.data.vertices),
                                               "shapes": len(o.data.shape_keys.key_blocks) - 1 if o.data.shape_keys else 0} for o in keep},
        "body_joints": len(brig.data.bones), "head_joints": len(hrig.data.bones)}
json.dump(info, open(out.replace(".glb", ".json"), "w"), indent=1)
print("ASSEMBLE_DONE", json.dumps(info))
