"""Fit Marcus's finger joints to his hand mesh and weight each finger.

The Marcus rig came from Nia's rig. Its finger joints sat 0.13 m behind the
wrist, inside the forearm, and no vertex had a finger weight. The hands moved
as one rigid region.

This module finds the five fingers on each hand mesh. It cuts the hand at a
geodesic distance from the wrist. At the correct distance, the cut leaves five
separate regions: the thumb and four fingers. The module puts each finger
chain on the center line of its region. It then splits the existing hand
weight between the hand and the finger joints. The forearm weight at the
wrist does not change, so the wrist seam does not change.
"""
import heapq
import math

import bpy
import numpy as np
from mathutils import Vector

FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")
# Joint positions as fractions of the distance from joint 1 to the tip.
FINGER_JOINTS = (0.0, 0.43, 0.73, 1.0)
THUMB_JOINTS = (0.0, 0.40, 0.70, 1.0)


def smooth(a, b, value):
    t = min(1.0, max(0.0, (value - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def hand_slot(mesh, side):
    """Return the material slot that has the most weight on the hand joint."""
    group = mesh.vertex_groups["mixamorig:" + side + "Hand"].index
    totals = {}
    for polygon in mesh.data.polygons:
        for i in polygon.vertices:
            for g in mesh.data.vertices[i].groups:
                if g.group == group and g.weight > .5:
                    totals[polygon.material_index] = totals.get(polygon.material_index, 0) + 1
    return max(totals, key=totals.get)


def _graph(mesh, slot):
    """Return the hand vertices and a welded edge graph for one material."""
    vertices = sorted({i for p in mesh.data.polygons if p.material_index == slot for i in p.vertices})
    points = np.array([mesh.data.vertices[i].co[:] for i in vertices])
    # UV seams split vertices. Weld coincident vertices for the graph only.
    key = {}
    weld = []
    for p in points:
        k = tuple(np.round(p / 1e-4).astype(int))
        weld.append(key.setdefault(k, len(key)))
    weld = np.array(weld)
    local = {v: n for n, v in enumerate(vertices)}
    edges = {}
    for polygon in mesh.data.polygons:
        if polygon.material_index != slot:
            continue
        for a, b in polygon.edge_keys:
            wa, wb = weld[local[a]], weld[local[b]]
            if wa != wb:
                length = float(np.linalg.norm(points[local[a]] - points[local[b]]))
                edges.setdefault(wa, {})[wb] = length
                edges.setdefault(wb, {})[wa] = length
    return vertices, points, weld, edges, len(key)


def _components(nodes, edges):
    seen, out = set(), []
    for start in nodes:
        if start in seen:
            continue
        stack, part = [start], []
        seen.add(start)
        while stack:
            n = stack.pop()
            part.append(n)
            for m in edges.get(n, {}):
                if m in nodes and m not in seen:
                    seen.add(m)
                    stack.append(m)
        out.append(part)
    return out


def find_fingers(arm, mesh, side):
    """Return the hand vertices and the five finger regions of one hand."""
    slot = hand_slot(mesh, side)
    vertices, points, weld, edges, count = _graph(mesh, slot)
    hand = arm.data.bones["mixamorig:" + side + "Hand"]
    axis = np.array((hand.tail_local - hand.head_local).normalized())
    welded = np.zeros((count, 3))
    welded[weld] = points
    along = (welded - np.array(hand.head_local)) @ axis
    # Geodesic distance from the wrist edge of the hand mesh.
    distance = np.full(count, math.inf)
    queue = []
    for n in np.nonzero(along < along.min() + .01)[0]:
        distance[n] = 0.0
        queue.append((0.0, int(n)))
    heapq.heapify(queue)
    while queue:
        d, n = heapq.heappop(queue)
        if d > distance[n]:
            continue
        for m, length in edges.get(n, {}).items():
            if d + length < distance[m]:
                distance[m] = d + length
                heapq.heappush(queue, (d + length, m))
    assert np.isfinite(distance).all(), f"The {side} hand mesh is not connected."
    leaves = _leaf_regions(distance, edges)
    assert len(leaves) >= 5, f"Found {len(leaves)} finger regions on the {side} hand."
    leaves = sorted(leaves, key=lambda leaf: len(leaf[0]), reverse=True)[:5]
    parts = [leaf[0] for leaf in leaves]
    # The thumb starts nearest the wrist. Sort the other four by their
    # distance from the thumb: index, middle, ring, pinky.
    centers = [welded[p].mean(axis=0) for p in parts]
    thumb = min(range(5), key=lambda i: along[parts[i]].mean())
    rest = sorted((i for i in range(5) if i != thumb),
                  key=lambda i: np.linalg.norm(centers[i] - centers[thumb]))
    regions = {}
    for name, index in zip(FINGERS, [thumb] + rest):
        part, cut = leaves[index]
        regions[name] = {"nodes": part, "distance": distance[part], "cut": cut}
    return {"slot": slot, "vertices": vertices, "weld": weld, "welded": welded,
            "distance": distance, "regions": regions}


def _leaf_regions(distance, edges, minimum=6):
    """Return each tip region at its largest size before it joins another region.

    Add the vertices from the largest distance down. A region starts at a tip.
    When two regions of `minimum` vertices or more join, each region that
    started at a tip is complete. Small regions join the larger one.
    """
    parent = {}
    members = {}
    leaf = {}

    def root(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    done = []
    for n in np.argsort(-distance):
        n = int(n)
        parent[n], members[n], leaf[n] = n, [n], True
        for m in edges.get(n, {}):
            if m not in parent:
                continue
            a, b = root(n), root(m)
            if a == b:
                continue
            big = len(members[a]) >= minimum and len(members[b]) >= minimum
            if big:
                for r in (a, b):
                    if leaf[r]:
                        done.append((list(members[r]), float(distance[n])))
            if len(members[a]) < len(members[b]):
                a, b = b, a
            parent[b] = a
            members[a].extend(members.pop(b))
            leaf[a] = False if big else leaf[a]
    return done


def _chain(welded, region, thumb):
    """Return four joint positions on the center line of one finger region."""
    pts = welded[region["nodes"]]
    dist = region["distance"]
    cut = region["cut"]
    center = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - center)
    direction = vt[0]
    tip = pts[dist.argmax()]
    if (tip - center) @ direction < 0:
        direction = -direction
    base = pts[dist < cut + .006].mean(axis=0)
    t_base = (base - center) @ direction
    t_tip = (tip - center) @ direction - .004
    visible = t_tip - t_base
    # The knuckle is inside the palm, behind the web of the finger.
    start = t_base - visible * (.55 if thumb else .28)
    fractions = THUMB_JOINTS if thumb else FINGER_JOINTS
    joints = [center + direction * (start + (t_tip - start) * f) for f in fractions]
    return joints, direction


def fit_fingers(arm, mesh, sides=("Left", "Right")):
    """Move the finger joints onto the finger regions. Return the fit data."""
    fits = {side: find_fingers(arm, mesh, side) for side in sides}
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = arm.data.edit_bones
    report = {}
    for side, fit in fits.items():
        chains = {}
        for name in FINGERS:
            joints, direction = _chain(fit["welded"], fit["regions"][name], name == "Thumb")
            chains[name] = joints
            for number in range(1, 5):
                bone = bones["mixamorig:" + side + "Hand" + name + str(number)]
                roll_axis = bone.z_axis.copy()
                bone.use_connect = False
                head = Vector(joints[number - 1])
                if number < 4:
                    tail = Vector(joints[number])
                else:
                    tail = head + Vector(direction) * (.4 * (Vector(joints[3]) - Vector(joints[2])).length)
                bone.head, bone.tail = head, tail
                bone.align_roll(roll_axis)
            for number in range(2, 5):
                bones["mixamorig:" + side + "Hand" + name + str(number)].use_connect = True
        fit["chains"] = chains
        report[side] = {"cuts_m": {n: round(r["cut"], 4) for n, r in fit["regions"].items()},
                        "lengths_m": {n: round(float(np.linalg.norm(c[3] - c[0])), 4)
                                      for n, c in chains.items()}}
    bpy.ops.object.mode_set(mode="OBJECT")
    return fits, report


def _segment(point, a, b):
    ab = b - a
    t = float(np.clip((point - a) @ ab / (ab @ ab), 0, 1))
    return t, float(np.linalg.norm(point - (a + ab * t)))


def finger_shares(point, chain, blend):
    """Split one unit of weight along a finger chain. Joint 0 is the hand."""
    # Distance along the chain from joint 1, in meters.
    lengths = [float(np.linalg.norm(chain[i + 1] - chain[i])) for i in range(3)]
    best = None
    for i in range(3):
        t, d = _segment(point, chain[i], chain[i + 1])
        if best is None or d < best[1] - 1e-9:
            best = (sum(lengths[:i]) + t * lengths[i], d)
    s = best[0]
    # Points behind joint 1 project to s = 0. Use the signed axial offset.
    axis = (chain[1] - chain[0]) / lengths[0]
    behind = float((point - chain[0]) @ axis)
    if behind < 0:
        s = behind
    shares = [1.0, 0.0, 0.0, 0.0]
    for joint in range(1, 4):
        at = sum(lengths[:joint - 1])
        w = smooth(at - blend, at + blend, s)
        moved = shares[joint - 1] * w
        shares[joint - 1] -= moved
        shares[joint] += moved
    return shares


def weight_fingers(arm, mesh, fits, blend=.006, palm_reach=.012):
    """Split the hand weight of each hand vertex between the hand and the fingers."""
    report = {}
    for side, fit in fits.items():
        hand_group = mesh.vertex_groups["mixamorig:" + side + "Hand"]
        groups = {name: [mesh.vertex_groups.get("mixamorig:" + side + "Hand" + name + str(n))
                         or mesh.vertex_groups.new(name="mixamorig:" + side + "Hand" + name + str(n))
                         for n in (1, 2, 3)] for name in FINGERS}
        owner = {}
        for name, region in fit["regions"].items():
            for n in region["nodes"]:
                owner[n] = name
        changed = 0
        maximum = {name: 0.0 for name in FINGERS}
        for local, index in enumerate(fit["vertices"]):
            vertex = mesh.data.vertices[index]
            hand = next((g.weight for g in vertex.groups if g.group == hand_group.index), 0.0)
            if hand <= 1e-6:
                continue
            point = np.array(vertex.co[:])
            node = fit["weld"][local]
            name = owner.get(node)
            if name is None:
                # A palm vertex. The nearest finger takes a share near its knuckle.
                options = []
                for finger, chain in fit["chains"].items():
                    t, d = _segment(point, chain[0], chain[1])
                    options.append((d, finger))
                d, name = min(options)
                chain = fit["chains"][name]
                shares = finger_shares(point, chain, blend * 2)
                reach = palm_reach * (2 if name == "Thumb" else 1)
                fade = 1 - smooth(reach, reach * 2, d)
                shares = [shares[0] + (1 - fade) * sum(shares[1:])] + [s * fade for s in shares[1:]]
            else:
                shares = finger_shares(point, fit["chains"][name], blend)
            if shares[0] > 1 - 1e-4:
                continue
            hand_group.add([index], hand * shares[0], "REPLACE")
            if shares[0] * hand <= 1e-6:
                hand_group.remove([index])
            for group, share in zip(groups[name], shares[1:]):
                if share * hand > 1e-6:
                    group.add([index], hand * share, "REPLACE")
            maximum[name] = max(maximum[name], max(shares[1:]))
            changed += 1
        report[side] = {"vertices_changed": changed,
                        "max_finger_share": {k: round(v, 3) for k, v in maximum.items()}}
    limit_influences(mesh, 4)
    return report


def limit_influences(mesh, count):
    """Keep the largest influences on each vertex and normalize them."""
    for vertex in mesh.data.vertices:
        groups = sorted(((g.weight, g.group) for g in vertex.groups if g.weight > 0), reverse=True)
        keep = groups[:count]
        total = sum(w for w, _ in keep)
        for weight, group in groups[count:]:
            mesh.vertex_groups[group].remove([vertex.index])
        if total > 0:
            for weight, group in keep:
                mesh.vertex_groups[group].add([vertex.index], weight / total, "REPLACE")
