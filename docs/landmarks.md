# Landmark facsimiles: BeltLine Eastside

Procedural Blender models of the hero buildings and the trail bridges of the
`beltline-eastside` level, for the pbr look (`?look=pbr`). Each model is built
on the real OSM footprint, at the height and ground the game already uses, so
it stands exactly where the game puts the building or deck.

- Generator: `scripts/blender/landmarks.py` (Blender 5.2.3, headless).
- Site data: `scripts/assets/landmark-sites.mjs` writes `assets/landmarks/sites.json`
  with the same pure level code as the game (`landmarks.js`, `terrain.js`
  `buildingSpan`/`bridgeDeck`, `bridges.js`).
- Output: `assets/landmarks/<key>/<key>.glb` (Draco, one node per LOD) and
  `provenance.json`; `assets/landmarks/landmarks-build.json` has the stats.
- Checks: `node scripts/assets/landmarks-check.mjs --out x.png <glb...>` (load
  check and lineup, GLTFLoader + DRACOLoader), and
  `node scripts/assets/landmarks-shots.mjs --out docs/landmarks` (BEFORE /
  AFTER in the real game renderer, identical cameras).

Rebuild:

```
node scripts/assets/landmark-sites.mjs
~/tools/blender -b -P scripts/blender/landmarks.py            # all
~/tools/blender -b -P scripts/blender/landmarks.py -- --only ponce-city-market
```

## Placement

Every model uses the level axes (+x east, +y up, +z south), which are also
the glTF axes. The placement transform is `position = origin`, `yaw = 0`,
scale 1. Each GLB holds `<key>_lod0`, `<key>_lod1` (and `<key>_lod2` for Ponce
City Market) with `extras.lodDistance` (m): build a `THREE.LOD` from them.

| Landmark | Source footprint | Height | Placement (x, y, z), yaw |
|---|---|---|---|
| ponce-city-market | OSM `w184803195`, 26 points, 182.84 x 177.32 m | 50 m (height); walls 0.06 to 53.98 m | (-235.78, 3.98, -852.11), 0 |
| telephone-factory-lofts | OSM `w185605331`, 7 points, 81.02 x 84.13 m | 9.13 m (overture); walls 15.88 to 29.31 m | (224.75, 20.18, -366.25), 0 |
| studioplex | OSM `r11742136`, 11 points, 11 holes, 71.79 x 164.03 m | 7.4 m (levels); walls 40.00 to 48.72 m | (-280.31, 41.32, 970.48), 0 |
| new-realm-brewing | OSM `w961282227`, 4 points, 31.12 x 29.32 m | 12.1 m (overture); walls 20.23 to 33.23 m | (119.79, 21.13, -475.9), 0 |
| bridge-north-ave | OSM `w741961708` (cycleway, 4.3 m), OSM `w83294497` (cycleway, 4.3 m) | deck 13.63 to 15.08 m | (-56.16, 13.63, -709.62), 0 |
| bridge-ralph-mcgill | OSM `w83291376` (cycleway, 4.3 m) | deck 22.12 to 22.94 m | (225.35, 22.12, -302.65), 0 |
| bridge-ponce | OSM `w83291379` (cycleway, 4.3 m) | deck 12.34 to 12.84 m | (-124.51, 12.34, -957.27), 0 |
| bridge-freedom-parkway | OSM `w156324719` (trunk, 14 m), OSM `w156324725` (trunk, 14 m), OSM `w29094065` (trunk, 14 m), OSM `w29094070` (trunk, 14 m), OSM `w44851092` (cycleway, 3 m) | deck 29.75 to 33.82 m | (356.66, 29.75, -13.44), 0 |


Heights: a building's walls run from `buildingSpan().base` (the lowest
footprint ground less 0.5 m) to `top = ground + height`, the same as the
generic extrusion and its collider. Windows are only placed where they are
above the local ground, so the downhill walls of the Telephone Factory Lofts
show more floors than the uphill walls. Bridge structure follows
`bridgeDeck()` on the OSM span of each deck.

## Assets

