# Skater repair review

Run these scripts in a separate background Blender process. They reject execution
in the open Blender application.

The sources for repaired geometry are:

- `assets/skaters/nia/raw/review-v4/nia-review.glb`
- `assets/skaters/marcus/raw/review-v6/marcus-review.glb`

Each directory contains a `.blend`, a contact sheet, two MP4 videos, an audit,
and provenance. Marcus also has a modular `.blend` with 26 mesh parts.
The game still uses its existing `skater.glb` files.

## Forward motion and Nia's arms

The user rejected the shared motion in the geometry sources.
The user judged the later Tripo tests as dances, not forward strides.
Keep those tests in `raw/tripo-motion-v1/` for reference.

`skater_forward_motion.py` builds two new clips in `raw/forward-v1/`:

- `push`: alternate the drive leg and support leg. Lift the free skate during recovery.
- `coast`: keep both skates on the floor with a small weight shift.

Nia uses a two-second cycle. Marcus uses a 1.6-second cycle.
They use different lead feet, arm poses, stride lengths, and recovery heights.
The script calibrates the knee pole angles for each rig.
It places each skate from its sole geometry.

The script also increases Nia's upper arms to 0.26 m and her forearms to 0.23 m.
It applies the same deformation to the mesh and skeleton.
Her arm span changes from 1.23 m to 1.51 m at a height of 1.70 m.

Build and check Nia:

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_forward_motion.py -- \
  --name nia --out assets/skaters/nia/raw/forward-v1

"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_motion_audit.py -- \
  assets/skaters/nia/raw/forward-v1/nia-forward.glb \
  --report assets/skaters/nia/raw/forward-v1/motion-audit.json \
  --clips coast push --check-arms --check-support

"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_rig_audit.py -- \
  assets/skaters/nia/raw/forward-v1/nia-forward.glb \
  --report assets/skaters/nia/raw/forward-v1/rig-audit.json --clips coast push
```

Use `marcus` in the paths and name for Marcus. Omit `--check-arms` for Marcus.
Render each view:

```sh
for view in front side; do
  "$BLENDER" -b --factory-startup --python-exit-code 1 \
    -P scripts/blender/skater_review_render.py -- \
    assets/skaters/nia/raw/forward-v1/nia-forward.glb \
    --out "assets/skaters/nia/raw/forward-v1/$view" \
    --clips push coast --view "$view" --floor --travel-speed 2 --video
done
python3 scripts/blender/skater_motion_package.py --name nia --kind forward
```

Use `--travel-speed 2.5` for the Marcus review.
Travel exists only in the review scene. The game controller supplies travel during gameplay.
Each MP4 shows the front view on the left and the side view on the right.
Each MP4 repeats the clip three times.

The new files contain two clips. They still require user review and a full clip rebuild.

## Inputs and repairs

Nia uses `raw/nia-animated.blend` as the input. This file contains the previous
UV correction. The repair shares weights at adjacent material boundaries,
diffuses those weights into the surfaces, and binds each skate assembly to its
foot bone. It preserves the source textures.

Marcus uses `raw/marcus-rig-work.blend` as the input. The repair selects only
`MARCUS_RIG_WORK` and its armature. It resets the pose and replaces the joint
coordinates and weights. One continuous spatial field supplies the body weights
for all parts. Coincident vertices are welded before reduction; face corners
retain their UV coordinates. The original 1,954,933-triangle source remains intact.

Both builds use quaternion foot targets in `nia_clips.py`. This prevents the
Euler discontinuity that made the right foot spin in `coast`.

## Rebuild

From the repository root:

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_repair.py -- \
  --name marcus --out assets/skaters/marcus/raw/review-v6
```

Use `--name nia` and `assets/skaters/nia/raw/review-v4` for Nia.

## Verify and render

```sh
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_rig_audit.py -- \
  assets/skaters/marcus/raw/review-v6/marcus-review.glb \
  --report assets/skaters/marcus/raw/review-v6/rig-audit.json --all-clips

"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_review_render.py -- \
  assets/skaters/marcus/raw/review-v6/marcus-review.glb \
  --out assets/skaters/marcus/raw/review-v6/video-frames --video

python3 scripts/blender/skater_review_package.py \
  assets/skaters/marcus/raw/review-v6 --name marcus
```

The package script requires Pillow, FFmpeg, and FFprobe.

## Evidence and limits

The original Marcus GLB failed: adjacent parts separated by 0.73055 m.
Its jacket had only `Spine2` weights. Both shorts legs had only `RightUpLeg`
weights. Automatic weights failed and retained these rigid assignments.

