# Skater dossier: Nia "Sway" Ellis

Status: draft for M1-01 (#11). Real Atlanta skaters must review this dossier before release.

## Summary

| Field | Value |
|---|---|
| Name | Nia Ellis |
| Skate name | Sway |
| Age | 24 (an adult) |
| Home | West End, Atlanta |
| Day work | Mural painter and sign painter |
| Skate style | Rink style: backward skating, footwork, and rhythm on the beat |
| Role in the game | The first playable skater (version 1) |
| Asset folder | `assets/skaters/nia/` |

Nia is an original character. She is not based on a real person, a real crew, or a real rink.

## Story

Nia learned to skate at the Saturday adult sessions at her neighborhood rink. Now she teaches the beginner hour there. In the day, she paints murals on the walls of local shops.

She skates the city to find walls for new murals. She knows every smooth sidewalk on the BeltLine. Her goal in the game is to show the player the best of each neighborhood.

## Personality

- Confident and warm. She calls out a good move from any skater.
- Generous. She shares her lines and her music.
- Precise. She counts the beat before every trick.

Her voice lines must be short, positive, and in plain words. Do not write slang that a real Atlanta skater has not reviewed.

## Look

| Part | Design |
|---|---|
| Body | Athletic, medium height, a strong lower body |
| Skin | Deep brown |
| Hair | Box braids in a high bun, held close to the head |
| Top | A cropped bomber jacket in peach orange, over a cream tank top |
| Bottom | Forest-green joggers, cuffed at the calf |
| Skates | High-top quad roller skates (four wheels each), white boots, gold wheels, a peach toe stop |
| Accessories | Small gold hoop earrings, cream knee pads, a green wristband |
| Logos and text | None |

The skates are quad roller skates. They are not inline skates and not a skateboard. The model must show this at a distance.

## Palette

| Name | Hex | Use |
|---|---|---|
| Peach | `#F28C4A` | The jacket, the toe stops |
| Forest | `#2F6B4F` | The joggers, the wristband |
| Gold | `#E8B931` | The wheels, the earrings |
| Cream | `#F4EBD9` | The tank top, the knee pads, the boots |
| Deep brown | `#5A3A29` | The skin tone reference |
| Ink | `#1E1E24` | The outlines and the hair |

The palette refers to the peach, the city in a forest, and warm gold light. M1-06 (#16) can change these values in `docs/style-sheet.md`.

## Rules for the 3D model

These rules make the Tripo or Meshy output easy to rig and animate.

1. Use a T-pose: the arms straight out to the sides, the palms down.
2. Keep the legs apart, so that the skates do not touch.
3. Keep the jacket short and close to the body. Do not add loose cloth below the waist.
4. Keep the braids in the bun, close to the head. Do not add loose hair.
5. Make the skates part of the body mesh.
6. Do not add transparent parts, props, or a base.
7. After the cleanup, keep the mesh under 20,000 triangles and the GLB under 3 MB.

## Move set (from M1-02, #12)

| Group | Clips |
|---|---|
| Base | idle, push, coast, carve left, carve right |
| Air | jump, air trick 1, air trick 2 |
| Rails | grind, manual |
| Fail | bail |
| Style | dance 1 to dance 4 |

The dance clips must come from rink culture: backward skating, footwork, spins, and rhythm moves. If a move looks like skateboarding, replace it with a rink move (pillar 5).

## Political and cultural rules

- Show Nia and the West End at their best.
- Her murals show positive local subjects. They are murals, not graffiti.
- Real Atlanta skaters review her look, her moves, and her voice lines before release.

## Concept art

The concept art is in `docs/characters/concept/nia/`. The `provenance.json` file in that folder records the tool, the prompt, the credits, and the date for each image. The concept art is a reference for the model, not a game asset.