| File | LOD tris | Bytes | Textures | Est. GPU texture memory |
|---|---|---|---|---|
| `assets/landmarks/ponce-city-market/ponce-city-market.glb` | lod0 57,432 / lod1 6,921 / lod2 453 | 0.92 MB | 11 (9x 512x512, 1x 256x256, 1x 1024x1024) | 17.7 MiB |
| `assets/landmarks/telephone-factory-lofts/telephone-factory-lofts.glb` | lod0 2,027 / lod1 723 | 0.57 MB | 11 (10x 512x512, 1x 1024x1024) | 18.7 MiB |
| `assets/landmarks/studioplex/studioplex.glb` | lod0 5,339 / lod1 2,508 | 0.55 MB | 10 (9x 512x512, 1x 1024x1024) | 17.3 MiB |
| `assets/landmarks/new-realm-brewing/new-realm-brewing.glb` | lod0 2,336 / lod1 529 | 0.51 MB | 10 (9x 512x512, 1x 1024x1024) | 17.3 MiB |
| `assets/landmarks/bridge-north-ave/bridge-north-ave.glb` | lod0 1,444 / lod1 420 | 0.10 MB | 4 (3x 512x512, 1x 128x128) | 4.1 MiB |
| `assets/landmarks/bridge-ralph-mcgill/bridge-ralph-mcgill.glb` | lod0 828 / lod1 260 | 0.10 MB | 4 (3x 512x512, 1x 128x128) | 4.1 MiB |
| `assets/landmarks/bridge-ponce/bridge-ponce.glb` | lod0 844 / lod1 276 | 0.10 MB | 4 (3x 512x512, 1x 128x128) | 4.1 MiB |
| `assets/landmarks/bridge-freedom-parkway/bridge-freedom-parkway.glb` | lod0 9,464 / lod1 4,070 | 0.18 MB | 4 (3x 512x512, 1x 128x128) | 4.1 MiB |

GPU memory is an estimate: RGBA8 with mipmaps (w x h x 4 x 4/3) per image in
the file. All building GLBs use the same images (`lm_brick_*`, `lm_trim_*`,
`lm_concrete_color`, `lm_window_*`), and the brick/trim scans are the ones the
game already loads for the img2threejs landmarks, so a loader that shares
textures by image name pays for them once (about 18 MiB for every building
together, not 18 MiB each). GLTFLoader does not share them across files by
default.

Textures: brick and trim are the CC0 Poly Haven scans in
`assets/landmarks/textures/` (512 px); the buff brick, the lighter brick, and
the concrete are recolored from them in code; the window atlas (1024 px color,
512 px normal and roughness; 16 window cells: steel sash, storefront, door,
screen, garage door, louver, brewhouse tanks behind glass) and the fence card
(128 px PNG with alpha) are painted in code. No photo pixels.

## The landmarks

### Ponce City Market (`ponce-city-market`)

Full building, not only the tower: the 26-point footprint at 50 m (OSM
`height`), 11 floors of 4.4 m of recessed steel-sash windows between brick
pilasters (4 m bays), storefronts on the ground floor where the floor meets
the ground, a cream cornice band and parapet, the roof with 7 brick stair
and elevator bulkheads and rooftop units, the central tower (brick shaft,
belvedere with tall windows, stone bands, hipped copper roof, cap, gold
finial) at the img2threejs tower anchor, the rooftop sign frame (steel posts,
rails, back braces) at the same spot and size as the game's rooftop sign,
with the generic text "CITY MARKET" (no real lettering or logo), and a water
tower on the east roof toward the trail.

- LOD0 57,432 tris, LOD1 6,921 (flush windows, pilasters, bands), LOD2 453
  (one tiling far-facade texture per wall).
- The model replaces both the img2threejs tower top and the game's rooftop
  "PONCE CITY MARKET" sign: drop that entry from `LANDMARKS` when the GLB is
  used, and claim the footprint (`claim: true`).
- The water tower is modeled in Blender (about 600 tris); Meshy was not
  needed.
- Not modeled: the lower wings of the real building (the game footprint is
  one 50 m block; the model keeps the collider height), the real tower
  height (not verified), and the rooftop park.

### Telephone Factory Lofts (`telephone-factory-lofts`)

Buff brick with red brick piers and spandrels, wide steel multi-pane windows,
stone belts at the sill lines, a round buff chimney, rooftop units, and a
green canopy over the trail-side entry (reference: the former Western
Electric building from the Ralph McGill trail bridge). Height 9.13 m from
Overture: the real building has about 4 stories; with the slope the downhill
walls show 3 floors and the uphill walls 2.

### Studioplex (`studioplex`)

Red brick infill in an exposed concrete frame (concrete columns, floor beam,
cornice), ground floor storefronts, black screens and a garage door, sparse
upper windows, the 11 OSM courtyard holes as open light wells, and a steel
entry canopy on the Auburn Avenue wall with the fictional letters "STUDIO
YARDS". The OSM footprint runs past the level's south bound (z = 972.96), so
the south end is outside the playable area.

### New Realm Brewing (`new-realm-brewing`)

Dark brick with steel piers and belts, a glass taproom ground floor (copper
tanks behind the glass), large upper windows, and a roof deck toward the
trail: rail, wood pergola, a rooftop unit and stair, and the generic letters
"BREW HALL" on a low frame facing the trail. No real name or logo.

