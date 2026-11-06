"""Build the runtime skater GLB from the runtime .blend source.

Marcus gets the hand and seam corrections (#168):

- Fit the 40 finger joints to the hand mesh and weight each finger.
- Keep each knee pad closed on the knee.
- Keep each wristband closed on the wrist.

Run in a background Blender process from the repository root:

    blender -b --factory-startup --python-exit-code 1 \
      -P scripts/blender/skater_runtime.py -- --name marcus

The script writes `raw/runtime-v2/<name>-runtime.blend` and `skater.glb`.
Run `skater_texture_variant.py` on the new .blend for `skater-1024.glb`.
"""
import argparse
import json
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from skater_repair import reset
import skater_hands
import skater_seams


def correct_marcus(arm, mesh):
    report = {"pads": skater_seams.close_pads(arm, mesh),
              "wristbands": skater_seams.close_cuffs(mesh)}
    fits, report["finger_fit"] = skater_hands.fit_fingers(arm, mesh)
    report["finger_weights"] = skater_hands.weight_fingers(arm, mesh, fits)
    return report


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", choices=("nia", "marcus"), required=True)
    parser.add_argument("--source", type=Path, help="The runtime .blend source.")
    parser.add_argument("--out", type=Path, help="The directory for the new .blend.")
    parser.add_argument("--glb", type=Path, help="The exported GLB.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    raw = ROOT / "assets/skaters" / args.name / "raw"
    source = args.source or raw / "runtime-v1" / (args.name + "-runtime.blend")
    out = args.out or raw / "runtime-v2"
    glb = args.glb or ROOT / "assets/skaters" / args.name / "skater.glb"
    bpy.ops.wm.open_mainfile(filepath=str(source.resolve()))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH"
                and any(m.type == "ARMATURE" for m in o.modifiers))
    for action in [a for a in bpy.data.actions if "." in a.name]:
        bpy.data.actions.remove(action)
    reset(arm)
    report = {"name": args.name, "source": str(source)}
    if args.name == "marcus":
        report.update(correct_marcus(arm, mesh))
    for action in bpy.data.actions:
        action.use_fake_user = True
    report["clips"] = sorted(a.name for a in bpy.data.actions)
    arm.animation_data_create()
    scope = {"__name__": "skater_runtime", "SKATER_CFG": {"arm": arm.name, "mesh": mesh.name}}
    exec(compile((HERE / "nia_clips.py").read_text(), "nia_clips.py", "exec"), scope)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str((out / (args.name + "-runtime.blend")).resolve()))
    scope["export"](str(glb.resolve()), True, export_image_format="JPEG", export_jpeg_quality=88)
    (out / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print("RUNTIME_BUILD", json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
