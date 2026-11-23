# Content checklist: political rules (M2-05, #22)

- **Status:** filled by an agent on 2026-11-23. The owner reviews it (owner decision on #22, 2026-11-23).
- **Scope:** the 5 political rules in `AGENTS.md`, checked against the content on `main` at commit `82b84e1`.
- **Not in scope:** the real skater review. It stays open for Version 1 (`docs/review/skater-review.md`).
- **Method:** read the data files and the code that makes text, signs, people and cars. Ran the content tests. Loaded the level in headless Chromium (Playwright, SwiftShader, 1280 x 720, `npm ci` install) and took screenshots. This PR changes no code.

## Summary

| Count | Value |
|---|---|
| Rules | 5 |
| Check rows | 24 |
| Pass | 20 |
| Flagged | 3 (2 new issues, 1 issue that was open before) |
| Open (Version 1) | 1 |

| Flag | Issue | Priority |
|---|---|---|
| The first load can show a dark, rainy night (device clock, not Atlanta time) | [#353](https://github.com/William-Hill/atl-arcade/issues/353) | P1 |
| The New Realm Brewing story card names beer and spirits | [#354](https://github.com/William-Hill/atl-arcade/issues/354) | P1 |
| Moving cars are solid boxes for the skater (traffic) | [#261](https://github.com/William-Hill/atl-arcade/issues/261) (open before this review) | P0 |

Notes for the owner (not flags, no issue): see "Notes for the owner" at the end.

## Rule R1: Every neighborhood is shown at its best. No decline, no stigma.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 1.1 | Landmark short lines and story cards | `levels/beltline-eastside/landmarks.json` (15 spots, 65 facts, 15 short lines) | **Flagged** [#354](https://github.com/William-Hill/atl-arcade/issues/354) | 14 of 15 spots pass: history, architecture, parks, birds, art, public projects. No decline, no stigma. 1 fact on `new-realm-brewing`: "New Realm makes its own beer and spirits ...". Alcohol is the only text of its kind in the game, and the shop signs already drop "liquor", "lounge" and "night club" (`NAME_DENY` in `src/level/geo/shop-signs.js`). |
| 1.2 | The look of the level at the first load (time and weather) | `src/render/weather-view.js` `weatherClock()`, `src/sim/weather.js`, a load with no parameters | **Flagged** [#353](https://github.com/William-Hill/atl-arcade/issues/353) | Load at 19:50 UTC (14:50 in Atlanta): `__atl.weather` gave hour 19.85, sun elevation -26 degrees, `rain`, wet 0.85. The clock uses the device time zone, not Atlanta time. The frame is near-black: `docs/review/screenshots/night-default.jpg`. The e2e pictures `e2e/__screenshots__/cars-traffic.png` and `fact-card-desktop.png` (2026-11-07) are also dark. |
| 1.3 | The look of the level in daylight | Fast travel to 9 places with `?weather=clear&time=14`, toon look, low tier | Pass | `docs/review/screenshots/day-*.jpg`: green trail, trees in bloom, clean buildings, a walker, bike share. No empty lots, boarded windows, litter or damage. The banner in each picture can show the spot found before the travel (the banner shows for 3 s). |
| 1.4 | Shop name signs | `src/level/geo/shop-signs.js` (`SHOP_USES`, `NAME_DENY`), `src/render/shop-names.js` (`SHOP_NAMES`), the 18 buildings with a `use` in `levels/beltline-eastside/level.json` | Pass | Real names that show: Mister Hot Shine Car Wash, Across the Street, Jack's Pizza, The Collective, Venkman's, Beatlecat, Kroger, New Realm Brewing. `SHOP_USES` has no bar, pub or night club. The 24 invented names are cafes, books, bikes, flowers and food (`SHOP_NAMES`). |
| 1.5 | Street name signs | `src/level/geo/signs.js` `streetIntersections()`, 97 corners, 65 street names from OSM | Pass (note N1) | All names are the real street names. See note N1 for one name. |
| 1.6 | People (NPCs) | `assets/people/manifest.json`, `src/sim/peds.js`, `src/sim/npc/skaters.js` | Pass | Walker in a sundress, elder in a polo, jogger, dog walker, dad with a stroller, cyclist, dog, and NPC skaters. No police, security, homeless or crowd conflict. |
| 1.7 | Loader and HUD text | `index.html`, `src/ui/*.js`, `src/ui/callout-math.js`; text read from the page with Playwright | Pass | Loader: "Lacing up the skates…" (`docs/review/screenshots/loader.jpg`). HUD: score, timer, goals ("Score 6,000 points", "Collect 3 fact cards", the 2 gaps), "Claim it: ...", "SKATE!", "NICE COMBO" to "ATL LEGEND", "SPOT CLAIMED", "ROUND OVER", medals. No negative word. |
| 1.8 | Trick and dance names | `src/sim/skate/constants.js` `STYLE`, `src/sim/skate/run.js` | Pass | Hop, Ramp Air, Vert Air, Rail Grind, Ledge Grind, "Long" grinds; Bankhead Bounce, Walk It Out, The Prep, Swag Surf, Snap Lean, Crisscross, Smooth Quad, Jam Groove, Drumline Count, Jam Step, Toe Spin, Sit Spin. The dances with a content flag in `docs/characters/atl-dance-references.md` (Laffy Taffy, Rock Yo Hips, the Folks, the Dab, Superman, Nae Nae with the Silentó song) are not in the game. |

## Rule R2: No crime, police, or traffic danger as content. Obstacles are cones, crowds, and construction.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 2.1 | Fact data filter | `src/facts/client.js` (`BLOCKED_DATASETS`, `BLOCKED_WORDS`) | Pass | The client blocks `apd-crime-incidents`, `atl-pedestrian-crashes-by-tract` and `gdot-traffic-counters`, and drops text with crime, police, crash, death, blight, decline, vacant, homeless, graffiti, gang or drug words. Vitest `src/facts` passes. |
| 2.2 | Landmark text filter | `src/landmarks/validate.js` `BANNED_WORDS`, `npm run validate:landmarks` | Pass | Banned: crime, police, graffiti, blight, slum, decline, abandoned, derelict, gentrification, displacement, riot, arson, murder, bail. Result: "OK, 13 claim spots and 2 edge markers". |
| 2.3 | Vehicle kinds and colors | `src/sim/traffic/traffic.js` (`CAR_SIZE`, `CAR_COLORS`), `src/render/car-kit.js`, `assets/vehicles/` | Pass | Sedan, hatchback, pickup, van, taxi, box truck, bus (MARTA colors, no logo). No police car, no emergency vehicle, no light bar, no black and white two-tone. |
| 2.4 | Traffic behavior | `src/sim/traffic/traffic.js`, `docs/decisions.md` 2026-11-03 (#132) and 2026-11-21 (#285); a load at 14:50 Atlanta time | **Flagged** [#261](https://github.com/William-Hill/atl-arcade/issues/261) (open before this review) | Current state on `main`: 68 moving cars and 456 parked cars. A car slows and stops for the skater (2 m circle), and backs away when she comes to it (#285). A car is a solid box: a head-on hit stops the skater (`bonkSpeedKeep` 0); it does not knock her down. Owner decision on #261 (2026-11-23): calm traffic with no collision; cars slow and stop for the skater, and a contact never knocks the skater down. Another PR changes the code now. |
| 2.5 | Obstacles | `assets/props/street/` (`traffic_cone.glb`, `barricade.glb`), `src/level/geo/props.js`, `src/level/edge-fence.js`, `levels/beltline-eastside/level.json` `furniture` | Pass (note N2) | Obstacles in play: walls, curbs, benches, bike racks, bollards, waste baskets, lamps, people, and the edge fence. No crime or police obstacle. Cars: see 2.4. |
| 2.6 | Fall text | `src/render/skater-anim.js`, `src/playtest/sessions.js`, the HUD text | Pass | "bail" is an internal clip and log name only. No HUD text names a fall or a crash. The GDD rule "never show the word bail" holds. |

## Rule R3: Murals, not graffiti.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 3.1 | Painted mural atlas (pbr look) | `assets/murals/provenance.json`, `docs/murals.md`, `docs/murals/contact-sheet.jpg` | Pass | 16 original designs drawn from code (seed 1979, no image model, credits 0): skyline, trail, dogwood, peaches, heron, rink, porch neighbors. Framed painted walls, no tags, no spray marks. `provenance.json` is present. |
| 3.2 | Canvas murals (toon look) | `src/render/murals.js` `MURAL_WORDS` | Pass | The same 16 words: ATL, BELTLINE, SKATE ATL, DOGWOOD, ROLL ON, PEACH, FLOW, STRIDE, GLIDE, A-TOWN, SUNSHINE, GOOD VIBES, SMOOTH, SWAG SURF, RINK, SHINE. No neighborhood names (#80). |
| 3.3 | Art spots | `levels/beltline-eastside/landmarks.json` (kind `art`), `design/gdd/landmark-discovery.md` "Political rules" | Pass | No `art` spot ships. The GDD rule stays: a real piece shows only after the artist credit is cleared. |

## Rule R4: Facts are positive or neutral, sourced from the open data catalog. Landmark story cards may also cite a public source.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 4.1 | Open data fact cards | `levels/beltline-eastside/facts.json`, `src/facts/fixtures/beltline-eastside.json` | Pass | 3 cards, all from City of Atlanta Department of City Planning GIS (fetched 2026-11-04): the trail links 3 neighborhoods (Poncey-Highland, Inman Park, Old Fourth Ward); Freedom Park covers 124 acres; Inman Park-Reynoldstown MARTA station is within a mile. All neutral or positive. `docs/review/screenshots/day-02-fact-neighborhoods.jpg`. |
| 4.2 | Landmark story card sources | `levels/beltline-eastside/landmarks.json`, `npm run validate:landmarks`, an HTTP check of every source URL | Pass (note N3) | 65 of 65 facts have a source name and URL. Sources: National Register of Historic Places, Atlanta BeltLine Inc., Historic Fourth Ward Park Conservancy, Freedom Park Conservancy, the Carter Library, Ponce City Market. 28 of 29 URLs return HTTP 200. `poncecitymarket.com/history/` returns 403 to a script. |
| 4.3 | Quotes behind each fact | `docs/research/2026-11-10-landmark-facts.md` | Pass | Each fact has the quote from its source. The 2026-11-07 decision in `docs/decisions.md` allows a cited public source for story cards. |
| 4.4 | Landmark GDD rules | `design/gdd/landmark-discovery.md` (rule 8, "Political rules", S-1 to S-3) | Pass | The GDD requires positive or neutral facts with a source, rings with no red and no hazard stripes, clean sunny card art, and no "bail" text. The data and the code follow it (1.1, 2.2, 2.6). |
| 4.5 | Dance names and their Atlanta sources | `docs/characters/atl-dance-references.md`, `docs/decisions.md` (2026-11-01) | Pass | Each Atlanta dance in the game has a source: USA Roller Sports (The Prep, Cross Step), Wikipedia, AJC and STEEZY (Bankhead Bounce), KAXE and AJC (Walk It Out), Wikipedia and uDiscover (Swag Surf), Wikipedia and AJC (Snap Lean). No song is licensed. The music is original and instrumental (`assets/music/LICENSE.md`). |
| 4.6 | Content tests | Vitest: `src/landmarks/validate.test.js`, `src/facts`, `src/sim/fact-cards.test.js`, `src/level/geo/shop-signs.test.js`, `src/sim/traffic/traffic.test.js` | Pass | 5 files, 81 of 81 tests pass (2026-11-23, cloud container). |

## Rule R5: Real skaters review the move set before release.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 5.1 | Real skater review | `docs/review/skater-review.md` | **Open, v1.0.0** | Owner decision on #22 (2026-11-23): the real skater review stays open for Version 1. The template with the move list is in `docs/review/skater-review.md`. |

## Notes for the owner

These are not flags. They need an owner view only.

- **N1, Dixie Ave NE.** One street sign shows "Dixie Ave NE", the real OSM name of a street in the level. The name is accurate. Some people connect the word with the Confederacy. If the owner wants it off the signs, `streetIntersections()` can skip the name, but then the sign is not accurate.
- **N2, cones and construction.** The models `traffic_cone.glb` and `barricade.glb` are in `assets/props/street/`, but no code places them. The rule "obstacles are cones, crowds, and construction" is met by crowds and street furniture today.
- **N3, Ponce City Market source.** `https://poncecitymarket.com/history/` returned HTTP 403 to `curl` (a bot block is likely). A person must open it in a browser before the pitch.
- **N4, two neutral facts.** "With traffic below and buildings above, the North Avenue Bridge is a favorite place for photos" names traffic as a view, not as danger. "The giant puppet Little Amal's Eastside Trail walk ..." is an arts event. Both are from Atlanta BeltLine, Inc. and pass.

## How to repeat the screenshots

1. `npm ci`
2. `npx vite --port 5191 --strictPort`
3. `node docs/review/screenshots/capture.cjs <out-dir>` (the default clock and weather), then `node docs/review/screenshots/capture.cjs <out-dir> "&weather=clear&time=14"` (clear day).

The pictures in `docs/review/screenshots/` are scaled to 960 x 540.
