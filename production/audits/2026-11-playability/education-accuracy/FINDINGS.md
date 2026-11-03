# Education and real-world accuracy audit: `beltline-eastside`

- Date: 2026-11-03. Issue #65, areas 5 and 6. Branch `audit-65-playability` (head 90260bb).
- Method: the `content-audit` skill, applied by hand to one level. The project has no `design/gdd/` folder, so the content counts come from `docs/games/2026-10-30-skate-atl-concept.md`.
- This audit changes no file under `src/`, `docs/`, `levels/`, `assets/`, `landmarks/`, or `e2e/`.
- Evidence: `landmarks.csv` (188 rows), `data/` (8 JSON files), `scripts/` (8 scripts), `screenshots/` (7 JPEGs).

## Scores

| Area | Score | Reason |
|---|---|---|
| Educational quality | **1** | The game has no fact cards. Pillar 3 and the "knowledge" progression do not exist. The only text in the world is street signs, one rooftop sign, the Krog Street Market letters, and random mural words. |
| Real-world accuracy | **4** | The trail is within 3.6 m of the official BeltLine line. 6 streets are within 5.4 m of the City of Atlanta centerlines; one exception is Krog St (max 15.5 m), at a service segment that OSM names Krog St. The PCM tower is 9.7 m from OSM. The errors are in text and art: a sign name that is not a real street, the PCM sign on the wrong side, clipped KSM letters, and invented murals. |

## Landmark summary

`landmarks.csv`, 188 rows. OK is under 10 m. CHECK is 10–30 m. WRONG is over 30 m, or the wrong place or side.

| Group | Rows | OK | CHECK | WRONG | Other |
|---|---|---|---|---|---|
| Landmarks and named places with a real position | 9 | 5 | 3 | 1 | – |
| Street-sign posts (68 names) | 95 | 89 | 4 | 2 | – |
| Murals in the game | 39 | – | – | – | 39 invented |
| Real OSM artworks, not in the game | 12 (9 unique) | – | – | – | 12 MISSING |
| Named buildings with no label | 31 | – | – | – | N/A (from OSM) |
| Freedom Park pieces | 2 | – | – | – | N/A |

| Item | Offset | Status |
|---|---|---|
| PCM tower top (model) | 9.7 m from OSM building:part way 335151383 | OK |
| PONCE CITY MARKET rooftop sign | Faces bearing 90 (east). The reference photo shows it next to the tower, facing south | WRONG (orientation) |
| KSM front (model and letters) | 26.2 m from the address point at the building middle. The front is on the real wall | CHECK (side not verified) |
| PCM footprint | The address point (675 Ponce de Leon Ave NE) is inside the footprint | OK |
| KSM footprint | The address point (99 Krog St NE) is inside the footprint | OK |
| Kroger at 725 Ponce | The address point is inside, 2.9 m from the centroid | OK |
| Atlanta Art Park | 0.2 m | OK |
| Historic Fourth Ward Park | 13.0 m. The offset comes from the centroid method only | CHECK |
| Parque en el centro bonito | 11.8 m. One OSM editor added the name in 2025. No official source | CHECK (name) |

## Findings

