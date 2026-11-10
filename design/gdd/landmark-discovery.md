# Landmark discovery

> **Status**: Designed (pending `/design-review` in a fresh session)
> **Author**: William Hill + Claude agents
> **Last Updated**: 2026-11-07
> **Implements Pillar**: 2 (Every block is real), 3 (The city teaches, the game never lectures)
> **Concept source**: `docs/games/2026-10-30-skate-atl-concept.md` (off-index GDD: no systems index exists yet)

## Overview

**Landmark discovery** makes the real landmarks of each neighborhood into places that the player can find, ride, and learn about.

**The data layer:** Each landmark has 1 record. The record holds the landmark id, the OSM building (or bridge) and its map position, and a ride-in zone. It also holds a short-fact line, a story card of 3 to 5 sourced facts, and 1 skate challenge. The records cover all the modeled landmarks in the level: Ponce City Market, Krog Street Market, Telephone Factory Lofts, Studioplex, New Realm Brewing, and the 4 BeltLine bridges. The minimap and the full map read the same records, so every look shows the same landmarks.

**The player effect:**

1. The maps show each landmark with an icon that is either found or not found. A click on the full map opens the story card.
2. In the world, the player skates into the landmark zone. A name banner and 1 fact line show, and the play does not pause.
3. Each landmark also has a short challenge, for example a gap, a grind line, or a manual across the plaza. When the player completes the challenge, the full story card unlocks. The results screen and the full map show the card. Play never stops for it.

**Without this feature,** the landmarks are only scenery with gold initials on a map. Pillar 3 ("the city teaches") and the concept goal list ("2 landmark gaps") have no gameplay.

## Player Fantasy

**Main feeling: "I claimed this spot."** Every landmark is a famous skate spot. The player lands the landmark challenge and claims the spot, like a skater who conquers a known spot in a video part. The story card is the trophy.

**Support feeling: "I found them all."** Each claimed landmark turns its map icon gold. The full map becomes a guide to the neighborhood that the player wrote with their wheels. The next unclaimed icon drives "one more run".

**Tone: "I know that place!"** Atlanta players recognize real places, and visitors learn them. The facts show each place at its best, so the player feels pride and wants to show a friend.

Anchor moment: the skater rides the Eastside Trail, and the Ponce City Market tower rises ahead. The skater lands the landmark gap. The banner says "SPOT CLAIMED", and the card slides into the collection with no pause in play.

Note: `creative-director` was not consulted (lean review mode). Review manually before production.

## Detailed Design

### Core Rules

Scope of version 1 on the BeltLine Eastside level: 20 claim spots and 2 edge markers. Candidates, facts and sources: `docs/research/2026-11-07-eastside-landmarks.md`.

- 7 buildings: Ponce City Market, Krog Street Market, Telephone Factory Lofts, Studioplex, New Realm Brewing, Ford Factory Lofts, and the Excelsior Mill. The last 2 need primary sources before they ship.
- 4 BeltLine bridges: North Ave, Ralph McGill, Ponce, Freedom Parkway.
- 4 named parks: Atlanta Art Park, Freedom Park, Historic Fourth Ward Park, Parque en el centro bonito.
- 1 skate spot: the Historic Fourth Ward Skatepark. It needs a skatepark model or kit.
- 4 art spots: real Eastside Trail art (Beltline Shed, "33 Oaks", "Naw'-tsiʔ", "Northern White"). Each piece ships only after a check of the artist credit and permission. The 16 level murals stay unnamed original art (`assets/murals/provenance.json`).
- 2 edge markers (kind `edge`): Inman Park Historic District and the Jimmy Carter Presidential Library and Museum, just east of the level. An edge marker can be Found but has no challenge and no claim.

1. **One data file per level.** `levels/<level>/landmarks.json` lists the spots. Each spot has these fields:
   - `id`, `kind` (`building` / `bridge` / `park` / `skate` / `art` / `edge`), `name`, and the map point `at` [x, z].
   - The ride-in zone (`find.r`).
   - `short`: 1 fact line, 90 characters or fewer. It restates one fact of the `card` and uses the source of that fact.
   - `card`: 3 to 5 facts. Each fact has a `source` (name and URL).
   - `challenge`: the claim challenge (none for `edge`).
   - `art` only: `credit` = { `artist`, `title`, `year`, `permission`, `ref` }. The credit is "cleared" when `permission` is `written` and `ref` names the permission record in `docs/permissions/`. A validator rejects an art spot without a cleared credit.

   The minimap, the full map, and the world read only this file. The toon look and the pbr look show the same spots.
