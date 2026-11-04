# gen-city-auto: what makes the city look alive

Source: https://github.com/greggman/gen-city-auto (cloned 2026-11-04, ~55k lines of TS + WGSL, raw WebGPU, no libraries, <500 kB). The repo carries its own art-direction doc (`agents/art-direction.md`) that diagnoses exactly the problems our pbr spike screenshots show: a "bleached, low-contrast white-box city". The quality is calibration and context, not geometry.

## What carries the look

1. **Tonal range first.** Their day frames spanned luma 8–240; ours sit in the middle. Fixes they used: darker albedos (walls × 0.68, nothing above 0.6 linear, asphalt 0.075), histogram exposure metering (average only the 40th–95th percentile bins, clamp to ±1 stop around a physical baseline), AgX tonemap + adaptive levels stretch, and a per-time-of-day split-tone white balance before the tonemap. (`src/shaders/post.wgsl`, `agents/art-direction.md` R7-2, change 1–2.)
2. **Sun color from airmass transmittance**, not a hand-tuned gradient: Kasten-Young airmass + Rayleigh/aerosol/ozone optical depths, then a golden-hour boost. Same world frame as ours (+x east, +z south). (`src/world/sky.ts`.) **Adopted** in `src/sim/weather.js sunTransmittance`.
3. **Daylit rooms are dark** — 5–10× darker than the facade; the sky reflection dominates. At night lit rooms become the light source, and lit-room light spills onto the window reveal. **Adopted**: our facade `roomGlow` now scales 0.05→~0.9 by `uLit` instead of a fixed 0.2–0.24.
4. **Glass cues**: a per-pane normal wobble (~0.035 rad) so adjacent panes reflect different sky — the strongest "this is glass" cue at distance. Per-window lit/unlit hash with warm (mostly) and cool (some) interior colors. Partially adopted (lit-window hash + warm/cool glow in the facade shader); the pane wobble is a small follow-up for the pbr branch.
5. **Facade self-shadowing** — a sun-visibility term in the surface: lintel shadow bands across the top of every window and a slab shadow line per floor, computed in tangent space from the sun direction. The single biggest "not a box" cue. Not yet adopted; candidate for the pbr branch.
6. **Wet streets**: wetness soaks fast (~20 s) and dries over ~2.5 clock hours; puddles get a damp gradient edge, rough ~0.12, albedo ~0.35 of dry; overcast reflections dimmed ×0.85. **Adopted** the soak/dry memory (`wetAt` over the last 3 h) and the darken+roughness hooks (`uWet`).
7. **Rain**: a 45-line shader — streak quads in a 36 m box that wraps around the camera, velocity = wind + fall speed, streak length ~1/50 s exposure, additive-over blend tinted by sky ambient ×1.9 + city glow ×6. **Ported** to `src/render/rain.js` (instanced geometry, premultiplied over-blend).
8. **Life**: pedestrians are instanced variants walking a sidewalk offset of each road chain, density weighted by hubs (Gaussian falloff, ~420 within 160 m of camera); traffic follows lanes with IDM car-following, turn indicators, and per-wheel steering. Vehicle emissive: brake `vec3(1,0.04,0.02) * (lightsOn*3 + brake*8)`, headlights when `lightsOn` (dusk/rain/night). Our `claude/132-cars` branch already does parked cars + calm traffic; its headlights should key off our `windowLit`/`night` factor.
9. **Street clutter**: one object every ~4 m of sidewalk — guardrails, bollards, bikes, vending machines, bus stops, planters, manholes. Our prop batch has the mechanism; density and night emissive (lit bus-stop panels, vending machines) are the gap.
10. **Street lights at night**: real light pools — a ~60° downward cone, warm 4000K LED `[1.0,0.88,0.72]` (sodium as a sparse accent), sidewalk between lamps falls to near black, and a faint city-glow dome lifts the sky. The cityGlow ambient term is **adopted** in `skyState.glow`.
11. **Weather transitions**: a target-state machine — `{sunny,cloudy,rain,storm}` → `{cloud,rain,fog,wind}` targets, exponential lerp (~7 s), lightning flicker timer in storms. We do the same lerp shape in `weather-view.js` but the targets come from a deterministic day/hour draw (Atlanta climate normals) instead of a Markov cycle.

## Things they warn against (their own "stop doing" list)

- Near-white wall albedo (>0.6 linear) → bleached look. Our palette needs the same check in the pbr branch.
- A single constant ambient for the whole city — alleys must get less sky than rooftops (they rasterize a 2048² height map and march horizon visibility per pixel; GTAO gets us partway).
- Omnidirectional street lights (no pools), cold-blue LED color, and neon barely brighter than lit windows (neon must be the hottest thing at night: emissive ×8, `c*c*1.5` for hot cores).
- Crosswalks/markings at 0.75 albedo — they out-shine everything; drop to ~0.55 with wear.
- Uniform featureless lawns — break up with noise, paths, trees.

## Pipeline notes

- Cities are generated per-tile in a **worker**; `gen-tile.ts` (11k lines) builds facades with interior-mapped rooms, reveal parallax, shopfronts, fins, ledges — the same interior-mapping idea as our facade shader, deeper (reveal side faces, sun-visible reveal lighting, blinds/curtains).
- Everything is instanced/batched; cars and peds are skinned-variant instances drawn in one call per material family.
- They verify with puppeteer screenshot matrices across time/weather and luma-percentile gates — worth copying for our `e2e/__screenshots__` flow: gate on p2/p98 luma bands per scene, not just "no console errors".
