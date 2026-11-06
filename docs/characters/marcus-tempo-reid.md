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
| Body | Tall and lean, long legs |
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