The historical audit sampled part separation every six Blender frames at 24 fps
across all 24 clips. It checks foot rotation at every Blender frame.
The current GLB audit uses 30 fps and records that rate in its report.
Videos import the GLB at 30 fps and render all frames of `coast` and `bail`.
The package script checks each encoded video frame count.

| Measure | Rejected output | Current output |
| --- | ---: | ---: |
| Marcus separation increase | 0.73055 m | 0.00571 m |
| Nia separation increase | 0.13224 m | 0.00002 m |
| Nia largest right-foot step in `coast` | 51.79 degrees | 5.01 degrees |

The separation check measures growth between vertices that start within 8 mm
on different materials. It does not prove the absence of cloth intersections,
correct anatomy, or visual approval.

Marcus's fingers currently follow the hand as one region. Independent finger
articulation and facial animation remain outside this body repair.
The candidate assets still require user review and game verification.

Earlier review directories and `raw/videos/` contain rejected outputs.
The `review-v5` Marcus texture-bake experiment also failed visual review.

## Forward v2 — current motion review

Use Blender for these corrections. The defects came from the rest joints,
skin weights, and keyed motion. This pass uses no Tripo credits.

Nia has a larger arm stroke, variable elbow flex, and torso counter-rotation.
Marcus has corrected hip and knee positions. His boot cuffs and calves share
a wider weight transition. His shorts use fitted weights with fixed attachment seams.

The preserved `weight-source.glb` contains the corrected rig and the initial
shorts weights. The refinement script fits those weights to 17 push poses.
The final audit checks every exported frame of both clips.

Rebuild the Marcus weight file and final candidate:

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_weight_refine.py -- \
  assets/skaters/marcus/raw/forward-v2/weight-source.glb \
  --out assets/skaters/marcus/raw/forward-v2/shorts-weights.npz

"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_forward_motion.py -- \
  --name marcus --out assets/skaters/marcus/raw/forward-v2 \
  --shorts-weights assets/skaters/marcus/raw/forward-v2/shorts-weights.npz
```

For Nia, use `--name nia`, the Nia output directory, and no weight file.
The build always starts from the preserved geometry source.
The weight file must match the shorts mesh within 0.3 mm.
Repeat the weight fit and audits after a rig or stride change.

Check Marcus's exported deformation:

```sh
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_rig_audit.py -- \
  assets/skaters/marcus/raw/forward-v2/marcus-forward.glb \
  --report assets/skaters/marcus/raw/forward-v2/rig-audit.json \
  --clips coast push --check-deformation

"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_motion_audit.py -- \
  assets/skaters/marcus/raw/forward-v2/marcus-forward.glb \
  --report assets/skaters/marcus/raw/forward-v2/motion-audit.json \
  --clips coast push --check-support
```

Use both audits for Nia. Omit `--check-deformation` from her rig audit.
Add `--check-arms` to her motion audit.
The deformation check targets Marcus's shorts, boots, and calves by material.
It requires the worst frame's 99th-percentile edge ratio to remain at or below 1.25.
It also limits axial leg twist to 20 degrees.
The same check fails on `forward-v1` and passes on `forward-v2`.

Render and package Marcus:

```sh
for view in front side; do
  "$BLENDER" -b --factory-startup --python-exit-code 1 \
    -P scripts/blender/skater_review_render.py -- \
    assets/skaters/marcus/raw/forward-v2/marcus-forward.glb \
    --out "assets/skaters/marcus/raw/forward-v2/$view" \
    --clips push coast --view "$view" --floor --travel-speed 2.5 --video
done
python3 scripts/blender/skater_motion_package.py \
  --name marcus --kind forward --version 2 --travel-speed 2.5
