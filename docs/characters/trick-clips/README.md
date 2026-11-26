# Trick input clips (#329), 2026-11-26

This folder holds the evidence for the new trick clips of Nia and Marcus. The design is in `docs/gdd/trick-input.md`, section "Visual/Audio Requirements".

Real skaters must review every clip before release. This work does not close #329.

## The clips

Each skater GLB (`skater.glb` and `skater-1024.glb`) has 6 new clips:

| Clip | Nia | Marcus | Touch point |
|---|---|---|---|
| `air_rocket` | New | Mirror of Nia | In the air. Both hands hold the toe box of the skates. |
| `air_tuckknee` | New | Mirror of Nia | In the air. Both hands hold the shins, below the knee pads. |
| `grind_makio` | New | Mirror of Nia | The left skate (Marcus: the right skate) goes across the rail, on the plate between the trucks. The other skate is up behind the hip. |
| `grind_royale` | New | Mirror of Nia | The front skate goes along the rail on the inside edge of its plate. The back skate goes across the rail, on the plate between the trucks. |
| `manual_toe` | New | New (`marcus_manual_toe`) | The front wheels of both skates. The rear wheels and the toe stops are clear of the ground. |
| `land_stumble` | New | Mirror of Nia | The stumble landing (R10): a deeper hit and a 0.2 s arm wave. |

`land_stumble` is not one of the 10 trick clips. The issue asks for it as "a stumble variant of `land`".

Makio and Royale are inline names. They stay open for the skater review (Q3 of the GDD).

## Pipeline

