# ATL Arcade — agent guide

Read this first. Then read `docs/games/2026-10-30-skate-atl-concept.md` (the concept, v2) and `production/session-state/active.md`.

## What this is
Skate ATL: a free-skate roller skate game in real Atlanta neighborhoods, Tony Hawk's Pro Skater movement with Jet Set Radio style, in the browser with Three.js. Goal: the official game of the City of Atlanta. Agents and MCPs build it; no human scene editor.

## Rules
- Three.js + Vite. No Phaser for new work. The old Phaser scaffold and `prototypes/beat-lock-concept/` are history; do not extend them.
- Prototype code under `prototypes/` never imports production code under `src/`, and production never imports prototypes.
- Keep the skate controller and scoring as pure modules with Vitest tests. Rendering stays separate.
- Verify in a real browser with Playwright (headless). Screenshots are evidence. Do not claim "it works" without a run.
- Use dependency versions published at least 7 days ago.
- Never commit secrets, GLB files over 10 MB, or generated art without a `provenance.json` next to it (tool, prompt, credits, date).
- Record decisions in `docs/decisions.md`.

## Political rules (the game must shine a positive light on Atlanta)
- Every neighborhood is shown at its best. No decline, no stigma.
- No crime, police, or traffic danger as content. Obstacles are cones, crowds, and construction.
- Murals, not graffiti.
- Facts are positive or neutral, sourced from the open data catalog. Landmark story cards may also cite a public source (see `docs/decisions.md`, 2026-11-07).
- Real skaters review the move set before release.

## Pipeline
- Skater: Meshy or Tripo (MCP) model in T-pose → rig and animate → Blender-MCP cleanup and Draco → glTF → Three.js `GLTFLoader` + `AnimationMixer`. Reference: RenderATL Rush branch `codex/196-3d-spike`, `docs/spikes/threejs-demo/`.
- Neighborhoods: OpenStreetMap / Overture footprints + Atlanta open data → extruded, cel-shaded blocks in JavaScript. Rails, ledges, ramps placed by script on real features.
- Data API: the open-data-atl site (`https://github.com/William-Hill/open-data-atl`) serves neighborhoods, datasets, and fact cards.

## Work order
Follow the GitHub milestones in order: M0 Greybox movement prototype → M1 Playable block → M2 Version 1. Each issue has acceptance criteria. Do not start M1 before the M0 playtest verdict is PROCEED.