```

Use 2 m/s for Nia. Both previews travel 4 m per cycle.
The camera and lights follow the character. This keeps the light constant
and avoids a floor-pattern jump at the video loop.
Frame manifests include the source GLB hash. Packaging checks that hash,
the speed, the frame count, and the encoded frame rate.

The v2 videos contain three cycles at 30 fps: 180 frames for Nia and 144 for Marcus.
The full-cycle frame sheets show both views. The `.blend` files remain editable.
Marcus still has rigid fingers. Isolated shorts edges still reach 1.56 times
their rest length. The percentile check does not replace visual review.
User approval, the full clip rebuild, and game verification remain open.

## Runtime v2: Marcus hands, knee pads, and wristbands (#168)

`skater_runtime.py` reads `raw/forward-v2` and writes `raw/runtime-v2` and the runtime GLB. (In #168 it read `raw/runtime-v1`.)
For Marcus, it applies three corrections before the export:

1. `skater_hands.py` moves the 40 finger joints onto the hand mesh.
   The old joints were 0.13 m behind the wrist, inside the forearm.
   No vertex had a finger weight, so each hand moved as one rigid region.
   The script finds the thumb and four fingers with a geodesic merge tree.
   It splits the hand weight between the hand joint and each finger chain.
   The forearm weight at the wrist does not change.
2. `skater_seams.close_pads()` sets one weight field on each knee pad.
   The cap and the lower strap follow the shin. The thigh share starts at the
   knee joint and ends 0.06 m above it. Skin near the pad takes the pad
   weights. Before this change, the cap folded at its middle in `bail`, and
   the knee skin came through at the side of the cap.
3. `skater_seams.close_cuffs()` smooths each wristband's weights. Skin under
   the band takes the band weights.

Build Marcus and the phone variant:

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_runtime.py -- --name marcus
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_texture_variant.py -- \
  --in assets/skaters/marcus/raw/runtime-v2/marcus-runtime.blend \
  --out assets/skaters/marcus/skater-1024.glb
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  -P scripts/blender/skater_rig_audit.py -- assets/skaters/marcus/skater.glb \
  --report assets/skaters/marcus/raw/runtime-v2/rig-audit.json --all-clips
```

The finger fit requires five separate fingers on each hand mesh.
The script stops with an error if it finds fewer than five finger regions.

Limits:

- The rig audit measures vertex pairs that start within 8 mm. The worst
  increase is 11.1 mm, between the shorts hem and the thigh skin in
  `air_liukang`. The base GLB has the same value. The knee and wrist fixes
  come from visual review of close renders in `reports/skater-168/`.
- The 24 clips in this build keep their keyed finger rotations. Those keys
  rotate each finger about the armature forward axis. The splayed pinky
  turns partly to the side in a fist. The clip rebuild (#170) corrects the
  curl axis.

## Runtime v2: all clips on the v2 bodies (#170)

Runtime v1 appended 22 clips keyed on the old review rigs. The knees of
those clips pointed up to 178 degrees away from forward on Marcus, and Nia's
knees came within 6 mm of each other. `skater_runtime.py` now drops those
clips and keys the 22 clips of `nia_clips.py` on the v2 body:

- It keeps `push` and `coast` from `raw/forward-v2`.
- It calibrates the knee pole angle of each leg on a bent idle pose.
- The knee pole turns with the foot yaw. A `pole` key in a pose turns the
  knees with the body instead.
- At each leg key, it turns the pole about the hip-ankle axis until the knee
  bend points over the skate. One pole angle does not fit every leg shape.
- `at()` foot x values scale with the hip width (`stance` in SKATER_CFG).
- A fist curls each finger about its own axis (`CURL`).

Build both skaters:

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
FBX=assets/skaters/nia/raw/tripo-motion-v1/tripo_convert_8a663486-9228-4e65-abc7-9c14db3df2dd.fbx
for n in nia marcus; do
  R=assets/skaters/$n/raw/runtime-v2
  "$BLENDER" -b --factory-startup --python-exit-code 1 \
    -P scripts/blender/skater_runtime.py -- --name $n
  "$BLENDER" -b --factory-startup --python-exit-code 1 \
    -P scripts/blender/skater_motion_retarget.py -- --name $n --fbx "$FBX" \
    --out $R --base $R/$n-runtime.blend --preserve-actions \
    --clip dance_smoothquad --glb assets/skaters/$n/skater.glb --blend $R/$n-runtime.blend
  "$BLENDER" -b --factory-startup --python-exit-code 1 \
    -P scripts/blender/skater_texture_variant.py -- \
    --in $R/$n-runtime.blend --out assets/skaters/$n/skater-1024.glb
done
```

Nia's .blend links its textures from `raw/nia-tripo-pbr/`. Copy that
folder with the other raw files, or the GLB has no textures (about 1 MB).

Both skaters now have 25 clips, with `dance_smoothquad` from the approved
Tripo smooth quad dance. Marcus did not have this clip before, and the
contact-sheet test failed on it.

Knee check (`skater_motion_audit.py`, every frame): 20 of 25 clips pass for
each skater. The audit cannot measure `air_liukang`: the kick leg stays
straight, so it has no bend direction. The failures are deliberate leg shapes:
`dance_crisscross` and `grind_unity` cross the legs, `grind_frontside` turns
the body 90 degrees to the rail, and Marcus's `dance_sitspin` extends one
leg nearly straight. Nia's `ride_back` swizzle brings the knees to 0.083 m
and fails the 0.1 m limit. The check does not assess artistic quality.
Real skaters must review the move set before release.
