"""Build review candidates without changes to the source assets."""
import argparse
from pathlib import Path
import re
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def smooth(a, b, value):
    t = min(1.0, max(0.0, (value - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def mix(a, b, t):
    return {k: a.get(k, 0) * (1 - t) + b.get(k, 0) * t for k in a.keys() | b.keys()}


def chain(value, names, joints):
    weights = {names[0]: 1.0}
    for name, (lo, hi) in zip(names[1:], joints):
        weights = mix(weights, {name: 1.0}, smooth(lo, hi, value))
    return weights


def marcus_weights(point):
    """Use one spatial field for all parts at each joint."""
    x, y, z = point
    side = "Left" if x >= 0 else "Right"
    torso = chain(z, ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"],
                  [(.60, .65), (.665, .71), (.725, .775), (.805, .837), (.84, .875)])
    arm = chain(abs(x), ["Spine2", side + "Shoulder", side + "Arm",
                        side + "ForeArm", side + "Hand"],
                [(.065, .105), (.105, .15), (.22, .28), (.325, .37)])
    torso = mix(torso, arm, smooth(.665, .73, z) * smooth(.065, .12, abs(x)))
    legs = []
    for full in ("Right", "Left"):
        legs.append(chain(z, [full + "Foot", full + "Leg", full + "UpLeg", "Hips"],
                          [(.177, .225), (.305, .375), (.49, .58)]))
    lower = mix(legs[0], legs[1], smooth(-.045, .045, x))
    weights = mix(lower, torso, smooth(.57, .61, z))
    weights = sorted(((k, w) for k, w in weights.items() if w > 1e-6),
                     key=lambda item: item[1], reverse=True)[:4]
    total = sum(w for _, w in weights)
    return {"mixamorig:" + k: w / total for k, w in weights}


def reset(arm):
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.matrix_basis = Matrix.Identity(4)
        pb.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()


def fit_marcus(arm):
    """Set joint coordinates from the source geometry in meters."""
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = arm.data.edit_bones
    original = {b.name: (b.head.copy(), b.tail.copy(), b.z_axis.copy()) for b in bones}
    for b in bones:
        b.use_connect = False
    joints = {
        "Hips": ((0, 0, .565), (0, 0, .625)),
        "Spine": ((0, 0, .625), (0, 0, .685)),
        "Spine1": ((0, 0, .685), (0, 0, .745)),
        "Spine2": ((0, 0, .745), (0, 0, .812)),
        "Neck": ((0, 0, .812), (0, 0, .855)),
        "Head": ((0, 0, .855), (0, 0, .955)),
        "HeadTop_End": ((0, 0, .955), (0, 0, .979)),
    }
    for side, sign in (("Left", 1), ("Right", -1)):
        wrist_y = .060 if sign == 1 else .024
        def p(x, y, z):
            return (sign * x, y, z)
        joints.update({
            side + "Shoulder": (p(.028, 0, .785), p(.12, .012, .772)),
            side + "Arm": (p(.12, .012, .772), p(.25, .030 if sign == 1 else .014, .77)),
            side + "ForeArm": (p(.25, .030 if sign == 1 else .014, .77), p(.355, wrist_y, .766)),
            side + "Hand": (p(.355, wrist_y, .766), p(.408, wrist_y, .766)),
            side + "UpLeg": (p(.075, 0, .55), p(.09, -.004, .34)),
            side + "Leg": (p(.09, -.004, .34), p(.12, .012 if sign == 1 else -.012, .16)),
            side + "Foot": (p(.12, .012 if sign == 1 else -.012, .16),
                           p(.125, -.065 if sign == 1 else -.09, .075)),
            side + "ToeBase": (p(.125, -.065 if sign == 1 else -.09, .075),
                              p(.125, -.092 if sign == 1 else -.117, .075)),
            side + "Toe_End": (p(.125, -.092 if sign == 1 else -.117, .075),
                              p(.125, -.10 if sign == 1 else -.125, .075)),
        })
        old_wrist = original["mixamorig:" + side + "Hand"][0]
        new_wrist = Vector(p(.355, wrist_y, .766))
        for name, (head, tail, _) in original.items():
            if name.startswith("mixamorig:" + side + "Hand") and name != "mixamorig:" + side + "Hand":
                joints[name.split(":")[1]] = (new_wrist + (head - old_wrist) * .85,
                                               new_wrist + (tail - old_wrist) * .85)
    for name, (head, tail) in joints.items():
        b = bones.get("mixamorig:" + name)
        if b:
            b.head, b.tail = head, tail
            b.align_roll(original[b.name][2])
    bpy.ops.object.mode_set(mode="OBJECT")


def normalize_uv(obj):
    mesh = obj.data
    assert mesh.uv_layers, f"No UV coordinates on {obj.name}"
    active = mesh.uv_layers.active
    data = [item.uv.copy() for item in active.data]
    for layer in list(mesh.uv_layers)[1:]:
        mesh.uv_layers.remove(layer)
    layer = mesh.uv_layers[0]
    layer.name = "UVMap"
    for i, uv in enumerate(data):
        layer.data[i].uv = uv
    layer.active_render = True
    for mat in mesh.materials:
        if mat and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == "UVMAP":
                    node.uv_map = "UVMap"


def prepare_marcus():
    source = ROOT / "assets/skaters/marcus/raw/marcus-rig-work.blend"
    bpy.ops.wm.open_mainfile(filepath=str(source))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o.get("fitted_to_marcus"))
    parts = [o for o in bpy.data.collections["MARCUS_RIG_WORK"].objects if o.type == "MESH"]
    assert len(parts) == 26
    keep = set(parts + [arm])
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    reset(arm)
    arm.matrix_world = Matrix.Identity(4)
    fit_marcus(arm)
    for obj in parts:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        obj.modifiers.clear()
        obj.vertex_groups.clear()
        normalize_uv(obj)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # glTF splits vertices at UV and normal boundaries. Join coincident
        # vertices before reduction; keep UV coordinates on face corners.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
        bm.to_mesh(obj.data)
        bm.free()
        mod = obj.modifiers.new("Review reduction", "DECIMATE")
        mod.ratio = .02
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        groups = {}
        for vertex in obj.data.vertices:
            for name, weight in marcus_weights(vertex.co).items():
                if name not in groups:
                    groups[name] = obj.vertex_groups.new(name=name)
                groups[name].add([vertex.index], weight, "REPLACE")
        obj.parent = arm
        obj.matrix_parent_inverse = Matrix.Identity(4)
        modifier = obj.modifiers.new("Skin", "ARMATURE")
        modifier.object = arm
        print("WEIGHTED", obj.name, len(obj.data.vertices), flush=True)
    # Save the modular source before the runtime join.
    return arm, parts


def join(parts, arm):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.object
    mesh.parent = arm
    return mesh


def repair_nia_seams(mesh):
    """Share weights at part boundaries and diffuse them into each surface."""
    count = len(mesh.data.vertices)
    materials = np.zeros(count, dtype=np.int32)
    for poly in mesh.data.polygons:
        for vi in poly.vertices:
            materials[vi] = poly.material_index
    group_count = len(mesh.vertex_groups)
    weights = np.zeros((count, group_count), dtype=np.float64)
    for v in mesh.data.vertices:
        for g in v.groups:
            weights[v.index, g.group] = g.weight
    points = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    tree = KDTree(count)
    for i, co in enumerate(points):
        tree.insert(co, i)
    tree.balance()
    parents = list(range(count))
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    for i, point in enumerate(points):
        for _, j, distance in tree.find_range(point, .0085):
            if materials[i] != materials[j]:
                parents[root(j)] = root(i)
    clusters = {}
    for i in range(count):
        clusters.setdefault(root(i), []).append(i)
    clusters = [indices for indices in clusters.values() if len(indices) > 1]
    assert clusters, "No part boundaries found."
    # A boot, its wheels, and its toe stop form one rigid assembly.
    rigid = set()
    rigid_parts = {5, 6, 10, 13, 17, 18, 21}
    for i, slot in enumerate(mesh.material_slots):
        part = re.search(r"tripo_part_(\d+)", slot.name)
        if part and int(part[1]) in rigid_parts:
            indices = np.where(materials == i)[0]
            x = sum(points[k].x for k in indices) / len(indices)
            name = "mixamorig:" + ("Left" if x > 0 else "Right") + "Foot"
            weights[indices] = 0
            weights[indices, mesh.vertex_groups[name].index] = 1
            rigid.update(indices.tolist())
    pinned = set(rigid)
    for indices in clusters:
        anchors = [i for i in indices if i in rigid]
        average = weights[anchors or indices].mean(axis=0)
        top = np.argsort(average)[-4:]
        average[np.setdiff1d(np.arange(group_count), top)] = 0
        average /= average.sum()
        weights[indices] = average
        pinned.update(indices)
    neighbors = [set() for _ in range(count)]
    for edge in mesh.data.edges:
        a, b = edge.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    region = set(pinned)
    frontier = set(pinned)
    for _ in range(5):
        expanded = set().union(*(neighbors[i] for i in frontier)) - region
        region.update(expanded)
        frontier = expanded
    movable = sorted(region - pinned)
    for _ in range(12):
        updated = weights.copy()
        for i in movable:
            if neighbors[i]:
                updated[i] = .5 * weights[i] + .5 * weights[list(neighbors[i])].mean(axis=0)
        weights = updated
    names = [g.name for g in mesh.vertex_groups]
    mesh.vertex_groups.clear()
    groups = [mesh.vertex_groups.new(name=n) for n in names]
    for i, row in enumerate(weights):
        indices = np.argsort(row)[-4:]
        total = row[indices].sum()
        assert total > 0
        for gi in indices:
            if row[gi] > 1e-6:
                groups[gi].add([i], float(row[gi] / total), "REPLACE")
    print("NIA_SEAMS", len(clusters), "PINNED", len(pinned), flush=True)


def scale(arm, mesh, height):
    points = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    lo = Vector(tuple(min(v[i] for v in points) for i in range(3)))
    hi = Vector(tuple(max(v[i] for v in points) for i in range(3)))
    factor = height / (hi.z - lo.z)
    # The armature and mesh share world coordinates and an identity transform.
    for v in mesh.data.vertices:
        v.co = (v.co - Vector((0, 0, lo.z))) * factor
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for b in arm.data.edit_bones:
        b.head = (b.head - Vector((0, 0, lo.z))) * factor
        b.tail = (b.tail - Vector((0, 0, lo.z))) * factor
    bpy.ops.object.mode_set(mode="OBJECT")


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", choices=("nia", "marcus"), required=True)
    parser.add_argument("--out", required=True)
    a = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if a.name == "marcus":
        arm, parts = prepare_marcus()
        bpy.ops.wm.save_as_mainfile(filepath=str(out / "marcus-modular.blend"))
        mesh = join(parts, arm)
        scale(arm, mesh, 1.78)
    else:
        bpy.ops.wm.open_mainfile(filepath=str(ROOT / "assets/skaters/nia/raw/nia-animated.blend"))
        arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        mesh = next(o for o in bpy.data.objects if o.type == "MESH")
        reset(arm)
        assert len(mesh.data.uv_layers) == 1
        repair_nia_seams(mesh)
    arm.name = a.name.capitalize() + "Rig"
    mesh.name = a.name.capitalize()
    reset(arm)
    feet = [arm.data.bones["mixamorig:" + side + "Foot"].head_local for side in ("Left", "Right")]
    cfg = {"arm": arm.name, "mesh": mesh.name,
           "feet": (feet[0].x, feet[1].x, (feet[0].y + feet[1].y) / 2),
           "continuous_foot_rotation": True}
    scope = {"__name__": "skater_clips", "SKATER_CFG": cfg}
    exec(compile((HERE / "nia_clips.py").read_text(), "nia_clips.py", "exec"), scope)
    scope["build_all"]()
    scope["prune_static_channels"]()
    bpy.ops.wm.save_as_mainfile(filepath=str(out / (a.name + "-review.blend")))
    scope["export"](str(out / (a.name + "-review.glb")), True,
                    export_image_format="JPEG", export_jpeg_quality=88)
    print("REPAIR_EXPORT", a.name, flush=True)


if __name__ == "__main__":
    main()
