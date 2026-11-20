# Skater dossier: Marcus "Tempo" Reid

Status: draft for M1-10 (#42). Real Atlanta skaters must review this dossier before release.

## Summary

| Field | Value |
|---|---|
| Name | Marcus Reid |
| Skate name | Tempo |
| Age | 28 (an adult) |
| Home | Old Fourth Ward, near Sweet Auburn, Atlanta |
| Day work | Middle-school band teacher (drums) |
| Skate style | Jam skating: crossovers, footwork, and spins on the beat |
| Role in the game | The second playable skater (M1-10) |
| Asset folder | `assets/skaters/marcus/` |

Marcus is an original character. He is not based on a real person, a real crew, a real school, or a real rink.

## Body

These values set the model scale and the skating physics in the game. The source of truth is `SKATER_BODIES` in `src/sim/skate/body.js`. Change both together.

| Field | Value |
|---|---|
| Height (barefoot) | 1.88 m (6 ft 2 in) |
| Height on skates | 1.98 m (the quad skate adds 0.10 m) |
| Weight | 79 kg (174 lb) |
| Build | Tall and lean, long legs |
| Stance | Goofy: the right skate leads |
| Skates | High-top quad skates, black boots, teal 58 mm wheels, white toe stops |
| Model scale | 1.112 (the GLB is 1.78 m from the wheels to the top of the head) |

### Effect on the skating physics

`skateFor()` changes the reference constants (`SKATE`, tuned for a 1.75 m, 70 kg skater) with small scaling laws: longer legs give a longer stroke, a heavier skater coasts further and turns wider. Marcus is taller and heavier than the reference, so he has a higher top speed and a longer coast, but he takes longer to reach speed and turns wider.

| Constant | Reference body | Marcus | Change |
|---|---:|---:|---:|
| Top speed after pushes (`maxSpeed`, m/s) | 12 | 12.44 | +3.6% |
| Push acceleration (`pushAccel`, m/s²) | 8 | 7.964 | -0.4% |
| Time of one stroke (`pushCooldown`, s) | 0.4 | 0.4146 | +3.6% |
| Air drag (a lower value coasts further) (`coastDrag`, 1/m) | 0.025 | 0.02439 | -2.4% |
| Brake (toe stop) (`brakeDecel`, m/s²) | 8 | 7.684 | -4.0% |
| Turn rate at full carve speed (`carveRate`, rad/s) | 2.4 | 2.269 | -5.4% |
| Jump speed (vertical) (`jumpSpeed`, m/s) | 5 | 4.989 | -0.2% |
| Collision radius (`bodyRadius`, m) | 0.3 | 0.3075 | +2.5% |

The roll friction (`coastDecel`) does not change: it is the same per kilogram.

## Story

Marcus grew up two blocks from the Eastside Trail of the BeltLine. He learned to skate on the trail on Sunday mornings. Now he teaches the drum line at a middle school and counts every move like a drum cadence.

He skates the BeltLine to his school and to the parks of the Old Fourth Ward. He knows the history of Sweet Auburn and he shares it with the player. His goal in the game is to keep every line in time with the music.

## Personality

- Upbeat and patient. He is a teacher first.
- Musical. He taps a rhythm on every rail before a grind.
- Proud of his neighborhood. He points out murals, parks, and landmarks.

His voice lines must be short, positive, and in plain words. Do not write slang that a real Atlanta skater has not reviewed.

## Look

| Part | Design |
|---|---|
| Body | Tall (1.88 m) and lean, long legs |
| Skin | Brown |
| Hair | A high-top fade, a short neat beard |
| Top | A short teal track jacket with white stripes on the sleeves, over a white tee |
| Bottom | Navy shorts to the knee |
| Skates | High-top quad roller skates (four wheels each), black boots, teal wheels, white toe stops |
| Accessories | White knee pads, teal wristbands |
| Logos and text | None |

The skates are quad roller skates. They are not inline skates and not a skateboard. The model must show this at a distance.

## Palette

| Name | Hex | Use |
|---|---|---|
| Teal | `#1FB5A8` | The jacket, the wheels, the wristbands |
| Navy | `#22305C` | The shorts |
| White | `#F5F3EE` | The tee, the knee pads, the toe stops, the sleeve stripes |
| Ink | `#1E1E24` | The boots, the hair, the outlines |
| Brown | `#7A4B2E` | The skin tone reference |

Teal and navy are a contrast to the peach and forest of Nia, so that the player can tell the two skaters apart at a distance. M1-06 (#16) can change these values in `docs/style-sheet.md`.

## Rules for the 3D model

These are the same rules as for Nia.

1. Use a T-pose: the arms straight out to the sides, the palms down.
2. Keep the legs apart, so that the skates do not touch.
3. Keep the jacket short and close to the body.
4. Keep the hair short and close to the head.
5. Make the skates part of the body mesh.
6. Do not add transparent parts, props, or a base.
7. After the cleanup, keep the mesh under 20,000 triangles and the GLB under 3 MB.

## Move set

Marcus uses the gameplay clip names in `src/render/skater-anim.js`.
His movement must differ from Nia's movement.
The user added this requirement on 2026-11-05 after rejection of the shared animation set.

Marcus uses sharper jam accents, different lead-foot patterns, and asymmetric arm gestures.
Nia uses a smoother rink glide and longer support phases.
See `skating-motion-research-2026-11-05.md` for the references and review requirements.

## Political and cultural rules

- Show Marcus, the Old Fourth Ward, and Sweet Auburn at their best.
- Real Atlanta skaters review his look, his moves, and his voice lines before release.

## Concept art

The concept art is in `docs/characters/concept/marcus/`. The `provenance.json` file in that folder records the tool, the prompt, the credits, and the date for each image. The concept art is a reference for the model, not a game asset.
