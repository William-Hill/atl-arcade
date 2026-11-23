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

## Body

These values set the model scale and the skating physics in the game. The source of truth is `SKATER_BODIES` in `src/sim/skate/body.js`. Change both together.

| Field | Value |
|---|---|
| Height (barefoot) | 1.68 m (5 ft 6 in) |
| Height on skates | 1.78 m (the quad skate adds 0.10 m) |
| Weight | 61 kg (134 lb) |
| Build | Athletic, a strong lower body |
| Stance | Regular: the left skate leads |
| Skates | High-top quad skates, cream boots, gold 58 mm wheels, peach toe stops |
| Model scale | 1.047 (the GLB is 1.70 m from the wheels to the top of the head) |

### Effect on the skating physics

`skateFor()` changes the reference constants (`SKATE`, tuned for a 1.75 m, 70 kg skater) with small scaling laws: longer legs give a longer stroke, a heavier skater coasts further and turns wider. Nia is shorter and lighter than the reference, so she pushes up to speed quicker and turns tighter, with a slightly lower top speed.

| Constant | Reference body | Nia | Change |
|---|---:|---:|---:|
| Top speed after pushes (`maxSpeed`, m/s) | 12 | 11.76 | -2.0% |
| Push acceleration (`pushAccel`, m/s²) | 8 | 8.206 | +2.6% |
| Time of one stroke (`pushCooldown`, s) | 0.4 | 0.3919 | -2.0% |
| Air drag (a lower value coasts further) (`coastDrag`, 1/m) | 0.025 | 0.02624 | +5.0% |
| Brake (toe stop) (`brakeDecel`, m/s²) | 8 | 8.376 | +4.7% |
| Turn rate at full carve speed (`carveRate`, rad/s) | 2.4 | 2.506 | +4.4% |
| Jump speed (vertical) (`jumpSpeed`, m/s) | 5 | 5.064 | +1.3% |
| Collision radius (`bodyRadius`, m) | 0.3 | 0.2858 | -4.7% |

The roll friction (`coastDecel`) does not change: it is the same per kilogram.

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
| Body | Athletic, medium height (1.68 m), a strong lower body |
| Skin | Deep brown |
| Hair | Box braids in a high bun, held close to the head |
| Top | A cropped bomber jacket in peach orange, over a cream tank top |
| Bottom | Navy joggers, cuffed at the calf (forest green until #203: green pants merged with the BeltLine lawn) |
| Skates | High-top quad roller skates (four wheels each), white boots, gold wheels, a peach toe stop |
| Accessories | Small gold hoop earrings, cream knee pads, a green wristband |
| Logos and text | None |

The skates are quad roller skates. They are not inline skates and not a skateboard. The model must show this at a distance.

## Palette

| Name | Hex | Use |
|---|---|---|
| Peach | `#F28C4A` | The jacket, the toe stops |
| Navy | `#2E3D6B` | The joggers (#203) |
| Forest | `#2F6B4F` | The wristband |
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
| Base (Atlanta rink style) | idle, push (ATL stride), coast, ride back, carve left, carve right (the ATL Ryde corner step) |
| Air (X Games) | jump, land, mute grab, japan, Liu Kang |
| Rails (X Games) | frontside, soul, unity, manual |
| Fail | bail |
| Style, Q (Atlanta dances, 2 beats each, in this order) | Bankhead Bounce, Walk It Out, the Prep, Swag Surf, Snap Lean, Cross Step (clip `dance_crisscross`; spec: `atl-dance-references.md`, section 3) |
| Style, E (spins, 1 beat each) | toe-stop spin, sit spin |

The sources for each move are in `skate-style-references.md` and `atl-dance-references.md`.

The idle is a relaxed lean: the weight on the right skate, the right hand on the hip, the left skate forward with a toe tap on beat 4, and a head nod on each beat.

The dance clips must come from rink culture: backward skating, footwork, spins, and rhythm moves. If a move looks like skateboarding, replace it with a rink move (pillar 5).

## Political and cultural rules

- Show Nia and the West End at their best.
- Her murals show positive local subjects. They are murals, not graffiti.
- Real Atlanta skaters review her look, her moves, and her voice lines before release.

## Concept art

The concept art is in `docs/characters/concept/nia/`. The `provenance.json` file in that folder records the tool, the prompt, the credits, and the date for each image. The concept art is a reference for the model, not a game asset.
