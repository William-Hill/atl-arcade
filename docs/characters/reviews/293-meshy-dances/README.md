# Meshy text-to-motion test: Bankhead Bounce and The Prep (#293)

Date: 2026-11-15. Result: **keep the hand keys. Wait for the motion capture (#116).** See `docs/decisions.md`, 2026-11-15.

## What we did

1. We wrote 2 text prompts from `docs/characters/atl-dance-references.md` (section 4, Bankhead Bounce; section 2, The Prep). The Meshy API accepts a maximum of 400 characters, so the prompts are short. The full prompts are in `assets/dances/meshy-293/*/provenance.json`.
2. We generated each motion with Meshy text-to-motion, mode `prime`, 4 s. Cost: 10 credits for each clip, 20 credits in total. The owner approved the cost before the calls.
3. `scripts/blender/meshy_retarget.py` (headless Blender 5.2.4) retargeted each motion onto the Mixamo rig of Nia and Marcus, cut the best loop of 2 beats, retimed it to the game clip length (48 frames at 30 fps), and held the wheels on the ground with the leg IK.
4. `scripts/dance-compare-sheet.mjs` rendered the hand-keyed clips (after #292) and the Meshy clips side by side in headless Chromium (`dance-compare.html`, a dev page). The clips play at the game tempo (100 BPM), with no procedural layers (#291).

## Evidence

| Dance | Contact sheet, front | Contact sheet, side | Video (3 loops) |
|---|---|---|---|
| Bankhead Bounce | `contact-bankhead-front.png` | `contact-bankhead-side.png` | `bankhead.mp4`, `bankhead.gif` |
| The Prep | `contact-prep-front.png` | `contact-prep-side.png` | `prep.mp4`, `prep.gif` |

Columns: Nia hand keys, Nia Meshy, Marcus hand keys, Marcus Meshy. Rows: beats 0, 0.5, 1, and 1.5. Each cell gives the lowest point of the skinned mesh ("low") in cm. `probe.json` has all the measurements.

![Bankhead Bounce](contact-bankhead-front.png)

![The Prep](contact-prep-front.png)

## Measurements (`probe.json`, Nia; Marcus is almost the same)

Largest bone rotation away from the pose at beat 0, over 1 loop (degrees):

| Bone | Bankhead, hand | Bankhead, Meshy | Prep, hand | Prep, Meshy |
|---|---|---|---|---|
| LeftShoulder | 51.4 | 1.7 | 14.5 | 23.8 |
| LeftArm | 125.7 | 3.1 | 76.5 | 51.1 |
| LeftForeArm | 96.8 | 2.4 | 100.4 | 54.6 |
| Head | 50.5 | 1.8 | 20.6 | 9.0 |
| Hips | 9.8 | 1.4 | 11.8 | 23.9 |

| Measurement | Bankhead, hand | Bankhead, Meshy | Prep, hand | Prep, Meshy |
|---|---|---|---|---|
| Distance between the wrists (cm) | 24 to 84 | 37 to 38 | 7 to 91 | 14 to 38 |
| Hip height (cm) | 74 to 83 | 93 to 95 | 73 to 80 | 89 to 94 |
| Lowest skate point (cm) | -0.2 | -0.1 | -0.2 to -0.1 | -0.2 to -0.1 |

## Findings

**Bankhead Bounce: fail.** Meshy made a static "fists up" pose with a small sway. In the raw 4 s motion, the wrists move less than 3 cm and the shoulders move less than 1 cm. There is no shoulder bounce, no cross of the forearms, and no open. No retarget or cut can add a move that is not in the source.

**The Prep: partial, but not The Prep.** Meshy made a forward walk with a small cross step, and the hands meet about once each second. But:
- The **right** foot crosses **in front**. The source (USA Roller Sports) says that the **left** leg crosses **behind**.
- The hands meet at the waist, not in a clap at the chest. The smallest wrist gap is 14 cm.
- The motion has no clean 2-beat loop. The best loop is 58 frames (62 BPM for 2 beats), and its seam error is 6 times the seam error of the Bankhead. The retime makes it 21 % faster.

**What Meshy does better.** The weight shift and the hip sway look more natural than the hand keys. The body is never in a fixed pose.

**What the pipeline proves.** The retarget works: SMPL-H to Mixamo, the loop cut, the retime, and the leg IK keep the wheels on the ground (lowest point -0.2 cm to 0 cm on all 4 clips). A Meshy clip costs 10 credits, and each task was done in less than 20 s. The script can retarget any SMPL-H motion, for example a motion-capture clip from #116, if it uses the same skeleton.

**What the clips do not have.** Meshy stands upright (hips at 93 cm to 97 cm). The hand keys use a skate crouch (hips at 73 cm to 86 cm). A Meshy dance needs a crouch layer before it looks like skating.

## Limits of this test

- 1 prompt and 1 generation for each dance. A second round of prompts can give a different result. We did not spend more credits without a new approval.
- The test compares the raw clips. In the game, the procedural layers of #291 move both sources.
- Real skaters and dancers did not review these clips (AGENTS.md rule).

## Rerun

```bash
blender -b --factory-startup -P scripts/blender/meshy_retarget.py -- --skater assets/skaters/nia/skater.glb --name nia --motion assets/dances/meshy-293/bankhead/source-smplh.glb --clip dance_bankhead_meshy --out assets/dances/meshy-293/bankhead/nia.glb
```

```bash
npx vite --port 5193 &
node scripts/dance-compare-sheet.mjs
```