| ID | Sev | Finding | Evidence | Suggested fix | Issue | Phone |
|---|---|---|---|---|---|---|
| EDU-1 | P0 | The game has no fact cards. A grep for "fact" finds only unrelated code. `objects` in `level.json` is empty. Version 1 needs 9 cards, 3 per level, and the cards unlock content. | `src/`, `level.json`, concept lines 87, 93, 113, 133 | Build #17 with the spec below. Design the card for a phone first. | #17 | high |
| EDU-2 | P1 | Mural words come from a hash of the building id (`src/render/murals.js`). 6 of 39 murals say "SWEET AUBURN", which is a different neighborhood. "KROG", "PONCE", and "INMAN" go on any wall. | `data/ingame.json`, csv "Mural" rows | Pick the word from the nearest open-data-atl neighborhood, or use words with no place name. | – | low |
| EDU-3 | P1 | The `#shell-info` text is a 51-word list of keyboard and mouse controls, plus dev text (`H for colliders`, `?view=orbit`). On an 844x390 screen it takes 3 lines (57 px) over the scene. | `index.html:14`, `screenshots/phone-pcm-sign-844x390.jpg` | Show help for the player's device. Remove the dev text. Hide the help after the first move. | #24 | high |
| GEO-1 | P1 | 2 signs show "Closed Lake Ave". OSM way 586825917 has `name=Closed Lake Avenue` (since 2018). City centerlines have Brickworks Cir NE and West Ashland Ave NE there. TIGER does not have the name. This breaks pillar 2. | `screenshots/sign-closed-lake-ave.jpg`, `data/city-checks.json` | Add a name override in the level build, or fix the name in OSM. Add a test that checks sign names against the city centerlines. | – | low |
| GEO-2 | P1 | The PCM sign is on the east roof edge and faces the trail. The reference photo (taken from Historic Fourth Ward Park) shows it next to the tower, west of it, facing south. | `screenshots/pcm-aerial-from-southeast.jpg`, `landmarks/ponce-city-market/ref/reference.jpg` | Move the sign next to the tower and face it south. Confirm with a second photo. | #18 | medium |
| GEO-3 | P1 | "MARKET" shows as "MAR". The wall of the next building box covers the card. | `screenshots/ksm-front.jpg` | Move the model out of the next footprint, or raise the card. Add a screenshot test. | #18 | medium |
| GEO-4 | P2 | "Bishop Way NE" (city: Bishops Way NE). "Prospect Way NE" is not in the city data or TIGER. "Austin Ave NE" is on a corner where the city has Lake Ave NE. "Ralph McGill Blvd" appears with and without "NE". | `data/city-checks.json` | Use the city centerlines (catalog `atl-street-centerlines`) as the source for sign names. | – | low |
| GEO-5 | P2 | Sign blades are about 3 px high at 9 m on an 844x390 screen. Players cannot read them. | `screenshots/phone-street-sign-844x390.jpg` | Show the street name in the HUD at a crossing. | #24 | high |
| GEO-6 | P2 | 9 real artworks (for example the "We ♥ ATL" mural and "Northern White") are not in the game. The concept says to place murals "at real positions". | `data/overpass-landmarks.json` | Put mural slots at the real art positions. Get artist permission first. | #18 | low |
| GEO-7 | P2 | 2 names in the data have no official source: "Parque en el centro bonito" (one editor, 2025), and "Troy Pierless Lofts" (the City landmark list spells it Troy-Peerless). | OSM history of way 1229184075, `data/city-checks.json` | Take every name a player sees from the catalog. | #17 | low |
| GEO-8 | P2 | PCM is one 50 m box. The real complex has wings at different heights. Only 2 of 5–10 landmark models exist. | `screenshots/pcm-aerial-from-southeast.jpg` | Split the box by OSM building:part heights. | #18 | low |
| GEO-9 | P2 | 3 camera positions near Historic Fourth Ward Park gave a black frame. The cause is not known. | `screenshots/blank-canvas-h4w-park-camera.jpg` | Investigate. | – | low |
| GEO-10 | P2 | Known trail problems: roof walls (#57) and the ground under bridges (#59). This audit did not measure them again. | issues | Fix in #57 and #59. | #57, #59 | medium |
| EDU-4 | P2 | The attribution is 11 px text and 815 px wide on an 844 px phone screen, over the score. | phone screenshots | Move it to pause and credits on a phone, with a short in-play mark. Check the ODbL guidance first. | #24 | medium |

## Content audit (skill)

| Content | Specified | Found | Status |
|---|---|---|---|
| Fact cards in Version 1 | 9 | 0 | NOT STARTED (HIGH PRIORITY) |
| Fact cards per level | 3 | 0 | NOT STARTED (HIGH PRIORITY) |
| Landmark models per neighborhood | 5–10 | 2 | EARLY |
| Landmark gaps per level | 2 | 0 | NOT STARTED |
| Street signs | unspecified | 95 posts | found |
| Murals at real positions | unspecified | 0 real, 39 invented | gap in kind |

Total: 16 items specified, 2 found, a gap of 88%.

Text a player reads now:

| Text | Status |
|---|---|
| Street names | 62 of 68 names match city or TIGER data (GEO-1, GEO-4) |
| PCM rooftop sign | Name correct, side wrong |
| KSM letters | Clipped |
| Mural words | Positive tone, but the places are wrong |
| Controls text | Flesch-Kincaid grade about 4, but one 51-word run-on, keyboard only |
| Hint "Press any key or click..." | Gives keyboard and mouse words on a phone |
| Attribution | 11 px |

All tone is positive or neutral.

## Fact-card spec (Version 1)

1. **Count:** 9 cards, 3 per level.
2. **Source:** every card has one open-data-atl catalog dataset id, the field, the value, and the fetch date. A card from outside the catalog needs a review flag.
3. **Length:** the pickup toast has 70 characters or fewer, at grade 6 or lower. An optional detail line has 140 characters or fewer and shows on the results screen only.
4. **Display:** the card never pauses the run. The toast shows for 3 s at the top center, inside the safe area. It must not cover the combo or the touch controls.
5. **Placement:** each card stands at its real place, within 30 m of a skate surface.
6. **Tone:** positive or neutral only. No crime, police, traffic danger, or decline.
7. **Names:** take every name from the catalog or the city layers, not from OSM.
8. **Test:** a Vitest test checks the source id, the length, the bounds, and a list of banned words.

Candidate facts:

| # | Text | Place | Source | Catalog |
|---|---|---|---|---|
| 1 | The Eastside Trail runs 2.4 miles to the Krog Tunnel. | spawn | Official Atlanta Beltline Trails `dpcd-1db4dee8701c4aea8af97728ffa7ce75-0` (`miles_txt`, `extent`) | yes |
| 2 | The Eastside Trail was the first finished part of the Atlanta Beltline. | Ponce bridge | same, `description` | yes |
| 3 | The Eastside Trail is built on an old railroad line. | North Ave bridge | same, `description` | yes |
| 4 | Excelsior Mill on North Avenue became a City of Atlanta landmark in 2006. | 695 North Ave NE | Landmark Building Site `dpcd-5009ee2c703d4291a21a98cdc03167f3-16` (2006-10-24) | yes |
| 5 | The Troy-Peerless Laundry Building became a city landmark in 2007. | 650 Glen Iris Dr | same (2007-05-14) | yes |
| 6 | Inman Park is a City of Atlanta historic district. | near KSM | Historic District `dpcd-3f15fba5c71c4c4eab7288a3d1b4f17a-15` | yes |
| 7 | Part of this map is in the Martin Luther King Jr. Landmark District. | Auburn Ave / Randolph St | same | yes |
| 8 | Old Fourth Ward covers about 783 acres. | Historic Fourth Ward Park | open-data-atl `areas` (old-fourth-ward, 783.1 acres) | yes |
| 9 | Ponce City Market opened in 1926 as a Sears store and warehouse. | PCM, trail side | Wikipedia "Ponce City Market" | **no, needs review** |

Spare facts: the trail is open 6 AM to 11 PM (Beltline Trails `hours`); Inman Park is 384 acres; Ponce De Leon Tourist Home became a landmark in 2020.

## Streets, trail, bounds, heights

- **Trail:** compared with the official BeltLine line, the median is 0.3 m, p95 1.7 m, and max 3.6 m (602 samples). The official line in the bounds is 2294 m; the game trail is 2327 m.
- **Centerlines** (median / max, against the city layer):

  | Street | Median | Max |
  |---|---|---|
  | Ponce de Leon Ave | 3.8 m | 5.4 m |
  | North Ave | 0.9 m | 2.2 m |
  | Highland Ave | 0.7 m | 1.3 m |
  | Irwin St | 0.7 m | 1.0 m |
  | Ralph McGill Blvd | 0.8 m | 3.8 m |
  | Krog St | 0.6 m | 15.5 m (at a service segment that OSM names Krog St) |

- **Integrity:** all strips, buildings, and areas are OSM elements of the raw fetch. No fake street geometry. Only the name in GEO-1 is wrong. "John Lewis Freedom Pkwy" is correct; TIGER and the city layer still use the old name.
- **Bounds:** the bounds equal the bbox (x ±485.31 m, z ±972.96 m). The trail runs the full north-to-south extent.
- **Heights:** the PCM tower top is about 71 m; the published tower height is 227 ft (69.2 m, Traditional Building 2020, not a catalog source). 725 Ponce is 39.4 m from 12 levels; Wikipedia gives 12 stories but no height.

## Verified

- No fact cards exist (grep).
- In-game positions come from the real level code, converted back to lat/lon with `projection.js`.
- Real positions come from Nominatim, Overpass, TIGERweb, and the City of Atlanta and BeltLine catalog layers (2026-11-03).
- The OSM histories of the two odd names.
- Screenshots on Vite port 5183 (headless, high tier) show the sign direction, the clipped "MARKET", the "Closed Lake Ave" blade, and unreadable signs on a phone screen.
- The PCM tower height is within 2 m of the published figure.

## Not verified

- The real side of the KSM entrance (the Overpass query timed out).
- The surveyed position of the PCM sign (GEO-2 relies on one photo).
- MARTA stations in the bbox.
- The cause of the blank canvas.
- The sources in `heights.json`.
- The City Parks layer (the URL is inaccessible) and the BeltLine access points layer (timeout).
- Fact 9 and the PCM tower height come from sources outside the catalog.
- No test on a real phone.
