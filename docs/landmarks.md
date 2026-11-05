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
| `assets/landmarks/ponce-city-market/ponce-city-market.glb` | lod0 32,522 / lod1 6,053 / lod2 341 (4 sections) | 0.72 MB | 13 (7x 512x512, 5x 256x256, 1x 64x64) | 11.0 MiB |
| `assets/landmarks/telephone-factory-lofts/telephone-factory-lofts.glb` | lod0 3,769 / lod1 1,101 | 0.50 MB | 12 (8x 512x512, 4x 256x256) | 12.0 MiB |
| `assets/landmarks/studioplex/studioplex.glb` | lod0 4,274 / lod1 1,593 | 0.44 MB | 11 (7x 512x512, 4x 256x256) | 10.7 MiB |
| `assets/landmarks/new-realm-brewing/new-realm-brewing.glb` | lod0 2,352 / lod1 529 | 0.42 MB | 11 (7x 512x512, 4x 256x256) | 10.7 MiB |
| `assets/landmarks/bridge-north-ave/bridge-north-ave.glb` | lod0 1,444 / lod1 420 | 0.09 MB | 4 (2x 512x512, 1x 128x128, 1x 256x256) | 3.1 MiB |
| `assets/landmarks/bridge-ralph-mcgill/bridge-ralph-mcgill.glb` | lod0 828 / lod1 260 | 0.08 MB | 4 (2x 512x512, 1x 128x128, 1x 256x256) | 3.1 MiB |
| `assets/landmarks/bridge-ponce/bridge-ponce.glb` | lod0 844 / lod1 276 | 0.08 MB | 4 (2x 512x512, 1x 128x128, 1x 256x256) | 3.1 MiB |
| `assets/landmarks/bridge-freedom-parkway/bridge-freedom-parkway.glb` | lod0 7,706 / lod1 3,406 | 0.15 MB | 4 (2x 512x512, 1x 128x128, 1x 256x256) | 3.1 MiB |

GPU memory is an estimate: RGBA8 with mipmaps (w x h x 4 x 4/3) per image in
the file. All building GLBs use the same images (`lm_brick_*`, `lm_trim_*`,
`lm_concrete_color`, `lm_window_*`), and the brick/trim scans are the ones the
game already loads for the img2threejs landmarks, so a loader that shares
textures by image name pays for them once (about 18 MiB for every building
together, not 18 MiB each). GLTFLoader does not share them across files by
default.

Textures: brick and trim are the CC0 Poly Haven scans in
`assets/landmarks/textures/` (512 px; roughness stored at 256 px); the buff
brick, the lighter red brick, and the concrete are recolored from them in
code, and every red brick (PCM, PCM dark, Studioplex, New Realm, the
Telephone Factory piers) is the one lighter red image times a glTF
`baseColorFactor`, so the raw scan color is no longer in any file. The window
atlas is painted at 1024 px and stored at 512 px (color, normal) and 256 px
(roughness, `lm_window_emit`): 16 cells (steel sash, storefront, door,
screen, garage door, louver, brewhouse tanks behind glass); the fence card
(128 px PNG with alpha) is painted in code. No photo pixels.

Night windows: `lm_window` and `lm_far_pcm` carry an emissive map (warm room
light on the glass, none on the frames, dimmer behind blinds and curtains)
and every window has a light key in TEXCOORD_1 u (a random 0..1 per window,
0..0.5 for shops). `src/render/landmark-models.js` patches those materials
with the facade rule of `geo-view.js`: a window glows when its key is under
`windowLit * 0.6`, at `windowLit` strength, reading the `uLit` uniform that
`weather-view.js` sets on the facade materials (found in the scene, so
`main.js` is unchanged; `setWindowLit(v)` overrides it). In the day
`windowLit` is 0 and nothing glows.

LOD and shadows: PCM is split into a 2 x 2 grid of sections
(`ponce-city-market_s<i>_lod<n>`, each node at its section center; every
wall goes whole to the section of its midpoint at every LOD, so mixed LODs
leave no gaps), each its own `THREE.LOD` (LOD1 at 110 m, LOD2 at 320 m from
the section center), so only the sections near the camera use LOD0.
Materials that differ only by a color factor (PCM dark brick, sills, cream
trim) are drawn as their base material with a vertex color (COLOR_0): fewer
primitives, so fewer draw calls per section. Landmark meshes no longer cast
shadows; each GLB gets one shadow proxy (its coarsest LOD merged into one
position-only mesh, fences left out) that casts for it, on layer 7, which
`landmark-models.js` enables on the shadow cameras of the scene's shadow
lights, so the proxy costs no main-pass draw call.

