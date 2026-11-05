# Convert the unrigged Tripo parts GLB to FBX for mixamo.com auto-rigging.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/marcus_glb_to_fbx.py
import bpy, sys, os

src = os.path.expanduser("~/Development/atl-arcade-epic/assets/skaters/marcus/raw/marcus-tripo-pbr.glb")
dst = os.path.expanduser("~/Development/atl-arcade-epic/assets/skaters/marcus/raw/marcus-tripo-parts.fbx")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print(f"imported {len(meshes)} parts")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, add_leaf_bones=False,
                         path_mode='COPY', embed_textures=False)
print(f"exported {dst} {os.path.getsize(dst)} bytes")
