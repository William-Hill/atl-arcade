# Skate ATL — Game Concept

**Date:** 2026-10-30
**Status:** Concept, revised 2026-10-30 after the beat-lock PIVOT. Working title.
**Revision:** v2 — free skate in 3D. The v1 linear-route design is superseded; see `prototypes/beat-lock-concept/PIVOT-NOTE.md`.
**Home:** This file moves to the new game repo when that repo exists.
**Method:** Game concept brainstorm (MDA, Self-Determination Theory, pillars, Bartle types, nested loops). Review mode: lean, director gates skipped.

## 1. Core identity

| Field | Value |
|---|---|
| Working title | Skate ATL (placeholder) |
| Elevator pitch | A free-skate roller skate game in real Atlanta neighborhoods. Tony Hawk's Pro Skater movement with Jet Set Radio style: skate anywhere in the level, grind real rails and ledges, launch off ramps, and dance on the move to build style. Every block is generated from real city data, and every collectible is a real fact from Atlanta open data. |
| Core verb | Skate (move freely, grind, trick, style) |
| Core fantasy | I skate my city, and I look good. |
| Unique hook | Like Tony Hawk meets Jet Set Radio, and also every level is a real Atlanta neighborhood built from city data, and the skating comes from Atlanta rink culture. |
| Primary MDA aesthetic | Sensation and challenge. Secondary: discovery. |
| Platform | Web first, inside the open data site: phone browsers (touch) and desktop (keyboard and gamepad). Phones are the top priority (`docs/decisions.md`, 2026-11-03). |
| Engine | Three.js in the browser, with Vite. Starting point: the Rush `codex/196-3d-spike` (GLB skater, AnimationMixer, Blender-MCP cleanup). Physics: a kinematic skate controller, Rapier for collisions. |
| Estimated scope | Greybox movement prototype: 2 to 4 weeks. Version 1 (one neighborhood with art): 3 to 6 months, solo with agents. Full vision: 9 to 12 months. |

## 2. Creative brief

The maker wants a game that rewards mastery first and teaches Atlanta second. Their taste is action-adventure and role-playing, so they respond to characters, progression, and consequences. Their city game memories are SimCity and Oregon Trail. They have weeks for a first playable, and 15 years of software work, with one shipped Phaser game (RenderATL Rush). The game must run in the browser.

## 3. Why this game

- Roller skating is a real and loved part of Atlanta culture: Cascade, Golden Glide, adult skate nights, the film *ATL*. No other city can claim it. No game serves rink culture.
- It is politically safe. The goal is the official game of the City of Atlanta. Nobody gets blowback from roller skates.
- The art pipeline exists. Crossroads measured a rigged Meshy character at about 150 to 180 credits. The Rush 196 spike proved GLB to Three.js with animation, cleaned by Blender-MCP from 97,000 to 14,500 triangles. Neighborhood geometry is generated from geodata, not modeled by hand.
- Agents and MCPs build it. The whole pipeline is code and files: geodata to geometry in JavaScript, Blender-MCP, Meshy and Tripo MCPs, Playwright for headless checks. No scene editor session is needed.

## 4. Precedents and the official-game frame

Research on 2026-10-30 found no US city with an official city video game. Close precedents:

- Benidorm Fun Town Tycoon (Roblox, Benidorm city council and tourism foundation, May 2026). Singapore and Tokyo have Roblox games.
- Stockholm used Cities: Skylines to plan a district in 2016.
- Block by Block (UN-Habitat and Mojang): Minecraft for public space design, 150 projects in 55 countries.
- NYC Battle of the Boroughs: a Minecraft Education contest run by the mayor's office with public schools.
- Atlanta: the Mayor's Office of Technology and Innovation runs youth esports labs at Thomasville and a second site. This office is the natural partner and playtest group.

Political rules for the game:

1. Show every neighborhood at its best. No decline, no stigma.
2. No crime, no police, no traffic danger as content. Obstacles are cones, crowds, and construction.
3. Murals, not graffiti. Atlanta has a legal mural program.
4. Facts are positive or neutral and come from the open data catalog with a source.
5. Real skaters review the move set before release (cultural gate).

## 5. Pillars

