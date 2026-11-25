# Content checklist: political rules (M2-05, #22)

- **Status:** approved by the owner for v0.9.0 on 2026-11-25. An agent filled it on 2026-11-23 and updated it on 2026-11-24. The real skater review (row 5.1, `docs/review/skater-review.md`) stays open for Version 1.
- **Scope:** the 5 political rules in `AGENTS.md`, checked against the content on `main` at commit `087a8a8` (2026-11-24). The first version checked `main` at commit `82b84e1` and merged as PR 355 (`d567ad7`).
- **Not in scope:** the real skater review. It stays open for Version 1 (`docs/review/skater-review.md`).
- **Method:** read the data files and the code that makes text, signs, people, cars and screens. Searched all player-facing strings for words that break the rules. Ran the content tests. Loaded the level in headless Chromium (Playwright, SwiftShader, 1280 x 720, `npm ci` install) and took screenshots. This PR changes no game code.

## Summary

| Count | Value |
|---|---|
| Rules | 5 |
| Check rows | 38 (24 from 2026-11-23, 14 new) |
| Pass | 37 |
| Flagged | 0 (the 3 flags of 2026-11-23 are fixed on `main`) |
| Open (Version 1) | 1 |

| Flag of 2026-11-23 | Issue | Fix on `main` | Row |
|---|---|---|---|
| The first load can show a dark, rainy night (device clock, not Atlanta time) | [#353](https://github.com/William-Hill/atl-arcade/issues/353) | PR 366 (`9eab5c2`) | 1.2: Pass |
| The New Realm Brewing story card names beer and spirits | [#354](https://github.com/William-Hill/atl-arcade/issues/354) | PR 366 (`9eab5c2`) | 1.1: Pass |
| Moving cars are solid boxes for the skater (traffic) | [#261](https://github.com/William-Hill/atl-arcade/issues/261) | PR 360 (`f7bbff3`) | 2.4: Pass |

No new flag. Notes for the owner (not flags, no issue): see "Notes for the owner" at the end. N5 to N9 are new.

## Changes since 2026-11-23

- The 3 flags are fixed. The agent read the code and the data on `main`, not only the PR titles (rows 1.1, 1.2, 2.4).
- 14 new rows check the content that merged after `d567ad7`: the story cards and the results row (#220, PR 368), the claim effects (#221, PR 378), the claim targets (#264 and #365, PR 367), the intro and the title screen (#301, PR 358), the share assets (#303, PR 350), the Tour mode text (#260, PR 359) and the pitch docs (#258, PRs 371 and 376).
- A word search of all player-facing strings found no word that breaks a rule. Row 1.16 lists each hit.
- All 65 story card facts and all 3 open data fact cards have a source. No fact has no source (rows 4.1 and 4.7).
- New screenshots on `main` at `087a8a8`: the first load with no URL parameters, a story card, the results row, Tour mode and the title screen. `night-default.jpg` is removed, because the first load is no longer a night (the old picture stays in commit `d567ad7`).
- 5 new notes for the owner: N5 to N9.

## Rule R1: Every neighborhood is shown at its best. No decline, no stigma.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 1.1 | Landmark short lines and story cards | `levels/beltline-eastside/landmarks.json` (15 spots, 65 facts, 15 short lines) | Pass (fixed by PR 366, #354) | 2026-11-24: all 15 spots pass. `new-realm-brewing` fact 3 is now "New Realm has a full food menu and hosts trivia, vintage market pop-ups and live music four days a week." (`landmarks.json:123`). A search of `levels/*/landmarks.json` for beer, spirits, wine, liquor, alcohol and cocktail finds no hit. The text matches the source page (fetched 2026-11-24, "an extensive food menu, regular trivia and vintage market pop-ups, and live music four days a week"). The card in the game: `docs/review/screenshots/story-card-new-realm.jpg`. See note N6. 2026-11-23: **Flagged** #354 ("New Realm makes its own beer and spirits ..."). |
| 1.2 | The look of the level at the first load (time and weather) | `src/render/weather-view.js` `weatherClock()` and `FIRST_LOAD`, `src/sim/weather.js` `atlantaTime()`, a load with no parameters | Pass (fixed by PR 366, #353) | 2026-11-24: with no `?time` and no `?weather`, `weatherClock()` gives hour 14 (`FIRST_LOAD.hour`) and `clear` on the Atlanta date (America/New_York), not the device clock. `?time=now` and `?weather=auto` keep the real clock and the season draw as options. A load at 23:00 device time (local Mac) gave `__atl.weather` = `{kind: "clear", day: 328, hour: 14, elevation: 31.9, wet: 0, rain: 0}`. Vitest `src/render/weather-view.test.js` passes (sun over 20 degrees, no rain, dry street on every 7th day of the year). Picture: `docs/review/screenshots/day-01-spawn.jpg`. 2026-11-23: **Flagged** #353 (hour 19.85, sun -26 degrees, rain). |
| 1.3 | The look of the level in daylight | Fast travel to 9 places with no URL parameters (the first load is clear at 14:00) | Pass | `docs/review/screenshots/day-*.jpg` (retaken 2026-11-24): green trail, trees in bloom, clean buildings, walkers. No empty lots, boarded windows, litter or damage. The banner in each picture can show the spot found before the travel (the banner shows for 3 s). |
| 1.4 | Shop name signs | `src/level/geo/shop-signs.js` (`SHOP_USES`, `NAME_DENY`), `src/render/shop-names.js` (`SHOP_NAMES`), the 18 buildings with a `use` in `levels/beltline-eastside/level.json` | Pass | Real names that show: Mister Hot Shine Car Wash, Across the Street, Jack's Pizza, The Collective, Venkman's, Beatlecat, Kroger, New Realm Brewing. `SHOP_USES` has no bar, pub or night club. The 24 invented names are cafes, books, bikes, flowers and food (`SHOP_NAMES`). |
| 1.5 | Street name signs | `src/level/geo/signs.js` `streetIntersections()`, 97 corners, 65 street names from OSM | Pass (note N1) | All names are the real street names. See note N1 for one name. |
| 1.6 | People (NPCs) | `assets/people/manifest.json`, `src/sim/peds.js`, `src/sim/npc/skaters.js` | Pass | Walker in a sundress, elder in a polo, jogger, dog walker, dad with a stroller, cyclist, dog, and NPC skaters. No police, security, homeless or crowd conflict. |
| 1.7 | Loader and HUD text | `index.html`, `src/ui/*.js`, `src/ui/callout-math.js`; text read from the page with Playwright | Pass | Loader: the logo over a skyline (`docs/review/screenshots/loader.jpg`, #303). HUD: score, timer, goals ("Score 6,000 points", "Collect 3 fact cards", the 2 gaps), "Claim it: ...", "SKATE!", "NICE COMBO" to "ATL LEGEND", "SPOT CLAIMED", "ROUND OVER", medals. No negative word. See note N5 for one gap name. |
| 1.8 | Trick and dance names | `src/sim/skate/constants.js` `STYLE`, `src/sim/skate/run.js` | Pass | Hop, Ramp Air, Vert Air, Rail Grind, Ledge Grind, "Long" grinds; Bankhead Bounce, Walk It Out, The Prep, Swag Surf, Snap Lean, Crisscross, Smooth Quad, Jam Groove, Drumline Count, Jam Step, Toe Spin, Sit Spin. The dances with a content flag in `docs/characters/atl-dance-references.md` (Laffy Taffy, Rock Yo Hips, the Folks, the Dab, Superman, Nae Nae with the Silentó song) are not in the game. |
| 1.9 | Story cards (#220, PR 368) | `src/landmarks/story-card.js`, `src/ui/story-card-view.js`, `src/ui/landmark-guide.js`, `public/landmark-cards/` (15 JPEG, `provenance.json`) | Pass | A card shows the spot name, the kind, a picture, 3 to 5 facts and a source link under each fact. The 15 pictures are in-game renders (pbr look, 21 June, 13:30, clear, `provenance.json`, no image model). Each picture shows a sunny day, trees and clean buildings. A Found spot shows "Claim it to unlock" and no facts. Pictures: `story-card-new-realm.jpg` (results view), `story-card-skatepark.jpg` (full map). |
| 1.10 | Results row and "Reset progress" (#220, PR 368) | `src/ui/results.js`, `src/ui/results-text.js`, `src/ui/settings-menu.js` | Pass | Text: "Time!", "Spots claimed", "NEW", "Skate again", "Tour (no timer)", "Not yet", "No medal", "Reset progress?", "Every landmark spot goes back to not found, and the claims clear. Unlocked outfits stay.", "Progress reset.". No negative word. Picture: `docs/review/screenshots/results-row.jpg`. |
| 1.11 | Intro and title screen (#301, PR 358) | `src/ui/intro.js`, `src/ui/front-screen.js`, `assets/brand/logo/skate-atl-logo.svg` | Pass | The intro flies the camera along the Eastside Trail under the logo. Text: "Press any key" or "Tap to start", "Press any key to skip", "SETTINGS", and the skater select: Nia "Sway" (West End), Marcus "Tempo" (Old Fourth Ward). Picture: `docs/review/screenshots/title.jpg`. |
| 1.12 | Share assets (#303, PR 350) | `index.html` (meta tags), `public/share/`, `public/brand/loader-art.svg`, `public/favicon*`, `public/apple-touch-icon.png`, each `.provenance.json` | Pass | Description: "Roller skate real Atlanta neighborhoods in your browser. Grind rails, dance on the beat, and skate the BeltLine. Free to play." The share card is an in-game capture of Nia on the Eastside Trail on a sunny day, with the logo. The loader art is generic towers, with no copy of a real building or a seal. Each file has a provenance file (no image model, credits 0). |
| 1.13 | Tour mode text (#260, PR 359) | `src/landmarks/guide.js`, `src/landmarks/play.js`, `src/sim/skate/round-end.js`, `src/ui/hud.js` (`TOUR_LABEL`), `src/ui/results-text.js` | Pass | Text: "TOUR", "Tour (no timer)", "Next: <spot>, <distance> <direction>", "a new spot", "Nearby spots done", "All spots done. Free skate!", "Too far for the time left", "Time! Land the combo to bank it", "Time! The round is over", "Start a timed run to claim it", "Ring line restarted". No negative word. Picture: `docs/review/screenshots/tour.jpg`. |
| 1.14 | Claim effects (#221, PR 378) | `src/landmarks/claim-fx.js`, `src/render/landmark-rim.js`, `src/render/effects/fx.js` | Pass | No text. A ring and a star in the district accent color, dogwood pink petals (`#c98fa6`), and a warm golden-hour rim (`#ffb36b`) on a Found building. No red, no hazard stripes, no flash that suggests an accident. `prefers-reduced-motion` and "Reduce motion" turn the burst and the petals off. |
| 1.15 | Claim targets (#264 and #365, PR 367) | `src/render/claim-target.js`, `src/render/claim-target-math.js`, the `challenge.hint` values in `landmarks.json` | Pass | A gold line (`#ffd166`) with a dark ink edge marks the curb to grind, the goal line and the skatepark pad. Hints: "Grind the Ponce curb for 9 m", "Grind the Krog Street curb for 15 m", "Grind the curb below the bridge for 15 m", "Hop on the bridge over Ponce", "Land a 2,000 point combo in the skatepark", and others. No negative word, no red, no hazard stripes. Street curbs and cars: see 2.7. |
| 1.16 | Word search of all player-facing strings | `index.html`, `public/`, `src/ui/`, `src/landmarks/`, `levels/*/`, `src/render/claim-target.js`, `src/render/landmark-rim.js`, `src/sim/skate/round-end.js`, `src/sim/skate/run-mode.js`, `docs/pitch/`. Words: crime, criminal, police, cop, arrest, gang, graffiti, tag or tagging, drug, alcohol, beer, liquor, spirits, wine, cocktail, bar, brewery or brewing, decline, blight, abandoned, danger, crash, accident, collision, vandal, homeless, slum, riot, murder, gun | Pass | Every hit, with a verdict: (a) `levels/beltline-eastside/landmarks.json:106,108,115` and `level.json` (building `use` name): "New Realm Brewing", the real place name. Pass. (b) `public/landmark-cards/provenance.json:18,153`: the file key `new-realm-brewing`, not player text. Pass. (c) `src/ui/skater-select.js:7-8`: `tag: "Sway"` and `tag: "Tempo"`, a nickname field, not vandalism. Pass. (d) `src/ui/hud.js:89-201`: the move name tag element, not vandalism. Pass. (e) "bar" in `index.html:33-45`, `src/ui/hud.js`, `src/ui/loader.js`: a progress bar or a meter. Pass. (f) `src/landmarks/validate.js:67`: the banned word list. Pass. (g) `docs/pitch/` hits: see 4.9. No hit breaks a rule. |

## Rule R2: No crime, police, or traffic danger as content. Obstacles are cones, crowds, and construction.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 2.1 | Fact data filter | `src/facts/client.js` (`BLOCKED_DATASETS`, `BLOCKED_WORDS`) | Pass | The client blocks `apd-crime-incidents`, `atl-pedestrian-crashes-by-tract` and `gdot-traffic-counters`, and drops text with crime, police, crash, death, blight, decline, vacant, homeless, graffiti, gang or drug words. Vitest `src/facts` passes. |
| 2.2 | Landmark text filter | `src/landmarks/validate.js` `BANNED_WORDS`, `npm run validate:landmarks` | Pass | Banned: crime, police, graffiti, blight, slum, decline, abandoned, derelict, gentrification, displacement, riot, arson, murder, bail. Result on 2026-11-24: "OK, 13 claim spots and 2 edge markers". |
| 2.3 | Vehicle kinds and colors | `src/sim/traffic/traffic.js` (`CAR_SIZE`, `CAR_COLORS`), `src/render/car-kit.js`, `assets/vehicles/` | Pass | Sedan, hatchback, pickup, van, taxi, box truck, bus (MARTA colors, no logo). No police car, no emergency vehicle, no light bar, no black and white two-tone. |
| 2.4 | Traffic behavior | `src/sim/traffic/traffic.js` `carGroundSampler()`, `src/sim/skate/controller.js` (`softSlideVelocity()`, `isSoft()`), `src/sim/skate/constants.js` `softWallKeep`, `docs/decisions.md` 2026-11-23 "Calm traffic with no collision (#261)" | Pass (fixed by PR 360, #261) | 2026-11-24: a moving car gives a ground sample with `soft: true` (`traffic.js:1084-1095`). On a soft wall the controller glances the skater along the car side, on the ground and in the air, and tries both directions; it does not bonk, stop or knock her down. She keeps at least `softWallKeep` (0.5) of her speed on a head-on hit. Cars still slow and stop for her (#285). Parked cars stay solid. Vitest `src/sim/traffic/traffic.test.js` passes ("calm traffic with no collision (#261)"). `AGENTS.md` now states the car rule. Evidence of PR 360: `e2e/traffic-calm.spec.js`, `reports/traffic-calm-261/`. Load on 2026-11-24: 68 moving cars, 456 parked cars. 2026-11-23: **Flagged** #261 (a head-on hit stopped the skater). |
| 2.5 | Obstacles | `assets/props/street/` (`traffic_cone.glb`, `barricade.glb`), `src/level/geo/props.js`, `src/level/edge-fence.js`, `levels/beltline-eastside/level.json` `furniture` | Pass (note N2) | Obstacles in play: walls, curbs, benches, bike racks, bollards, waste baskets, lamps, people, and the edge fence. No crime or police obstacle. Cars: see 2.4. |
| 2.6 | Fall text | `src/render/skater-anim.js`, `src/playtest/sessions.js`, the HUD text | Pass | "bail" is an internal clip and log name only. No HUD text names a fall or a crash. The GDD rule "never show the word bail" holds. |
| 2.7 | Claim targets on street curbs (#264, PR 367) | `levels/beltline-eastside/landmarks.json` (`ford-factory-lofts` "Grind the Ponce curb for 9 m", `krog-street-market` "Grind the Krog Street curb for 15 m", `ralph-mcgill-bridge` "Grind the curb below the bridge for 15 m"), row 2.4 | Pass | 3 challenges put the skater on a street curb. The game shows no danger there: cars slow and stop for her, and a contact with a moving car never stops her or knocks her down (2.4). No text or effect shows a car as a threat. |

## Rule R3: Murals, not graffiti.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 3.1 | Painted mural atlas (pbr look) | `assets/murals/provenance.json`, `docs/murals.md`, `docs/murals/contact-sheet.jpg` | Pass | 16 original designs drawn from code (seed 1979, no image model, credits 0): skyline, trail, dogwood, peaches, heron, rink, porch neighbors. Framed painted walls, no tags, no spray marks. `provenance.json` is present. |
| 3.2 | Canvas murals (toon look) | `src/render/murals.js` `MURAL_WORDS` | Pass | The same 16 words: ATL, BELTLINE, SKATE ATL, DOGWOOD, ROLL ON, PEACH, FLOW, STRIDE, GLIDE, A-TOWN, SUNSHINE, GOOD VIBES, SMOOTH, SWAG SURF, RINK, SHINE. No neighborhood names (#80). |
| 3.3 | Art spots | `levels/beltline-eastside/landmarks.json` (kind `art`), `design/gdd/landmark-discovery.md` "Political rules" | Pass | No `art` spot ships. The GDD rule stays: a real piece shows only after the artist credit is cleared. |
| 3.4 | New art since `d567ad7` | `public/landmark-cards/` and `provenance.json` (#220), `public/share/`, `public/brand/`, `public/favicon*`, `public/apple-touch-icon.png` and their provenance files (#303) | Pass | All new pictures are in-game renders or hand-written SVG, with a provenance file (tool, prompt or "none", credits 0, date). No tags, no spray marks. The walls in the card art show the game murals only. |

## Rule R4: Facts are positive or neutral, sourced from the open data catalog. Landmark story cards may also cite a public source.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 4.1 | Open data fact cards | `levels/beltline-eastside/facts.json`, `src/facts/fixtures/beltline-eastside.json` | Pass | 3 cards, all from City of Atlanta Department of City Planning GIS (fetched 2026-11-04): the trail links 3 neighborhoods (Poncey-Highland, Inman Park, Old Fourth Ward); Freedom Park covers 124 acres; Inman Park-Reynoldstown MARTA station is within a mile. All neutral or positive. Each card names its dataset. `docs/review/screenshots/day-02-fact-neighborhoods.jpg`. |
| 4.2 | Landmark story card sources | `levels/beltline-eastside/landmarks.json`, `npm run validate:landmarks`, an HTTP check of every source URL | Pass (note N3) | 65 of 65 facts have a source name and URL. Sources: National Register of Historic Places, Atlanta BeltLine Inc., Historic Fourth Ward Park Conservancy, Freedom Park Conservancy, the Carter Library, Ponce City Market. 28 of 29 URLs return HTTP 200 (checked again 2026-11-24). `poncecitymarket.com/history/` returns 403 to a script. |
| 4.3 | Quotes behind each fact | `docs/research/2026-11-10-landmark-facts.md` | Pass | Each fact has the quote from its source. The 2026-11-07 decision in `docs/decisions.md` allows a cited public source for story cards. |
| 4.4 | Landmark GDD rules | `design/gdd/landmark-discovery.md` (rule 8, "Political rules", S-1 to S-3) | Pass | The GDD requires positive or neutral facts with a source, rings with no red and no hazard stripes, clean sunny card art, and no "bail" text. The data and the code follow it (1.1, 1.9, 1.15, 2.2, 2.6). |
| 4.5 | Dance names and their Atlanta sources | `docs/characters/atl-dance-references.md`, `docs/decisions.md` (2026-11-01) | Pass | Each Atlanta dance in the game has a source: USA Roller Sports (The Prep, Cross Step), Wikipedia, AJC and STEEZY (Bankhead Bounce), KAXE and AJC (Walk It Out), Wikipedia and uDiscover (Swag Surf), Wikipedia and AJC (Snap Lean). No song is licensed. The music is original and instrumental (`assets/music/LICENSE.md`). |
| 4.6 | Content tests (2026-11-23) | Vitest: `src/landmarks/validate.test.js`, `src/facts`, `src/sim/fact-cards.test.js`, `src/level/geo/shop-signs.test.js`, `src/sim/traffic/traffic.test.js` | Pass | 5 files, 81 of 81 tests pass (2026-11-23, cloud container). See 4.10 for the run on `087a8a8`. |
| 4.7 | Sources on the story cards in the game (#220, PR 368) | The card text read with Playwright from the results view and the full map; `levels/beltline-eastside/landmarks.json` | Pass (note N8) | Each fact on a card shows "Source: <name>" as an https link that opens in a new tab. Read on 2026-11-24: New Realm Brewing (3 facts, Atlanta BeltLine, Inc.) and Thomas Taylor Memorial Skatepark (5 facts, Atlanta BeltLine, Inc. and Historic Fourth Ward Park Conservancy). All 65 facts in the data have a source name and URL; no fact has no source. All 65 facts are positive or neutral. |
| 4.8 | The New Realm fact against its source | `landmarks.json:123`, `https://beltline.org/blog/the-beltline-from-above/` (fetched 2026-11-24) | Pass (note N6) | The source says "an extensive food menu, regular trivia and vintage market pop-ups, and live music four days a week". The card says "a full food menu". The meaning is the same. |
| 4.9 | Pitch docs (#258, PRs 371 and 376) | `docs/pitch/2026-11-01-official-game-of-atlanta.md`, `docs/pitch/one-pager.md`, `docs/pitch/demo-script.md`, `docs/pitch/screenshots/` | Pass (notes N7, N9) | The facts and spot lines match `landmarks.json`, and each names its source. The 12 screenshots show a clear day. Word search hits, with a verdict: (a) `one-pager.md:34-36`, `demo-script.md:47`: the rules as text ("No crime, police or traffic danger"). Pass. (b) `2026-11-01-official-game-of-atlanta.md:89`: "Players damaged it soon after launch", about the Denmark Minecraft map in the prior-art table, not about Atlanta. Pass. (c) `:216`: a change note that names "beer and spirits" to explain the #354 fix. Pass, see N7. (d) `:377`: "Do not copy the tags in the Krog Street Tunnel", a mitigation that follows R3. Pass. (e) `:419`: "Traffic shown as danger" in the risk table, with the calm traffic mitigation. Pass. (f) `:200`, `:469`: "New Realm Brewing", the real place name. Pass. |
| 4.10 | Content tests (2026-11-24) | Vitest: `src/landmarks`, `src/facts`, `src/sim/fact-cards.test.js`, `src/level/geo/shop-signs.test.js`, `src/sim/traffic/traffic.test.js`, `src/render/weather-view.test.js`, `src/ui/intro.test.js`, `src/sim/skate/round-end.test.js`, `src/sim/skate/run-mode.test.js`, `scripts/brand/share-assets.test.js`; `npm run validate:landmarks` | Pass | 16 files, 212 of 212 tests pass (2026-11-24, local Mac, `main` at `087a8a8`). `validate:landmarks`: "OK, 13 claim spots and 2 edge markers". The full Playwright suite was not run. |

## Rule R5: Real skaters review the move set before release.

| # | Check | What we checked (files) | Result | Evidence |
|---|---|---|---|---|
| 5.1 | Real skater review | `docs/review/skater-review.md` | **Open, v1.0.0** | Owner decision on #22 (2026-11-23): the real skater review stays open for Version 1. The template with the move list is in `docs/review/skater-review.md`. |

## Notes for the owner

These are not flags. They need an owner view only.

- **N1, Dixie Ave NE.** One street sign shows "Dixie Ave NE", the real OSM name of a street in the level. The name is accurate. Some people connect the word with the Confederacy. If the owner wants it off the signs, `streetIntersections()` can skip the name, but then the sign is not accurate.
- **N2, cones and construction.** The models `traffic_cone.glb` and `barricade.glb` are in `assets/props/street/`, but no code places them (checked again 2026-11-24). The rule "obstacles are cones, crowds, and construction" is met by crowds and street furniture today.
- **N3, Ponce City Market source.** `https://poncecitymarket.com/history/` returned HTTP 403 to `curl` again on 2026-11-24 (a bot block is likely). A person must open it in a browser before the pitch.
- **N4, two neutral facts.** "With traffic below and buildings above, the North Avenue Bridge is a favorite place for photos" names traffic as a view, not as danger. "The giant puppet Little Amal's Eastside Trail walk ..." is an arts event. Both are from Atlanta BeltLine, Inc. and pass.
- **N5, Stone Mountain Trail Bridge Hop (new).** One gap goal is "Stone Mountain Trail Bridge Hop" (`levels/beltline-eastside/goals.json:10`). It shows on the HUD and on the results screen (`results-row.jpg`). It is the real name of the PATH trail and its bridge. Some people connect Stone Mountain with the Confederate memorial carving. This text was in the game before 2026-11-23, but the first review did not list it. If the owner wants another label, the `label` field in `goals.json` can change; then the label is not the real trail name.
- **N6, the New Realm source page (new).** The card text names no alcohol. The source link on the card opens the Atlanta BeltLine, Inc. page, and that page says "house-made beer and spirits". The 2026-11-24 decision (#354) keeps this source. A player who opens the link sees the words. **Owner decision (2026-11-25):** keep the link. The card text follows the rule, and the source page is the real site, outside the game.
- **N7, alcohol words in the pitch (new).** `docs/pitch/2026-11-01-official-game-of-atlanta.md:216` says that the review "flagged one fact that named beer and spirits". This is a change note, not game content. If the City gets this document, the owner can shorten it to "one fact that named alcohol". **Fixed (2026-11-25, owner decision):** the change note now says "named alcohol".
- **N8, two sources of the Freedom Parkway Bridge card (new).** Fact 2 cites the Historic Fourth Ward Park Conservancy and fact 3 cites the Freedom Park Conservancy. The 2026-11-07 decision lists "the landmark's own site", and these are the sites of the next parks, not of the bridge. Both are public, cited sources, and both facts are neutral.
- **N9, old counts in the pitch (new).** `docs/pitch/one-pager.md:40` and `docs/pitch/2026-11-01-official-game-of-atlanta.md:36` give the counts of 2026-11-23 (24 checks, 20 pass, 3 flagged and fixed, 1 open). The counts in this checklist are now 38 rows, 37 pass, 0 flagged, 1 open. This PR does not change the pitch. **Fixed (2026-11-25, owner decision):** both pitch docs give the counts of 2026-11-24 (38 checks, 37 pass, 0 flagged, 1 open).

## How to repeat the screenshots

1. `npm ci`
2. `npx vite --port 5402 --strictPort`
3. `PORT=5402 node docs/review/screenshots/capture.cjs <out-dir>` (the first load: no URL parameters, a clear afternoon since #353). A second argument such as `"&weather=rain&time=22"` changes the clock or the weather.
4. Scale each picture to 960 x 540 (for example `sips -z 540 960`).
5. Stop the dev server.

The script also writes `11-traffic.jpg`, but the follow camera replaces the fixed camera, so that picture does not show a car. It is not in this folder.

| Picture | What it shows |
|---|---|
| `loader.jpg` | The load screen (#303) |
| `day-01-spawn.jpg` | The first load with no URL parameters: a clear afternoon (#353) |
| `day-02-fact-neighborhoods.jpg`, `day-05-skatepark.jpg`, `day-06-ponce-city-market.jpg`, `day-07-krog-street-market.jpg`, `day-08-new-realm.jpg`, `day-10-north-ave-bridge.jpg` | Fast travel to the spots and the fact cards |
| `results-row.jpg` | The results screen with the "Spots claimed" row (#220) |
| `story-card-new-realm.jpg` | The New Realm Brewing story card over the results (#220, #354) |
| `story-card-skatepark.jpg` | The skatepark story card on the full map (#220) |
| `tour.jpg` | Tour mode: the HUD reads TOUR (#260) |
| `title.jpg` | The title screen (#301) |

The pictures in `docs/review/screenshots/` were taken on 2026-11-24 from `main` at `087a8a8` (headless Chromium, SwiftShader, the look and the tier that the game picks with no URL parameter).
