# Skate ATL: live demo script (5 minutes)

**For:** a meeting with the Mayor's Office of Technology and Innovation (OTI). **Date:** 2026-11-24. **Status:** draft for the owner. Nobody was contacted.
**Build:** release v0.9.0, https://skate-atl.vercel.app (production deploys from `main`).
**Devices (owner decision, 2026-11-24):** a laptop on the projector (main), and a phone for a short touch demo at the end (backup).

## 1. Before the meeting (30 minutes before)

1. Laptop: Chrome, full screen, sound on, a USB or Bluetooth gamepad connected (the keyboard also works).
2. Open the demo URL. It plays the intro, starts Tour mode, sets a clear afternoon, and turns on fast travel from the map:

   ```
   https://skate-atl.vercel.app/?intro=1&run=tour&weather=clear&time=14&travel=1&look=pbr&teach=0
   ```

   - `weather=clear&time=14`: until #353 merges, the game clock uses the device time zone and can start at night in rain.
   - `teach=0`: no move prompts (they take about 30 s). Use `teach=1` if the audience will play.
   - `travel=1`: the full map gets a "Travel here (T)" button. It is off in a normal production visit.
3. Let the page load fully once. Skate for 1 minute. Then reload the same URL, so the intro plays from the browser cache.
4. Phone: open `https://skate-atl.vercel.app/?run=tour&weather=clear&time=14&teach=0` in landscape. Leave it on the title screen ("TAP TO START").
5. Do not open the New Realm Brewing story card until #354 merges (one fact names beer and spirits).

## 2. The route

The skater starts on the Eastside Trail by the Freedom Parkway bridge, facing north. The route stays inside about 100 m of the start, and one fast travel goes to Ponce City Market.

| Order | Place | Where from the start | What the audience sees |
|---|---|---|---|
| A | Freedom Parkway Bridge | 20 m south (turn around) | Easy gap: "Hop under the Freedom Parkway bridge". Found and Claimed banners. |
| B | Neighborhoods fact card | 63 m south, on the trail | Open data card: "The Eastside Trail links 3 neighborhoods here: Inman Park, Old Fourth Ward and Poncey-Highland." |
| C | Thomas Taylor Memorial Skatepark | 65 m west of the start | Grinds on the rails and the ledge, the quarter pipe. Hard challenge: a 2,000 point combo. |
| D | Full map and Guide tab | Key M, then key G | Spot states (Unknown, Found, Claimed), the story card of the skatepark with sources. |
| E | Ponce City Market | Fast travel from the map | Found banner: "Opened in 1926 as a nine-story Sears, Roebuck and Co. store and warehouse." |

## 3. Script with timings

Keys: W or Shift push, A and D steer, Space jump, F grind, Q and E dance, M map, G Guide tab, P photo mode. Gamepad: X push, A jump, RT grind, Y and B dance, left stick steer.

