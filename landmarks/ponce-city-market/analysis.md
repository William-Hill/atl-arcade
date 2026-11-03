# Image analysis: Ponce City Market (img2threejs layer protocol)

Reference: `ref/reference.jpg`, "Ponce City Market from Historic Fourth Ward Park", Wikimedia Commons, CC BY-SA 2.0. An aerial drone view at dusk, from the south-east, about 60 m up.

## Layer 1: identification
- Work type: a multi-storey brick warehouse (adaptive reuse, mixed use). Broad class: building, architectural landmark.
- primaryDomain: object. Confidence 0.95 (the rooftop sign reads "PONCE CITY MARKET").

## Layer 2: form and silhouette
- Bounding volume: a set of stepped cuboids. The tallest mass is a long cuboid of about 9 storeys. Lower wings of 4 to 6 storeys step down at both ends.
- One square tower rises above the roof line near the back. Its top is a square brick belvedere with 3 arched windows per face, white stone bands, a low hipped copper roof with a wide eave, a small square cap, and a gold finial (correction after a close crop: not an octagonal lantern with a dome).
- Symmetry: asymmetric plan; each facade is regular (a repeated bay grid).
- Shape language: geometric. Aspect: the main block is about 3 times longer than it is deep, and about 1 depth tall.

## Layer 3: macro, meso, micro
- Macro: (1) main block, (2) north wing (lower, behind), (3) east wing (lower), (4) the tower, (5) rooftop sign frame.
- Meso: (a) a regular window grid per facade, one window per bay per floor; (b) a parapet and a cornice band at each roof line; (c) the belvedere (arched windows, stone bands, hipped copper roof, cap, finial); (d) rooftop mechanical boxes; (e) a ground-floor arcade of larger openings and canopies.
- Micro: (i) brick pilasters between window bays; (ii) the sign letters on a steel frame; (iii) a light stone band at the floor lines.

## Layer 4: spatial relationships
- <tower, embedded-in, main block roof> (butt contact, the tower shaft continues down into the block).
- <belvedere, above, tower shaft> (same square plan, separated by a white stone band).
- <hipped roof, above, belvedere> (overhangs it on all 4 sides).
- <sign frame, attached-to, roof of the north wing> (stands on the roof, faces south-east).
- <wings, flush-with, main block walls> (shared walls, lower roof lines).
- <mechanical boxes, above, roof> (rest on the flat roof).

## Layer 5: materials (PBR)
- Brick walls: dielectric, metalness 0, roughness about 0.9, albedo a mid-value red-brown.
- Window glass: dielectric, roughness about 0.2, albedo a dark blue-grey; lit warm from inside at dusk (do not read as albedo).
- Roof membrane: matte light grey, roughness 0.95.
- Tower roof: patinated copper, a mid-value blue-green, roughness about 0.6.
- Finial: gold (metallic), small.
- Sign letters: emissive warm yellow at dusk (lit sign); by day, a painted yellow.
- Cornice and stone bands: light warm grey, roughness 0.85.

## Layer 6: color and finish
- Brick: hue red-orange, value mid-dark, saturation mid. Finish matte.
- Trim and cornice: warm light grey, matte.
- Lantern: blue-green, satin.
- Sign: saturated warm yellow.

## Layer 7: identity-defining features
1. The tower top: a square brick belvedere with arched windows under a low hipped green copper roof, with a gold finial.
2. The rooftop sign "PONCE CITY MARKET" in yellow block letters on a steel frame.
3. The long red-brick mass with a dense, regular window grid.
4. The stepped roof lines (a tall main block, lower wings).
5. The light cornice and parapet at each roof edge.

## Layer 8: uncertainty and single-image limits
- Hidden: the north and west facades. Assume the same window grid (inference).
- The real footprint comes from OpenStreetMap (`w184803195`), not from the photo. The photo sets the style, the tower position, and the sign position only.
- The tower position along the block is approximate: about 70 % of the length from the south-west end, at the back edge (inference from perspective).
- Dusk lighting: the warm interior light and the lit sign are lighting, not albedo.
- Stylization: the target is a low-cost toon model with vertex colors for a game, not a photoreal rebuild. Window detail comes from the game's facade shader, not from geometry.
