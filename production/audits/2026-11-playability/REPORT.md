# Playability audit: Skate ATL (#65)

- Date: 2026-11-03.
- Build: `origin/main` at `90260bb` (branch `audit-65-playability`). The level is `beltline-eastside`. The skaters are Nia and Marcus.
- Method: four agents ran the game design skills by hand. Each agent played the build in headless Playwright and saved evidence. A person reviewed the summaries and spot-checked the key claims.
- Weight: mobile playability is the top priority (`docs/decisions.md`, 2026-11-03). Every finding has a phone impact.

## Verdict: FAIL

A phone player cannot skate. On every device, the run has no goal and no end, and the only real level has nothing to grind. The movement feel, the skater models, and the map accuracy are good bases.

## Scores (1 to 5)

| Area | Score | Detail |
|---|---|---|
| Mobile playability | **1** | [mobile/FINDINGS.md](mobile/FINDINGS.md) |
| Educational quality | **1** | [education-accuracy/FINDINGS.md](education-accuracy/FINDINGS.md) |
| Funness | **2** | [fun-gameplay/FINDINGS.md](fun-gameplay/FINDINGS.md) |
| Gameplay | **2** | [fun-gameplay/FINDINGS.md](fun-gameplay/FINDINGS.md) |
| Graphics | **3** | [graphics-characters/FINDINGS.md](graphics-characters/FINDINGS.md) |
| Characters | **3** | [graphics-characters/FINDINGS.md](graphics-characters/FINDINGS.md) |
| Real-world accuracy | **4** | [education-accuracy/FINDINGS.md](education-accuracy/FINDINGS.md), [landmarks.csv](education-accuracy/landmarks.csv) |

## Summary by area

### Mobile (1)

- The game has no touch input. A tap, a hold, and a swipe do not move the skater. A drag turns only the camera.
- A phone GPU gets the `high` tier: 186–250 draw calls and 467k–595k triangles. The `low` tier has 45 draw calls and 95k triangles.
- The first load is 6.93 MB in 31 requests. On an emulated Fast 4G link with a 4x CPU throttle, the first game frame comes at 6.6 s. The game has no load screen.
- All hints name keys. At 390x844 the attribution covers the score and the skater buttons.
- In landscape, the skater is about 50 CSS px tall.

### Fun and gameplay (2 and 2)