| # | Pillar | Definition | Design test |
|---|---|---|---|
| 1 | Flow over failure | The game never kills the player. It slows them. | If a feature adds a fail state, cut it. |
| 2 | Every block is real | Every level is a real neighborhood: real footprints, real streets, real landmarks, generated from city data. | If a feature needs a fake street, drop the feature. |
| 3 | The city teaches, the game never lectures | Facts arrive as collectibles, one line each, and never pause play. | If a learning moment stops the skating, move it to the results screen. |
| 4 | Atlanta looks good | Every neighborhood is shown at its best. | If an asset shows decline, redraw it. |
| 5 | Style is Atlanta | The skating comes from rink culture, and the moves must look like it. | If a trick looks like skateboarding, replace it with a rink move. |

Tension: pillar 1 and pillar 3 pull against each other. With no fail state, the challenge must come from the combo ceiling, and the fact cards must not dilute it.

### Anti-pillars

- No seamless open city in version 1. Each neighborhood is a bounded free-roam level (THPS style). The seamless city is the full vision, not version 1.
- No graffiti. Murals only (pillar 4).
- No licensed hit music in version 1. Local artists or original tracks.
- No traffic or crime hazards.
- No multiplayer in version 1.
- No story campaign in version 1.

## 6. Core loop

### 30-second loop
The player skates freely, lines up a rail or ledge, grinds it, launches off the end, lands a trick, and keeps the combo alive with a dance move on the roll-out. Combos chain grind, air, manual, and style moves. A bail ends the combo, never the run. Feedback: speed lines, landing sound, combo counter, style meter, and an on-beat bonus when a move lands on the music.

### Dance and style system
- Style on the move: dance moves are tricks you do while you roll. They keep a combo alive between rails and score style points. Grinds are for rails, style is for the open road.
- Style meter: a second meter next to speed. Dance moves fill it. A full meter unlocks a signature move with a large score bonus.
- The rink: every neighborhood set ends in a rink stage. No route, pure rhythm, a crowd, call-outs. It is the boss stage.

### City shape: bounded free-roam levels
Each neighborhood is one skate level, 4 to 8 real blocks, with free movement in every direction. Real footprints become stylized buildings. Real streets, sidewalks, the BeltLine, and MARTA plazas become the skate surface. Rails, ledges, ramps, and the rink are placed on real features. The level has a run timer (THPS style, 2 to 3 minutes) and a goal list. Fact cards hide around the level, so the player replays it to find them.

### 5-minute loop
One run is one song, 2 to 3 minutes, in one neighborhood level. Each level has a goal list: score target, combo target, 3 fact cards, 2 landmark gaps, and the rink finale. The next goal drives "one more run."

### Session loop
3 to 5 routes, 15 to 25 minutes. Natural stop: the end of a neighborhood set at the rink. Hook outside the game: per-route leaderboard and a share card (both exist in Rush).

### Progression loop
Routes unlock by medals. Skaters and outfits unlock by fact cards. Knowledge is the progression currency.

### Motivation (Self-Determination Theory)
- Autonomy: go anywhere in the level, choose your lines, choose your skater.
- Competence: the combo ceiling, the style meter, the medals.
- Relatedness: real places the player knows, the rink crowd, the leaderboard.

### Flow state
Difficulty rises through level density (more rails, bigger gaps, harder goals) and never through punishment. The rink stage is the peak of each set.

## 7. Player types

- Primary: Achievers and Competitors (combo ceilings, medals, leaderboards).
- Secondary: Explorers (fact cards, landmarks). Atlanta locals of every type, because recognition is the hook.
- Not for: sandbox players, story players, multiplayer players.
- Market signal: OlliOlli World sold well on rhythm-flow skating. Bomb Rush Cyberfunk revived the Jet Set Radio form in 2023. Rink culture has no game.

## 8. Data integration

- Level geometry: building footprints with heights, street centerlines, sidewalks, trees, the BeltLine, and MARTA from OpenStreetMap, Overture Maps, and the Atlanta open data catalog. Extruded and stylized in code. Landmarks, rails, benches, and murals placed at real positions.
- Fact cards: one-line facts from the open data catalog, each with a dataset source. Served by the open-data-atl tools API.
- Neighborhood sets: the real neighborhood list and boundaries from the site.
- Leaderboard: per route, reuses the Rush leaderboard client.

## 9. Art and audio pipeline

- Skater: Meshy or Tripo model in T-pose, rig and animate (skate idle, push, carve, grind, air tricks, 4 to 6 dance moves, bail), Blender-MCP cleanup and Draco compression, glTF into Three.js with the AnimationMixer. Toon shading in the renderer. About 150 to 180 credits per skater.
- Neighborhood: geodata to extruded blocks in JavaScript (or Blosm in Blender), cel-shaded, with 5 to 10 landmark models per neighborhood from Meshy or Tripo. Rails, ledges, and ramps placed by script on real features, then hand-tuned by an agent with Playwright screenshots.
- Rink: an interior level with a crowd, the dance finale.
- Physics: kinematic skate controller (speed, carve, push, jump, rail snap, manual balance), Rapier for collisions with the level.
- Camera: follow camera with look-ahead, THPS style.
- Music: local artists or original tracks, 4 for version 1. No licensed hits.
- Move set review: real skaters review every animation before release.

