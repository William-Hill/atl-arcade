# brick-loft, round 3, judge: overall 5 / 10

Round 3 is issue #135 (storefronts, entries, roof details, and porches). The engineer of the round also wrote this report, so it is not an independent judge. Read the scores with that limit. The next round must use a separate judge agent.

Lab building: brick-loft pick 0, look `pbr`. Captures: `reports/lab/brick-loft-135-after/` (after) and `reports/lab/brick-loft-135-before/` (before, commit e2338a8). The round also captured two more styles: `reports/lab/storefront-135-{before,after}/` and `reports/lab/craftsman-house-135-{before,after}/`. Street views: `reports/streets/135-{before,after}/` (`o4w-houses.png`, `venkmans.png`, `new-realm.png`).

Short verdict: the top floor now has its stone lintels, so the window rhythm is complete under the cornice (`facade.png`). The house streets now have porches with steps, knee walls, posts, a shed roof, and a door. The shops with an OSM name show the name on a board. The lab building does not change much at 25 m and over: the change is mostly in the houses and in the named shops.

## Scores

| # | Criterion | Score | Reason |
|---|---|---|---|
| 1 | Silhouette and massing | 4 | No change on the loft. The house porches add a second mass to the house fronts (`o4w-houses.png` after). |
| 2 | Mid-scale relief | 6 | The top floor lintels are now on every window, under the bed molding (`facade.png`, y 100 to 115). The porches give the house fronts real depth. |
| 3 | Material definition | 5 | No change. |
| 4 | Color and value variation | 6 | The door colors and the shop board colors add accents (`venkmans.png` after). |
| 5 | Life and story | 6 | Real shop names from OSM on 7 buildings (Kroger, Venkman's, New Realm Brewing, Beatlecat, The Collective, Across the Street, Mister Hot Shine Car Wash). Porches and doors on 219 houses. Solar rows on 117 flat roofs. |
| 6 | Read at distance | 5 | The porches and the boards are in the near level of detail (120 m and 160 m), so `far.png` does not change. This is the intent of the issue. |
| 7 | Close-up quality | 5 | The window reveal shadow is faint in `facade.png`: the top band of the glass is a little darker, but the glass still reads flat in full shade. |
| 8 | Lighting response | 4 | No change. The shop front is still in shade. |
| 9 | Image quality | 5 | No new artifact found in the after captures. |

## Top fixes for the next round

1. **Make the window reveal read.** The shadow band (`REVEAL` in `src/render/geo-view.js`) is too weak in shade. Raise `headShade` and add a light sill band, or move the glass back with a parallax shift on all tiers.
2. **Porch on the lab house.** The craftsman-house lab pick faces open ground, so it gets no porch. Make the lab pick prefer a house with a porch, or let a house with open ground in front (no way within 30 m) get a porch too.
3. **Bigger planters at 25 m.** The planter scale is `PLANTER` in `src/level/geo/props.js` (the roads session owns that file).
4. **The plinths on the steepest lots.** The footprint grade cuts the plinths over 3 m from 146 to 49. The 8 m terrain grid limits it. A finer grid under the buildings would do more.
5. **Shop boards for more shops.** Only 8 BeltLine buildings have a named shop or amenity tag. The OSM shop points (nodes) are not in the level yet; a node in a footprint can give a board too.

## Broken

- Nothing new found. The porch geometry has no collider, like the rest of the kit: a skater passes through a porch post.
