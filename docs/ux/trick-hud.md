# UX spec: trick HUD, manual balance bar, flick ring, trick list

> **Status**: Draft for wave 2. Written 2026-11-26.
> **Issue**: #330 (this spec only; the code comes in wave 2: #335, #336, #337, #338, #342, then #331).
> **Design source**: `docs/gdd/trick-input.md`, sections "UI Requirements", "Visual/Audio Requirements" (Feedback), R6, R7, R10, R11, R12, R13.
> **Reference build**: the prototype `prototypes/trick-input/` (`hud()` and `ringHud()` in `src/main.js`, the CSS in `index.html`) and its screenshots `prototypes/trick-input/playtest/screenshots/01` to `10`.
> **Production HUD now**: `src/ui/hud.js`, `src/shell.css` (`#hud`, `.hud-*`, `.touch-*`), `src/sim/skate/combo.js` (`comboLine`, `COMBO_LINE`), `src/ui/callouts.css` (#305).
> **Method**: the `/ux-design` skill is not installed in this cloud session. This spec uses the sections of that skill (purpose, player context, layout, states, interaction per device, data, timing, accessibility, acceptance criteria, open questions). An earlier session did the same for #220 (`docs/decisions.md`, 2026-11-24).

## 1. Purpose

The trick input system (GDD) lets the player choose each trick with a direction and a button. The player must see 4 things:

1. **Which trick came out.** The player must know that the direction worked. This is the main feedback of the system ("I called that trick").
2. **The combo so far.** The names of the links, the beat tags, and the multiplier.
3. **The manual balance.** The manual is the only new state with a fail limit, so it needs a meter.
4. **The map.** On a phone, the flick ring shows the 4 directions of a button. On all devices, the trick list screen shows every slot, per skater and per context.

The HUD must not hide the skater, the rails, or the touch controls. It must read in grayscale (R12.4).

## 2. Player context

- The player looks at the skater and the next rail, not at the HUD corner. A trick name must read in one look of 200 ms or less. Use short names, a big font, and a fixed place.
- The player uses the left hand for steer and direction (keyboard, gamepad) or the left thumb on the stick (phone). The right hand or thumb presses the trick buttons.
- On a phone, the right thumb covers the button that it presses, and an area of about 40 px around it.
- Many players are new to skate games. The trick list must teach the map without a manual.

## 3. Elements and owners

| ID | Element | Where in the code (wave 2) | Replaces or extends |
|---|---|---|---|
| E1 | Trick line | `src/ui/hud.js` `#hud-combo`; the pure text in a new `trickLine()` | `comboLine()` and the "+N" bank line of #269 |
| E2 | Live trick chip (with the landing tag and the refusal cue) | `src/ui/hud.js` `#hud-tag` | The move flash, the beat tag, and `REFUSED_TEXT` of #264 |
| E3 | Hold bar and beat pips (under E2) | `src/ui/hud.js`, new child of `#hud-tag` | New |
| E4 | Manual balance bar | New `src/ui/manual-bar.js` (DOM) and `src/ui/manual-bar-math.js` (pure) | New. The grind balance meter (`#hud-balance`) stays. |
| E5 | Touch flick ring, tick marks, and flick card | `src/input/touch.js` (labels, ticks), new `src/ui/flick-ring.js` | The label GROOVE becomes TRICK (R1, Q4) |
| E6 | Trick list screen | New `src/ui/trick-list.js`, new `src/content/dance-origins.js` | New |

Settings rows ("One-button tricks", "Relaxed timing", remap) belong to #328. This spec gives only their effect on E1 to E6.

## 4. Layout

### 4.1 Desktop, 1280 x 720 (keyboard or gamepad)

```
+------------------------------------------------------------------------------+
| 12,450                                                      [buttons] (beat) |
| +2 ↓ Long Ledge Makio ★ + • Manual + ← Japan Grab ✓  x5          <- E1        |
| 1,298                                                 <- pending points       |
| ★ PERFECT  ← Japan Grab                               <- E2                   |
| ▓▓▓▓▓▓▓▓░░░░                                          <- E3 (hold bar)        |
| STYLE ▓▓▓▓▓░░░                                                               |
|                                                                              |
|                                        W                                     |
|                         (skater)    ▶ [▒]   <- E4, 56 px right of the skater  |
|                                       [█]                                    |
|                                       [▒]                                    |
|                                        S                                     |
|                                                                  (minimap)   |
+------------------------------------------------------------------------------+
```

- E1, the pending line, E2, and E3 stay in the `#hud` column at the top left, in this order. This is the place of the present combo line and move flash, so a player of version 0.9 finds them in the same place.
- E1 is at most `min(640px, 50vw)` wide. E2 is at most `min(480px, 40vw)` wide.
- E4 follows the skater (section 7).
- The callout (#305) stays at 58 vh in the middle. E1 to E3 do not move into the middle of the screen.

### 4.2 Phone portrait, Pixel 7 (412 x 839 CSS px)

```
+--------------------------------------+
| 12,450              [SET][TRK](beat) |
| +2 → Side Grab ✓ x3     <- E1         |
| 1,298                                 |
| ✓ GOOD → Side Grab      <- E2         |
| ▓▓▓▓░░░░                <- E3         |
|                          (minimap)    |
|                                       |
|           (skater)  ▶[▒]  <- E4       |
|                        [█]            |
|                        [▒]            |
|          +---------------------+      |
|          |      ↑ Rocket       |      |
|          | ← Japan  • Mute  → Side |  <- E5 flick card (above the buttons)
|          |      ↓ Tuck Knee    |      |
|          +---------------------+      |
|  ( stick )         (SPIN) (TRICK)    |
|                 (SWITCH)  ↑          |
|                  (GRIND) ←●→ (JUMP)  |  <- E5 ring on TRICK
|                           ↓          |
+--------------------------------------+
```

- E1 and E2 stay in the `#hud` column. On a compact screen (`isCompact()`), `#hud` is at most `100vw - 200px` wide (present rule), so E1 shows fewer links (section 5.3).
- The flick card shows above the button area when the viewport is taller than wide.

### 4.3 Phone landscape, Pixel 7 (839 x 412 CSS px)

```
+-----------------------------------------------------------------------+
| 12,450  +2 → Side Grab ✓ x3                 [SET][TRK]      (minimap) |
| ✓ GOOD → Side Grab                                                     |
|                           (skater)  ▶[▒]                               |
|                                       [█]                              |
|                                       [▒]     +-----------------+      |
| ( stick )                                     |    ↑ Rocket     |      |
|                                               | ← Japan  → Side |      |
|                                               |  • Mute (tap)   |      |
|                                               |  ↓ Tuck Knee    |      |
|                                               +-----------------+ (buttons) |
+-----------------------------------------------------------------------+
```

- The flick card shows to the left of the button area when the viewport is wider than tall. Above the buttons, the card would cover the landscape minimap (top right, 184 px).
- E4 is 160 px high, plus 2 labels of 16 px: 192 px. It fits in 412 px.

## 5. E1: Trick line

### 5.1 Content

One line: `[+N ]link + link + link  xM`.

Each link is: `[arrow][space][short name][space][tag glyph]`.

| Part | Rule | Examples |
|---|---|---|
| Arrow | The direction that chose the trick: `←` `→` `↑` `↓`. The neutral slot shows `•`. A link with no trick input shows no arrow (an air with no grab: "Ramp Air", "Vert Air", "Hop"). In one-button mode, no link shows an arrow, because the direction did not choose it. | `← Japan Grab`, `• Mute Grab`, `Ramp Air` |
| Short name | The HUD short form, 18 characters or fewer (GDD R6, #335). A direction stance drops the final word "Grind". The neutral stance keeps "(edge) Grind" (#342). No name shows "Frontside". | `Long Ledge Makio`, `Ledge Soul`, `Long Rail Grind` |
| Manual | The arrow `↑` and "Toe Roll" for the front-wheel manual. The arrow `•` and "Manual" for the other manual. | `↑ Toe Roll`, `• Manual` |
| Tag glyph | `★` for PERFECT, `✓` for GOOD, `~` for a stumble (WOBBLE). No glyph for a clean link off the beat. | `← Japan Grab ★` |
| Fold | When older links do not show, the line starts with `+N`, where N is the count of hidden links. | `+2 ↓ Tuck Knee + • Manual` |
| Multiplier | ` x` and the multiplier, at the end, in bold. Always shown while the combo is active. | `x5` |

The pending points stay on their own line under E1 (`#hud-pending`). That line shows the points only ("1,298"), because the multiplier is now on E1.

### 5.2 States

| State | What shows | Color (text on the dark pill) |
|---|---|---|
| No combo, no bank | Nothing (no pill) | — |
| Combo active | The line of 5.1 | Pink `#ff80c4` (present) |
| Banked | `+N` with the banked points, for `BANKED_SHOW_MS` (2.5 s), then a 0.4 s fade (present #269) | Yellow `#ffd166` (present) |
| Bail | `+N` with the 25% bail bank, with the same times. The pill has a dashed border (2 px). No word. | Paper `#f3f3f7` at 80% opacity |
| Combo lost (teleport) | Nothing. The line clears at once. | — |

### 5.3 Fit rule

Wave 2 writes `trickLine(links, { maxLinks, maxChars, oneButton })` as a pure function with Vitest tests. It replaces `comboLine()`.

1. Make the text of each link (5.1).
2. Try the 3 newest links (`maxLinks` 3). If the full text, with the fold and the multiplier, is `maxChars` or less, use it.
3. Else try 2 links, then 1 link.
4. One link always shows in full. A link is never cut.
5. Budgets: desktop `maxChars` 64; compact `maxChars` 30 (the present `COMBO_LINE.phone`).

Decision: the fold uses the GDD form "+2" at the start. It replaces the "… a + b (4)" form of #269. Reason: the GDD names "+2", and the number at the start reads first.

### 5.4 Timing

- A link shows on E1 at the frame that the combo adds it (the touchdown, the snap, the manual end, the dance end).
- The text changes at once. No slide, no fade, no scale on E1 (GDD: "No motion when reduced motion is on"; E1 has no motion at all, so the two modes agree).
- The bank fade (0.4 s) has no transition when reduced motion is on (present rule).

## 6. E2: Live trick chip and E3

E2 shows the trick in progress, then the result of the link, then the reason for a press that did not work. It uses the place of the present move flash (`#hud-tag`).

### 6.1 Content and states

| State | Trigger | Text | Shape and color cue | Time |
|---|---|---|---|---|
| Hidden | No event in the last show time | Nothing | — | — |
| Trick in progress | `state.trick` starts (grab, stance, manual, dance) | Arrow + full name. Compact screens use the short name. | Paper text, 2 px solid border | While `state.trick` exists |
| Manual in progress | `state.manual` exists | `• Manual 12 m` or `↑ Toe Roll 12 m`. The meters change once per whole meter. At `manualCapMeters` the text is `• Manual MAX`. | As above | While the manual lasts |
| Clean link | Link added, no beat tag | Arrow + name | Paper text, no border | 900 ms (present) |
| GOOD | Link added with GOOD | `✓ GOOD` + arrow + name | Yellow `#ffd166`, 2 px border | 900 ms |
| PERFECT | Link added with PERFECT | `★ PERFECT` + arrow + name | Mint `#7ef0c2`, 3 px border, bold | 900 ms |
| WOBBLE | Stumble (R10) | `~ WOBBLE` + arrow + name | Paper `#f3f3f7`, dotted 2 px border. No red. | 900 ms |
| Busy | `press-ignored` event: TRICK or SPIN during a dance (prototype finding 5, owner choice 2026-11-26) | `… BUSY: Cross Step` (the name of the dance that runs) | Paper text, 16 px, no border (the present refusal style) | 600 ms from the last ignored press |
| Refused | Present `refused` reasons of #264 ("Roll faster to dance", "Dance after the grind") and SPIN in the air ("Dance on the ground, not in the air") | The present text | As above | 1400 ms (present) |

Rules:

- A link result takes the place of a trick in progress at once.
- A new trick start takes the place of a link result at once. The player needs the newest input first.
- Refused never takes the place of a trick in progress or a link result that shows. It shows only when E2 is hidden or shows another refusal.
- Busy is different: the ignored press always comes while a dance is in progress, so Busy replaces the text of the dance chip for 600 ms. The beat pips (E3) stay, so the player sees how long the dance has left. After 600 ms with no new ignored press, the chip shows the dance again. A link result that comes in the 600 ms takes the place of Busy at once.
- The Busy cue does not show in one-button mode. In that mode a TRICK press during a dance has another job (R12.1).
- No text uses the words "FAIL", "CRASH", "MISS", or "BAD". `src/content/banned-words.js` (#342) must contain them, and a Vitest test checks every E2 string against the list.

### 6.2 E3: Hold bar (grabs)

- A bar 4 px high under the E2 text, as wide as the text.
- It shows while a grab is held. It fills from 0 to `holdCap` (1.5 s) of hold time.
- At `holdCap` the fill gets diagonal stripes (the same stripes as the style meter at READY). The stripes tell the player that more hold pays no more.
- It hides at the release or at the touchdown.
- It does not tell the player to let go. The teach prompt (#331) does that.

### 6.3 E3: Beat pips (dances)

- A row of squares under the E2 text, one per beat of the dance (2 for Cross Step, 8 for ATL Rydin).
- Each square is 6 x 6 px, 3 px apart. An empty square has a 1 px border; a past beat is a filled square.
- It shows while the dance runs. With the Busy cue, the pips show how long the dance has left.

### 6.4 PERFECT hit stop (#338)

- `perfectHitStopMs` (typical 60 ms, 0 turns it off) stops the sim for a short time at a PERFECT link.
- E2 shows the PERFECT state at the first frame of the hit stop.
- The HUD times (900 ms, 600 ms, 1400 ms, 2.5 s) use the wall clock, so the hit stop does not make a tag longer or shorter.
- The HUD keeps its frame rate during the hit stop. Only the sim and the skater stop.
- The wheel spark ring (Visual/Audio, Feedback) is render work, not HUD work.

## 7. E4: Manual balance bar

### 7.1 Shape

| Part | Desktop | Compact (phone) |
|---|---|---|
| Track | 16 x 180 px, 2 px paper border, radius 4 px | 16 x 160 px (GDD: 160 px or more) |
| Marker | A triangle, 20 px high, 14 px deep, paper fill, 2 px ink outline. It points at the track from the skater side. | Same |
| End labels | 16 px high, above and below the track: the input that moves the marker to that end | Same |

The marker position: `top = (m + 1) / 2` of the track height, where `m` is the lean of F1 (`state.manual.balance`, -1 to 1). The input `s` = +1 (W, stick up) makes `m` smaller, so it moves the marker up, to the top label. The player moves the marker toward a label with the key of that label. This is the mapping of the prototype.

### 7.2 Zones (pattern first, color second)

| Zone | Range of \|m\| | Fill | Pattern |
|---|---|---|---|
| Safe | 0 to 0.5 | Green `#2f9e6e` | Solid |
| Warning | 0.5 to 0.8 | Amber `#d98c1f` | Horizontal lines: 2 px dark, 2 px clear |
| Limit | 0.8 to 1 | Dark red-brown `#9a2d2d` | Diagonal hatching at 45 degrees: 3 px dark, 4 px clear |

A 1 px ink tick crosses the track at each zone edge (|m| = 0.5 and 0.8).

The prototype grayscale screenshot (`07-grayscale-manual-bar.png`) shows that the green and the amber have almost the same gray. The prototype has a pattern on the limit zone only. This spec adds the line pattern to the warning zone, so the 3 zones differ in grayscale.

### 7.3 End labels by device

The labels use the bindings of the device in use (`input.source`), so a remap (R12.2) changes them.

| Device | Top label | Bottom label |
|---|---|---|
| Keyboard | The first key bound to `dirUp` (default `W`) | The first key bound to `dirDown` (default `S`) |
| Gamepad | `↑` and a small stick ring | `↓` and a small stick ring |
| Touch | `↑` | `↓` (the touch stick y) |

### 7.4 Position

- The anchor is the skater hip (world position + 1.0 m up), projected to the screen.
- The bar center is 56 px to the right of the anchor, at the anchor height.
- The bar follows the anchor with smoothing: each axis moves `1 - exp(-dt / 0.12 s)` of the distance per frame. The bar does not shake with the camera.
- The bar stays inside a safe rectangle: 16 px from each viewport edge plus the safe-area inset. It does not cover the `#hud` column, the touch buttons, the touch stick base, or the minimap. Wave 2 reads their bounding boxes once per layout change, not each frame.
- If the right side has no room at the manual start, the bar goes 56 px to the left of the anchor, and the marker points from the right. The side does not change during one manual.
- **Reduced motion**: the bar does not follow the skater. It stays at a fixed place: 120 px right of the screen center, at the screen center height, inside the same safe rectangle.

### 7.5 States and timing

| State | Trigger | What shows | Time |
|---|---|---|---|
| Hidden | Not in a manual | Nothing | — |
| Show | Manual start frame | The bar fades in. With reduced motion, it shows at once. | 100 ms |
| Normal | \|m\| < 0.7 | Marker at `m` | — |
| Pulse | \|m\| >= 0.7 | The marker opacity goes 1 → 0.55 → 1, 2 times per second | While \|m\| >= 0.7 |
| Pulse, reduced motion | \|m\| >= 0.7 | No pulse. The marker gets a 3 px ink outline and a `!` beside it. | While \|m\| >= 0.7 |
| Clean end | GRIND let go, JUMP, slow, rail snap | The bar fades out | 150 ms |
| Balance out | \|m\| = 1 (stumble) | The marker stays at the end for 300 ms; E2 shows WOBBLE. Then the bar hides. | 300 ms |

- The drift side shows only by the motion of the marker in the first 0.3 s (GDD). The bar has no arrow for the drift.
- The pulse rate is 2 Hz. It must stay at 3 Hz or less (no flashes over 3 per second, WCAG 2.3.1). The prototype blinks at 4 Hz; do not copy that rate.
- One-button mode: the manual starts with a TRICK hold (R12.1). The bar is the same.

The grind balance meter (`#hud-balance`, horizontal, in the HUD column) does not change in this issue. See Q4 in section 12.

## 8. E5: Touch flick ring and flick card

### 8.1 Buttons at rest

- The 5 buttons keep their size and place (#245): JUMP 88 px, GRIND 76 px, TRICK 64 px, SPIN 62 px, SWITCH 56 px. Each stays 44 px or larger.
- The `style1` label changes from GROOVE to TRICK (R1, GDD Q4 default). The e2e specs that use `.touch-style1` keep the class name; only the label changes.
- TRICK, SPIN, and GRIND show 4 tick marks: white lines of 2 x 6 px at 70% opacity, 4 px inside the circle edge, at the top, bottom, left, and right. JUMP and SWITCH have none. The ticks tell the player that a flick is possible before the first touch.
- In one-button mode, no button shows ticks (section 8.5).

### 8.2 The ring (at the button)

- At the touch-down on TRICK, SPIN, or GRIND, a ring of 4 arrow chips shows. Only the ring of the button under the finger shows.
- The chip centers are 40 px from the button center (GDD: 40 px or less). Each chip is 22 x 22 px with a 16 px arrow glyph, ink fill at 75% opacity, and a 1 px paper border.
- The ring does not take touches (`pointer-events: none`). The arrow chips are not targets.
- When the drag crosses `flickMin` (24 px), the chip of that direction lights: paper fill, ink glyph, 2 px ink border, and 1.25 times the size. The other 3 chips hide. With reduced motion, the lit chip does not grow; it gets a 3 px border.
- A tap (lift before `flickMin`) or the `flickMaxMs` timeout gives the neutral trick. Then the 4 chips hide, and a dot chip `•` lights at the button center.
- The ring hides 150 ms after the finger lifts.

### 8.3 The flick card (away from the thumb)

The thumb covers most of the ring. The GDD asks that the lit arrow "shows the short trick name". The name goes in a card away from the thumb, so the player can read it (owner choice 2026-11-26).

- The card shows at the touch-down, with the ring.
- Content: a 3 x 3 grid with the 4 directions and the neutral slot of that button in the present context.
  - Top cell: `↑` + short name. Left: `←` + short name. Right: `→` + short name. Bottom: `↓` + short name. Center: `•` + short name + `tap`.
- Place: above the button area (`.touch-buttons`) when the viewport is taller than wide; to its left when it is wider than tall (sections 4.2, 4.3). 8 px gap. It stays inside the safe rectangle of section 7.4.
- Size: at most 220 x 100 px. Text 13 px, weight 700, on the HUD pill color.
- The lit cell gets the paper fill, the ink text, and a `▶` before the arrow. The other cells stay.
- The card hides 150 ms after the finger lifts.

Card content per button and context:

| Button | Context at the touch-down | Cells |
|---|---|---|
| TRICK | Air | The 5 grabs: • Mute Grab, ← Japan Grab, → Side Grab, ↑ Rocket Grab, ↓ Tuck Knee |
| TRICK | Ground | The 5 TRICK dances of the skater (R7) |
| TRICK | Grind or manual | One line: `Off on a rail` or `Off in a manual`. No ring. |
| SPIN | Ground | The 5 SPIN dances (R7) |
| SPIN | Air, grind, or manual | One line: `SPIN: on the ground`. No ring. |
| GRIND | Any | The 5 stances: • (edge) Grind as `• Grind`, ← Soul, → Unity, ↑ Makio, ↓ Royale. A GRIND hold with no rail starts a manual; the card does not show the manual. |

- The context is the state at the touch-down. If the state changes before the resolve (for example, the skater lands), the card changes to the new context at that frame. The sim uses the state at the resolve frame.
- For GRIND, R6 permits one stance change at the resolve. The lit cell shows the final stance.

### 8.4 Timing summary

| Time | Ring | Card | Button |
|---|---|---|---|
| Touch-down | 4 chips show | Shows | Down state (present pink and 0.92 scale) |
| Drag crosses 24 px | 1 chip lit, 3 hide | Cell lit | Down |
| Lift before 24 px, or 120 ms with no drag | Center dot lit | Center cell lit | Down until the lift |
| Lift | Hides after 150 ms | Hides after 150 ms | Up |

With "Relaxed timing" (R12.3), `flickMaxMs` is 250 ms. The ring and the card do not change.

### 8.5 One-button mode

- The direction is not read (GDD R12.1, Edge Cases, and acceptance criteria; owner choice 2026-11-26). So no button shows ticks or a ring.
- A touch-down on TRICK shows the card with one line: `Next: Japan Grab` (the next item of the one-button set for the present context).

## 9. E6: Trick list screen

### 9.1 Entry and exit

There is no pause menu in the game now. The settings dialog (key O) pauses the game (`main.js`: `paused` includes `settingsMenu.isOpen`). The trick list is its own dialog of the same kind, not a page of the settings dialog (owner choice 2026-11-26).

| Device | Open | Close |
|---|---|---|
| Keyboard | Key `T` (free in play; the full map uses T only while the map is open), or the `TRICKS T` button beside `SETTINGS O`, or the "Trick list" button in the settings dialog | `Escape`, `T`, or the close button |
| Gamepad | The View/Back button (standard button 8). Start (button 9) stays free for a later pause menu. Owner choice 2026-11-26. | B, or the View/Back button |
| Touch | The `TRICKS` button beside `SETTINGS` (44 px or larger, the same row or column as `SETTINGS` in each #245 layout) | The close button (44 px) or a tap outside the dialog |

- The game pauses while the dialog is open, as with the settings dialog. The dialog cannot open on the front screen, in photo mode, or on the results screen.
- When it closes, the focus goes back to the element that opened it.

### 9.2 Content

Header: `TRICKS`, then 2 tabs: `Nia` and `Marcus`. The tab of the skater in play is selected at the open.

Below the header, a line names the input for the device in use (the bound keys, after a remap):

- Keyboard: `Direction (W A S D or the arrows) + button`.
- Gamepad: `Left stick or d-pad + button`.
- Touch: `Flick the button. A tap gives the • trick.`

5 sections, in this order. Each section has a title, the button for the device, and a compass of 5 cells.

| Section | Button (keyboard / gamepad / touch) | Cells |
|---|---|---|
| Air: grabs | Q / Y / TRICK | • Mute Grab, ← Japan Grab, → Side Grab, ↑ Rocket Grab, ↓ Tuck Knee |
| Rail: grind stances | F / RT / GRIND, at the snap | • Rail Grind or Ledge Grind, ← Soul Grind, → Unity Grind, ↑ Makio Grind, ↓ Royale Grind |
| Ground: TRICK dances | Q / Y / TRICK | Per skater (R7) |
| Ground: SPIN dances | E / B / SPIN | • Cross Step, ← Toe Spin, → Smooth Quad, ↑ ATL Rydin, ↓ Sit Spin |
| Manual | Hold F / RT / GRIND, no rail near | • Manual, ↑ Toe Roll. Then: `Balance with W and S` (the bound keys) |

TRICK dances per skater (R7):

| Direction | Nia | Marcus |
|---|---|---|
| • | Bankhead Bounce | Swag Surf |
| ← | Walk It Out | Walk It Out |
| → | The Prep | The Prep |
| ↑ | Swag Surf | Drumline Count |
| ↓ | Snap Lean | Jam Step |

The air, rail, SPIN, and manual sections are the same for both skaters. Only the TRICK dances change with the tab.

### 9.3 Dance origins (R13)

Each dance cell has a second line: the origin, or the no-source note. A select (click, tap, Enter, gamepad A) on a dance cell opens a detail panel with the full origin text and the source names.

Wave 2 puts the text in `src/content/dance-origins.js`, from `docs/characters/atl-dance-references.md`. Draft text (short line / detail):

| Dance | Short line | Detail (place, year, creators, source) |
|---|---|---|
| Bankhead Bounce | Bankhead, west Atlanta, 1995 | From Bankhead, a neighborhood on the west side of Atlanta. Popular from 1995, with the A-Town Players and D-Roc. Sources: Wikipedia; The Atlanta Journal-Constitution. |
| Walk It Out | Atlanta snap era, 2006 | Made famous by DJ Unk of Atlanta in 2006. Sources: KAXE; The Atlanta Journal-Constitution. |
| The Prep | ATL rink move | A stutter step forward, with a clap to keep the move going. Source: USA Roller Sports, "Culture Roll". |
| Swag Surf | South side of Atlanta, 2009 | The dance came from the south side of Atlanta. Fast Life Yungstaz of Stone Mountain made it famous in 2009. Now an anthem at HBCU homecomings. Sources: Wikipedia; uDiscover Music. |
| Snap Lean | Bankhead snap music, 2005 | Snap music started in Bankhead in the early 2000s. Dem Franchize Boyz of Atlanta made the snap lean famous in 2005. Sources: Wikipedia. |
| Cross Step | Key move of ATL style | The key move of ATL style rink skating. Source: USA Roller Sports, "Culture Roll". |
| ATL Rydin | Signature move of ATL style | The signature move of ATL style rink skating. Source: USA Roller Sports, "Culture Roll". |
| Toe Spin, Smooth Quad, Sit Spin | rink move (no source yet) | — |
| Drumline Count, Jam Step | no source yet | — |

Rules (R13):

- The screen shows the origin of the dance only: the place, the year, the creators, and the public source.
- A song title shows only after the lyric check of that song passes. Each entry has a field `lyricCheck: "passed" | "open"`. While it is `"open"`, the text names no song. The draft text above names no song. (The dance names "Walk It Out" and "Swag Surf" are also song titles. They show as the names of the dances, as in R7.)
- Nae Nae is not in the game and not on the screen.
- The source names are links that open in a new tab (`rel="noopener"`), as the landmark story cards do. The detail panel shows the source name as text, not the URL.
- The text is in plain words, positive or neutral. A Vitest test checks every string against `src/content/banned-words.js` (#342).
- Real skaters review the text before release (AGENTS.md).

### 9.4 One-button mode

When "One-button tricks" is on, a 6th section shows first: `One-button set`. It lists the order of each set (R12.1): air, grind, and the ground set of the selected skater. The compass sections stay, with the note `Directions are off in one-button mode`.

### 9.5 Layout per screen

| Screen | Layout |
|---|---|
| Desktop 1280 x 720 | Dialog at most 960 x 600 px, in the middle. 2 columns of sections (3 and 2). The detail panel opens in the place of the column it belongs to, with a back button. |
| Phone landscape | Dialog at full height minus 16 px, 2 columns, the content scrolls. The tabs and the close button stay at the top. |
| Phone portrait | 1 column, the content scrolls. The tabs and the close button stay at the top. |

Each compass is a 3 x 3 grid: the neutral cell in the middle, the arrows around it. In the DOM, the cells are a list in the order •, ↑, ←, →, ↓, each with its text label ("Up: Rocket Grab"). A screen reader reads the list; the grid is CSS only.

### 9.6 Navigation

- Keyboard: Tab and Shift+Tab move the focus. Left and Right on a tab change the skater. Enter opens a dance detail. Escape closes the detail, then the dialog. The focus stays inside the dialog.
- Gamepad: the d-pad and the left stick move the focus. A selects. B goes back. LB and RB change the skater tab.
- Touch: tap a tab, tap a dance cell, tap the back button or the close button. Each target is 44 px or larger.
- The dialog has `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` on the `TRICKS` title.

## 10. Accessibility (GDD R12)

### 10.1 No color-only signal (R12.4): the grayscale rule

Every state must read from shape and text alone.

| Element | State | Cue that is not color |
|---|---|---|
| E1 | PERFECT link | `★` glyph |
| E1 | GOOD link | `✓` glyph |
| E1 | Stumble link | `~` glyph |
| E1 | Direction | Arrow glyph (`← → ↑ ↓ •`) |
| E1 | Bail bank | Dashed border |
| E2 | PERFECT | Word `PERFECT`, `★`, 3 px border, bold |
| E2 | GOOD | Word `GOOD`, `✓`, 2 px border |
| E2 | WOBBLE | Word `WOBBLE`, `~`, dotted border |
| E2 | Busy | `…` and the word `BUSY` |
| E3 | Hold at max | Stripes |
| E3 | Beat past | Filled square, against an outlined square |
| E4 | Safe / warning / limit | Solid / horizontal lines / diagonal hatching, and the ticks at 0.5 and 0.8 |
| E4 | Near the limit | Pulse (motion), or the `!` and the thick outline with reduced motion |
| E5 | Flick possible | 4 tick marks |
| E5 | Lit direction | Filled chip, larger size or thicker border, `▶` in the card |
| E5 | Button down | Smaller size (present 0.92 scale) |
| E6 | Selected tab | Underline 3 px and `aria-selected` |
| E6 | No source | The words "no source yet" |

Evidence: Playwright screenshots with `filter: grayscale(1)` on the page, at 1280 x 720 and on the Pixel 7 viewport, of every row above. A person reviews them (GDD acceptance criterion, R12.4). The files go in `e2e/__screenshots__/trick-hud-grayscale-*.png`.

### 10.2 Contrast

- All HUD text sits on the dark pill (`--hud-pill`, present rule of #73). Every text color must give 4.5:1 or more on the pill over a white background. Wave 2 tests each new color with `contrast()` and `over()` of `src/ui/layout.js`.
- The new colors in this spec: the E4 zone fills are not text, so they need 3:1 against the track border (WCAG 1.4.11). The ink outline of the marker gives the marker 3:1 or more on every zone.
- The ring chips and the card use the pill color and paper text.

### 10.3 Size

- E1: 18 px desktop, 15 px compact (present). E2: 22 px desktop, 16 px compact (present). Refusal and Busy: 16 px.
- E5 card text: 13 px or larger. Ring glyphs: 16 px.
- E6 text: 15 px or larger; titles 18 px.
- Touch targets: 44 px or larger (buttons, tabs, close, TRICKS).

### 10.4 Motion

- With reduced motion (the settings switch, else the media query; present `reducedMotion()`):
  - E1, E2: no motion in either mode.
  - E4: fixed place, no fade, no pulse (section 7).
  - E5: the lit chip does not grow.
  - E6: no transition between pages.
- No element flashes more than 3 times per second.

### 10.5 One-button mode, remap, relaxed timing

- One-button mode: E1 shows no arrows; E5 shows no ticks and no ring; E6 shows the one-button set first.
- Remap: every key name in the HUD (E4 labels, E6 input line and section buttons) comes from the present bindings, not from fixed text.
- Relaxed timing: no visual change.

### 10.6 Screen readers

- The HUD in play is not a live region. A real-time trick line would read too fast to be useful.
- E6 is fully readable (section 9.5).

## 11. Data the HUD needs (contract for #327 and #328)

| Field | From | Used by |
|---|---|---|
| `state.trick` `{ kind, id, name, short, clip, dir, held, heldFor }` | Sim (#327). `short` is the HUD short form (#335). `heldFor` is the hold time in s. | E2, E3 |
| `state.manual` `{ balance, meters, toe, capped }` | Sim (#327) | E2, E4 |
| Each combo link `{ name, short, dir, tag, landing }`: `dir` is `"n" | "l" | "r" | "u" | "d" | null` (null for no trick input and in one-button mode); `tag` is `"PERFECT" | "GOOD" | null`; `landing` is `"clean" | "stumble"` | Combo (#327) | E1, E2 |
| `combo.lastBail` (points of the 25% bank) | Combo (#327) | E1 bail state |
| `press-ignored` `{ button, name, left }` (or `refused` with the reason `"busy"`) | Sim (#327, from the prototype) | E2 Busy |
| The dance beat count and the beat now | `STYLE.moves` per dance (#337), beat clock | E3 pips |
| `perfectHitStopMs` | `constants.js` (#338) | E2 timing |
| Active flicks `{ button, x0, y0, resolved: { dir } }` | Touch input (#328, #340) | E5 |
| `input.source`, the bindings | Input (#328, #341) | E4 labels, E6 |
| One-button mode, the next item of the set | Settings and sim (#336) | E1, E5, E6 |

## 12. Open questions

The owner answered Q1, Q2, Q3, and Q5 on 2026-11-26 (all the recommended option). The other questions do not block wave 2: each has a default that wave 2 can build, and a later answer changes only a detail.

| # | Question | Default in this spec | Owner | By |
|---|---|---|---|---|
| Q1 | The gamepad has no menu button now. Which button opens the trick list? | **Decided 2026-11-26**: View/Back (standard button 8). Start (button 9) stays free. | Owner | Done |
| Q2 | Does the trick list live in its own dialog (this spec), or as a page of the settings dialog? | **Decided 2026-11-26**: own dialog, with a "Trick list" button in the settings dialog | Owner | Done |
| Q3 | GDD R12.1 said that in one-button mode "the directions still work". The Edge Cases and the acceptance criteria say that the direction is not read. Which is correct? | **Decided 2026-11-26**: the direction is not read: no ring, no arrows. GDD R12.1 is fixed in this PR. | Owner | Done |
| Q4 | The manual bar is vertical and beside the skater. The grind balance is horizontal in the HUD column. Does the grind balance move beside the skater too? | No change in #330 | Owner | After the human playtest |
| Q5 | The flick card puts the trick names away from the thumb. The GDD says that the lit arrow "shows the short trick name". Is the card a good reading of that rule? | **Decided 2026-11-26**: yes. The ring keeps the arrows; the card shows the names. | Owner | Done |
| Q6 | What is the link name of an air with a spin (F3, #339, #344)? For example, "180 Japan Grab". | No spin word until #344 decides the turn rate | Owner | #344 |
| Q7 | Does the trick list show the points of each trick? | No | Owner | After playtest data |
| Q8 | The arrow and tag glyphs (`← → ↑ ↓ • ★ ✓ ~ … ▶`) need a font with these glyphs on every phone. Does wave 2 ship a small icon font or SVG glyphs? | System fonts, with a Playwright check that each glyph has a width over 0 | Wave 2 | Wave 2 |
| Q9 | Real skaters must review the dance origin text and the names on the trick list (AGENTS.md). When? | Before release, with the move set review | Owner | Before release |

## 13. Acceptance criteria for wave 2

These criteria add to the criteria of #330. Each one names its evidence.

**E1 trick line**
- `trickLine()` is a pure function with Vitest tests: the 3 newest links fit; a 4th link folds into `+1`; 2 hidden links show `+2`; a long link shows in full; the desktop budget is 64 characters and the compact budget is 30.
- The line for the GDD anchor shows `• Ledge Grind + • Manual + ← Japan Grab ★ x3` (with a PERFECT landing).
- A direction stance shows its short form: `↓ Long Ledge Makio` (16 characters, #335). No name shows "Frontside" (#342).
- In one-button mode, no link has an arrow.

**E2 and E3**
- Each state of section 6.1 shows its text, glyph, and border (Vitest on the pure text function; Playwright screenshot of PERFECT, GOOD, WOBBLE, and Busy).
- A TRICK press during a dance replaces the dance chip with `… BUSY:` and the dance name for 600 ms, with the beat pips still shown; then the dance chip shows again. Not in one-button mode.
- With `perfectHitStopMs` 60, the PERFECT tag shows for 900 ms of wall time.
- No E2 string contains a word of `src/content/banned-words.js`.

**E4 manual bar**
- `manual-bar-math.js` is pure, with Vitest tests: the marker place for m = -1, 0, 0.5, 1; the zone of each m; the side flip when the right side has no room; the smoothing step; the fixed place with reduced motion.
- Playwright at 1280 x 720 and on Pixel 7 (portrait and landscape): the bar is 180 px and 160 px high, does not overlap the `#hud` column, the touch buttons, the stick base, or the minimap.
- The pulse is 2 Hz; with reduced motion, there is no pulse and the `!` shows.

**E5 flick ring**
- The style1 button reads TRICK. TRICK, SPIN, and GRIND show 4 ticks; JUMP and SWITCH show none.
- A Playwright touch on TRICK in the air shows 4 chips at 40 px from the center; a 24 px drag right lights `→` and the card cell `→ Side Grab`.
- The card does not overlap the minimap or the stick base in portrait and landscape.
- Each touch button stays 44 px or larger.

**E6 trick list**
- The dialog opens with T (keyboard), the TRICKS button (touch), and the gamepad button of Q1. It pauses the game. Escape closes it and gives the focus back.
- Nia and Marcus show the TRICK dances of R7. Each dance shows its origin or "no source yet". No song title shows while `lyricCheck` is `"open"`.
- Playwright screenshots at 1280 x 720 and on Pixel 7.

**Grayscale and contrast**
- The grayscale screenshots of section 10.1 exist, and a person signs off that each state reads from shape and text.
- Every new text color gives 4.5:1 or more on the pill over white (Vitest with `contrast()`).

## 14. Change log

- 2026-11-26: First draft (#330, lane D).
- 2026-11-26: Review fixes (PR #395, Codex): Busy replaces the dance chip for 600 ms (it was blocked by the chip). Owner answers for Q1, Q2, Q3, Q5.
