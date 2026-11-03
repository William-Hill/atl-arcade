# Image analysis: Krog Street Market (img2threejs layer protocol)

Reference: `ref/reference.jpg`, "Krog Street Market", Wikimedia Commons, LittleT889, CC BY-SA 4.0. A street-level view of the main entrance from the parking lot, by day. Scale from the brick wall: about 30 px per meter (the wall is about 5.5 m tall).

## Layer 1: identification
- Work type: a 1920s brick warehouse, now a food hall (adaptive reuse). Broad class: building, architectural landmark.
- primaryDomain: object. Confidence 0.95 (the sign reads "KROG STREET MARKET").

## Layer 2: form and silhouette
- A long brick box (about 5.5 m) with a stone rubble base course. Above it, silver corrugated metal upper walls: a gable at the left (peak about 9.8 m) and a raised monopitch at the right (high end about 10.2 m).
- A flat black steel canopy cantilevers from the entrance (about 15.5 m wide, 3.5 m deep, at about 4.4 m).
- Shape language: geometric. Symmetry: asymmetric.

## Layer 3: macro, meso, micro
- Macro: (1) the brick box (from the game), (2) the metal upper wall and roof profile, (3) the entrance canopy.
- Meso: (a) the "KROG STREET" block letters on top of the canopy, (b) the "MARKET" letters on the canopy fascia, (c) 2 canopy posts.
- Micro: (i) 5 brass pendant lights under the canopy, (ii) the corrugation of the metal (fine vertical ribs), (iii) rooftop equipment.

## Layer 4: spatial relationships
- <metal upper wall, above, brick box> (sits on the brick wall top; butt contact).
- <canopy, attached-to, brick front wall> (cantilever; butt contact at the wall).
- <KROG STREET letters, above, canopy> (stand on the canopy top).
- <MARKET letters, attached-to, canopy fascia> (flush with the front edge).
- <pendant lights, below, canopy> (hang from the canopy soffit).

## Layer 5: materials (PBR)
- Corrugated metal: metal, roughness about 0.45, albedo a light silver grey.
- Canopy steel: painted black, roughness about 0.5.
- KROG STREET letters: painted black. MARKET letters: white.
- Pendant lights: brass, metallic.

## Layer 6: color and finish
- Metal: light neutral grey, satin. Canopy and letters: near-black, satin. MARKET: white. Lights: warm brass.

## Layer 7: identity-defining features
1. The silver metal gable and raised monopitch above the brick wall.
2. "KROG STREET" in tall black block letters on top of the black canopy.
3. "MARKET" in white letters on the canopy front.
4. Brass pendant lights under the canopy.

## Layer 8: uncertainty and single-image limits
- Hidden: the roof behind the front, and the other facades. The roof profile is extruded back over the footprint (inference).
- The real footprint comes from OpenStreetMap (relation 5413435). The entrance is placed on the east face, to the parking drive (approximate).
- OSM gives one 6 m height for the whole footprint; the metal upper walls rise above it.
- Stylization: a low-cost toon model with flat colors. The corrugation is not modeled.
