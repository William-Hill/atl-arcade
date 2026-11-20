"""Render the exported GLB with a fixed camera and neutral lights."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from skater_rig_audit import activate


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--out", required=True)
    parser.add_argument("--video", action="store_true")
    parser.add_argument("--rest", action="store_true")
    parser.add_argument("--height", type=float)
    parser.add_argument("--unlit", action="store_true")
    parser.add_argument("--clips", nargs="+")
    parser.add_argument("--view", choices=("three-quarter", "front", "side"), default="three-quarter")
    parser.add_argument("--floor", action="store_true")
    parser.add_argument("--travel-speed", type=float, default=0)
    parser.add_argument("--sample-step", type=int)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    source = Path(args.source).resolve()
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.import_scene.gltf(filepath=str(source))
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    for obj in list(bpy.data.objects):
        if obj.name == "Icosphere" and obj.type == "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    if args.height:
        points = [obj.matrix_world @ v.co for obj in bpy.context.scene.objects
                  if obj.type == "MESH" for v in obj.data.vertices]
        factor = args.height / (max(p.z for p in points) - min(p.z for p in points))
        for obj in bpy.context.scene.objects:
            if obj.parent is None:
                obj.scale *= factor
        bpy.context.view_layer.update()
    if args.unlit:
        for mat in bpy.data.materials:
            if not mat.node_tree:
                continue
            tree = mat.node_tree
            shader = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            output = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if shader and output:
                emission = tree.nodes.new("ShaderNodeEmission")
                color = shader.inputs["Base Color"]
                if color.links:
                    tree.links.new(color.links[0].from_socket, emission.inputs[0])
                else:
                    emission.inputs[0].default_value = color.default_value
                tree.links.new(emission.outputs[0], output.inputs["Surface"])
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.fps = 30
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("Review world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.18, .18, .18, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .4
    scene.view_settings.view_transform = "AgX"
    cam = bpy.data.objects.new("Review camera", bpy.data.cameras.new("Review camera"))
    scene.collection.objects.link(cam)
    cam.location = (1.4, -5, 2.2)
    if args.view == "front":
        cam.location = (0, -5, 1.3)
    elif args.view == "side":
        cam.location = (5, 0, 1.3)
    aim(cam, (0, 0, .95))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.5
    scene.camera = cam
    if args.floor:
        bpy.ops.mesh.primitive_plane_add(size=20)
        floor = bpy.context.object
        floor.name = "Review floor"
        material = bpy.data.materials.new("Review floor")
        material.use_nodes = True
        tree = material.node_tree
        checker = tree.nodes.new("ShaderNodeTexChecker")
        checker.inputs["Color1"].default_value = (.12, .13, .14, 1)
        checker.inputs["Color2"].default_value = (.16, .17, .18, 1)
        checker.inputs["Scale"].default_value = 40
        uv = tree.nodes.new("ShaderNodeTexCoord")
        tree.links.new(uv.outputs["UV"], checker.inputs["Vector"])
        tree.links.new(checker.outputs["Color"], tree.nodes["Principled BSDF"].inputs["Base Color"])
        floor.data.materials.append(material)
    light_origins = []
    for name, location, power, size in [
        ("Key", (-3, -4, 5), 500, 4),
        ("Fill", (3, -2, 3), 300, 3),
        ("Rim", (0, 3, 4), 400, 3),
    ]:
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        scene.collection.objects.link(light)
        light.location = location
        light.data.energy = power
        light.data.shape = "DISK"
        light.data.size = size
        aim(light, (0, 0, 1))
        light_origins.append((light, light.location.copy()))
    clips = ["rest"] if args.rest else args.clips or ["coast", "bail", "air_japan", "dance_bankhead"]
    manifest = []
    camera_origin = cam.location.copy()
    arm_origin = arm.location.copy() if arm else None
    for clip in clips:
        action = bpy.data.actions.get(clip)
        if args.rest:
            if arm:
                activate(arm, None)
            start, end = 0, 0
        else:
            assert action, f"Missing clip {clip}"
            activate(arm, action)
            start, end = map(int, action.frame_range)
        frames = list(range(start, end + 1)) if args.video and (args.clips or clip in ("coast", "bail")) else [
            start, start + (end-start)//2, end]
        if args.sample_step:
            assert args.sample_step > 0
            frames = sorted(set(range(start, end + 1, args.sample_step)) | {end})
        folder = out / clip
        folder.mkdir(exist_ok=True)
        for frame in frames:
            scene.frame_set(frame)
            if arm and args.travel_speed:
                travel = Vector((0, -args.travel_speed * (frame - start) / 30, 0))
                arm.location = arm_origin + travel
                cam.location = camera_origin + travel
                for light, origin in light_origins:
                    light.location = origin + travel
                bpy.context.view_layer.update()
            scene.render.filepath = str(folder / f"{frame:04d}.png")
            bpy.ops.render.render(write_still=True)
        manifest.append({"clip": clip, "start": start, "end": end, "frames": frames,
                         "source_sha256": source_hash, "travel_speed_m_s": args.travel_speed})
        print("RENDERED", clip, flush=True)
    (out / "frames.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