2. **Found.** The skater enters the find zone of a spot for the first time in the save. The spot becomes Found. A banner shows the name and the `short` line for 3 s. Play does not pause.
3. **Hint.** After a spot is Found, the HUD goal line shows its challenge, for example "Claim it: hop the gap under the bridge". A ring marks the challenge zone in the world.
4. **Challenge types.** Each type uses data from the skate controller, and the controller stays unchanged:
   - `gap`: the skater is in the air in the zone, and then lands with no bail, after the minimum air time (`COMBO.minAirTime`). A hard gap also needs the landing in its landing zone. A bail or a respawn drops the attempt. This type is the same as the existing gap goals (`src/sim/skate/goals.js`).
   - `grind`: the skater grinds a feature in the zone for `meters` or more in 1 grind.
   - `line`: the skater passes through 2 or 3 checkpoints in order within `seconds`, with no bail.
   - `combo`: the skater banks a combo of `points` or more, and the last link of the combo is in the zone. The bank position does not count (Formulas, Combo challenge).
5. **Claimed.** The skater completes the challenge. The spot becomes Claimed. The game shows "SPOT CLAIMED", banks the claim points, and unlocks the story card. Play does not pause.
6. **The save.** The Found and Claimed states stay in the browser across runs, for each level. Key `atl.landmarks`, value `{ "v": 1, "levels": { "<level>": { "found": [ids], "claimed": [ids] } } }`. A run also records which spots it claimed, for the results screen.
7. **No stop to read.** The full story card shows only on the results screen and on the full map, never during play (pillar 3).
8. **Facts.** Every fact is positive or neutral, with a source. A fact comes from the open data catalog or from a cited public source (National Register, City of Atlanta, Atlanta History Center, Atlanta BeltLine Inc., the landmark's own site). The rule change goes into `docs/decisions.md`.

### States and Transitions

Per spot, per save:

| State | Map icon | World | Enter by |
|---|---|---|---|
| Unknown | Gray "?" disc at the spot | No marker | Start state |
| Found | White disc with the kind icon and initials | Challenge ring and HUD hint | The skater enters the find zone |
| Claimed | Gold disc with the kind icon | No ring (spot done) | The skater completes the challenge |

A state never goes back, except through "Reset progress" in the settings menu. An `edge` marker stops at Found: its icon turns gold when Found, and its card unlocks when Found.

### Interactions with Other Systems

| System | In / out | Data |
|---|---|---|
| Skate controller (`src/sim`) | in | Position, airborne, grind (feature id, length), combo landed (points, position), bail |
| Minimap and full map (`src/ui/minimap.js`, `fullmap.js`) | out | The spot list and the state of each spot. These replace `mapLandmarks()` for landmarks. |
| Full map info panel | out | Found: `short` and "Claim it to unlock". Claimed: the full card with sources. A "Guide" tab shows the count, n of N claimed and m of M found. N and M come from the spots that ship (Edge Cases). |
| Score | out | Claim points go to the medal total only (`medalScore()` = banked score + run claim sum). The score goal reads the banked score without claim points, so the results screen keeps 2 totals. |
| Goal list (`goals.json`) | out | Each existing gap goal becomes the `gap` challenge of the spot at the same zone. Only a `gap` challenge at the same zone completes a gap goal; a bridge with a grind or line challenge does not. |
| Fact cards (`src/sim/fact-cards.js`) | none | The fact cards stay a separate system with the same values. |
| Results screen | out | The spots claimed in this run, with "NEW" on first claims and the cards to read. |
| Landmark models (`landmarks.js`) | in | A spot can name its building, so the map point follows the footprint. |

## Formulas

Source: `systems-designer` proposal, 2026-11-07. Verified in code (`epic/city-look`): maxSpeed 12 m/s, jumpSpeed 5, gravity 20 (air time 0.5 s), grind friction 0.6 m/s², combo value = pending × multiplier (max 10), grindBase 100 + 300/s, hop 50, groove 150, spin 160, gap check = airborne inside a circle, minimap 1 px = 1 m. **Assumed (confirm with a playtest log):** typical speed 8 m/s, street width at least 14 m, rail lengths.

### Claim points

`awarded = min(first_claim ? P[tier] : 0, run_cap - run_claim_sum)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| First claim in save | first_claim | bool | 0/1 | 1 if the spot was never Claimed |
| Tier points | P[tier] | int | easy 200 / typical 300 / hard 500 | Min 100, max 600 per tier |
| Run cap | run_cap | int | 1000 (tune 600 to 1500) | Claim points per run |
| Claim sum so far | run_claim_sum | int | 0 to run_cap | Points awarded this run |

**Output range:** 0 to 500 per claim; 5800 over the whole save (8 easy × 200 + 9 typical × 300 + 3 hard × 500; 20 claim spots). Claim points count toward the medals only, not toward the score goal (decision 2026-11-07). **Example:** 4th claim of a run, typical, run_claim_sum 800: min(300, 1000 − 800) = 200.

### Find check

Buildings and parks: the skater is Found when the distance to the footprint outline is `d_edge` or less (or the skater is inside it). Bridges and the art spot: the distance to the point `at` is `r_find` or less.

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| Edge distance | d_edge | float m | 4 / 8 / 12 | Buildings and parks |
| Point radius | r_find | float m | bridge 14 / 20 / 28; art 10 / 14 / 18 | Bridges and art |

**Rule:** keep `d_edge` below the street width (14 m assumed), so the far side of a street does not trigger. **Example:** the skater rides the trail 6 m from the Ponce City Market outline: 6 ≤ 8, so the spot is Found.

### Gap challenge

`r_gap = k_tier * L_air`, with `L_air = v_typ * 2 * jumpSpeed / gravity`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| Air path | L_air | float m | 3 to 6 | 8 × 0.5 = 4 m |
| Tier factor | k_tier | float | easy 3 / typical 2 / hard 1.25 | Min 1, max 3.5 |

**Output range:** easy 12 m, typical 8 m (the same as the 2 gap goals), hard 5 m plus a landing zone of 3 m.

### Grind challenge

`meters = min(v_g * t_tier, 0.8 * L_rail)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| Grind speed | v_g | float m/s | 4 / 6 / 8 | Assumed |
| Grind time | t_tier | float s | easy 1.5 / typical 2.5 / hard 4 | Min 1 |
| Rail length | L_rail | float m | 8 to 60 | Not verified |

**Output range:** easy 9 m, typical 15 m, hard 24 m. A tier needs a rail of `v_g * t_tier / 0.8` or more: easy 11.25 m, typical 18.75 m, hard 30 m. On a shorter rail, `0.8 * L_rail` would give a hard grind shorter than an easy one (an 11 m rail gives 8.8 m). The validator rejects a tier on a rail that is too short, and the level designer picks a lower tier or another feature. **Example:** typical on a 30 m rail: min(15, 24) = 15 m.

### Line challenge

`T = ceil((n - 1) * d * s / v_line)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| Checkpoints | n | int | 2 to 3 | The timer starts at the first checkpoint |
| Spacing | d | float m | easy 40 / typical 30 / hard 35 | Min 20, max 60 |
| Slack | s | float | easy 1.8 / typical 1.4 / hard 1.15 | Min 1.1, max 2 |
| Line speed | v_line | float m/s | 6 | 0.75 × v_typ, assumed |
| Checkpoint radius | r_cp | float m | 4 | Fixed |

**Output range:** 7 to 24 s (typical n = 2: 7 s; easy n = 3: 24 s). **Example:** typical, n = 3: ceil(2 × 30 × 1.4 / 6) = 14 s. A miss resets the attempt only (no fail state).

### Combo challenge

`claimed = (pending * multiplier >= C[tier])` and the last combo link is within `r_combo` of the spot.

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| Tier points | C[tier] | int | easy 600 / typical 1000 / hard 2000 | Min 400, max 3000 |
| Zone radius | r_combo | float m | 10 | Around the last link position |

**Example:** hop + 1.5 s grind = 600 × 2 = 1200, so a typical combo spot is claimed. Use the position of the last link, not the bank position, because the bank comes about 0.8 s (about 6 m) later.

### Banner time

`t_show = clamp(t_base * (1 - 0.3 * q), t_min, t_base)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| Base time | t_base | float s | Found 3.0 (2 to 4); Claimed 2.5 (1.5 to 3.5) | Includes a 0.3 s fade |
| Queue length | q | int | 0 to 2 | Banners that wait |
| Minimum | t_min | float s | 1.5 | |

**Rules:** One banner shows at a time. A Claimed banner goes before a Found banner. The queue holds 2 Found banners at most. Claimed banners are not capped; each one shows for at least `t_min`. A Found banner that does not fit is dropped, but the state and the map icon still change. A Claimed banner is never dropped. **Example:** q = 1, Found: 3.0 × 0.7 = 2.1 s.

### Collection

`n_claimed = count(Claimed)`, `unlock_i = ceil(f_i * N)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| Spots | N | int | 20 | Claim spots per level (edge markers do not count) |
| Fractions | f_i | float | 0.35 / 0.7 / 1.0 | Tune 0.25 to 1.0 |

**Output:** outfit unlocks at 7, 14 and 20 claims. Unlocks never change the score. The full map shows the Found count and the Claimed count separately.

### Tier map (placeholder)

8 easy, 9 typical, 3 hard. The level designer must confirm that each feature exists.

- Buildings: Ponce City Market combo hard; Krog Street Market grind typical; Telephone Factory Lofts line typical; Studioplex gap easy; New Realm Brewing combo easy; Ford Factory Lofts grind easy; Excelsior Mill line typical.
- Bridges: gap easy (r 12); gap typical (r 8); grind typical; line hard.
- Parks: Atlanta Art Park gap easy; Freedom Park line easy; Historic Fourth Ward Park combo typical; Parque en el centro bonito grind easy.
- Skate spot: Historic Fourth Ward Skatepark combo hard.
- Art spots: 2 line typical, 1 gap easy, 1 grind typical (by the space around each piece).
- Edge markers: no challenge.

## Edge Cases

- **If 2 find zones overlap:** Both spots become Found in the same step. The nearer spot shows its banner first, and the other spot waits in the queue (Section D rules).
- **If the skater starts the run inside a find zone:** The game checks find zones only after the run timer starts. Then the spot becomes Found normally.
- **If the run is a free run (`?run=free`, no run timer):** The find checks start at the first frame of play, so spots become Found. A free run has no results screen and no medals, so no spot becomes Claimed in it, and no challenge ring shows. The first claim of each spot, with its points, stays for a timed run. In a free run, the HUD hint and the full map panel of a Found spot read "Start a timed run to claim it" in place of the challenge text and "Claim it to unlock".
- **If the skater uses "Travel here" on the full map into a find zone:** The spot becomes Found. A challenge ignores the travel step, so a jump in the air cannot complete a gap challenge.
- **If the skater completes a challenge before the spot is Found:** The spot becomes Found and Claimed in the same step. Only the "SPOT CLAIMED" banner shows.
- **If the skater bails during a line challenge:** The attempt resets. The ring stays.
- **If the run timer ends during an attempt:** The run end rule does not change: the run ends when no combo is active, or when the 10 s overtime (`goals.json` `overtime`) ends. A combo attempt can finish in the overtime. A line, gap or grind attempt that is open when the run ends is dropped. A landmark attempt does not extend the run.
- **If the run cap for claim points is full:** The claim still counts and the card unlocks. The banner shows "SPOT CLAIMED" with no points.
- **If browser storage is not available (private window or blocked storage):** The game keeps the claims for the current run only. The settings menu shows "Progress is not saved in this browser."
- **If the save has spot ids that the level file does not have:** The game ignores those ids. A new spot starts as Unknown. The save has a version number.
- **If a spot fails its source check** (art credit not cleared, or no primary source)**:** The spot stays out of `landmarks.json`, and the map shows no icon. N counts only the spots that ship, and the outfit unlocks use that N.
- **If a fact card pop-up and a banner show at the same time:** The 2 positions can overlap on a phone (at 360 x 640 the pop-up starts at 206 px) and on a short desktop window (at 1024 x 550 the pop-up starts at 88 px and the banner at 165 px). So on every screen, a banner waits in its queue while the fact pop-up shows, and shows when the pop-up closes. The banner time starts when the banner shows.
- **If photo mode is open:** The simulation pauses, so no Found or Claimed change occurs.
- **If a grind starts in the zone and leaves it:** The full length of the grind counts.
- **If the player switches skater:** The progress belongs to the save, not to the skater.
- **If reduced motion is on:** The banner fades in with no slide.
- **If the player resets progress:** A confirm dialog shows first. The claims and the found states clear, but the unlocked outfits stay.
- **If a bridge spot is already claimed in an earlier run:** The gap goal for that bridge in `goals.json` still needs the gap in this run, because goals reset for each run and claims stay in the save.

## Dependencies

| System | Direction | Hard or soft | Interface |
|---|---|---|---|
| Skate controller (`src/sim`) | upstream | Hard | Each step gives the position, the airborne flag, grind events (feature id, meters), combo links (points, position), and bails. The controller does not change. |
| Level data (`levels/<level>/level.json`) | upstream | Hard | Building and park outlines for the edge check. Feature ids for grind challenges. |
| Landmark models (`src/level/geo/landmarks.js`) | upstream | Soft | The building names, so a map point follows the footprint. |
| Open data catalog and cited sources | upstream | Hard (content) | The card facts. Research: `docs/research/2026-11-07-eastside-landmarks.md`. |
| Run timer and goals (`goals.json`) | both | Soft | The run start gates the find checks. A `gap` claim at the zone of a gap goal marks that goal in this run. |
| Score and medals | downstream | Soft | Claim points go to the medal total only. |
| Minimap and full map | downstream | Hard | The spot list and the state of each spot. These replace `mapLandmarks()` for landmarks; parks without a spot keep their icons. |
| Results screen | downstream | Soft | The spots that this run claimed. |
| Settings menu | downstream | Soft | "Reset progress", and the notice when progress is not saved. |
| Outfits (skater select) | downstream | Soft | The unlocks at 7, 14 and 20 claims. The outfit content does not exist yet. |
| Photo mode | peer | Soft | It pauses the checks. |
| Skatepark model or kit | upstream | Hard for 1 spot | The Historic Fourth Ward Skatepark spot needs ramps or ledges in the level. |

**One-way links to fix:** `AGENTS.md` and the concept doc say "facts from the open data catalog". A `docs/decisions.md` entry must record the change to "catalog or cited public source".

## Tuning Knobs

All knobs are data in `landmarks.json` or in one constants object, like `FACT_CARDS`.

| Knob | Typical | Safe range | Too low | Too high |
|---|---|---|---|---|
| `P[tier]` claim points | 200 / 300 / 500 | 100 to 600 | Claims feel empty | Claims drive the medals more than skating does |
| `run_cap` | 1000 | 600 to 1500 | Later claims in a run give 0 | A rush of claims in run 1 jumps the medals |
| `d_edge` find distance | 8 m | 4 to 12 m | The player rides past with no banner | The far side of a street triggers the banner |
| `r_find` (bridge / art) | 20 / 14 m | 10 to 28 m | Same as `d_edge` | Same as `d_edge` |
| `k_tier` gap factor | 3 / 2 / 1.25 | 1 to 3.5 | Gaps are too hard | A near miss claims a gap |
| `t_tier` grind time | 1.5 / 2.5 / 4 s | 1 to 5 s | Trivial | The player needs more than the rail |
| Line slack `s` | 1.8 / 1.4 / 1.15 | 1.1 to 2 | Only experts finish | No skill is needed |
| `C[tier]` combo points | 600 / 1000 / 2000 | 400 to 3000 | Trivial | Above the skill of a new player |
| `t_base` banner time | 3.0 / 2.5 s | 1.5 to 4 s | Too short to read | Banners pile up |
| `f_i` unlock fractions | 0.35 / 0.7 / 1.0 | 0.25 to 1.0 | Unlocks with no effort | Unlocks too late to motivate |

**Knobs that interact:**

- `run_cap` limits `P[tier]`. If `P` goes up, check `run_cap`.
- `d_edge` must stay below the street width.
- `k_tier` uses the typical speed, so a playtest change to the speed changes every gap zone.

## Visual/Audio Requirements

Source: `art-director` proposal, 2026-11-07. Rules: `docs/art-direction-pbr.md` (bloom day threshold 2.4, night 0.92; section 8 tiers; section 11 comic effects #113). **Not verified in code:** the fact pop-up height, the sound effect API, the music gain node, and instancing in the renderer.

### World markers

- **Find zone:** no marker. A marker would spoil the discovery. The map "?" is the only hint.
- **Challenge ring** (Found, not Claimed): 1 flat ring on the ground, 0.15 m wide, in the landmark gold `#ffd166`. The type reads by shape, not by color: `gap` full circle, `grind` dashed circle, `line` numbered checkpoint rings, `combo` double ring.
- **Toon look:** flat unlit ring with an ink outline. **Pbr look:** emissive overlay. In the day its emissive value is 0.8, below the day bloom threshold of 2.4. At night the core value is 1.6 and the rest stays at 0.8, so only the core is above 0.92, so the signs stay the hottest thing.
- **Draw calls:** 1 `InstancedMesh`, 1 shared `MeshBasicMaterial`, 1 atlas texture: 1 extra draw call for all rings. A fade cone up to 3 m is on the high tier only (1 more draw call).
- **Tiers:** low = flat ring, no pulse; phone = slow scale pulse; high = pulse, cone, and night bloom core. `prefers-reduced-motion` turns off the pulse, the burst (a 0.3 s fade of the ring instead), the petals, and the icon pulse on every tier.

### The Found and Claimed moments

- **Banner position:** center, 30 vh from the top, below the fact pop-up (`shell.css`, top 88 px) and clear of the HUD and the minimap. Width on a desktop: `min(520px, 100vw - 600px)`, the same as the pop-up. On a compact screen (`max-width: 600px` or `max-height: 500px`) the banner uses the compact width of the fact pop-up (`shell.css`): `min(420px, 100vw - 24px)` minus the safe-area insets in portrait. The banner never gets a width under 280 px. Test it at 390 x 844 and 360 x 640. The banner and the fact pop-up never show at the same time (Edge Cases); test a banner and a pop-up that start in the same step at 360 x 640 and at 1024 x 550.
- **Found banner:** dark pill (`--hud-pill`) with a 3 px `#ffd166` border; name in `system-ui` 800 weight, 22 px; the `short` line in 600 weight, 17 px.
- **Claimed banner:** the pill fills with the district accent, with dark ink text. "SPOT CLAIMED" in 800 weight, 28 px, 0.1 em letter spacing. No other gold fill shows on the screen. Contrast 4.5:1 or more.
- **Claim effect (first piece of #113):** a star-and-ring burst at the skater's feet for 0.4 s, in the district accent from `DISTRICT_LOOKS`. Bloom on the hot core only. The ground ring turns gold and fades in 0.5 s. Phone: ring only. Low: no bloom. No impact frame.

### Map icons

| State | Shape | Fill | Mark |
|---|---|---|---|
| Unknown | Dashed circle | Gray | "?" |
| Found | Circle, thick ink outline | White | Kind glyph |
| Claimed | Circle | Gold | Kind glyph and a check mark at the lower right |
| Edge (Found) | Square | White | Arrow out of the map |

Kind glyphs (single stroke, 16 px grid): building = flat roof with 2 windows; bridge = arch; park = tree; skate = quarter pipe; art = brush on a frame; edge = arrow. Size: 14 px or more on the minimap, 24 px on the full map. The state reads by shape and mark, not by color only.

### Story card

- Portrait trading card, 3:4, paper `#f5ecd7` with an ink border. A header band shows the district accent. Then the name, the kind glyph, 3 to 5 facts with source links, and a "NEW" stamp on a first claim.
- **Card art:** an in-game render of the landmark from a fixed camera, in the day pbr look. The art is original and shows the place at its best, and a script can rebuild it. Its `provenance.json` records the commit, the camera, and the date. A real photo needs a written license. Generated art needs a `provenance.json` (tool, prompt, credits, date).
- Hard spots get a foil edge (a CSS shimmer, off with reduced motion).

### Audio

- **Found:** a soft 2-note rising chime, under 0.4 s. **Claimed:** a 3-note major arpeggio and a short wheel sound, under 0.9 s.
- Start each chime on the next beat or half beat from `BeatClock` (`src/audio/beat-clock.js`), with a delay under 1 beat. If the clock is off, play the chime at once.
- **Ducking:** the music gain goes to 0.5 × its value in 80 ms, holds for the chime, then returns in 300 ms. One chime plays at a time; Claimed goes first. No chime in photo mode.

### Political rules

- Rings and effects use the accents only: no red, no hazard stripes. A ring must not look like a warning.
- An art spot shows the real piece only after the artist credit is cleared.
- Card art shows clean, sunny scenes. The line challenge UI never shows the word "bail".

### Extra effects

| Effect | Tiers |
|---|---|
| A faint warm rim on a Found building at golden hour | High only |
| Dogwood petals (`#c98fa6`) fall over the skater for 1 s on a claim | High; phone 8 petals; low off |
| A newly claimed icon pulses once on the minimap and the full map | All; off with reduced motion |

## UI Requirements

- **Full map:** a "Guide" tab lists all spots by kind, with "n of N claimed" and "m of M found". N is the count of claim spots that ship, and M is the count of all spots that ship (claim spots and edge markers). Both come from `landmarks.json`, never from a fixed number. A click or a tap on a spot opens its card (Claimed or edge Found), or its `short` line and "Claim it to unlock" (Found), or "Not found yet" (Unknown). "Travel here" stays.
- **Minimap:** the same 3 icon states and the edge square, 14 px or more.
- **Results screen:** a row of the cards that this run claimed, with "NEW" stamps. A tap or a click opens a card. Play never pauses for a card.
- **Settings menu:** "Reset progress" with a confirm dialog, and the notice "Progress is not saved in this browser" when storage fails.
- **Input:** a mouse, a touch, and the keyboard can open each card and the Guide tab. A card closes with Escape, a close button, or a tap outside it.

**UX flag:** run `/ux-design` for the Guide tab and the story card before the stories are written.

## Acceptance Criteria

Source: `qa-lead` proposal, 2026-11-07. Tags: [unit] = Vitest; [e2e] = Playwright headless with a screenshot; [manual] = a human check; (P) = needs a playtest log or a real device.

### Core rules

- **AC-1 (rule 1)** **GIVEN** a level file, **WHEN** the game loads it, **THEN** every spot has `id`, `kind`, `name`, `at`, a find value, `short` of 90 characters or fewer, 3 to 5 sourced facts, and a challenge (none for `edge`). The minimap and the full map list the same ids in `?look=pbr` and in the toon look. [unit][e2e]
- **AC-2 (rule 2)** **GIVEN** an Unknown spot, **WHEN** the skater first enters its find zone after the run timer starts, **THEN** the state is Found in that step, the banner shows the name and `short` for 3.0 s, and the frame delta does not change (no pause). [unit][e2e]
- **AC-3 (rule 3)** **GIVEN** a Found spot, **WHEN** the next frame renders, **THEN** the HUD goal line shows the challenge text and 1 ring marks the zone. [e2e]
- **AC-4 (rule 4)** **GIVEN** scripted controller events for each type, **WHEN** all conditions hold, **THEN** the challenge completes. **WHEN** one condition fails (on the ground in the gap, a grind too short, a checkpoint out of order or late, a combo too low or outside the zone), **THEN** it does not complete. `git diff src/sim` shows no controller change. [unit]
- **AC-5 (rule 5)** **GIVEN** a Found spot, **WHEN** the challenge completes, **THEN** the state is Claimed, the banner reads "SPOT CLAIMED", the points are banked, the card unlocks, the ring goes, and play does not pause. [unit][e2e]
- **AC-6 (rule 6)** **GIVEN** Found and Claimed spots, **WHEN** the page reloads, **THEN** the states under `atl.landmarks` are the same for that level, and the results screen lists only the spots claimed in this run. [unit][e2e]
- **AC-7 (rule 7)** **GIVEN** a run in progress, **WHEN** a spot is claimed, **THEN** no story card shows until the results screen or the full map opens. [e2e]
- **AC-8 (rule 8)** See S-1 to S-3.

### Formulas

- **F-1 Claim points** **GIVEN** a typical spot, `run_cap` 1000, `run_claim_sum` 800, **WHEN** the first claim occurs, **THEN** 200 points are awarded. A claim when the cap is full awards 0 and still unlocks the card. The 20 spots sum to 5800. [unit]
- **F-2 Find check** **GIVEN** a building, **WHEN** the skater is 8.0 m from the outline, **THEN** Found; at 8.01 m, not Found; inside the footprint, Found. A bridge at 20 m and an art spot at 14 m use the same inclusive edge. [unit]
- **F-3 Gap** **GIVEN** a typical gap, **WHEN** the skater is in the air 8.0 m from the point and then lands with no bail after the minimum air time, **THEN** Claimed at the landing. On the ground, at 8.01 m, a bail before the landing, or less air time, not Claimed. Easy = 12 m; hard = 5 m plus a landing in a 3 m landing zone. [unit] (P)
- **F-4 Grind** **GIVEN** a typical grind on a 30 m rail, **WHEN** 1 grind reaches 15 m, **THEN** Claimed; 14.9 m is not. A grind that leaves the zone counts its full length. The validator rejects a tier on a rail under its minimum (easy 11.25 m, typical 18.75 m, hard 30 m). [unit] (P)
- **F-5 Line** **GIVEN** a typical line with n = 3, **WHEN** the timer starts at checkpoint 1, **THEN** T = 14 s, and a finish in order within 14 s claims. A bail or a late finish resets the attempt, and the ring stays. [unit] (P)
- **F-6 Combo** **GIVEN** a typical combo spot, **WHEN** a combo of 1200 ends with the last link 10.0 m from the spot, **THEN** Claimed; 999 points or 10.01 m, not Claimed. The bank position is ignored. [unit]
- **F-7 Banner** **GIVEN** q = 0, 1, 2, **WHEN** a Found banner shows, **THEN** it shows for 3.0, 2.1, 1.5 s. Claimed shows before Found. The queue holds 2 Found banners; a third Found has no banner, but its state and icon change. Claimed banners are never dropped. [unit]
- **F-8 Collection** **GIVEN** N = 20, **WHEN** the claims reach 7, 14 and 20, **THEN** an outfit unlocks at each. With N = 19, the unlocks are at 7, 14 and 19. [unit]

### Edge cases

- **E-1** **GIVEN** 2 overlapping find zones, **WHEN** the skater enters both, **THEN** both are Found in 1 step, and the nearer banner shows first. [unit]
- **E-2** **GIVEN** a run that starts inside a zone, **WHEN** the timer starts, **THEN** the spot becomes Found. [unit]
- **E-3** **GIVEN** "Travel here" into a zone, **WHEN** the skater lands, **THEN** the spot is Found, and a gap challenge does not complete. [e2e]
- **E-4** **GIVEN** an Unknown spot, **WHEN** its challenge completes, **THEN** 1 step gives Found and Claimed, and only the "SPOT CLAIMED" banner shows. [unit]
- **E-5** **GIVEN** blocked storage, **WHEN** the player claims a spot, **THEN** it stays Claimed for this run, and the settings menu shows "Progress is not saved in this browser." [e2e]
- **E-6** **GIVEN** a save with an unknown id, **WHEN** the game loads, **THEN** it ignores that id with no error, and new spots are Unknown. [unit]
- **E-7** **GIVEN** photo mode is open, **WHEN** the skater is in a zone, **THEN** no state changes and no chime plays. [e2e]
- **E-8** **GIVEN** progress and unlocked outfits, **WHEN** the player confirms "Reset progress", **THEN** all spots are Unknown and the outfits stay; Cancel changes nothing. [e2e]

### Map icons

- **M-1** **GIVEN** a spot in each state (Unknown, Found, Claimed, edge Found), **WHEN** the minimap renders in the toon look and in `?look=pbr`, **THEN** the icons match the icon table, each 14 px or more. [e2e]
- **M-2** **GIVEN** the same 4 states, **WHEN** the full map renders in both looks, **THEN** the icons are 24 px, the Guide tab shows "n of N claimed" and "m of M found" with N and M from the shipped `landmarks.json`, and a click on a spot opens the panel for its state. [e2e]
- **M-3** **GIVEN** a grayscale screenshot, **WHEN** a reviewer compares the 4 states, **THEN** shape and mark tell them apart. [manual]

### Performance and motion

- **P-1** **GIVEN** the phone tier with 5 Found spots, **WHEN** a frame renders, **THEN** the draw calls are at most the no-ring baseline plus 1; with 0 Found spots, the difference is 0. [e2e]
- **P-2** **GIVEN** a mid-range phone, **WHEN** the player skates 5 minutes with rings visible, **THEN** the mean frame time stays at 16.7 ms or less (the phone target in #191). [manual] (P)
- **R-1** **GIVEN** `prefers-reduced-motion: reduce`, **WHEN** a banner shows and a spot is claimed, **THEN** the banner fades with no slide, and the ring pulse, the burst, the petals, the icon pulse and the foil shimmer are off. [e2e]
- **V-1** **GIVEN** the pbr look in the day, **WHEN** the ring renders, **THEN** its emissive value is 0.8; at night the core is 1.6 and the rest 0.8. [unit]

### Sources and political rules

- **S-1 (rule 8)** **GIVEN** `landmarks.json`, **WHEN** the validator runs, **THEN** every fact has a source name and a URL, and a missing source fails the build. [unit] Link checks: [manual]
- **S-2** **GIVEN** an art spot, **WHEN** the validator runs, **THEN** it ships only with a cleared `credit`; without one it is absent from the file and the map. [unit] The permission itself: [manual]
- **S-3** **GIVEN** the Ford Factory Lofts and Excelsior Mill spots, **WHEN** the validator runs, **THEN** each fact has a primary source, or the spot is absent. [unit]
- **S-4** **GIVEN** all rings, effects and the line UI, **WHEN** the e2e run scans them, **THEN** no red or hazard stripe shows and the word "bail" does not show. [e2e] Real skaters review the challenges before release. [manual]

## Open Questions

| # | Question | Owner | Target |
|---|---|---|---|
| 1 | Confirm the typical speed (8 m/s), the street width (14 m) and the rail lengths with a playtest log. F-3, F-4 and F-5 depend on them. | gameplay programmer | Before the challenge tuning |
| 2 | Define a test hook for e2e (spot states, banner time, draw calls), for example `window.__atl.landmarks` in dev builds only. | lead programmer (ADR) | Before the first story |
| 3 | Define the frame budget of the low tier for P-2. | performance analyst | With #191 |
| 4 | Find primary sources for Ford Factory Lofts, the Excelsior Mill, Telephone Factory Lofts, Studioplex and Krog Street Market. | writer / researcher | Before the fact cards ship |
| 5 | Get written permission from the artists of the 4 trail art pieces, or drop them. | producer | Before the art spots ship |
| 6 | Pick a skatepark model or kit for the Historic Fourth Ward Skatepark. Polyfork's Skatepark kit is a candidate for the toon look (CC BY 4.0). | art director | Before that spot ships |
| 7 | Define the outfits that unlock at 7, 14 and 20 claims. | game designer | Before the unlocks ship |
| 8 | Confirm that the fact pop-up height leaves room for the banner at 30 vh on a phone in landscape. | UX designer | With `/ux-design` |