1. Hand keys: `scripts/blender/nia_clips.py` (Nia's poses) and `scripts/blender/skater_anim_v3.py` (the build, Marcus's mirror, and Marcus's `manual_toe`). No Meshy text-to-motion ran, so no credits were spent.
2. The physics pass and the arm IK: `scripts/blender/skater_physics_pass.py`.
   - `grind_makio`, `grind_royale`, `manual_toe`: the full pass (balance, smoothing, the clipping fix).
   - `air_rocket`, `air_tuckknee`: the arm IK only, with the new two-hand grabs.
3. The graft into the shipped GLBs: `scripts/assets/graft-clips.mjs`, with the new `--prune-rest` flag for the physics-pass clips.
4. The joint-limit gate (`skater_joint_limits.py`), the clip probe (`skater_clip_probe.py`), and the contact sheets (Playwright).

The commands are in `assets/skaters/<skater>/provenance.json`, the last step.

### Changes to the physics pass

- A grab spec is now a list of grabs, one for each hand: `(hand, part, region)`. The part is a skate box or a shin capsule.
- A `"toe"` region holds the front 40% of the skate box (the toe box and the toe stop).
- A shin target is the shin capsule from 0.3 to 0.65 of the way from the knee to the ankle.
- With `chest_first`, the chest bends first (in up to 4 rounds, up to `bend_max` degrees), and the skates move only for the rest of the gap. The rocket uses it, so the legs stay almost straight.
- The skate move to the hand now runs in 3 steps, and again after the chest bend. A toe region or a shin moves less than the ankle, so one step was too short.

## Gate results

Joint-limit gate (all clips of each GLB): `nia-joint-limits.json`, `marcus-joint-limits.json`. All 12 new clips PASS. The only WARN is Marcus `dance_drumline` (left knee 30.9 degrees off its hinge, limit 30). That WARN was already on `main`.

Clip probe (the 6 new clips): `nia-clip-probe.json`, `marcus-clip-probe.json`. No clip goes more than 1 cm into another part.

Grabs (palm to target, the largest value of all frames, before and after the arm IK):

| Clip | Palm to target (cm) | Skate moved to the hand (cm) | Chest bend (deg) | Knee bend (deg, left and right) |
|---|---|---|---|---|
| Nia `air_rocket` | 26.4 -> 0.2 | 0.0 and 1.4 | 9.0 | 30.9 and 33.6 |
| Nia `air_tuckknee` | 6.6 -> 0.1 | 0 | 0 | 150.7 and 150.7 |
| Marcus `air_rocket` | 13.4 -> 0.4 | 10.3 and 6.1 | 24.2 | 64.1 and 50.3 |
| Marcus `air_tuckknee` | 7.9 -> 0.3 | 8.2 and 10.8 | 3.5 | 138.7 and 139.3 |

Every grab holds its target at 1 cm or less.

Ground (the lowest vertex of each skate part over all frames, in Blender, m). The ground is z = 0. The front wheels, the rear wheels, and the toe stop are separate parts:

| Clip | Lowest wheel | Toe stop gap | Rear wheels |
|---|---|---|---|
| Nia `manual_toe` | -0.0002 | 0.0025 (right), 0.0059 (left) | 0.019 to 0.021 up |
| Marcus `manual_toe` | -0.0000 | 0.0024 (right), 0.0070 (left) | 0.020 to 0.023 up |
| Nia `grind_makio` | -0.0000 | | |
| Nia `grind_royale` | -0.0001 | | |
| Marcus `grind_makio` | -0.0001 | | |
| Marcus `grind_royale` | -0.0001 | | |
| Nia and Marcus `land_stumble` | -0.0001 | | |

No wheel goes more than 0.2 mm into the ground.

Physics pass (`nia-metrics.json`, `marcus-metrics.json`): the zero moment point is inside the support of the skates on every frame of the grinds and the toe roll. Marcus `grind_makio` had 2 frames outside before the pass and 0 after.

## Contact sheets

- `assets/skaters/<skater>/clips/<clip>.png`: the contact sheet of each new clip, made by `e2e/skater-anim.spec.js` (6 frames, the three-quarter view).
- `sheets/<skater>-<clip>-<view>.png`: the three-quarter view and the back view (the follow camera side), made by `e2e/trick-clips.spec.js`.

## Differences from the spec

1. **The toe roll pitch is 8 degrees, not 15 to 20.** On both skate meshes, the toe stop is only 5 to 14 mm above the ground and 2 to 6 cm in front of the front wheels. At 12 degrees, Nia's right toe stop is 0.3 mm from the ground. At 14 degrees, it touches the ground, and a toe stop on the ground brakes. At 8 degrees, the smallest toe stop gap is 2.4 mm and the rear wheels are 1.9 to 2.3 cm up. A larger pitch needs higher toe stops on the skate mesh.
2. **Marcus's rocket knees bend 50 to 64 degrees** (the spec: 20 to 30). His keyed pose has knees of about 24 to 36 degrees. The arm IK then pulls each skate 6 to 10 cm toward the hand, because his arms do not reach his toes with straight legs. Nia's rocket has knees of 31 and 34 degrees.
3. `air_tuckknee` knees bend about 139 to 151 degrees (a ball shape). The gate limit is 160.

## The code (`src/render/skater-anim.js`)

- The renderer plays `state.trick.clip` when the clip is in the group of the state (a grab in the air, a stance on a rail, a manual on the ground). Else it plays the base clip of the state: `jump`, `grind_frontside`, or `manual`.
- The `AIR_TRICKS` and `GRINDS` cycles, `airVariant`, `grindVariant`, and `ANIM.trickAirTime` are removed. A ramp air with no grab plays `jump`.
- A landing plays `land_stumble` when the landing result is `"stumble"`. The renderer reads `state.landing` as a string or as `{ result }`.

The sim (#327, lane A) does not fill `state.trick` or `state.landing` yet. The field names come from the GDD (Interactions table: `state.trick` is `{ kind, id, name, clip, dir, held }`). The GDD does not name the field of the landing result, so `state.landing` is a proposal for #327.

## Not verified

- No person looked at the clips in the game. No real skater reviewed them.
- The clips did not play from the sim: the sim has no `state.trick` yet. `e2e/trick-clips.spec.js` drives the skater view with synthetic states.
- No real phone or GPU. The browser runs are headless Chromium with SwiftShader.