### Eastside Trail bridges

- `bridge-north-ave`: the two trail decks over North Avenue (OSM `w741961708`
  and the hosted `w83294497`).
- `bridge-ralph-mcgill`: the trail over Ralph McGill Boulevard (`w83291376`).
- `bridge-ponce`: the trail over Ponce de Leon Avenue (`w83291379`); only its
  south part is in the level (the level ends at z = -972.96).
- `bridge-freedom-parkway`: John Lewis Freedom Parkway (4 carriageway ways)
  and the Stone Mountain Trail over the Eastside Trail.

Trail bridges: painted steel plate girders with web stiffeners on both deck
edges, a galvanized post-and-rail fence with a mesh card on the game's 1 m
parapet, concrete abutments where the deck is above the ground, and concrete
bents where there is clearance. The road bridge: concrete fascia, 4 concrete
girders and the slab soffit under each carriageway, round-column bents, and a
steel rail on the parapet. The game still draws the deck slab and parapets;
these models dress them and do not replace them.

### Skipped

- Krog Street Tunnel: outside the current level bounds (the level ends at
  Krog Street Market). Not modeled.
- Krog Street Market: the img2threejs front stays as it is.

## Screenshots

BEFORE is the game as it is (`index.html`); AFTER is
`scripts/assets/landmarks-preview.html` (the same game, with the footprints
claimed and the GLBs added; preview only, no shared code changed). Same
camera, `quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed`,
`npcs=0&cars=0`, headless Chromium (SwiftShader).

Lineup (LOD0 / LOD1 / LOD2): ![lineup](landmarks/lineup-buildings.jpg)
![bridges](landmarks/lineup-bridges.jpg)

### Ponce City Market from the trail

BEFORE (current placeholder): ![before](landmarks/pcm-trail-before.jpg)

AFTER (GLB): ![after](landmarks/pcm-trail-after.jpg)

### Ponce City Market from the east

BEFORE (current placeholder): ![before](landmarks/pcm-wide-before.jpg)

AFTER (GLB): ![after](landmarks/pcm-wide-after.jpg)

### Telephone Factory Lofts from the Ralph McGill trail bridge

BEFORE (current placeholder): ![before](landmarks/telephone-factory-lofts-before.jpg)

AFTER (GLB): ![after](landmarks/telephone-factory-lofts-after.jpg)

### New Realm Brewing from the trail side

BEFORE (current placeholder): ![before](landmarks/new-realm-brewing-before.jpg)

AFTER (GLB): ![after](landmarks/new-realm-brewing-after.jpg)

### Studioplex from Auburn Avenue

BEFORE (current placeholder): ![before](landmarks/studioplex-before.jpg)

AFTER (GLB): ![after](landmarks/studioplex-after.jpg)

### Freedom Parkway over the trail

BEFORE (current placeholder): ![before](landmarks/bridge-freedom-parkway-before.jpg)

AFTER (GLB): ![after](landmarks/bridge-freedom-parkway-after.jpg)

### North Avenue trail bridge

BEFORE (current placeholder): ![before](landmarks/bridge-north-ave-before.jpg)

AFTER (GLB): ![after](landmarks/bridge-north-ave-after.jpg)

### Ralph McGill trail bridge

BEFORE (current placeholder): ![before](landmarks/bridge-ralph-mcgill-before.jpg)

AFTER (GLB): ![after](landmarks/bridge-ralph-mcgill-after.jpg)

### Ponce de Leon trail bridge

BEFORE (current placeholder): ![before](landmarks/bridge-ponce-before.jpg)

AFTER (GLB): ![after](landmarks/bridge-ponce-after.jpg)

## Open problems

- Integration (parent session): load the GLBs, build `THREE.LOD`s, claim the
  four footprints, drop the PCM img2threejs tower and rooftop sign, and share
  textures by image name across files.
- Murals: the game paints murals on some walls of claimed footprints (one on
  New Realm Brewing shows through the model). A claimed footprint should skip
  its murals, or the mural should move to the model wall.
- LOD1 is 9 to 35 % of LOD0 (PCM 12 %): the flush-window LOD1 keeps the bay
  grid, so less is lost at distance than the counts suggest.
- Heights are the level's (OSM/Overture); the Telephone Factory Lofts and the
  PCM wings and tower are not at their verified real heights.
- Night: the windows have no emissive map; lit windows at night need the
  game's window light or an emissive atlas.
- Performance: measured in SwiftShader only (memory note: FPS must be
  measured on a real GPU).
