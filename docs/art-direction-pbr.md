# Art direction: the pbr look (stylized PBR city)

Issue #159. The visual goal for `?look=pbr` on `epic/city-look`.

The toon look keeps its own direction (#111: Jet Set Radio flat cel shades,
thick ink lines, Hi-Fi Rush as a stretch). This doc does not change it. Both
looks share the level, the facade shader, the murals and the props; they
differ in how light falls on them.

Read with: `docs/research/2026-11-04-gen-city-auto.md` (what makes a city
look alive), `docs/murals.md`, `docs/storefronts.md`, `docs/landmarks.md`,
`docs/skate-features.md`, and the style frames in `docs/style-frames/` (#114).

## The target in one line

A sunny, warm, lived-in Atlanta you want to skate through: **warm sun, sky-lit
ambient and reflections, readable materials, saturated but not neon color,
bold original murals and signs.**

Style references (style only, nothing is copied): the web city demos named in
#144 (teleoperator.mindblown.ai, greggman.github.io/gen-city-auto). No copied
characters, logos, brands, or murals.

## Where we are today (honest frames)

Captured in the real game renderer (Playwright, Chromium + SwiftShader,
`?level=beltline-eastside&quality=high&look=pbr&view=fixed&cam=...`,
`date=06-21`, `weather=clear`, `npcs=0&cars=0`, HUD hidden). The cameras and
the script are in `scripts/art/shots-today.json` and
`scripts/art/pbr-frames.mjs`. The frames are in `docs/style-frames/today/`;
the trail, skater and night frames are also option A of their style-frame
subject, and the mural wall has its own option A camera.

| Frame | Camera (eye x, h, z → target x, h, z) | Time |
| --- | --- | --- |
| BeltLine trail, looking north | 312, 2, -175 → 334, 3, -80 | 13:30 |
| Street with storefronts and murals (Old Fourth Ward) | -80, 2.5, 640 → -120, 5, 615 | 13:30 |
| Ponce City Market from the trail | -98, 2.5, -812 → -190, 22, -858 | 13:30 |
| Skater close-up (Nia at the spawn) | 338.9, 1.4, -2.9 → 337.07, 0.95, -1.3 | 13:30 |
| Dusk on the trail | same as the trail | 20:36 |
| Night on the street | same as the street | 22:30 |

What the frames show (the gaps this doc closes):

Luma percentiles (0–255, Rec. 709) and renderer counts at 1280×720, from
the capture log:

| Frame | p2 | p50 | p98 | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| Trail 13:30 | 14 | 182 | 223 | 222 | 735k |
| Street 13:30 | 19 | 172 | 215 | 212 | 717k |
| Ponce City Market 13:30 | 14 | 67 | 208 | 134 | 300k |
| Skater 13:30 | 11 | 189 | 228 | 300 | 1.08M |
| Dusk 20:36 | 12 | 76 | 180 | 226 | 803k |
| Night 22:30 | 16 | 50 | 187 | 220 | 723k |

- **The lawn bleaches the day.** The grass scan plus the grazing sky
  reflection gives a pale mint-gray haze that fills half of the trail, street and
  skater frames (p50 172–189). No frame reaches a real highlight (p98 ≤ 228) and the
  middle is crowded: the tonal range is compressed.
- **What already reads.** Red brick and dark glass on Ponce City Market; the
  storefront row with its sign bands and the three bold murals in Old Fourth
  Ward; the warm trail concrete; Nia's orange jacket against the trail; the
  crepe-myrtle pinks; the lilac dusk sky with the first lit rooms.
- **The skater has no edge.** In the close-up Nia reads by color only; in
  the tree shade her olive pants merge with the canopy shadow. There is no
  rim or separation light.
- **Dusk and night go blue-gray.** At 20:36 the lawn and the trail turn one
  desaturated blue; at 22:30 the ground is a flat blue-gray (p50 50), the
  storefronts glow evenly, the lamp posts throw no pools, and nothing is
  brighter than the windows (no hot signs).
- **Rain at night reads as day.** With `weather=rain` at 22:00 the
  overcast sky renders pale gray-white over a night street (style frame
  night C); the rain sky must follow the time of day (#160).
- **Asphalt reads lilac.** In the mural frame the street is a pale
  lilac-gray, lighter than the sidewalk; asphalt should be the darkest
  ground in the frame (about 0.075 linear, #158).
- **Murals and signs are the strongest asset.** They are the most
  saturated, most readable surfaces in every frame; the rules below protect
  them.

## Color and palette

General rules (all neighborhoods):

- **Albedo ceiling.** No wall, ground or prop albedo above 0.6 linear
  (about `#cbcbcb` sRGB). Near-white walls and pale lawns bleach the frame
  under a 3.2 sun plus a sky environment. Trim may go to 0.7 linear on thin
  pieces only.
- **Albedo floor.** Nothing below 0.03 linear except glass and tire rubber;
  asphalt sits at about 0.075 linear (`#4d4d4d` sRGB).
- **Saturated, not neon.** Paint and murals may be saturated (HSV saturation
  up to 0.85), but only emissive signs at night go above 1.0 in value. A
  daytime surface never glows.
- **Tonal range.** A day frame spans luma p2 ≤ 20 and p98 ≥ 230 (0–255). Use
  shadows: the shade side of a building, the tree canopy, the underpass.
  Today the frames sit in the middle (see the table above); this is the first
  thing #160 fixes.
- **Accents.** Each block has one accent color that repeats (an awning, a
  sign band, a bench, a mural background), so the eye can read the
  neighborhood at speed.
- **Green.** Grass and canopy are a mid green (`#4f7a3a`–`#6f9a4a` sRGB
  albedo), never mint or gray. Crepe myrtle and dogwood pinks are the
  seasonal accent.

Per neighborhood (the district mixes in `src/level/geo/styles.js`; the hex
values are today's style colors; the target column is the rule for #157):

| District | Mix today | Wall colors today | Target palette | Accent |
| --- | --- | --- | --- | --- |
| Poncey-Highland (anchor: Ponce City Market) | storefront 45, brick loft 30, stucco 25 | brick `#9e4d3d` `#b35c42` `#8c4538`; storefront `#fac773` `#8cccd9` `#ed99a8` `#9ed199` `#f5a366`; stucco `#f2d9b3` `#f5bf9e` | Red brick and cream trim, warm storefront pastels pulled down one step (mustard, teal, coral, sage, peach at ≤ 0.6 linear) | Mustard and deep green sign bands |
| Old Fourth Ward (anchor: Iris O4W) | modern apartment 40, storefront 30, stucco 30 | modern `#e6e6e6` `#525c6b` `#f29e66` `#80a8c7`; dark trim `#383d47` | Newer city: warm gray, slate, one orange or sky-blue panel per building, dark window frames; the most murals per block | Orange panels and the trail-facing murals |
| Inman Park (anchor: Krog Street Market) | craftsman 35, shotgun 20, brick loft 25, stucco 20 | craftsman `#bf9e7a` `#9eb39e` `#e0cca8` `#99a8c7`; shotgun `#faf0d9` `#a8d1e0` `#fad699` `#d9b8db` `#b3dbb3` | Victorian and craftsman porches: sage, butter, lilac, sky blue, white trim; deep shade under porches and trees | Lilac and sage; the dogwood pink |
| Trail and parks (the BeltLine corridor) | — | trail `#e8c890` (scan), grass (scan) | Warm concrete trail, mid-green grass with paths and mulch breaking it up, painted benches | Bench and rail paint (oxblood, navy, mustard from `SIGN_COLORS`) |
| Landmarks (PCM, Krog, Telephone Factory, Studioplex) | `brick-warehouse`, `brick-market-hall` | `#944738` `#a85440`, `#994a3b` | Darker, richer historic brick than the lofts around them, so the landmark reads as the anchor | The fictional rooftop signs |

Today's values over the albedo ceiling (fix in #157): stucco `#f2d9b3`
`#fae6c2`, modern `#e6e6e6`, shotgun `#faf0d9`, storefront `#fac773`, and the
white `#ffffff` trims. Pull each down to ≤ 0.6 linear and keep the hue.

## Materials and roughness

Metal/rough standard materials everywhere under `?look=pbr` (#157 acceptance:
no leftover toon material on the level, skaters, NPCs, traffic or landmark
GLBs). Ranges per class; today's value from `src/render/look.js` `ROUGHNESS`
where there is one:

| Class | Roughness | Metalness | Today | Notes |
| --- | --- | --- | --- | --- |
| Brick | 0.80–0.92 | 0 | wall 0.88 | Mortar a little rougher than the face; no normal map below one texel per joint |
| Stucco, painted wall | 0.75–0.90 | 0 | wall 0.88 | Painted brick ~0.75 (it shines a little at grazing light) |
| Glass (windows, storefronts) | 0.04–0.12 | 0 | glass 0.08 | Day: reflects the sky, interiors 5–10× darker than the wall; per-pane normal wobble ~0.035 rad |
| Asphalt | 0.85–0.95 dry, 0.12–0.3 wet | 0 | ground 0.95 | Wet: albedo × ~0.35, puddles at 0.12 (`uWet`) |
| Concrete (sidewalk, trail, ledges) | 0.75–0.92 | 0 | ground 0.95 | Worn edges of ledges and coping 0.5–0.6 (they are polished by grinds) |
| Grass, mulch, soil | 0.92–1.0 | 0 | ground 0.95 | Env light × 0.4 (today) so grazing Fresnel does not haze the lawn |
| Mural paint | 0.70–0.85 | 0 | mural 0.85 | Roughness atlas varies it with the paint layer (`createMuralRoughness()`, docs/murals.md) |
| Sign paint, awning cloth | 0.6–0.9 | 0 | props 0.8 | Awnings 0.85–0.9 (canvas) |
| Painted metal (rails, benches, poles) | 0.35–0.6 | 0.6–1.0 | props 0.8 | Grind rails: bare steel 0.25–0.4, metal 1 |
| Car paint | 0.2–0.4 | 0 (clearcoat if the tier pays) | GLB | Glass 0.05 |
| Skin | 0.45–0.6 | 0 | GLB | Never below 0.4: no plastic skin |
| Cloth (clothes) | 0.7–0.95 | 0 | GLB | Satin jackets 0.45–0.55 |
| Skate boots and wheels | boot 0.4–0.6, wheel urethane 0.35–0.5 | 0 | GLB | Plates and trucks metal 1, 0.3–0.45 |

Rules:

- Roughness carries the material read at a distance, not the normal map.
  Each class keeps its range so the glass, the wet street and the rails
  are the only shiny things.
- No baked light in albedos (#158 rejects candidates with baked shadows):
  the sun and the sky environment light the ground.
- Metal is only for real metal. No metal-looking paint at metalness 0.5.

## Lighting and time of day

The day is the weather clock (`src/render/weather-view.js`, `?time=`,
`?date=`, `?weather=`). The pbr look uses Neutral tone mapping, exposure
1.0, a 3.2 sun, and the sky environment at 0.6 (`LOOKS.pbr` in
`src/render/look.js`).

| Time | Key light | Fill and reflections | Grade | Must read |
| --- | --- | --- | --- | --- |
| Morning (8–10) | Low warm-white sun from the east, long soft shadows | Cool blue sky fill, strong sky reflections on glass | Neutral, slightly cool shadows | Dew-fresh, clean |
| Midday (11–16) | High sun, short hard shadows, warm white | Sky environment carries the shade; GTAO in corners | Light contrast lift (1.06–1.12) | The default; walls, ground and skaters read at skating height |
| Golden hour (18–20, summer) | Low orange sun (airmass transmittance), long shadows down the trail | Warm bounce, blue shade | Warm highlights, cool shadows (`uWarm` up) | The hero time for murals and the trail |
| Dusk / blue hour (20.5–21.5) | Sun gone; sky glow | Deep blue sky, first lit windows (`uLit`), lamps on | Cool, lifted blacks | Lit windows and signs start to count |
| Night (21.5–5) | Street lamps (warm 4000 K pools, ~60° cone), lit windows, signs | City glow dome; wet streets reflect everything | Bloom only on emissive; neon is the hottest thing | Light pools with dark between them, never a gray flat night |

Rules:

- One warm key (sun or lamps) and one cool fill (sky) in every frame.
- Shadows are colored by the sky, never black and never gray haze.
- Night needs pools: the sidewalk between lamps falls near black; signs and
  neon are emissive ×8 with hot cores, brighter than lit windows.
- Weather is positive: rain is a wet, reflective, cozy city, never gloom.
  Storms are short.
- The skater stays readable against any background: a subtle rim from the
  sky environment or a grade mask around the skater (#160), no ink pass.

## Texture detail and LOD

The game runs in the browser; detail is spent where the skater is.

| Surface | High tier | Phone tier | Notes |
| --- | --- | --- | --- |
| Ground sets (#158: concrete, brick, asphalt, trail) | 1024² albedo + normal + ORM | ≤ 512² (KTX2/Basis if it pays) | Tile with no visible seam or repeat at skating height |
| Facades | Shader-driven (facade kit, storefront atlas) | Same, fewer features | Fade fine detail by screen size; far windows become flat bold colors (#160) |
| Murals | 2048² atlas (883 KB, 22.3 MB GPU) + roughness | 1024² canvas atlas | One atlas, one material |
| Skaters | 2048² body sets | 1024² | Close-up hero: the face reads at 2 m |
| NPCs | ≤ 1024² sets, 1 draw call each | 512² | No ink hull under pbr |
| Vehicles | LOD0 1024² < 25 m, LOD1 512² atlas to 70 m, LOD2 to 140 m | LOD1 near | Shared atlas, BatchedMesh |
| Trees | Leaf cards near, impostors far | Impostors | |

Budgets on the high tier at the standard cameras (today, measured with the
frames above): 134–300 draw calls and 0.3–1.1 M triangles (the table above; the skater close-up is the heaviest view because the trail, the bridge and the full-detail skater are all near). #160 must not raise them. Every new texture
reports its download and GPU memory, and no GLB is over 10 MB.

## Characters (skaters and NPCs in PBR)

- The skaters (Nia, Marcus) and the NPC skaters keep their glTF standard
  materials with `envMapIntensity`; the sky environment lights them. No ink
  hulls under pbr (1 draw call per NPC).
- Read at speed: a strong silhouette, one saturated main color per outfit
  (Nia's orange jacket, olive pants), and a contrasting secondary. Outfits
  avoid the dominant colors of the neighborhood they are in; the skater
  never melts into a wall.
- Skin roughness 0.45–0.6 with a soft subsurface-like warm tint in the
  shade; hair 0.5–0.7 with anisotropy off on phone. Faces read at 2 m.
- Skates: cream or colored boots, warm-colored wheels, metal plates; the
  wheels are the brightest accent on the character.
- NPCs are positive and varied: skaters, joggers, families, dog walkers,
  vendors. No police, no crime, no danger. Same material ranges as skaters,
  lower texture size.
- Animation (#107-style follow-up): blends, slide and bonk clips, foot IK so
  the skates touch stairs and ramps; real skaters and dancers review clips.

## Effects (#113)

Comic effects ride on the pbr look as a layer, not a new look:

- Speed lines at high speed: thin warm-white streaks at the frame edge,
  additive, never covering the skater.
- Impact frame on a bonk and a hard landing: 2–3 frames of a radial burst in
  the accent color, not a full-screen flash.
- Bursts on a grind start and on-beat moves (#118): small star or ring decals
  in the district accent, with bloom only on the hot core.
- Off on the low tier and with `prefers-reduced-motion`.
- Effects are emissive overlays; they never change materials or the grade.

## What stays out (AGENTS.md political rules)

- Every neighborhood at its best: no decline, no stigma, no boarded windows,
  no trash, no ruins.
- No crime, police, or traffic danger as content. Obstacles are cones,
  crowds, and construction.
- Murals, not graffiti; no tags. All murals and signs are original. No real
  brands or logos, no copies of real artists' work. Shop and landmark signs
  are fictional or plain.
- Facts are positive or neutral, sourced from the open data catalog.
- Real skaters review the move set before release.

## Style frames (#114)

Options per subject in `docs/style-frames/<subject>/`, each image with its
`<frame>.provenance.json` and a folder `provenance.json` listing them, and a contact sheet of all options grouped by subject in
`docs/style-frames/contact-sheet.jpg`. The owner chooses the frames to keep;
the chosen ones replace the option lists below.

All frames are 1280×720 JPGs from the real renderer at fixed cameras;
paintovers are scripted ImageMagick passes over a capture (`scripts/art/paintover.sh`),
not image-model output. Rebuild: `node scripts/art/pbr-frames.mjs` then
`node scripts/art/style-frames.mjs --raw <frames dir>`.

Today (`docs/style-frames/today/`): `trail.jpg` (BeltLine trail, 13:30), `street.jpg` (O4W storefronts + murals, 13:30), `pcm.jpg` (Ponce City Market, 13:30), `skater.jpg` (Skater close-up (Nia), 13:30), `dusk.jpg` (Trail at dusk, 20:36), `night.jpg` (Street at night, 22:30).

**BeltLine street** (`docs/style-frames/beltline-street/`):

- `a-today.jpg` — today, 13:30 (`today-trail`)
- `b-golden.jpg` — golden hour 19:12, warm grade (`trail-b-golden`)
- `c-morning.jpg` — morning 9:30, sky-lit fill (`trail-c-morning`)
- `d-paintover-trail.jpg` — paintover: green lawn, tonal range (paintover `day` of `today-trail`)
- `e-paintover-street.jpg` — paintover: O4W storefront street (paintover `day` of `today-street`)

**Skater close-up** (`docs/style-frames/skater-close-up/`):

- `a-today.jpg` — today, 13:30 (`today-skater`)
- `b-golden.jpg` — golden hour 19:12, warm rim (`skater-b-golden`)
- `c-skylit.jpg` — overcast, sky-lit soft light (`skater-c-skylit`)
- `d-paintover.jpg` — paintover: green lawn, tonal range (paintover `day` of `today-skater`)

**Mural wall** (`docs/style-frames/mural-wall/`):

- `a-today.jpg` — today, eye level, 13:30 (`mural-a-today`)
- `b-golden.jpg` — golden hour 18:30, over the trees (`mural-b-golden`)
- `c-o4w-morning.jpg` — O4W mural, morning 10:00 (`mural-c-o4w-morning`)
- `d-paintover.jpg` — paintover: bolder paint, tonal range (paintover `mural` of `mural-a-today`)

**Night scene** (`docs/style-frames/night/`):

- `a-today.jpg` — today, street 22:30 (`today-night`)
- `b-bluehour.jpg` — blue hour 21:00, more bloom (`night-b-bluehour`)
- `c-wet.jpg` — rain at 22:00 (today the rain sky reads day-gray) (`night-c-wet`)
- `d-trail.jpg` — trail at 22:30, more bloom (`night-d-trail`)
- `e-paintover.jpg` — paintover: lamp pools, hot signs (paintover `night` of `today-night`)

## Follow-ups that use this doc

- **#157** PBR materials and the Atlanta palette: apply the albedo ceiling and
  the roughness table; write `docs/style-sheet-pbr.md` from the palette
  section.
- **#158** PBR ground textures: concrete, brick, asphalt, trail sets that fit
  the palette and roughness ranges; no baked light.
- **#160** PBR look pass: tonal range, sun and sky tuning, per-neighborhood
  grade and fog, far windows as bold colors, the skater rim.
- **#106-style (PBR) textures and murals**: per-neighborhood material sets
  and more original murals for the pbr look (the toon #106 stays as is).
- **#107-style (PBR) animation**: clip blends, slide and bonk clips, foot IK;
  the skater close-up frames are the target for how the skater sits in the
  light.
- **#113** comic effects and **#118** the beat-driven world, layered on top.
