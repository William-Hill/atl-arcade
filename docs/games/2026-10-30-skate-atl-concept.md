# Skate ATL — Game Concept

**Date:** 2026-10-30
**Status:** Concept, approved in brainstorm. Working title.
**Home:** This file moves to the new game repo when that repo exists.
**Method:** Game concept brainstorm (MDA, Self-Determination Theory, pillars, Bartle types, nested loops). Review mode: lean, director gates skipped.

## 1. Core identity

| Field | Value |
|---|---|
| Working title | Skate ATL (placeholder) |
| Elevator pitch | A rhythm-and-flow roller skate game on real Atlanta routes. Push on the beat, grind real rails, dance the flat stretches, and finish at the rink. Every landmark is real, and every collectible is a real fact from Atlanta open data. |
| Core verb | Flow (push, grind, dance, land) |
| Core fantasy | I skate my city, and I look good. |
| Unique hook | Like OlliOlli, and also every route is a real Atlanta street with real landmarks, and the skating comes from Atlanta rink culture. |
| Primary MDA aesthetic | Sensation and challenge. Secondary: discovery. |
| Platform | Web, desktop and mobile touch |
| Engine | Phaser 4 and Vite, forked from the RenderATL Rush architecture |
| Estimated scope | Version 1: 6 to 8 weeks, solo. Full vision: 6 to 9 months, solo. |

## 2. Creative brief

The maker wants a game that rewards mastery first and teaches Atlanta second. Their taste is action-adventure and role-playing, so they respond to characters, progression, and consequences. Their city game memories are SimCity and Oregon Trail. They have weeks for a first playable, and 15 years of software work, with one shipped Phaser game (RenderATL Rush). The game must run in the browser.

## 3. Why this game

- Roller skating is a real and loved part of Atlanta culture: Cascade, Golden Glide, adult skate nights, the film *ATL*. No other city can claim it. No game serves rink culture.
- It is politically safe. The goal is the official game of the City of Atlanta. Nobody gets blowback from roller skates.
- The art pipeline exists. Crossroads measured the cost of a cel-shaded character from Meshy at about 150 to 180 credits. RenderATL Rush has the Phaser shell, the pseudo-3D road, the parallax system, the leaderboard, and the tests.

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
| 2 | Every route is real | Every level is a graph of real streets with real landmarks in order. Every fork is a real intersection. | If a feature needs a fake street, drop the feature. |
| 3 | The city teaches, the game never lectures | Facts arrive as collectibles, one line each, and never pause play. | If a learning moment stops the skating, move it to the results screen. |
| 4 | Atlanta looks good | Every neighborhood is shown at its best. | If an asset shows decline, redraw it. |
| 5 | Style is Atlanta | The skating comes from rink culture, and the moves must look like it. | If a trick looks like skateboarding, replace it with a rink move. |

Tension: pillar 1 and pillar 3 pull against each other. With no fail state, the challenge must come from the combo ceiling, and the fact cards must not dilute it.

### Anti-pillars

- No open world. Branching routes with forks at real intersections (OutRun style), never free roam. Free roam breaks pillar 2 on a weeks budget.
- No graffiti. Murals only (pillar 4).
- No licensed hit music in version 1. Local artists or original tracks.
- No traffic or crime hazards.
- No multiplayer in version 1.
- No story campaign in version 1.

## 6. Core loop

### 30-second loop
The player pushes on the beat to build speed, drops into a grind on a real feature (a BeltLine rail, a MARTA bench), and lands a trick on the exit. On flat stretches with no rails, dance moves on the beat keep the combo alive. A clean landing extends the combo. A missed beat drops speed, not life. Feedback: music lock, landing sound, combo counter, style meter.

### Dance and style system
- Flat sections: dance moves fill the gaps between rails and keep the combo alive. Grinds are for rails, style is for the open road.
- Style meter: a second meter next to speed. Dance moves fill it. A full meter unlocks a signature move with a large score bonus.
- The rink: every neighborhood set ends in a rink stage. No route, pure rhythm, a crowd, call-outs. It is the boss stage.

### City shape: branching routes
Each neighborhood is a route graph, in the style of the Rush Connector Sprint pseudo-3D road. The road is built from pieces (`sim/road3d.js`), plus one new piece type: a fork. At a real intersection the player leans left or right and takes a different real street. One neighborhood has 2 to 4 forks and 4 to 8 real segments. Different paths hide different fact cards, so the player replays the neighborhood to find them. The rink is the final node of the graph.

### 5-minute loop
One route is one song, 2 to 3 minutes. Each route has three goals: finish, hit the combo target, find the 3 fact cards. The next medal and the next card drive "one more run."

### Session loop
3 to 5 routes, 15 to 25 minutes. Natural stop: the end of a neighborhood set at the rink. Hook outside the game: per-route leaderboard and a share card (both exist in Rush).

### Progression loop
Routes unlock by medals. Skaters and outfits unlock by fact cards. Knowledge is the progression currency.

### Motivation (Self-Determination Theory)
- Autonomy: route choice, line choice, skater choice.
- Competence: the combo ceiling, the style meter, the medals.
- Relatedness: real places the player knows, the rink crowd, the leaderboard.

