# Greybox skate playtest — M0-10

**Date:** 2026-10-31
**Player:** William
**Build:** the M0 greybox in `src/` (this folder holds only the report). William played the build from `m0-09-playtest-harness` before the review fixes; the camera fix and the review fixes merged after the session (PRs #29 to #34).
**Verdict:** PROCEED
**Waiver:** issue #10 asks for a 15-minute session with sound. This session did not meet that requirement, or did not record it. William waived it on 2026-10-31 and kept the verdict. The sound session moves to the first M1 playtest.

## Hypothesis

> A new player chains a 3-move combo within 3 minutes and falls off a rail by accident under once per minute.

**Not tested.** William did not try combos and did not grind much. The session tested free movement and the camera. Both numbers stay open, so measure them in the first M1 playtest, with the GLB skater in place.

| Check | Target | Human result | Harness result (scripted) |
|---|---|---|---|
| Time to the first 3-link combo | Under 3 min | Not tried | 3.47 s in the `combo` session |
| Accidental rail falls | Under 1 per minute | Too few grinds to judge | 2.48 per minute in the `rails` session, which falls on purpose once |

The harness numbers prove that the moves are reachable and that the build holds frame rate. They do not measure a human.

## The five answers

1. **Hypothesis check:** not tested. The session covered free skating and the quarter pipe, not combos or rails.
2. **Best moment:** free skating around the block. Push, carve, and roll felt good.
3. **Worst moment:** two things. The camera on the quarter pipe snapped and swung (fixed after the session, PR #29). The capsule also makes the movement hard to judge without the real 3D skater.
4. **Surprise:** free skating on a plain greybox block already felt good.
5. **Verdict:** PROCEED. In William's words, "a really good start." The next steps are the 3D character and the real neighborhood.

## Harness metrics

From `reports/playtest-2026-10-31-13-59-39.json` (`npm run playtest`, headless Chromium, this Mac, after the review fixes):

| Session | Median FPS | Score | Max combo | Combos | Falls per minute | First 3-link combo |
|---|---|---|---|---|---|---|
| `lap` | 59.9 | 0 | 0 | 0 | 0 | none |
| `rails` | 59.9 | 460 | 2 | 1 | 2.48 | none |
| `combo` | 59.9 | 1227 | 3 | 2 | 0 | 3.47 s |
| **All** | **59.9** (gate 55: PASS) | 1687 | 3 | 3 | 1.34 | 3.47 s |

No session respawned the skater. The score changes between runs because moves that land on the beat earn a bonus, and the beat runs on wall-clock time.

## What M1 must carry forward

- Measure the two hypothesis numbers with a human, with combos and rails in the session plan.
- Recheck the quarter-pipe camera with a human. The fix passed scripted tests only.
- The movement feel is untuned. Every knob is in `src/sim/skate/constants.js`.
- A real gamepad and audio through speakers are still unverified.
- Play the waived 15-minute session with sound, and judge the click track and the on-beat bonus by ear.