## 10. Scope tiers

| Tier | Content | Time |
|---|---|---|
| Greybox movement prototype (fun test) | Capsule skater on one greybox block: skate, push, carve, jump, grind on 3 rails, 1 ramp, 2 style moves, combo counter, follow camera | 2 to 4 weeks |
| Playable block | Greybox plus the GLB skater with animation, one real block from geodata, goals, run timer | 2 to 3 months |
| Version 1 | 1 skater, 1 full neighborhood level with landmarks, 1 rink finale, 9 fact cards, 4 tracks, leaderboard | 3 to 6 months |
| Full vision | 6 neighborhoods, 4 skaters, rink crews, Atlanta Tycoon as a second mode in the same shell | 9 to 12 months |

Prototype gate: if free movement plus grind plus style does not feel good on a greybox block after 4 weeks, pivot or kill.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Skate controller feel (rail snap, carve, camera) built without a scene editor | Greybox prototype first. Agents tune with Playwright runs and screenshots. Study THPS controller write-ups. |
| Browser performance on phones with a 3D neighborhood | Low-poly stylized blocks, Draco, instancing, frustum culling. Phones first: touch controls and a phone quality tier are in M1 (#71, #72). |
| Generated skate animation quality | Pose review with contact sheets, as in Crossroads. Budget 1.5x credits for redos. |
| Music rights | Original or local tracks only. Written agreements before launch. |
| Cultural accuracy of the moves | Real skater review gate before release. |
| Political blowback | Pillars 4 and 5, the content rules in section 4, and a mayor's office partner review. |
| Scope creep toward a seamless city | Anti-pillar. Bounded neighborhood levels in version 1. |

## 12. Architecture decision (recorded here until the repo exists)

- Repo `atl-arcade`. Three.js, Vite, Vitest, Playwright. The Phaser scaffold from v1 stays until the Three.js shell replaces it.
- Pure simulation (skate controller, combo scoring) separate from rendering, so the controller is testable in node.
- Modes: Skate (first), Tycoon (second), roguelike (later). Shared: data client, neighborhood geometry pipeline, fact cards, leaderboard, branding.
- Deployed on Vercel. The open-data-atl site is the data API and hosts the game at a route.

## 13. Companion concepts in the same shell

- Atlanta Tycoon: SimCity-style neighborhood sim. Political frame not yet settled. Candidate frames: build toward published Atlanta goals (no fail state, positive levers only), or replay growth from 1996.
- Neighborhood roguelike: later.

## 14. Next steps

Path B, prototype first:
1. Build the greybox free-skate prototype in Three.js: capsule skater, one block, rails, a ramp, 2 style moves, combo counter, follow camera.
2. Playtest the movement. PROCEED, PIVOT, or KILL.
3. If PROCEED: generate 1 skater (Meshy or Tripo to Blender-MCP to glTF) and one real block from geodata.
4. Art bible, then `/map-systems`, then per-system GDDs (skate controller, grind system, combo and style scoring, level generation, camera).
5. Open the conversation with the Mayor's Office of Technology and Innovation about the esports labs as a playtest group.

## Sources

- Benidorm Roblox game: https://www.theolivepress.es/spain-news/2026/05/08/benidorm-is-europes-first-city-to-launch-game-on-video-platform-used-daily-by-150-million-players/
- Stockholm and Cities: Skylines: https://www.pcgamer.com/how-cities-skylines-is-being-used-to-build-a-real-life-city-district/
- Block by Block: https://en.wikipedia.org/wiki/Block_by_Block_(program)
- NYC Video Game Festival: https://www.nyc.gov/site/mome/news/04242025-nyc-video-game-festival.page
- Atlanta esports lab: https://www.ajc.com/news/business/atlanta-officials-open-new-esports-and-computer-lab-near-downtown/KDN4PXIL6ZB4JNKO6NA2VM2TKQ/
- Crossroads cost analysis: `crossroads/docs/cost-analysis.md` (a local sibling repository)
- RenderATL Rush: the `renderatl-rush` repository (a local sibling repository)