### Flow state
Difficulty rises through route density (more rails, tighter beat windows) and never through punishment. The rink stage is the peak of each set.

## 7. Player types

- Primary: Achievers and Competitors (combo ceilings, medals, leaderboards).
- Secondary: Explorers (fact cards, landmarks). Atlanta locals of every type, because recognition is the hook.
- Not for: sandbox players, story players, multiplayer players.
- Market signal: OlliOlli World sold well on rhythm-flow skating. Bomb Rush Cyberfunk revived the Jet Set Radio form in 2023. Rink culture has no game.

## 8. Data integration

- Route graphs: real street centerlines from the open data catalog, one graph per neighborhood. Forks at real intersections. Landmarks, rails, benches, and murals placed at real positions.
- Fact cards: one-line facts from the open data catalog, each with a dataset source. Served by the open-data-atl tools API.
- Neighborhood sets: the real neighborhood list and boundaries from the site.
- Leaderboard: per route, reuses the Rush leaderboard client.

## 9. Art and audio pipeline

- Skater: Meshy or Tripo model in T-pose, Meshy rig and animate, Blender cel render to 8-direction sprite sheets (Crossroads `pipeline/blender-cel.py`). About 150 to 180 credits per skater.
- Routes: Rush pseudo-3D road (`Driving3DScene`, `sim/road3d.js`) for forward motion, with a new fork piece for intersections, and parallax neighborhood plates from image generation. About 30 to 50 credits per route.
- Rink: a side-scroller or fixed-camera stage with crowd sprites.
- Music: local artists or original tracks, 4 for version 1. No licensed hits.
- Move set review: real skaters review every animation before release.

## 10. Scope tiers

| Tier | Content | Time |
|---|---|---|
| MVP (fun test) | 1 skater, 1 straight route, push, grind, 2 dance moves, combo counter, 1 track | 2 weeks |
| Ship if time runs out | MVP plus the fork piece, medals, and leaderboard | 4 to 5 weeks |
| Version 1 | 1 skater, 1 neighborhood graph with 3 forks, 1 rink stage, 9 fact cards, 4 tracks, touch controls | 7 to 9 weeks |
| Full vision | 6 neighborhoods, 4 skaters, rink crews, Atlanta Tycoon as a second mode in the same shell | 6 to 9 months |

MVP gate: if the beat lock does not feel good after 2 weeks, pivot.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Beat sync in the browser audio clock | Use the Web Audio clock, not `setTimeout`. Build the beat test first. |
| Generated skate animation quality | Pose review with contact sheets, as in Crossroads. Budget 1.5x credits for redos. |
| Music rights | Original or local tracks only. Written agreements before launch. |
| Cultural accuracy of the moves | Real skater review gate before release. |
| Political blowback | Pillars 4 and 5, the content rules in section 4, and a mayor's office partner review. |
| Scope creep toward open world | Anti-pillar. Branching routes with forks only, never free roam. |
| Fork piece in the pseudo-3D road | New simulation work, about 1 week. Build it after the MVP beat-lock passes. |

## 12. Architecture decision (recorded here until the repo exists)

- New repo, forked from the RenderATL Rush architecture. Phaser 4, Vite, Vitest, Playwright.
- Pure simulation modules under `src/sim/`, render under `src/render/`, scenes route by mode.
- Modes: Skate (first), Tycoon (second), roguelike (later). Shared: data client, neighborhood map, fact cards, leaderboard, branding.
- Deployed on Vercel. The open-data-atl site is the data API and links to the game.

## 13. Companion concepts in the same shell

- Atlanta Tycoon: SimCity-style neighborhood sim. Political frame not yet settled. Candidate frames: build toward published Atlanta goals (no fail state, positive levers only), or replay growth from 1996.
- Neighborhood roguelike: later.

## 14. Next steps

Path B, prototype first:
1. Create the new repo from the Rush architecture.
2. Build the MVP beat-lock prototype: 1 straight route on the Rush pseudo-3D road, push and grind on the beat, 2 dance moves, combo counter.
3. Generate 1 skater through the Meshy to Blender cel pipeline.
4. Playtest the beat lock. PROCEED, PIVOT, or KILL.
5. If PROCEED: art bible, then `/map-systems`, then per-system GDDs.
6. Open the conversation with the Mayor's Office of Technology and Innovation about the esports labs as a playtest group.

## Sources

- Benidorm Roblox game: https://www.theolivepress.es/spain-news/2026/05/08/benidorm-is-europes-first-city-to-launch-game-on-video-platform-used-daily-by-150-million-players/
- Stockholm and Cities: Skylines: https://www.pcgamer.com/how-cities-skylines-is-being-used-to-build-a-real-life-city-district/
- Block by Block: https://en.wikipedia.org/wiki/Block_by_Block_(program)
- NYC Video Game Festival: https://www.nyc.gov/site/mome/news/04242025-nyc-video-game-festival.page
- Atlanta esports lab: https://www.ajc.com/news/business/atlanta-officials-open-new-esports-and-computer-lab-near-downtown/KDN4PXIL6ZB4JNKO6NA2VM2TKQ/
- Crossroads cost analysis: `/Users/william-meroxa/Development/crossroads/docs/cost-analysis.md`
- RenderATL Rush: `/Users/william-meroxa/Development/renderatl-rush`
