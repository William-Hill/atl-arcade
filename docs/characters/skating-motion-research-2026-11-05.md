# Skating motion research

Date: 2026-11-05.

The user rejected Nia `review-v4` and Marcus `review-v6`.
Both characters need new motion. The knee check must measure anatomy as well as mesh separation.
The user also requires distinct movement for each character.

## Video references

I inspected frame sequences from these videos. Local copies remain outside the repository.
They serve as visual references. They are not licensed animation assets.

| Source | Frames inspected | Observations |
| --- | --- | --- |
| [Dun Beezy: How to ATL Ryde](https://www.youtube.com/watch?v=oUeLJ5qbyoc) | 3:15–4:00, with a denser sequence at 3:30–3:36 | The skater shifts weight over the support skate. The free skate draws inward and behind. The hips remain above the support side. The torso does not collapse toward the knees. |
| [Elsie: Forward skating, lemons, and plow stops](https://www.youtube.com/watch?v=aNGNDFPs8O4) | 1:20–1:50, with a denser sequence at 1:21–1:27 | The skater transfers weight before each push. The knee bends forward. The recovery foot returns under the body. The torso height changes only a small amount. |
| [Sports-Actions: Quad Roller Skaters Actions SA](https://www.youtube.com/watch?v=-x-E2WzpTUM) | Samples across 0:00–3:06; denser sequence at 0:26–0:30 | The preview shows forward strokes, crossovers, turns, stops, jumps, and falls. It supplies relevant motion for retargeting. The preview does not prove that the downloaded files will fit our rigs. |

The previous coast clip moves both skates across the center while the hips stay near the center.
That motion does not preserve the support pattern in the ATL Ryde reference.
The previous arm throws and deep crouch also exceed the motion in the reference.

## Animation sources

| Source | Result | License or cost |
| --- | --- | --- |
| [CGTrader Quad Rollers, Sports-Actions](https://www.cgtrader.com/3d-models/sports/game/quad-roller-actions) | The listing contains 50 quad-skating actions, six avatars, FBX files, and a Unity package. The listing names ride, push, turns, reverse ride, crisscross, jumps, and falls. The preview is relevant. No asset files were purchased or tested. | The live page shows $20. It lists “Royalty Free License (no AI).” Check the full license before purchase. Use normal Blender retargeting for these assets. |
| Tripo Studio, Nia task `72bfc452-df28-4e58-83bb-e89a35341a9a`, Animate page | The preset search for `skat` returns “No matching animation.” The visible list contains dance, surf, swagger, walk, and run presets. The AI Animation tab shows one existing “Energy Blast Pose” item. | Text-to-motion shows 20 credits for a five-second generation. Two character tests would cost 40 credits. No generation started. |
| [CMU motion database](http://mocap.cs.cmu.edu/) | The database permits all uses. Subject 134 contains skateboard motions. Those motions do not supply a quad-skating gait. | Free for all uses, according to the database. |
| [NUS motion database](https://mocap.cs.sfu.ca/nusmocap.html) | The page explicitly excludes commercial products. | Research only. |
| [KinemIQ free library](https://kinemiq.itch.io/free-game-animations) | The page lists CC0 and attributed locomotion packs. It does not establish a quad-skating set. | Mixed CC0 and attribution licenses. |
| [Animium skate spin](https://animium.com/2014/10/skate-spin-mocap) | The page advertises one 152-frame spin in BVH and FBX. Its origin and reuse license remain unverified. | Unverified. |

No verified open-license quad-skating pack emerged from this search.
This finding does not establish that no such pack exists.

## Knee failure

`scripts/blender/skater_motion_audit.py` imports the exported GLB at 30 fps.
It samples every frame of `coast`, `push`, and `bail`.
It checks knee separation and the bend direction relative to forward travel.

Both original candidates fail with exit code 1.

| Candidate | Clip | Minimum knee-center distance | Maximum bend angle from forward |
| --- | --- | ---: | ---: |
| Nia v4 | coast | 0.0090 m | 30.2 degrees |
| Nia v4 | push | 0.0480 m | 40.1 degrees |
| Nia v4 | bail | 0.0664 m | 24.6 degrees |
| Marcus v6 | coast | 0.0938 m | 101.0 degrees |
| Marcus v6 | push | 0.1140 m | 112.9 degrees |
| Marcus v6 | bail | 0.1931 m | 95.1 degrees |

The check uses conservative limits: 0.10 m separation and 60 degrees from forward.
It applies to forward motion. Deliberate crossover tricks need a separate check.
These limits do not prove visual quality.

A separate neutral-pose probe varied each IK pole angle.
The previous script set both pole angles to zero on both rigs.
The probe found these angles:

| Rig | Left pole | Right pole | Remaining direction error |
| --- | ---: | ---: | ---: |
| Nia | -22 degrees | 26 degrees | Less than 0.8 degrees |
| Marcus | -32 degrees | 100 degrees | Less than 0.9 degrees |

These values apply to the probe pose and its pole positions.
They are not final animation settings.
A pole correction alone cannot repair Nia's crossing paths.

## Distinct movement

Keep the same gameplay clip names. Give each character distinct motion within those clips.

- Nia: smooth rink glide, longer support phases, controlled backward footwork, relaxed arms, and small shoulder counter-rotation.
- Marcus: sharper jam accents, different lead-foot patterns, shorter recovery phases, and asymmetric arm gestures.
- Both: the support knee follows the skate direction. The free leg clears the support leg.
- Crossovers: transfer weight and stagger the legs before the crossing phase.
- Falls: use distinct recovery steps and arm responses.

## Required review

1. Import or author the new motion on the existing clean geometry.
2. Fit the motion separately to each rig.
3. Run the knee check on the exported GLBs.
4. Check skate contact and leg clearance throughout each loop.
5. Render complete loops from the front and side with a visible floor.
6. Compare the motion with the reference sequences.
7. Request user review before game integration.

Real Atlanta skaters must review the movement before release.

## Result of the Tripo test

The user approved two five-second generations for 40 credits.
The balance changed from 2795 to 2755.
Tripo generated `Smooth Quad Skating` for Nia and `Compact Jam-Skating Groove` for Marcus.
Both exports used Nia's existing Tripo rig as the motion source.
Blender transferred the second motion to Marcus's repaired rig.

The user judged the motions as dances. They do not supply the required forward stride.
The user also identified Nia's short arms.
Keep the exported motions in `raw/tripo-motion-v1/` as dance references.
The raw tests also fail the foot-step limit. They need cleanup before game integration.

## Forward candidate

`skater_forward_motion.py` authors separate `push` and `coast` clips.
It uses the forward-skate reference from Elsie.
It controls the drive, recovery, and weight transfer as separate phases.
The coast does not use dance steps.

Nia uses a two-second cycle. Marcus uses a 1.6-second cycle.
The profiles use different lead feet, arm poses, stride lengths, and recovery heights.
The preview moves each character through the scene. The exported clips remain in place.

The arm probe found a 1.23 m span on Nia's 1.70 m body.
The short proportions also appear in the source concept.
Her upper arms measured about 0.18 m. Her forearms measured 0.16–0.17 m.
The new mesh and skeleton use upper arms of 0.26 m and forearms of 0.23 m.
The new span is 1.51 m. The height remains 1.70 m.

The first forward candidate placed Marcus's hips 0.111 m from the support skate during recovery.
The support check failed its 0.06 m limit.
The corrected transfer reduces this distance to 0.035 m.
The check observes 12 support samples for Marcus and 16 for Nia.
The hip position is a balance proxy. It is not a physical center-of-mass calculation.

Both new exports pass the knee, support, loop, separation, and foot-step checks.
Both retain 65 joints. Each has two clips.
The files remain under `raw/forward-v1/` for user review.
