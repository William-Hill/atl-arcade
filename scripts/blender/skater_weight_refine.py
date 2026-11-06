"""Fit Marcus's shorts weights to the forward poses."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).parent))
from skater_rig_audit import activate


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b.")
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if args.out.suffix != ".npz":
        parser.error("--out must use the .npz extension.")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH"
                and any(m.type == "ARMATURE" for m in o.modifiers))
    activate(arm, None)
    slot = next(i for i, s in enumerate(mesh.material_slots) if s.name == "tripo_part_1_material")
    polygons = [p for p in mesh.data.polygons if p.material_index == slot]
    ids = np.array(sorted({i for p in polygons for i in p.vertices}))
    positions = np.array([mesh.data.vertices[int(i)].co for i in ids])
    unique, inverse = np.unique(np.round(positions, 5), axis=0, return_inverse=True)
    first = np.unique(inverse, return_index=True)[1]
    edges = np.array(sorted({tuple(sorted(e)) for p in polygons for e in p.edge_keys}))
    edges = np.unique(np.sort(inverse[np.searchsorted(ids, edges)], axis=1), axis=0)
    edges = edges[edges[:, 0] != edges[:, 1]]
    lengths = np.linalg.norm(unique[edges[:, 0]] - unique[edges[:, 1]], axis=1)
    edges, lengths = edges[lengths > .003], lengths[lengths > .003]
    assert len(edges) > 1000, "The shorts mesh has too few edges for this pass."
    a, b = edges.T
    names = ("Hips", "LeftUpLeg", "RightUpLeg")
    groups = {mesh.vertex_groups["mixamorig:" + name].index: column for column, name in enumerate(names)}
    initial = np.zeros((len(ids), 3))
    for row, index in enumerate(ids):
        for group in mesh.data.vertices[int(index)].groups:
            if group.group in groups:
                initial[row, groups[group.group]] = group.weight
    assert np.all(initial.sum(axis=1) > .9)
    initial /= initial.sum(axis=1, keepdims=True)
    weights = initial[first, 1:].copy()
    outside = sorted(set(range(len(mesh.data.vertices))) - set(ids))
    tree = KDTree(len(outside))
    for i in outside:
        tree.insert(mesh.data.vertices[i].co, i)
    tree.balance()
    pins = np.array([tree.find(point)[2] < .01 for point in positions])[first]
    pins |= (np.abs(unique[:, 0]) < .03) & (unique[:, 2] > .88)
    assert pins.sum() > 0
    fixed = weights.copy()
    action = bpy.data.actions["push"]
    assert tuple(action.frame_range) == (0, 48), "This pass requires Marcus's 48-frame push."
    activate(arm, action)
    samples = []
    points = np.column_stack([positions[first], np.ones(len(first))])
    frames = list(range(0, 49, 3))
    for frame in frames:
        bpy.context.scene.frame_set(frame)
        transforms = [np.array(arm.pose.bones["mixamorig:" + name].matrix @
                              arm.data.bones["mixamorig:" + name].matrix_local.inverted()) for name in names]
        samples.append(np.array([(points @ matrix.T)[:, :3] for matrix in transforms]))
    samples = np.array(samples)
    hip = samples[:, 0]
    left_delta, right_delta = samples[:, 1] - hip, samples[:, 2] - hip
    count = len(unique)
    degree = np.maximum(np.bincount(a, minlength=count) + np.bincount(b, minlength=count), 1)
    momentum, variance = np.zeros_like(weights), np.zeros_like(weights)
    best_score, best, report = float("inf"), None, None
    for step in range(1501):
        posed = hip + left_delta * weights[None, :, :1] + right_delta * weights[None, :, 1:]
        vectors = posed[:, b] - posed[:, a]
        distance = np.linalg.norm(vectors, axis=2)
        ratios = distance / lengths
        if step % 100 == 0:
            p99 = float(np.percentile(ratios, 99, axis=1).max())
            p01 = float(np.percentile(ratios, 1, axis=1).min())
            score = p99 + max(0, .6 - p01)
            if score < best_score:
                best_score, best = score, weights.copy()
                report = {"step": step, "p99": p99, "p01": p01,
                          "max": float(ratios.max()), "min": float(ratios.min())}
        error = ratios - 1
        derivative = error + 8 * np.maximum(error - .15, 0) + 2 * np.minimum(error + .25, 0)
        coefficient = derivative / (lengths * np.maximum(distance, 1e-8))
        gradients = []
        for delta in (left_delta, right_delta):
            ga = -(coefficient * np.sum(vectors * delta[:, a], axis=2)).mean(axis=0)
            gb = (coefficient * np.sum(vectors * delta[:, b], axis=2)).mean(axis=0)
            gradient = np.bincount(a, weights=ga, minlength=count) + np.bincount(b, weights=gb, minlength=count)
            gradients.append(gradient / degree)
        gradient = np.array(gradients).T
        momentum = .9 * momentum + .1 * gradient
        variance = .999 * variance + .001 * gradient ** 2
        weights -= .003 * (momentum / (1 - .9 ** (step + 1))) / (
            np.sqrt(variance / (1 - .999 ** (step + 1))) + 1e-8)
        weights = np.maximum(weights, 0)
        weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1)
        weights[pins] = fixed[pins]
    assert best is not None
    full = np.column_stack([1 - best.sum(axis=1), best])[inverse]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, positions=positions, weights=full, bone_names=np.array(names))
    report.update({"source": str(args.source.resolve()), "frames": frames, "edges": len(edges),
                   "fixed_vertices": int(pins.sum()),
                   "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest()})
    args.out.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    print("SHORTS_WEIGHTS", json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