## The landmarks

### Ponce City Market (`ponce-city-market`)

Full building, not only the tower: the 26-point footprint at 50 m (OSM
`height`), **9 floors** of 5.36 m (NRHP: nine stories plus basement in every
section of the 1926 building and its 1966/1971 warehouse wings) of recessed
tripartite steel-sash windows between brick pilasters (4 m bays),
storefronts on the ground floor where the floor meets the ground, a cream
cornice band and parapet, shaped parapets with a rounded center over the two
end blocks of the Ponce de Leon Avenue facade, the roof with brick stair and
elevator bulkheads and rooftop units, the central tower on the projecting
central block of the Ponce facade (two brick stages with windows, a stage
with two tall arched windows a side, stone bands, overhanging eaves, a
pyramidal copper roof), and the rooftop sign frame (steel posts, rails, back
braces) at the same spot and size as the game's rooftop sign, with the
generic text "CITY MARKET" (no real lettering or logo). No rooftop water
tower: the NRHP form puts the large water tank inside the tower.

- LOD0 32,522 tris (was 57,432; no sill boxes, 9 instead of 11 floors),
  LOD1 6,053 (flush windows, pilasters, bands), LOD2 341 (one tiling
  far-facade texture per wall), each split over 4 sections.
- The lower part: the one-story 1926 shipping room on the south side is its
  own OSM footprint (`w619595557`), a generic building, now 7 m (one tall
  retail floor) instead of 10 m by a height override in
  `levels/beltline-eastside/heights.json`.
- The model replaces both the img2threejs tower top and the game's rooftop
  "PONCE CITY MARKET" sign: drop that entry from `LANDMARKS` when the GLB is
  used, and claim the footprint (`claim: true`).
- The water tower is modeled in Blender (about 600 tris); Meshy was not
  needed.
- Not modeled: the rooftop park. The tower stage heights above the roof
  (10.7 m of brick, 7.2 m arched stage, 5.2 m roof) are estimated from the
  photo references, not sourced.

### Telephone Factory Lofts (`telephone-factory-lofts`)

Buff brick with red brick piers and spandrels, wide steel multi-pane windows,
stone belts at the sill lines, a round buff chimney, rooftop units, and a
green canopy over the trail-side entry, and the Art Deco entrance tower on
the Ralph McGill Boulevard wall (brick shaft with a window strip, two
setbacks, 23 m above the street) (reference: the former Western Electric
building from the Ralph McGill trail bridge). **4 stories, 17.8 m** (4 x
about 4.2 m factory floors + parapet), a height override (was 9.13 m from
Overture), and the 75 ft (23 m) tower, from
[Wikipedia: Telephone Factory Lofts](https://en.wikipedia.org/wiki/Telephone_Factory_Lofts):
"a four-story main building, a single-story warehouse section, and a 75-foot
Art Deco entrance tower". The game has one height per footprint, so the
single-story warehouse section is 4 stories too.

### Studioplex (`studioplex`)

Red brick infill in an exposed concrete frame (concrete columns, floor beam,
cornice), ground floor storefronts, black screens and a garage door, sparse
upper windows, the 11 OSM courtyard holes as open light wells, and a steel
entry canopy on the Auburn Avenue wall with the fictional letters "STUDIO
YARDS". The OSM footprint runs past the level's south bound (z = 972.96):
the model is cut 1 m inside it (the cut is a wall like the others), and
courtyard holes past the cut are dropped. `sites.json` now carries the level
`bounds`.

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

Lineup (rows LOD0 / LOD1 / LOD2; GLTFLoader + DRACOLoader load check):

![lineup](landmarks/lineup-buildings.jpg)

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
- Heights: sourced storeys (PCM 9 at 50 m, NRHP; Telephone Factory 4 at
  17.8 m and its 23 m tower, Wikipedia; the PCM shipping room 1 story at 7 m,
  NRHP). The PCM total height stays the OSM 50 m (no source found for the
  roof height in meters).
- The game's generic footprint of Studioplex still runs past the south bound
  (the model is cut; `claimLandmarkModels()` hides the generic one).
- Performance: measured in SwiftShader only (memory note: FPS must be
  measured on a real GPU).