| Time | Do | Say |
|---|---|---|
| 0:00 to 0:20 | The intro plays: the camera flies along the real Eastside Trail under the Skate ATL logo. | "This is Skate ATL, a free roller skate game in the browser. What you see is the real BeltLine Eastside Trail, built from OpenStreetMap and City of Atlanta data." |
| 0:20 to 0:35 | Title screen. Pick Nia or Marcus. Press a key or a button. | "No install and no account. It runs on a laptop or a phone." |
| 0:35 to 1:05 | Tour mode starts (the HUD reads TOUR). The Found banner of the Freedom Parkway Bridge shows at the start. Turn around, push south, and jump under the bridge. The Claimed banner shows. | "Tour mode has no timer. When you skate near a real landmark, the game finds it and gives a skate challenge. Here: a gap under the John Lewis Freedom Parkway Bridge, where a BeltLine Marketplace sits." |
| 1:05 to 1:30 | Push on south about 40 m and ride through the floating card on the trail (pick-up radius 2.5 m). The "ATL FACT 1/3" pop-up shows for a few seconds. | "This card comes from the City's own GIS data, through the open-data-atl catalog: the trail links Inman Park, Old Fourth Ward and Poncey-Highland." |
| 1:30 to 2:30 | Turn west into the skatepark. Grind the long rail, ride the quarter pipe, dance on the roll-out (Q or E). Try the 2,000 point combo. | "This is Thomas Taylor Memorial Skatepark, Atlanta's first public skatepark, open since spring 2011. The moves come from Atlanta rink culture: Walk It Out, Swag Surf, The Prep. A fall never ends the run." |
| 2:30 to 3:20 | Press M (full map), then G (Guide tab). Show the claimed spots. A story card shows its facts only after the spot is claimed (an unclaimed spot reads "Claim it to unlock"). If the skatepark is claimed, open its icon. If not, open the Freedom Parkway Bridge icon (claimed in step A). | Skatepark: "Every fact has a source. This one is from the Historic Fourth Ward Park Conservancy: Tony Hawk came to the opening, and his foundation gave $25,000 toward the park." Freedom Parkway Bridge: "Every fact has a source. This one is from the Historic Fourth Ward Park Conservancy: the skatepark sits alongside the BeltLine corridor in the shadow of Freedom Parkway." Then: "13 spots, 65 facts, all positive or neutral." |
| 3:20 to 3:50 | On the map, click the Ponce City Market icon, then "Travel here (T)". Close the map. The Found banner shows. | "Ponce City Market opened in 1926 as a Sears store and warehouse. That fact is from the National Register of Historic Places." |
| 3:50 to 4:15 | Skate on the trail past people and bikes. Press P (photo mode), then Escape. | "Cars move calmly and stop for the skater. No crime, no police, no traffic danger. Murals, not graffiti." |
| 4:15 to 4:40 | Phone: tap to start, push with the stick, tap JUMP and GROOVE. | "Phones are the top priority. Students can play it on a Chromebook or a phone, with no login and no personal data." |
| 4:40 to 5:00 | Back to the laptop or a slide with the one-pager. | "Our ask: a playtest in the OTI youth esports labs, a partner agreement with OTI, and then a Council resolution that names Skate ATL the official game of Atlanta." |

If the 2,000 point combo does not land in 1 minute, stop and go on. Say: "That one is the hard tier." The demo does not need the claim: at 2:30 open the Freedom Parkway Bridge card. If the gap in step A also does not claim, the map shows "Claim it to unlock" for every spot; then show the Found banners and the open data card as the sourced facts, and say that a claim unlocks the full story card.

Checked on production on 2026-11-24 (headless Chromium, phone tier, Tour mode): at the start the Found banner reads "Freedom Parkway Bridge / A BeltLine Marketplace sits under the John Lewis Freedom Parkway Bridge."; at card B the pop-up reads "ATL FACT 1/3 The Eastside Trail links 3 neighborhoods here: Inman Park, Old Fourth Ward and Poncey-Highland. Source: Neighborhoods, City of Atlanta Department of City Planning". Not checked by a person: the gap claim, the skatepark combo and the full demo in 5 minutes.

## 4. Fallbacks

| Problem | Do |
|---|---|
| The network is slow, the page loads slowly | Use the tab that you loaded in step 1.3; do not reload it. Let it run for 1 minute first, so the skater, the cars and the landmark models finish their late loads. The fact cards fall back to a recorded copy of the City data when the call to the data site fails. (Not tested: a full demo with the network cut after the load.) |
| The page does not load | Use the phone tier on the laptop: add `&quality=phone` (a smaller download, the "pbr lite" look). |
| The frame rate is low on the projector laptop | Add `&quality=phone` or `&look=toon`. On the phone tier, the game can also step down to the toon look by itself and shows one line on the HUD. |
| No network at all | Run a local copy: in the repository, `npm ci`, `npm run build`, and `npx vite preview`, then open the local URL with the same parameters. Test this once offline before the meeting. If that also fails, show the screenshots in `docs/pitch/screenshots/` with the one-pager. |
| The intro does not play | Add `&intro=title` for the title screen only. Then start. |
| After the fast travel, the banner shows the skatepark, not Ponce City Market | The banners wait in a queue (about 3 s each). Wait 3 s; the Ponce City Market banner follows. |
| The skater is in a wrong place after a fast travel | Press M and travel to the spot again, or reload the tab. |
| The phone does not respond to touch | Skip the phone part. Say that the phone layout has tests on 5 screen sizes. |

## 5. Do not

- Do not claim that the game is "the official game" before a written agreement. Do not show the City seal or logo.
- Do not say "the first city game in the US". Say: "We found no other US city with an official video game."
- Do not say that the game is finished. Say: "v0.9.0. Real skaters review the move set before Version 1."
