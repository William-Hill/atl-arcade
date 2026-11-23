# #292: Bankhead, Prep, Crisscross, Spin, and Sit Spin rekeyed (before and after)

Each page shows the contact sheet of a dance on `main` after #290 ("before") above the new sheet ("after"). The sheets come from `e2e/skater-anim.spec.js` (6 frames per clip, three-quarter view). The full sheets are in `assets/skaters/<name>/clips/`.

- `nia-dances-before-after.jpg`, `marcus-dances-before-after.jpg`

## The new keys (`scripts/blender/nia_clips.py`)

Each dance has a large key pose on each beat, an anticipation key before the beat, and a follow-through key after it. The specs are in `docs/characters/atl-dance-references.md`.

| Dance | Beat 1 | Beat 2 | Anticipation and follow-through |
|---|---|---|---|
| Bankhead Bounce | Forearms in an X in front of the face, weight on the left skate, deep knee bounce | Arms open to a "goalpost" (elbows at shoulder height, forearms up), weight on the right skate | Shoulders shrug up on each "&" (24 degrees). The arms start to move 6 frames before the beat. The elbows overshoot up after they open. The head nods with the bounce. |
| The Prep | Right skate steps short and forward, knees bend | Clap in front of the chest, hips dip, head nods | On the "&" the left toe stop touches behind and to the right of the right heel, and the arms open wide (the wind-up for the clap). After the clap the hands bounce apart. On the next "&" the left skate steps forward again. |
| Crisscross | Left skate crosses in front, clap | Right skate crosses in front, clap | Between the beats the skates slide out wide and the arms open to the sides. Before each cross the knees dip and the arms come in. After each cross the hands bounce apart. |
| Toe Spin (1 beat) | f0 wind-up: knees bent, shoulders turned against the turn, arms back. f4: up on the toe stops, arms pull in. f8 to f15: tight spin, left arm up. f19: skates down, arms open. f24: finish, knees take the stop, arms in a V. | | The renderer turns the body one full turn over the beat at a constant rate (`src/render/skater-view.js`), so the tight pose is in the middle of the turn. |
| Sit Spin (1 beat) | f0 wind-up. f5: the drop. f9 to f15: low on the right skate, left leg out in front, arms reach forward. f20: the rise. f24: finish, standing with the arms in a V. | | As for Toe Spin. |

## Beats

The groove dances stay at 2 beats and the spins at 1 beat (`STYLE.moves[].beats`). Each dance now changes pose on every beat, so 4 beats do not read better. The combo points per second do not change, so no balance change is necessary.

## Measurements

Change of pose: the share of pixels that change by more than 24 grey levels between neighbor frames of a contact sheet (5 pairs per sheet). Swag Surf is the reference and does not change.

Nia

| Dance | Before: mean (min) % | After: mean (min) % |
|---|---|---|
| dance_bankhead | 2.3 (1.6) | 4.7 (4.0) |
| dance_prep | 5.9 (4.2) | 6.6 (4.1) |
| dance_crisscross | 5.2 (0.0) | 8.7 (6.2) |
| dance_spin | 2.2 (0.0) | 5.5 (2.1) |
| dance_sitspin | 1.8 (0.0) | 9.2 (3.2) |
| dance_swagsurf (reference) | 9.4 (7.5) | 9.4 (7.5) |

Marcus

| Dance | Before: mean (min) % | After: mean (min) % |
|---|---|---|
| dance_bankhead | 2.4 (1.6) | 5.1 (4.1) |
| dance_prep | 6.8 (5.1) | 7.7 (4.8) |
| dance_crisscross | 6.1 (0.0) | 10.3 (7.4) |
| dance_spin | 2.4 (0.0) | 6.4 (2.1) |
| dance_sitspin | 2.2 (0.0) | 10.8 (3.8) |
| dance_swagsurf (reference) | 11.1 (8.1) | 11.1 (8.1) |

Knees and wheels (`scripts/blender/clip_metrics.py`): the smallest knee mesh gap in the 5 dances is 4.0 cm for Nia (The Prep, the left skate crosses behind) and 5.3 cm for Marcus. The lowest skate point is -0.2 cm to 0.0 cm in each frame on the ground. In Toe Spin it goes up to +1.6 cm, because the skater is on the toe stops.

## Videos (`videos/`)

Nia does each dance in the game, on the BeltLine Eastside level (`?quality=low`, follow camera, SwiftShader in headless Chromium). The held button repeats the dance for 3 rounds. `<dance>.webm` is the full frame: the HUD shows the dance name, the combo, and the style meter. `<dance>-zoom.webm` is a 2x crop at the center, so the poses are easier to see. The skater view plays a dance clip at the game tempo from the beat clock, so one clip beat lasts one game beat.

Limits: SwiftShader draws few frames per second on this level, so the motion in the videos is not smooth. Trees sometimes come between the camera and the skater. Check the dances on a real GPU before the skater review.

## Review

Real skaters and dancers review the dances before release (`AGENTS.md`). Motion capture (#116) and a Cascadeur polish (#117) can replace these keys later.
