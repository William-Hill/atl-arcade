"""Keyed clips for the Meshy humanoid rig, posed by two-bone IK (imported by
people.py): "push" (the walk, hands on a stroller handle) and "ride" (seated on
the city bike, hands on the grips, feet on the pedals). Targets are glTF
meters in the person's frame (+y up, +z forward); the props sit at the same
origin as the person (docs/people-props.md). The IK is solved here, not with
Blender's IK constraint: the glTF importer leaves the bone tails meters away
from the child joints, and the constraint solves for the tails."""
import math

import bpy
from mathutils import Matrix, Vector

# Measured on assets/people/stroller.glb and assets/props/beltline/city_bike.glb.
STROLLER_HANDLE = (0.19, 1.08, 0.20)  # stroller origin 0.64 m in front of the person
BIKE_SADDLE = (0.0, 0.94, -0.30)
BIKE_GRIP = (0.26, 0.98, 0.25)  # swept-back grips, behind the stem
BIKE_PEDAL = (0.14, 0.36, 0.0)  # ankle circle center, 7 cm over the crank axle
PEDAL_R = 0.137  # the crank arm (prop_wheels.py)
PUSH_LEAN = (8, 6, 4)  # leaning into the handle
ARM_POLE = (0.7, 0.4, -0.6)  # elbows bend down, out and back
LEG_POLE = (0.15, 0.6, 1.5)  # knees bend forward


