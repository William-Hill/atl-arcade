# Comic effects draw calls (#113)

Source: `e2e/effects.spec.js`, test "the draw calls of the effects on each tier", 2026-11-08, headless Chromium (SwiftShader), 1280 x 720, BeltLine Eastside spawn, `time=14&weather=clear`, no walkers, NPC skaters or moving cars. Raw data: `draw-calls.json`.

The effect meshes count their own draws (`onAfterRender`). All effects run at the same time (speed lines, an impact frame, a grind burst and a beat burst), held still.

| Tier / look | Frame calls, no effect | Frame calls, all effects | Effect draws | Cap (`budget.json`) |
|---|---|---|---|---|
| low / toon | 79 | 79 | 0 (off) | 185 |
| phone / toon | 80 | 82 | 2 | 185 |
| phone / pbr | 88 | 90 | 2 | 185 |
| high / toon | 251 | 253 | 2 | 360 |
| high / pbr | 291 | 293 | 2 | 420 |

- No effect running: 0 draw calls on every tier. Both meshes are hidden. `npm run perf:check` measures this state, so the caps do not change.
- Effects running: 2 draw calls (the screen mesh and the burst mesh), on the phone and high tiers. Every frame stays under its cap.
- The meshes are kept out of the GTAO normal pass (`userData.overlay`), so they add no draw call there.
- Triangles: at most 40 screen quads and 48 burst quads (176 triangles).
- Frame time was not measured: the software GPU gives 0.1 FPS on high/pbr with or without the effects (`?fx=0`), so a difference cannot be seen. Measure on a real GPU before release.
