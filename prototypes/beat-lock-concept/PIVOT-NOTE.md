# Pivot note — beat-lock concept

**Date:** 2026-10-30
**Verdict:** PIVOT

## Original hypothesis
If the player pushes on the beat, speed and combo feedback feel locked to the music. True if the player holds a 16-beat combo within 2 minutes and input-to-beat offsets stay within ±60 ms after calibration.

## What happened
- Automated check: 32 taps aligned to the audio clock judged at mean 1.9 ms, sd 1.6 ms, 100% within ±60 ms. The timing chain works.
- Human playtest: William marked the hypothesis CONFIRMED on the first pass, then on a second pass reported "I don't know what to do" and that the prototype is not the vision.
- The real finding: the prototype answered the wrong question. The vision is free skating in a 3D space, a mix of Tony Hawk's Pro Skater and Jet Set Radio, with dance and style while you skate. The linear beat-lane design was the wrong frame.

## What to keep
- The Web Audio beat clock and the offset measurement. They become an on-beat bonus multiplier in trick scoring, not the core input.
- The political rules, the Atlanta data integration, the art pipeline (Meshy/Tripo to Blender to glTF), and the pillars 2 to 5.

## What to change
- Engine: Phaser (2D) to Three.js (3D in the browser). Decided 2026-10-30 after the Rush `codex/196-3d-spike` engine evaluation and because agents, not humans, build the levels.
- City shape: linear or branching routes to bounded free-roam neighborhood levels (THPS style: one neighborhood is one skate level with a run timer and goals).
- Core verb: "push on the beat" to "skate, grind, trick, style" with free movement.
- Timeline: weeks to months. A greybox movement prototype is 2 to 4 weeks. A playable neighborhood with art is 3 to 6 months.

## Revised hypothesis for the next prototype
If the player can skate freely on a greybox block with rails and a ramp, chain a grind into a jump into a style move, and the camera follows without fighting them, the movement will feel good enough to build a game on. True if a new player chains a 3-move combo within 3 minutes and does not fall off a rail by accident more than once per minute.