def B(p):
    """glTF (x, y up, z forward) to Blender world (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def _swing(arm, pb, pivot, frm, to):
    """Turn pose bone pb (and its children) about pivot so direction frm
    points along to; armature space."""
    r = frm.rotation_difference(to).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(pivot) @ r @ Matrix.Translation(-pivot) @ pb.matrix
    bpy.context.view_layer.update()


def two_bone(arm, upper, lower, end, target_w, pole_w):
    """Put the head of end on target (world), bending lower toward pole."""
    inv = arm.matrix_world.inverted()
    t, pole = inv @ target_w, inv @ pole_w
    U, L, E = (arm.pose.bones[n] for n in (upper, lower, end))
    a, b, c = U.head.copy(), L.head.copy(), E.head.copy()
    l1, l2 = (b - a).length, (c - b).length
    d = max(1e-4, min((t - a).length, (l1 + l2) * 0.999))
    n = (t - a).normalized()
    m = (pole - a) - n * (pole - a).dot(n)
    m = m.normalized() if m.length > 1e-6 else (b - a - n * (b - a).dot(n)).normalized()
    ca = max(-1.0, min(1.0, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
    elbow = a + n * (l1 * ca) + m * (l1 * math.sqrt(1 - ca * ca))
    _swing(arm, U, a, b - a, elbow - a)
    b, c = L.head.copy(), E.head.copy()
    _swing(arm, L, b, c - b, t - b)


def _solo(arm):
    """Mute the NLA tracks (the clips made so far) so sampling an action
    gives that action alone; returns the call that unmutes them. Without it
    the walk sampled for push came out mixed with the other tracks, and the
    far hand left the handle for half the loop."""
    tracks = list(arm.animation_data.nla_tracks)
    muted = [t.mute for t in tracks]
    for t in tracks:
        t.mute = True

    def restore():
        for t, m in zip(tracks, muted):
            t.mute = m

    return restore


def _set_action(arm, act):
    arm.animation_data.action = act
    if act is not None and hasattr(arm.animation_data, "action_slot") and act.slots:
        arm.animation_data.action_slot = act.slots[0]


def _sample(arm, act, f):
    """The pose basis of every bone at frame f of act."""
    _set_action(arm, act)
    bpy.context.scene.frame_set(f)
    out = {b.name: (b.rotation_quaternion.copy(), b.location.copy()) for b in arm.pose.bones}
    _set_action(arm, None)
    return out


def _apply(arm, basis):
    for b in arm.pose.bones:
        b.rotation_mode = "QUATERNION"
        b.rotation_quaternion, b.location = basis[b.name]
    bpy.context.view_layer.update()


def _key(arm, name, frames):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    _set_action(arm, act)
    for f, basis in frames.items():
        for b in arm.pose.bones:
            b.rotation_quaternion, b.location = basis[b.name]
            b.keyframe_insert("rotation_quaternion", frame=f)
            if b.name == "Hips":
                b.keyframe_insert("location", frame=f)
    _set_action(arm, None)
    return act


def _grab(arm):
    return {b.name: (b.rotation_quaternion.copy(), b.location.copy()) for b in arm.pose.bones}


def _mirror(p, k):
    return (p[0] * k, p[1], p[2])


def _lean(arm, degs, names=("Spine02", "Spine01", "Spine")):
    """Bend the spine forward about the side axis, degs per bone."""
    for name, deg in zip(names, degs):
        pb = arm.pose.bones[name]
        r = Matrix.Rotation(math.radians(deg), 4, "X")
        pb.matrix = Matrix.Translation(pb.head) @ r @ Matrix.Translation(-pb.head) @ pb.matrix
        bpy.context.view_layer.update()


def push_clip(arm):
    """The walk with both hands on the stroller handle (the arms stop
    swinging), one walk cycle."""
    walk = bpy.data.actions["walk"]
    f0, f1 = (round(x) for x in walk.frame_range)
    solo = _solo(arm)
    frames, miss = {}, {}
    for f in range(f0, f1 + 1):
        _apply(arm, _sample(arm, walk, f))
        _lean(arm, PUSH_LEAN)
        for s, k in (("Left", 1), ("Right", -1)):
            two_bone(arm, f"{s}Arm", f"{s}ForeArm", f"{s}Hand", B(_mirror(STROLLER_HANDLE, k)), B(_mirror(ARM_POLE, k)))
            miss[s] = max(miss.get(s, 0), (arm.matrix_world @ arm.pose.bones[f"{s}Hand"].head - B(_mirror(STROLLER_HANDLE, k))).length)
        frames[f - f0 + 1] = _grab(arm)
    solo()
    print("push: hand miss m", {k: round(v, 3) for k, v in miss.items()})
    return _key(arm, "push", frames), f1 - f0


def ride_clip(arm, lean=(24, 20, 14), n=30):
    """On the city bike: hips on the saddle, back leaning forward, hands on
    the grips, ankles turning the pedals half a turn apart, 1 s loop."""
    idle = bpy.data.actions["idle"]
    solo, miss = _solo(arm), {}
    base = _sample(arm, idle, round(idle.frame_range[0]))
    spine = ("Spine02", "Spine01", "Spine")
    frames = {}
    for f in range(1, n + 2):
        _apply(arm, base)
        for name, deg in zip(spine, lean):
            pb = arm.pose.bones[name]
            r = Matrix.Rotation(math.radians(deg), 4, "X")  # about the side axis: forward
            pb.matrix = Matrix.Translation(pb.head) @ r @ Matrix.Translation(-pb.head) @ pb.matrix
            bpy.context.view_layer.update()
        hips = arm.pose.bones["Hips"]
        m = hips.matrix.copy()
        m.translation = arm.matrix_world.inverted() @ B(BIKE_SADDLE)
        hips.matrix = m
        bpy.context.view_layer.update()
        for s, k in (("Left", 1), ("Right", -1)):
            two_bone(arm, f"{s}Arm", f"{s}ForeArm", f"{s}Hand", B(_mirror(BIKE_GRIP, k)), B(_mirror(ARM_POLE, k)))
            ph = 2 * math.pi * (f - 1) / n + (0 if k == 1 else math.pi)
            # ph 0 is the top of the turn, then forward (+z): pedaling forward;
            # city_bike's crank turns with the same phase (prop_wheels.py).
            ankle = (BIKE_PEDAL[0] * k, BIKE_PEDAL[1] + PEDAL_R * math.cos(ph), BIKE_PEDAL[2] + PEDAL_R * math.sin(ph))
            two_bone(arm, f"{s}UpLeg", f"{s}Leg", f"{s}Foot", B(ankle), B(_mirror(LEG_POLE, k)))
            for bone, t in ((f"{s}Hand", B(_mirror(BIKE_GRIP, k))), (f"{s}Foot", B(ankle))):
                miss[bone] = max(miss.get(bone, 0), (arm.matrix_world @ arm.pose.bones[bone].head - t).length)
        frames[f] = _grab(arm)
    solo()
    print("ride: miss m", {k: round(v, 3) for k, v in miss.items()})
    return _key(arm, "ride", frames), n
