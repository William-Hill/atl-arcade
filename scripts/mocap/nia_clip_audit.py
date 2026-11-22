# Measures every looping clip of a skater GLB with the metrics of
# nia_mocap_compare.py (penetration, hover, jitter, skid, loop seam), so the
# hand-keyed clips and a mocap clip have one scale. It reads the GLB only. It
# changes no clip.
#
# The loop seam is the largest change of joint speed between the last step
# of the loop and the first step (m/s). The jitter is the RMS joint
# acceleration (m/s^2) of the ankles, the wrists, and the head.
#
# Run:
#   blender -b --factory-startup -P scripts/mocap/nia_clip_audit.py -- \
#     --in assets/skaters/nia/skater.glb --out audit.json [--clips push,coast]
import argparse
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nia_mocap_compare as cmp  # noqa: E402  (measure(), import_skater())

# The clips that play once (src/render/skater-anim.js, CLIPS[name].once). A
# seam is not a fault for them.
ONCE = {"jump", "land", "bail"}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--clips", default="", help="comma list; empty = every looping clip")
    p.add_argument("--speed", type=float, default=3.0)
    p.add_argument("--fps", type=int, default=30)
    return p.parse_args(argv)


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = a.fps
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    names = sorted({x.name.split(".")[0] for x in bpy.data.actions})
    want = [c for c in a.clips.split(",") if c] or [n for n in names if n not in ONCE]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = a.fps
    out = {}
    for clip in want:
        arm, mesh, act = cmp.import_skater(a.src, clip, clip)
        out[clip] = cmp.measure(arm, mesh, act, a.speed, a.fps)
        print(f"[audit] {clip}: seam {out[clip]['loop_seam_m_s']} m/s, jitter {out[clip]['jitter_rms_m_s2']} m/s^2")
        for o in (mesh, arm):
            bpy.data.objects.remove(o, do_unlink=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