- Push, carve, jump, and the dances feel good. The greybox has a working 30-second loop: grind, hop, dance, and vert air.
- The BeltLine level has 0 objects: no rails, ledges, or ramps. A grind is not possible there.
- No run timer, goals, results screen, or restart exists. Nothing gives a reason for one more run.
- The score has no ceiling. Hold W+Q for 120 s: 99 links and 1,470,150 points. A spin dance earns more points per second (267) than a grind (160).
- A wall hit stops the skater dead (#58).
- The first 30 seconds teach nothing. The only help is a 45-word key list with developer items.

### Graphics and characters (3 and 3)

- The `high` tier on a real GPU looks good and reads at phone size. No political-rule violations were found in 87 shots.
- The `low` tier loses the Jet Set Radio look: the city has no ink and no halftone.
- No art bible exists (#16).
- The toon pass removes Nia's face decals, so blink, smile, and cheer do not show in the game.
- The NPCs are box bodies with faceless heads.
- Real skaters have not reviewed the 24 clips. AGENTS.md requires that review before release (#22).

### Education (1)

- The game has no fact cards (#17). The concept makes knowledge the progression currency, so this gap removes a pillar.
- Mural words come from a hash. 6 of 39 BeltLine murals say "SWEET AUBURN", which is a different neighborhood.
- The audit drafted a fact-card spec and 9 sourced candidate facts. 8 come from the Atlanta open data catalog. 1 needs a review.

### Real-world accuracy (4)

- The trail is within 3.6 m of the official BeltLine line (median 0.3 m, 602 samples).
- 6 sample streets are within 5.4 m of the City of Atlanta centerlines. One exception is Krog St (max 15.5 m), at a service segment.
- The Ponce City Market tower is 9.7 m from its OSM position. Its top is about 71 m; the published height is 69.2 m.
- `landmarks.csv` has 188 rows. Landmarks: 5 OK, 3 CHECK, 1 WRONG. Street-sign posts: 89 OK, 4 CHECK, 2 WRONG.
- Errors: 2 signs say "Closed Lake Ave" (an OSM mapper note, not a street). The PCM rooftop sign faces east, not south. The Krog Street Market letters read "MAR". All 39 murals are invented, and 9 real artworks are missing.

## Ranked fixes (mobile first)

| Rank | Sev | Fix | Findings | Issue |
|---|---|---|---|---|
| 1 | P0 | Touch controls for phones | MOB-1, GP-1, GP-4 | #71 (split from #24) |
| 2 | P0 | Phone quality tier that keeps the ink | MOB-2, GFX-1, GFX-2 | #72 (split from #24) |
| 3 | P0 | Run structure: timer, goals, results, restart | FUN-1 | #15 |
| 4 | P0 | Rails, ledges, and ramps on the BeltLine | FUN-2, FUN-4 | #14 |
| 5 | P0 | Fact cards, phone first | EDU-1 | #17 |
| 6 | P0 | Skater review of the move set | CHR-1 | #22 |
| 7 | P1 | Phone layout: touch hints, HUD, attribution, landscape camera | MOB-3, MOB-4, MOB-6, EDU-3, EDU-4, GFX-9, CHR-4 | #73 |
| 8 | P1 | First load: load screen, smaller download | MOB-5, GFX-11 | #74 |
| 9 | P1 | Score ceiling and move balance | GP-2 | #75 |
| 10 | P1 | In-world teaching of the moves | FUN-3 | #76 |
| 11 | P1 | Wall hit: slide, not a dead stop | GP-3 | #58 |
| 12 | P1 | Face decals lost in the toon pass | CHR-2 | #77 |
| 13 | P1 | Street-sign names from the city centerlines | GEO-1, GEO-4 | #78 |
| 14 | P1 | Landmark signs: KSM "MARKET" clipped, PCM sign side | GEO-2, GEO-3, GFX-4 | #79 |
| 15 | P1 | Mural words that match the place | EDU-2 | #80 |
| 16 | P1 | NPC style to match the skaters | CHR-3 | #81 |
| 17 | P1 | Art bible with phone rules and asset budgets | GFX-3 | #16 |

The P2 findings are in each area file. They do not have issues yet. The 11 new issues are #71 to #81, all in M1.

## Milestone changes

- Touch controls (#71) and the phone tier (#72) move into M1. #24 keeps the store and device polish in M2.
- The concept doc still says "Desktop first, phones in version 2". Update it to match the 2026-11-03 decision.

## Verified

- `npm test`: 40 files, 341 tests pass.
- `npm run build` passes. The main chunk is 4.54 MB raw, 1.74 MB gzip.
- The touch gestures, tier choice, draw calls, triangles, and load size on emulated phone profiles.
- The BeltLine level has 0 objects. The combo multiplier equals the link count (`src/sim/skate/combo.js:37`).
- The toon pass runs after the face decal (`src/render/skater-model.js:56`, `src/main.js:158`).
- The landmark and street positions against OSM, TIGERweb, and the City of Atlanta and BeltLine layers.

## Not verified

- No real phone was used. WebKit is not installed, so iOS Safari was not tested.
- No FPS number in this audit is a clean measurement. The four agents ran browsers at the same time, at a load average of 35 to 69. Both playtest gates failed under that load (greybox 20 FPS, BeltLine 12 FPS).
- After the agents stopped, both gates ran again at a load average of 6 to 14. Both failed again: greybox median 30 FPS over 1,596 frames, BeltLine median 29.9 FPS over 1,010 frames (gate 55). Evidence: `fps-rerun/`. M0 measured 59.9 FPS on the greybox. The 2026-11-02 decision also records 30 FPS under load. Find out if the drop comes from the load or from the code before the next gate.
- No human played. The M0 hypothesis (3-minute combo, accidental falls) is still untested.
- Sound, a real gamepad, and heat and battery on a phone.

## Evidence note

The graphics agent saved 87 screenshots. An error in a cleanup command deleted them before the commit. The capture scripts in `graphics-characters/scripts/` ran again to make them again. See the git log for this folder.
