# Draft issue for img2threejs (not sent)

**Title:** Tier 1 color check fails small parts that have their own color

## Problem

`forge/stage4_review/diagnose_render.py` groups the full render into 5 colors (k-means, k=5). Then it compares each spec material to the nearest group.

A small part with its own color does not get a group. Examples:

- A gold finial on a copper roof: delta-E 45.81.
- 5 small brass pendants under a black canopy: delta-E 55.78.

The part is correct, but the gate fails. To pass, the author must change the color or make the part larger. Both changes make the model worse.

## A second problem: the masks

With a sky or a city behind the subject, both masks fall back to "most pixels". The silhouette IoU then reads 1.0. The gate passes, but it measured nothing.

## Proposal

Add an optional per-part check on the visible footprint of each part:

1. Render the model unlit (flat base colors), on a transparent background.
2. For each part, render again with that part hidden. Keep the camera fixed.
3. The pixels that change are the visible footprint of the part.
4. Compare the mean color of the footprint to the spec base color (delta-E).
5. Report a part with fewer than N visible pixels as `unmeasured-too-small`, not as a failure.
6. Report a part with a canvas texture (text) as `textured-card`, for the AI review.

Also, warn when a mask covers more than 90% of the frame. That warning tells the author to use a transparent reference mask.

## Evidence

A local patch does this with a `--footprint-dir` argument (`full.png` and `hide-<id>.png`). It is in the ATL Arcade repository at `tools/img2threejs-footprint-color.patch` (111 lines, against v2.0.0, commit a669e9a).

Results with the patch:

- Ponce City Market tower: 27 parts measured, max delta-E 10.38.
- Krog Street Market front: 10 parts measured, max delta-E 7.88.
