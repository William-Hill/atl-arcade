"""Keep Marcus's knee pads and wristbands closed when the joints bend.

Two defects caused the knee pad gaps in `bail`:

1. The pad weights changed from the shin to the thigh across the full pad.
   The 50 percent line went through the middle of the cap, so the cap
   folded in half in a deep bend and opened at its sides.
2. The knee skin under each pad had other weights than the pad. In a deep
   bend, the skin came through the pad between the cap and the straps.

The fix uses one spatial weight field for each pad. The cap and the lower
strap follow the shin. The change to the thigh occurs across the upper strap.

Each wristband gets the same cover step as the pads. The wristband weights
are smoothed across the band, and the skin under the band takes the band
weights. This keeps the forearm and hand skin inside the band when the wrist
bends.

The cover step changes the skin weights less with the distance from the
part above. All weights are a function of the rest position, so the seams to
the thigh, the calf, the forearm, and the hand stay closed.
"""
import numpy as np
from mathutils.kdtree import KDTree

# Material numbers of the parts on each side (tripo_part_<n>_material).
MARCUS_PADS = {"Left": (9,), "Right": (15, 12, 22)}
MARCUS_CUFFS = {"Left": (19,), "Right": (20,)}


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def part_vertices(mesh, numbers):
    slots = {f"tripo_part_{n}_material" for n in numbers}
    index = {i for i, s in enumerate(mesh.material_slots) if s.name in slots}
    assert len(index) == len(numbers), f"Missing parts: {numbers}"
    return sorted({v for p in mesh.data.polygons if p.material_index in index for v in p.vertices})


def _rows(mesh, indices):
    """Return the weights of the vertices as a list of {group name: weight}."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    return [{names[g.group]: g.weight for g in mesh.data.vertices[i].groups if g.weight > 0}
            for i in indices]


def _write(mesh, index, weights, count=4):
    keep = sorted(((w, n) for n, w in weights.items() if w > 1e-6), reverse=True)[:count]
    total = sum(w for w, _ in keep)
    for g in [g.group for g in mesh.data.vertices[index].groups]:
        mesh.vertex_groups[g].remove([index])
    for w, name in keep:
        mesh.vertex_groups[name].add([index], w / total, "REPLACE")


def _tree(points, indices):
    tree = KDTree(len(indices))
    for row, i in enumerate(indices):
        tree.insert(points[i], row)
    tree.balance()
    return tree


def _smooth(points, indices, rows, tree, sigma, radius):
    """Average the weights of nearby vertices of the same parts."""
    out = []
    for i in indices:
        near = tree.find_range(points[i], radius)
        total = {}
        norm = 0.0
        for _, r, d in near:
            g = float(np.exp(-d * d / (2 * sigma * sigma)))
            norm += g
            for name, w in rows[r].items():
                total[name] = total.get(name, 0.0) + g * w
        out.append({n: w / norm for n, w in total.items()})
    return out


def _cover(mesh, points, indices, rows, skip, inner, outer):
    """Blend each vertex near the parts toward the weights of the nearest part vertex."""
    tree = _tree(points, indices)
    covered = 0
    own_rows = _rows(mesh, range(len(points)))
    for i, point in enumerate(points):
        if i in skip:
            continue
        _, row, distance = tree.find(point)
        if distance >= outer:
            continue
        share = float(smoothstep(1 - (distance - inner) / (outer - inner)))
        own = own_rows[i]
        part = rows[row]
        mixed = {n: own.get(n, 0.0) * (1 - share) + part.get(n, 0.0) * share
                 for n in set(own) | set(part)}
        _write(mesh, i, mixed)
        covered += 1
    return covered


def close_pads(arm, mesh, pads=MARCUS_PADS, band=(0.0, .06), sigma=.01, radius=.025,
               inner=.012, outer=.03):
    """Set one weight field on each pad. Give the covered skin the pad weights.

    band: the start and the end of the thigh share above the knee joint, in
    meters along the thigh.
    """
    points = np.array([v.co[:] for v in mesh.data.vertices])
    sides = {side: part_vertices(mesh, numbers) for side, numbers in pads.items()}
    skip = set().union(*sides.values())
    report = {}
    for side, indices in sides.items():
        thigh_name, shin_name = "mixamorig:" + side + "UpLeg", "mixamorig:" + side + "Leg"
        before = _rows(mesh, indices)
        outside = max(1 - b.get(thigh_name, 0) - b.get(shin_name, 0) for b in before)
        assert outside < .05, f"The {side} pad has weights outside the knee: {outside}"
        knee = np.array(arm.data.bones[shin_name].head_local)
        hip = np.array(arm.data.bones[thigh_name].head_local)
        up = (hip - knee) / np.linalg.norm(hip - knee)
        height = (points[indices] - knee) @ up
        thigh = smoothstep((height - band[0]) / (band[1] - band[0]))
        field = [{thigh_name: float(t), shin_name: float(1 - t)} for t in thigh]
        # Remove small steps between the pad parts.
        rows = _smooth(points, indices, field, _tree(points, indices), sigma, radius)
        for i, row in zip(indices, rows):
            _write(mesh, i, row)
        change = max(abs(r.get(shin_name, 0) - b.get(shin_name, 0)) for r, b in zip(rows, before))
        covered = _cover(mesh, points, indices, rows, skip, inner, outer)
        report[side] = {"pad_vertices": len(indices), "covered_vertices": covered,
                        "max_shin_weight_change": round(change, 3)}
    return report


def close_cuffs(mesh, cuffs=MARCUS_CUFFS, sigma=.008, radius=.02, inner=.006, outer=.018):
    """Smooth each wristband's weights. Give the skin under it the band weights."""
    points = np.array([v.co[:] for v in mesh.data.vertices])
    sides = {side: part_vertices(mesh, numbers) for side, numbers in cuffs.items()}
    skip = set().union(*sides.values())
    report = {}
    for side, indices in sides.items():
        before = _rows(mesh, indices)
        rows = _smooth(points, indices, before, _tree(points, indices), sigma, radius)
        for i, row in zip(indices, rows):
            _write(mesh, i, row)
        covered = _cover(mesh, points, indices, rows, skip, inner, outer)
        report[side] = {"band_vertices": len(indices), "covered_vertices": covered}
    return report
