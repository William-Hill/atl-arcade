# Trick input

> **Status**: Approved by the owner 2026-11-22 (after the review fixes). Implementation: #326 (prototype, first), #327 (sim), #328 (input), #329 (animation), #330 (HUD), #331 (tutorial).
> **Design review**: NEEDS REVISION 2026-11-22 (independent agent, lean depth): 4 blockers and 9 recommended fixes. All are fixed in this revision; see "Review log" at the end.
> **Author**: William Hill + Claude agents (`game-designer`, `systems-designer`)
> **Last Updated**: 2026-11-22
> **Issue**: #324
> **Implements Pillar**: 1 (Flow over failure), 5 (Style is Atlanta)
> **Concept source**: `docs/games/2026-10-30-skate-atl-concept.md` (off-index GDD: no systems index exists)
> **Review mode**: lean, then a specialist pass on 2026-11-22: `creative-director` (CD-GDD-ALIGN), `art-director`, and `qa-lead` each gave CONCERNS. The fixes are in this revision (Review log, pass 2).

## Overview

**Trick input** lets the player choose each trick with a direction plus a button, as in Tony Hawk's Pro Skater (THPS). Now the game chooses for the player: Q and E start the next dance in a fixed list, an air trick plays by itself after a ramp launch, a grind cycles through 3 stances, and the manual has no input.

With this system:

1. In the air, TRICK plus a direction gives one of 5 grabs.
2. On a rail, GRIND plus a direction at the snap gives one of 5 grind stances.
3. On the ground, TRICK or SPIN plus a direction gives one of 10 dance slots.
4. On the ground with no rail near, a held GRIND starts a manual. The manual links grinds and air in one combo (THPS 2).

The same direction gives the same trick on the keyboard, the gamepad, and the phone. The phone uses a flick from the trick button. A one-button mode and remapping make the system accessible.

**Without this system**, the player cannot choose, repeat, or master a trick. The owner played the game on 2026-11-22 and asked for the THPS feel.

## Player Fantasy

**Main feeling: "I called that trick."** The player thinks of a line ("grind the ledge, manual to the kicker, Japan grab, land on the beat") and the skater does it. The trick is the player's choice, so the score is the player's skill.

**Support feeling: "My style, my city."** The Atlanta dances come with their sources, and the moves with no source yet say so. A player learns the map and keeps favorite moves, as a rink skater keeps a signature move.

Anchor moment: on the Eastside Trail skatepark, the player grinds the ledge, holds GRIND off the end into a manual, rolls into the kicker, flicks left for a Japan grab, lands on the beat, and flicks right into The Prep on the next beat. The HUD shows "Ledge Grind + Manual + Japan Grab + The Prep x4" and a PERFECT tag.

## The present system (from the code)

| Move | How the game picks the clip now | Code |
|---|---|---|
| Dance | A press of `style1` (Q, gamepad Y, touch GROOVE) or `style2` (E, gamepad B, touch SPIN) starts `dances[count % dances.length]` of that button's move. A held button repeats the dance. | `src/sim/skate/skater.js` lines 108-147; `STYLE.moves` in `src/sim/skate/constants.js` |
| Dance lists | `groove`: Jam Groove, Drumline Count, Jam Step (Marcus only), Bankhead Bounce, Walk It Out, The Prep, Swag Surf, Snap Lean, Crisscross, Smooth Quad. `spin`: Toe Spin, Sit Spin. | `STYLE.moves`, `dancesFor()` |
| Air trick | No input. After a ramp air of `ANIM.trickAirTime` (0.25 s), the renderer plays `AIR_TRICKS[airVariant % 3]` (`air_mute`, `air_japan`, `air_liukang`). The sim scores "Vert Air", "Ramp Air", or "Hop" only. | `src/render/skater-anim.js` lines 59, 189 |
| Grind | Hold F (gamepad RT, touch GRIND) to snap. The renderer plays `GRINDS[grindVariant % 3]` (`grind_frontside`, `grind_soul`, `grind_unity`). | `src/render/skater-anim.js` lines 60, 186 |
| Manual | No input. The `manual` clip is in both GLBs. `COMBO.manualPoints` is 80 with the note "no input bound in M0". | `src/sim/skate/constants.js` line 165 |
| Keys | A/D steer, W and Shift push, S brake, Space jump, F grind, Q/E style, R switch. Gamepad: left stick x steer, A jump, X push, LT brake, RT grind, Y/B style, LB switch. The left stick y is not used. | `src/input/bindings.js` |
| Touch | A floating stick (x steer, up push, down brake) and the buttons JUMP, GRIND, GROOVE, SPIN, SWITCH. | `src/input/touch-map.js` |

**THPS model against the present list:**

| Item | THPS | Present list | Effect of the change |
|---|---|---|---|
| Who picks the trick | The player (direction + button) | The game (the next item in a list) | The player gets control. |
| Skill signal | The player learns the input | The result depends on a hidden list position | The player can master it. |
| Tricks per button | 5 (neutral + 4 directions) | 1 list | More tricks with no new button. |
| Phone fit | Poor (needs a d-pad) | Good | The flick from the button solves it (see Devices). |

Flips do not apply to quad roller skates: the skater has no board. The roller-skate equivalents are grabs, spins, grind stances, and dances.

## Detailed Design

### Core Rules

**R1. Buttons.** The system uses the present actions. Only two labels change.

| Action (code) | Keyboard | Gamepad | Touch label | Name in this GDD |
|---|---|---|---|---|
| `style1` | Q | Y | TRICK (was GROOVE) | TRICK |
| `style2` | E | B | SPIN | SPIN |
| `grind` | F | RT | GRIND | GRIND |
| `jump` | Space | A | JUMP | JUMP |

**R2. Directions.** A direction is one of neutral, left, right, up, or down. Keyboard: A, D, W, S or the arrows. Gamepad: the left stick or the d-pad. The stick needs 0.5 travel, and the main axis wins (no diagonals). Touch: the flick from the button (R11).

**R3. Fresh direction (owner choice 1).** A direction counts only if it started in the window from `dirBefore` (150 ms) before the button press to `dirAfter` (60 ms) after it. A direction held from earlier (for example, a held W to push) does not count, so the trick is neutral. If two directions start in the window, the later one wins. The trick starts at the press frame when a fresh direction exists. Otherwise it starts `dirAfter` after the press. A touch flick has its own timing (R11).

**R4. Air: grabs.** In the air, a press of TRICK starts a grab. The air must have lasted `grabMinAir` (0.1 s). The first press in one air sets the grab; a later press in the same air does nothing. The grab lasts while TRICK is held.

| Direction | Grab | Clip | New clip |
|---|---|---|---|
| Neutral | Mute Grab | `air_mute` | No |
| Left | Japan Grab | `air_japan` | No |
| Right | Side Grab (placeholder name, owner choice 2026-11-22) | `air_liukang` | No |
| Up | Rocket Grab | `air_rocket` | Yes |
| Down | Tuck Knee | `air_tuckknee` | Yes |

Steer turns the skater in the air as now (`SKATE.airTurnRate`). Each full half turn scores as a spin (Formulas F3). With the present constants (3 rad/s, about 172 degrees per second, and 0.5 s for a hop), only a long vert air reaches 180 degrees, so spins seldom pay. Playtest 1 decides if `SKATE.airTurnRate` goes up (its max is 6 rad/s). A partial turn is never a fault: the landing is clean at any yaw. SPIN does nothing in the air in version 1.

**R5. Ramp air with no press.** A ramp air with no grab plays the `jump` clip and scores the air only. The game no longer plays a grab by itself.

**R6. Rails: grind stances.** GRIND snaps to a rail as now (`GRIND.buffer`, `snapRadius`). The fresh direction at the GRIND press, or at the snap if the press was buffered, sets the stance. The stance does not change during the grind.

| Direction | Stance | Clip | New clip |
|---|---|---|---|
| Neutral | (edge) Grind, as now: Rail Grind, Ledge Grind | `grind_frontside` | No |
| Left | Soul Grind | `grind_soul` | No |
| Right | Unity Grind | `grind_unity` | No |
| Up | Makio Grind | `grind_makio` | Yes |
| Down | Royale Grind | `grind_royale` | Yes |

A direction stance joins the edge name: a Soul Grind on a ledge is "Ledge Soul Grind". The neutral stance keeps the present name ("Ledge Grind").

**R7. Ground: dances.** On the ground at `STYLE.minSpeed` (1.5 m/s) or faster, a press of TRICK or SPIN starts the dance of that slot. The dance length and the hold-to-repeat rule stay as now. No dance clip is new.

| Direction | TRICK (Nia) | TRICK (Marcus) | SPIN (both) |
|---|---|---|---|
| Neutral | Bankhead Bounce | Swag Surf | Cross Step |
| Left | Walk It Out | Walk It Out | Toe Spin (rink move, no source yet) |
| Right | The Prep | The Prep | Smooth Quad (rink move, no source yet) |
| Up | Swag Surf | Drumline Count (no source yet) | ATL Rydin (new clip; Sit Spin until it exists) |
| Down | Snap Lean | Jam Step (no source yet) | Sit Spin (rink move, no source yet) |

Every neutral slot holds a sourced dance, because the neutral slot gets the most presses (owner choice 2026-11-22: Swag Surf for Marcus). Marcus's Drumline Count and Jam Step take his up and down TRICK slots. His Jam Groove, Bankhead Bounce, and Snap Lean clips stay in his GLB for the one-button set (R12) and for later slots (Q1).

The sources are in `docs/characters/atl-dance-references.md`. The sourced dances are Bankhead Bounce, Walk It Out, The Prep, Swag Surf, Snap Lean, Cross Step, and ATL Rydin (rank 1, the signature move of ATL style). The other moves show "rink move (no source yet)" in R7 and on the trick list until the skater review gives a source or a new name.

The clip `dance_crisscross` is the Cross Step (`docs/decisions.md`, 2026-11-03; `nia-sway-ellis.md`), so its game name changes from "Crisscross" to "Cross Step" in `STYLE.moves`. ATL Rydin gets a new clip (owner choice 2026-11-22). Cross Step and Smooth Quad move to SPIN because they are footwork, not grooves. Each dance keeps its own beat count and points: Cross Step and Smooth Quad keep 2 beats and 150 points, so the clips play at full length. This needs `beats` and `points` per dance, not per move.

**R8. Manual (owner choice 2).** On the ground, GRIND held for `manualDelay` (0.15 s, the same as `GRIND.buffer`) with no rail in snap range starts a manual at `manualMinSpeed` (3 m/s) or faster. The delay lets a player hold GRIND just before a rail, as now, with no manual. A fresh up at the GRIND press starts a Toe Roll (the front-wheel manual, new clip `manual_toe`); any other direction starts a Manual (`manual`).

- In the manual, push and brake are off. W/S (gamepad stick y, touch stick y) move the balance (Formulas F1).
- The manual rolls with `manualFriction` (0.5) times the present roll friction (`SKATE.coastDecel`, `SKATE.coastDrag`), because a skater on two wheels rolls freely. With the full friction, 8 m/s drops to 3 m/s in about 13.5 m (an estimate, not a run); with 0.5, in about 27 m.
- The manual ends with no penalty when the player lets go of GRIND, jumps, or slows below `manualMinSpeed`.
- The manual ends in a stumble when the balance reaches the limit (R10).
- A rail that comes in snap range during the manual takes the GRIND input: the manual ends clean and the grind snaps.
- A manual keeps the combo open (the link window does not count down). At `manualCapMeters` (30 m) the game adds the manual link at its full pay (F2), and the link window starts to count down. The skater can stay in the manual after the cap, but it pays no more and does not keep the combo open.

**R9. Repeat decay by trick name.** The combo already decays repeats by name (`COMBO.repeatDecay` [1, 0.5, 0.25]). Each trick now has its own name, so a varied line pays more than one trick again and again.

**R10. Landings: clean, stumble, bail.** Pillar 1: a trick never kills the player. A trick input never causes a bail: only a grind balance out or a respawn does.

| Result | Cause | Effect |
|---|---|---|
| Clean | No fault | Full points, beat bonus allowed. |
| Stumble (owner choice 5) | TRICK still held at the touchdown or let go less than `landingGrace` (0.1 s) before it; a manual balance out. A partial spin is not a cause (R4). | Speed times `stumbleSpeedKeep` (0.7). The trick link pays `stumbleKeep` (0.5). No beat bonus. Style meter minus 0.25. The combo and the multiplier continue. The `land` clip plays a stumble variant. A TRICK press in the last `landingGrace` before the touchdown starts no grab, so a button held from that press is not a stumble. |
| Bail (owner choice 4) | A grind balance out (as now) or a respawn (a fall under `SKATE.fallFloor` or out of the level bounds; no trick input can cause it) | Speed times `GRIND.fallSpeedKeep` (0.5), as now. The combo banks `bailBank` (25%) of the pending points at multiplier 1. Style meter minus `COMBO.bailStyleLoss` (0.5). |

**R11. Devices (owner choice 3).**

| Device | Direction source | Notes |
|---|---|---|
| Keyboard | A, D, W, S, or the arrows | The left hand steers and gives the direction; the right hand has Q, E, F, Space. |
| Gamepad | Left stick or d-pad | The stick y gets a use: the trick direction and the manual balance. |
| Phone | Flick from the button | A tap on TRICK, SPIN, or GRIND gives the neutral trick. A drag of `flickMin` (24 px) or more from the button, up, down, left, or right, gives that direction. The trick starts when the drag crosses `flickMin` (the direction is known then), or when the finger lifts before that (a tap: the neutral trick), or at `flickMaxMs` (120 ms) after the touch (the neutral trick). The R3 window does not apply to a flick. The steer thumb stays on the stick. |

The phone keeps 5 buttons (JUMP, GRIND, TRICK, SPIN, SWITCH), so this system adds no button to the layout of #245. A flick has a small arrow ring around the button while the finger is down.

**R12. Accessibility.**

1. **One-button mode (owner choice 8).** The settings menu has a "One-button tricks" switch. TRICK then picks from the context with this order of precedence. The player can reach all goals and landmark challenges in this mode.

   | State | TRICK press | TRICK hold |
   |---|---|---|
   | Ground, rail in snap range | Grind snap (the rail wins) | Stay on the rail |
   | Ground, no rail | Nothing at the press. A release before `oneButtonHold` (0.5 s) starts the next dance. | At 0.5 s, a manual starts. |
   | Air, rail in snap range | Grind snap (buffered as `GRIND.buffer`) | Stay on the rail |
   | Air, no rail | The next grab of the one-button set | Hold the grab; the grab lets go by itself before the touchdown (no stumble) |
   | Grind | Nothing | Stay on the rail |
   | Manual | Nothing | Stay in the manual (the release ends it) |

   The one-button set, in order (the next press takes the next item, and the list starts again after the last one):
   - Air: Mute Grab, Japan Grab, Side Grab, Rocket Grab, Tuck Knee.
   - Grind: Frontside (the neutral stance), Soul, Unity, Makio, Royale.
   - Ground, Nia: Bankhead Bounce, Walk It Out, The Prep, Swag Surf, Snap Lean, Cross Step, ATL Rydin.
   - Ground, Marcus: Swag Surf, Walk It Out, The Prep, Bankhead Bounce, Snap Lean, Cross Step, ATL Rydin, Jam Groove, Drumline Count, Jam Step.
2. **Remapping.** Every action in `ACTIONS` is rebindable now (`rebind()` in `src/input/bindings.js`). The settings menu gets a remap screen for the keyboard and the gamepad. The game blocks two actions on one key. The direction source (WASD, arrows, stick, d-pad) is a choice.
3. **Longer windows.** A "Relaxed timing" switch sets `dirBefore` to 250 ms, `dirAfter` to 100 ms, `flickMaxMs` to 250 ms, and `landingGrace` to 0.2 s.
4. **No color-only signal.** The trick name and the direction arrow show as text and shape.

**R13. Names and political rules.** Every trick name is positive or neutral. Grab and grind names are standard skate terms. The dances keep their Atlanta sources and the content flags of `docs/characters/atl-dance-references.md` (lyric checks for Bankhead Bounce, Walk It Out, Snap Lean). No name refers to crime, danger, or decline. The standard skate name of the `air_liukang` grab uses the name of a fighting-game character, which is a trademark risk for an official city game. The game uses the placeholder "Side Grab" from the start (owner choice 2026-11-22), and the skater review picks the final name (Q3). The trick list shows the origin of a dance only (place, year, creators, public source). It shows a song title only after the lyric check of that song passes. Nae Nae stays out of the map. Real skaters review the move set and the names before release (AGENTS.md).

### States and Transitions

| Input | Ground (rolling) | Air | Grind | Manual |
|---|---|---|---|---|
| Steer | Carve | Air spin | Balance | Steer |
| Push (W, Shift, gamepad X, touch stick up) | Push | Off | Off | Off (W/S balance) |
| Brake (S, gamepad LT, touch stick down) | Brake | Off | Off | Off (W/S balance) |
| JUMP | To air | Off | To air | To air |
| GRIND | Rail near: grind. Else: manual | Buffered for a snap | Hold to stay | Rail near: grind |
| TRICK | Dance | Grab | Off | Off |
| SPIN | Spin dance | Off (v1) | Off | Off |
| SWITCH | Switch | Off | Off | Off |

| From | To | Trigger |
|---|---|---|
| Ground | Air | JUMP, a ramp launch, or a roll off an edge |
| Ground | Grind | GRIND with a rail in snap range |
| Ground | Manual | GRIND held for `manualDelay`, no rail in range, speed at `manualMinSpeed` or more |
| Air | Ground | Touchdown: clean or stumble (R10) |
| Air | Grind | GRIND held or buffered at rail contact |
| Grind | Air | JUMP or the rail end |
| Grind | Ground | Bail (balance out) |
| Manual | Ground | GRIND let go, slow speed, or a balance out (stumble) |
| Manual | Air | JUMP |
| Manual | Grind | A rail in snap range |

### Interactions with Other Systems

| System | Data in | Data out | Owner |
|---|---|---|---|
| Input (`src/input/`) | Device events | Per frame, the present fields plus `dir` (`"n"`, `"l"`, `"r"`, `"u"`, `"d"`) and `dirAge` (s since `dir` started; the sim applies R3 with it). Touch: the touch layer gives the trick button press at the flick resolve frame (R11), with the flick `dir` and `dirAge` 0. | Input |
| Skater sim (`src/sim/skate/skater.js`, `controller.js`) | The input per frame | `state.trick` (`{ kind, id, name, clip, dir, held }`), `state.manual` (`{ balance, meters }`), the landing result | Sim |
| Grind (`grind.js`) | The stance id at the snap | The grind meters and the balance, as now | Sim |
| Combo (`combo.js`, `run.js`) | The trick name, the points, the beat offset at the judged moment, the landing result | The links, the multiplier, the bank | Sim |
| Beat clock (`BEAT`) | The event times (touchdown, snap, manual press, dance press) | The beat offset and tag | Audio |
| Animation (`src/render/skater-anim.js`) | `state.trick.clip`, `state.manual` | The clip; the variant counters `airVariant` and `grindVariant` go away | Render |
| HUD (`src/ui/hud.js`) | The combo string, the tags | The trick names, the direction arrow, the manual balance bar | UI |
| Teach prompts (#76, `src/ui/teach-steps.js`) | The trick events | The tutorial steps for grabs, stances, and the manual | UI |

## Formulas

Source: `systems-designer` proposal, adjusted to the owner choices. The present formulas (grind points, repeat decay, multiplier) stay unless this section changes them.

### F1. Manual balance

`m_next = clamp(m + dt * (side * d + g * m - c * s), -1, 1)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| lean | m | float | -1 to 1 | Pitch lean. 0 is balanced. |
| drift side | side | int | -1 or +1 | Set at the manual start. It changes sign on each manual. |
| balance input | s | float | -1 to 1 | W/S, stick y, or touch stick y. +1 is up (W). |
| drift | d | float | 0.2 to 0.8 | `manualDrift`, typical 0.4. |
| gravity | g | float | 0.5 to 2 | `manualGravity`, typical 1.0. |
| correct | c | float | 1 to 4 | `manualCorrect`, typical 2.2. |

**Output range:** -1 to 1. At |m| = 1 the manual ends in a stumble. With no input, m goes from 0 to 1 in about 1.25 s (the grind takes about 0.9 s). Near m = 1 the player needs s = (0.4 + 1.0) / 2.2 = 0.64 to stop the lean, so a recovery is possible until the limit.
**Example:** m = 0.3, side = +1, s = 0.2, dt = 1/60. The change is (0.4 + 0.3 - 0.44) / 60 = 0.0043, so m becomes 0.3043.

### F2. Manual points

`manualPoints = manualBase + manualPerMeter * min(meters, manualCapMeters)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| base | manualBase | int | 20 to 80 | Points per manual. Typical 40. Replaces `COMBO.manualPoints` 80. |
| rate | manualPerMeter | float | 8 to 25 | Points per meter. Typical 15. |
| distance | meters | float | 0 and up | Meters rolled in this manual. |
| cap | manualCapMeters | float | 15 to 50 | Meters that pay. Typical 30. |

**Output range:** 40 to 490 with the typical values. At 8 m/s a manual pays 120 points per second; a grind pays about 280 (35 per meter), so the grind stays the better line. A Toe Roll uses `manualBase` + `toeRollBonus` (20).
**Example:** 20 m: 40 + 15 * 20 = 340.

### F3. Air trick points

`airPoints = airBase + trickBase + holdRate * min(tHold, holdCap) + spinPer180 * n`
`n = min(floor(|theta| / 180), spinCapHalfTurns)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| air base | airBase | int | 50, 100, 200 | `hopPoints`, `rampAirPoints`, `vertAirPoints` (present). |
| trick base | trickBase | int | 0 to 300 | 0 with no grab; neutral grab 80; direction grab 120. |
| hold rate | holdRate | float | 20 to 120 | Points per second of grab held. Typical 60. |
| hold time | tHold | float | 0 and up | Seconds TRICK is held in this air. |
| hold cap | holdCap | float | 0.5 to 3 | Seconds that pay. Typical 1.5. |
| spin rate | spinPer180 | int | 20 to 80 | Points per half turn. Typical 40. |
| spin angle | theta | float (deg) | 0 and up | Yaw turned in this air. Only full half turns pay. |
| spin cap | spinCapHalfTurns | int | 4 to 8 | Typical 6. |

**Output range:** a hop with no trick stays 50. The typical maximum is 200 + 120 + 90 + 240 = 650 (the spin part needs a faster `SKATE.airTurnRate`, see R4). One air gives one link.
**Example:** ramp air, Japan Grab held 0.8 s, no full half turn: 100 + 120 + 60 * 0.8 + 0 = 268. The same air on vert with a 180: 200 + 120 + 48 + 40 = 408.

### F4. Grind points

Unchanged: `grindPoints = grindBase + grindPerMeter * meters` (100 + 35 per meter, #262). A direction stance adds `stanceBonus` (30); the neutral stance adds 0.

### F5. Link score

`earned = round(P * R[r] * L * B)`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| link points | P | int | 0 and up | From F2, F3, F4, or the dance points. The grind has no cap (a 20 m grind is 800). |
| repeat factor | R[r] | float | 0 to 1 | `repeatDecay[r]`, 0 past the end. |
| repeat count | r | int | 0 and up | Earlier links with the same trick name. |
| landing factor | L | float | 0.5 or 1 | 1 clean, `stumbleKeep` on a stumble. |
| beat factor | B | float | 1 to 1.75 | F6. |

**Output range:** 0 and up; with no grind, at most 650 * 1.75 = 1138. A link with `earned` = 0 adds no multiplier (present rule).
**Example:** a second Japan Grab with P = 268: 268 * 0.5 = 134.

### F6. Beat bonus

`B = beatPerfectBonus if |offset| <= perfectMs; beatBonus if |offset| <= goodMs; 1 otherwise; 1 on a stumble`

| Variable | Symbol | Type | Range | Description |
|---|---|---|---|---|
| offset | offset | float (ms) | 0 and up | Distance of the judged moment from the nearest beat. |
| perfect | perfectMs | int | 10 to 40 | Present `BEAT.perfectMs` 20. |
| good | goodMs | int | 40 to 90 | Present `BEAT.goodMs` 60. |
| perfect bonus | beatPerfectBonus | float | 1.5 to 2 | New. Typical 1.75. |
| good bonus | beatBonus | float | 1 to 2 | Present `COMBO.beatBonus` 1.5. |

The judged moment (owner choice 6): air, the touchdown; grind, the snap; manual, the GRIND press. A dance stays as now: the game judges it when it ends (`justStyled` in `skater.js`). The perfect tier is new in `comboMove`. B multiplies the link points; it does not add a multiplier link.
**Example:** a manual of 340 points with the press 40 ms from the beat: 340 * 1.5 = 510.

### F7. Multiplier and bank

`multiplier = clamp(count(links with earned > 0), 1, maxMultiplier)` (present rule, cap 10).
`bank = pending * multiplier` on a clean end; `bank = round(pending * bailBank)` on a bail.

**Full example (grind, manual, air grab, land):**

1. Ledge Grind (neutral), 12 m, snap off the beat. P = 100 + 35 * 12 = 520. Pending 520. Multiplier 1.
2. Manual, 20 m, press 40 ms from the beat. 340 * 1.5 = 510. Pending 1030. Multiplier 2.
3. Ramp air, Japan Grab held 0.8 s, clean landing 80 ms off the beat. 268. Pending 1298. Multiplier 3.
4. 0.8 s of roll. The combo banks 1298 * 3 = **3894**.

With TRICK still held at the touchdown, link 3 pays 134: pending 1164, bank 3492. With a bail in place of step 4: bank `Math.round(1298 * 0.25)` = 325.

## Edge Cases

- **If the player holds GRIND for the whole manual**: at `manualCapMeters` (30 m) the manual link is added at 490, and the link window then counts down. The combo banks 0.8 s later even if the manual continues. After the capped first manual (490), the next manuals pay their F2 points times 0.5, then 0.25, then 0 (repeat decay).
- **If the player holds the grab for the whole air**: `holdCap` stops the hold pay at 90 points, and a hold at the touchdown is a stumble.
- **If the player spins without end**: `spinCapHalfTurns` stops the pay at 240. A partial turn at the touchdown is clean.
- **If the player repeats one trick**: the 4th and later repeats pay 0 and add no multiplier.
- **If the player holds W to push and presses TRICK**: the direction is not fresh (R3), so the trick is neutral. To get Up, the player taps W in the window.
- **If two directions start in the window**: the later one wins.
- **If TRICK is pressed before `grabMinAir` (0.1 s) or in an air shorter than `COMBO.minAirTime` (0.2 s)**: no grab and no link.
- **If TRICK is pressed in the last `landingGrace` before the touchdown**: no grab starts, and a button held from that press is not a stumble. Only a grab that exists and is held at the touchdown is a stumble.
- **If GRIND is held toward a rail that is still out of range**: for `manualDelay` (0.15 s) nothing happens and the push stays on. After that, the manual starts, and the grind snaps when the rail comes in range. The manual ends clean and scores its meters.
- **If GRIND is pressed in the air with no rail**: the press is buffered for `GRIND.buffer` as now; it does not start a manual at the touchdown. The player presses again for a manual.
- **If the manual rolls onto a ramp**: the manual scores and ends at the launch; the air starts a new link.
- **If the skater hits a wall in a manual**: the bonk rule applies; the manual ends clean if the speed drops under `manualMinSpeed`.
- **If the speed is under `STYLE.minSpeed` at a dance press**: no dance, as now.
- **If the beat clock is off (no audio)**: B = 1, as now.
- **If a bail comes with 0 pending points**: the bank is 0; the style meter still drops.
- **If the skater teleports (map jump)**: the combo ends and the pending points are lost (present rule).
- **If a phone flick does not reach `flickMin` in `flickMaxMs`**: the neutral trick starts at `flickMaxMs`.
- **If one-button mode is on**: the direction is not read; the precedence table of R12 applies; the next item of the one-button set plays. A repeat decay still applies, so the set cycles to keep the pay up.

## Dependencies

| System | Kind | Interface |
|---|---|---|
| Input bindings and touch (`src/input/`) | Hard | Must give the direction, its start time, and the flick. |
| Skater sim, grind, controller (`src/sim/skate/`) | Hard | Gives the states, the snap, the touchdown, the yaw. |
| Combo and run (`combo.js`, `run.js`) | Hard | Takes the trick names and the landing result. Changes: the perfect tier, the stumble factor, the bail bank, the air judged at the touchdown, the manual link at the cap. |
| Style constants (`STYLE.moves`) | Hard | `beats` and `points` move from the move to each dance (R7). |
| Beat clock | Soft | Without it, B = 1. |
| Skater animation and GLBs (`skater-anim.js`, `assets/skaters/`) | Hard for the look | Needs the 6 new clips per skater. Before they exist, a new slot plays the nearest present clip. The clip groups in `skater-anim.js` (`AIR`, `GROUPS.trick`, `GRINDS`, `GROUND`, `roll`) must list the new clips. |
| HUD and teach prompts (#76) | Soft | Shows the names and teaches the map. |
| Phone layout (#245) | Soft | The flick ring must fit the button layout. |
| Animation pipeline (#107, #116, #117) | Soft | New clips, mocap, and polish. |
| Skatepark scoring (#262) | Soft | The grind per meter score stays. |

## Tuning Knobs

All knobs go in `src/sim/skate/constants.js` (a new `TRICK` block, and `COMBO` additions). Values: min / typical / max.

| Knob | Values | Too low | Too high |
|---|---|---|---|
| `dirBefore` (ms) | 100 / 150 / 250 | Players miss the direction | A push tap turns into Up |
| `dirAfter` (ms) | 0 / 60 / 100 | Late directions miss | The neutral trick starts late |
| `stickThreshold` | 0.35 / 0.5 / 0.7 | Drift reads as a direction | A full push is needed |
| `flickMin` (px) | 16 / 24 / 40 | A tap reads as a flick | A short flick is a tap |
| `flickMaxMs` (ms) | 80 / 120 / 250 | Slow flicks become taps | The neutral trick starts late |
| `manualDelay` (s) | 0.1 / 0.15 / 0.3 | A hold before a rail starts a manual | Manuals feel late |
| `grabMinAir` (s) | 0.05 / 0.1 / 0.2 | Grabs on tiny hops | Grabs feel late |
| `manualMinSpeed` (m/s) | 2 / 3 / 4 | Manuals at a crawl | Manuals hard to start |
| `manualFriction` | 0 / 0.5 / 1 | Endless manuals on flat ground | Manuals end before the cap |
| `manualDrift` | 0.2 / 0.4 / 0.8 | No challenge | Out at once |
| `manualGravity` | 0.5 / 1.0 / 2 | No challenge | Out at once |
| `manualCorrect` | 1 / 2.2 / 4 | No recovery | No challenge |
| `manualBase` | 20 / 40 / 80 | Manual not worth it | Manual farm |
| `manualPerMeter` | 8 / 15 / 25 | Manual not worth it | Beats the grind (keep under `grindPerMeter`) |
| `manualCapMeters` | 15 / 30 / 50 | Short links | Endless manual |
| `toeRollBonus` | 0 / 20 / 60 | No reason to toe roll | Toe roll only |
| `trickBase` neutral | 40 / 80 / 150 | Grab not worth it | — |
| `trickBase` direction | 60 / 120 / 300 | No reason to aim | Neutral never used |
| `stanceBonus` | 0 / 30 / 80 | No reason to aim | — |
| `holdRate` (points/s) | 20 / 60 / 120 | No reason to hold | Hold beats variety (keep `holdRate * holdCap` under 1.5 x `trickBase`) |
| `holdCap` (s) | 0.5 / 1.5 / 3 | — | Hold farm |
| `spinPer180` | 20 / 40 / 80 | Spins not worth it | Spin farm |
| `spinCapHalfTurns` | 4 / 6 / 8 | — | Spin farm |
| `landingGrace` (s) | 0.05 / 0.1 / 0.2 | Unfair stumbles | No risk |
| `stumbleKeep` | 0.25 / 0.5 / 0.75 | Harsh | No cost |
| `stumbleSpeedKeep` | 0.5 / 0.7 / 0.9 | Breaks flow | No cost |
| `bailBank` | 0 / 0.25 / 0.5 | THPS harsh | No cost |
| `beatPerfectBonus` | 1.5 / 1.75 / 2 | Perfect = good | Beat dominates |
| `oneButtonHold` (s) | 0.3 / 0.5 / 0.8 | Taps start manuals | Manual hard to start |

`manualPerMeter` must stay under `grindPerMeter` (35). `beatPerfectBonus` must be at or above `beatBonus`.

## Visual/Audio Requirements

**Clip list (owner choice 7, and ATL Rydin added 2026-11-22).** 6 new clips per skater, 12 in total. Each clip must read from behind at the follow camera distance (about 8 m) with one clear shape.

| Clip | Nia | Marcus | Pose and silhouette (`art-director`) |
|---|---|---|---|
| `air_rocket` | New | Mirror of Nia | The longest shape. Legs almost straight (knees 20 to 30 degrees, not locked), hips folded about 90 degrees, both hands on the toes of the skates, head down. Turn the body 25 to 30 degrees to the camera and spread the knees, so the torso does not hide the skates. |
| `air_tuckknee` | New | Mirror of Nia | The smallest shape, a ball. Both knees high and apart, both hands on the shins. Symmetric, with no torso twist, so it does not look like `air_mute` (asymmetric: one arm across the body, a torso twist). |
| `grind_makio` | New | Mirror of Nia | One skate across the rail, on the plate between the trucks. The other skate lifted behind the hip, knee about 90 degrees, beside the body. Torso open to the camera, arms wide. |
| `grind_royale` | New | Mirror of Nia | A T shape: the front skate along the rail, the back skate across it. Body square to the travel, low crouch. Not the same as `grind_frontside`. |
| `manual_toe` | New | New | The front wheels on the ground, the heels up, the toe stops clear of the ground (a toe stop on the ground brakes). Boots pitched forward 15 to 20 degrees, torso forward, arms out. The opposite lean of `manual` (which leans back). |
| `dance_atlrydin` | New | Mirror of Nia | The ATL Rydin spec in `docs/characters/atl-dance-references.md`, section 1 (2 bars, rolling forward). |

Quad skates have no frame groove: a quad grinds on the plate or the boot (`docs/characters/skate-style-references.md`). The clip notes must name the touch point of each stance. Makio and Royale are inline names, so they stay open for the skater review (Q3).

Present clips with a new use: `air_mute`, `air_japan`, `air_liukang`, `grind_frontside`, `grind_soul`, `grind_unity`, `manual`, and all 9 shared dances plus Marcus's 3. Present clips need no change.

**Pipeline.** Hand-key or text-to-motion (Meshy), then the physics pass and the arm IK (`scripts/blender/skater_physics_pass.py`), then the contact sheets and the joint-limit gate. Mocap (#116) and Cascadeur polish (#117, cloud session only) can replace them later. Clip blends (#107) cover the move from a grab to the landing.

Risks (`art-director`):
1. The arm IK supports one hand on one skate (`HAND_TARGETS`). `air_rocket` and `air_tuckknee` need two hands, and `air_tuckknee` needs a shin target, not a skate box. Add a two-hand spec and a shin capsule target to the pass. This is new work.
2. Marcus's mirrored grabs already use a chest bend of 28 to 30 degrees for one hand. Two hands can pass the 30 degree limit or the joint gate. Test Marcus first.
3. Only 7 clips need a new source: Nia's 6 and Marcus's `manual_toe`. The other 5 are mirrors. With Meshy text-to-motion that is 21 credits (swift, 3 per clip) or 70 (prime, 10 per clip), plus 1.5 times for redos. The decision of 2026-11-15 (#293) kept hand keys over text-to-motion for the dances, so expect hand keys for the grabs and the rail clips. The cost is in the cleanup, not the credits.
4. Check each GLB against the 10 MB limit after the new clips.
5. Every new clip goes through the joint-limit gate and the contact sheets. A real skater reviews every pose before release.

**Feedback.** Every tier uses shape and text, not color alone (R12.4). Reuse the present landing dust, wall sparks, and comic effects.

| Tier | Feedback |
|---|---|
| Clean | The present landing dust and the `land` clip. No new effect. |
| PERFECT | A ring of 8 to 10 short wheel sparks on the ground, larger than the clean dust, for 0.3 s. A 1-frame hit stop (60 ms). The "PERFECT" tag. |
| Stumble | A small dust puff, a 0.2 s arm-wave recovery, and a short "WOBBLE" tag in a neutral color. No red and no loss sound. Until the clip exists, the fallback is `land` at 1.3 times speed plus a small arm-wave layer. |
| Bail | The present `bail` clip, a comic dust cloud, and the faded "+N" of the 25% bank. No red, no damage flash, no loud shake, and no words such as "FAIL" or "CRASH". The skater is up inside 0.9 s. |

**Audio.** A short click on a direction trick press; the present beat sounds for GOOD and PERFECT.

## UI Requirements

- **HUD trick line**: the name of each link with its direction stance ("Ledge Soul Grind + Manual + Japan Grab x3"). One line with the 3 newest links; older links fold into "+2". 18 characters or fewer per link. A direction arrow glyph before each name. A dark outline for a contrast of 4.5:1 or more on the bright sky. Reuse the present callout style. No motion when reduced motion is on.
- **Manual balance bar**: a vertical bar in screen space, 56 px beside the projected skater (smoothed, not anchored in the world), 160 px high or more on a phone. A 20 px triangle marker. Three zones with fill patterns, not only color: safe to 0.5, warning to 0.8, limit with hatching. The marker pulses at 0.7 or more. W and S arrows at the ends.
- **Touch flick ring**: 4 faint tick marks on TRICK, SPIN, and GRIND at rest, so the player knows the flick before the touch. At the touch-down, a ring of 4 arrows at a radius of 40 px or less, outside the thumb contact area. The arrow lights when the drag crosses `flickMin` and shows the short trick name. Only the ring of the active button shows. Each button stays 44 px or larger.
- **Trick list screen**: a pause menu page with the map per context, per skater, with the direction arrows, the dance origins (R13), and "rink move (no source yet)" for the moves with no source.
- **Settings**: "One-button tricks", "Relaxed timing", and the remap screen.
- **Teach prompts (#76)**: 3 new steps (a grab with a direction, a grind stance, a manual link).

> **UX flag**: this system has UI requirements. Run `/ux-design` for the HUD trick line, the flick ring, and the trick list screen before the HUD story.

## Acceptance Criteria

Reviewed by `qa-lead` on 2026-11-22. The sim criteria use `stepSkater` with the input fields `dir` and `dirAge` (Interactions table). "Off the beat" means more than 60 ms from the nearest beat.

**Input and direction (R1 to R3, R11)**
- **GIVEN** a ramp air of 0.3 s, **WHEN** A starts 100 ms before Q, **THEN** `state.trick.id` is `japan` and the clip is `air_japan` at the Q frame.
- **GIVEN** a skater on the ground, **WHEN** Q is pressed with a fresh right that started 100 ms before, **THEN** the dance is The Prep; **WHEN** the right started 160 ms before, **THEN** the dance is the neutral slot.
- **GIVEN** a skater on the ground, **WHEN** a fresh up starts 20 ms after the Q press, **THEN** the dance starts at the 20 ms frame; **WHEN** no fresh direction comes, **THEN** the neutral dance starts 60 ms after the press.
- **GIVEN** left and then right start in the window, **WHEN** Q is pressed, **THEN** right wins.
- **GIVEN** the player holds W for 1 s to push, **WHEN** the player presses Q on the ground, **THEN** the dance is the neutral slot (Bankhead Bounce for Nia).
- **GIVEN** the gamepad stick at x 0.49, **WHEN** TRICK is pressed, **THEN** the trick is neutral; at x 0.5, **THEN** it is left or right; at x 0.6 and y 0.7, **THEN** up or down wins.
- **GIVEN** the same direction on the keyboard, a simulated gamepad, and touch, **WHEN** TRICK is pressed in the air, **THEN** `state.trick.id` is the same for all 3.
- **GIVEN** a touch on TRICK in the air, **WHEN** the finger moves 24 px right, **THEN** the Side Grab starts in that frame.
- **GIVEN** a touch on TRICK in the air, **WHEN** the finger lifts at 50 ms with less than 24 px of travel, **THEN** the Mute Grab starts.
- **GIVEN** a touch on TRICK in the air, **WHEN** 120 ms pass with no drag, **THEN** the Mute Grab starts.
- **GIVEN** Relaxed timing, **WHEN** a direction starts 240 ms before the press, **THEN** it counts.

**Air (R4, R5, F3)**
- **GIVEN** an air of 0.09 s, **WHEN** TRICK is pressed, **THEN** no grab starts; at 0.11 s, **THEN** a grab starts.
- **GIVEN** a grab in an air, **WHEN** TRICK is pressed a second time, **THEN** `state.trick.id` does not change.
- **GIVEN** an air of 0.15 s with TRICK pressed, **WHEN** the skater lands, **THEN** no link is added (`COMBO.minAirTime` 0.2 s).
- **GIVEN** an air, **WHEN** SPIN is pressed, **THEN** no trick starts.
- **GIVEN** an air, **WHEN** TRICK is pressed with up, and in a second air with down, **THEN** the clips are `air_rocket` and `air_tuckknee`.
- **GIVEN** a ramp air with no press, **WHEN** the skater lands, **THEN** the clip is `jump` and the link is "Ramp Air" with the air points only.
- **GIVEN** a ramp air with a Japan Grab held 0.8 s and TRICK let go 0.15 s before a touchdown 80 ms off the beat, **THEN** the link is 268.
- **GIVEN** a neutral grab, **THEN** `trickBase` is 80.
- **GIVEN** a ramp air with a grab held 3 s, **THEN** the hold part of the points is 90.
- **GIVEN** a vert air with a 180 and a grab held 0.8 s, **THEN** P is 408; **GIVEN** 8 half turns, **THEN** the spin part is 240.
- **GIVEN** an air with a 90 degree turn, **WHEN** the skater lands with TRICK let go, **THEN** the landing is clean.

**Grind (R6, F4)**
- **GIVEN** a ledge snap with a fresh left, **THEN** the clip is `grind_soul` and the name is "Ledge Soul Grind".
- **GIVEN** a ledge snap with a fresh up, **THEN** the name is "Ledge Makio Grind" and the link is 100 + 35 x meters + 30.
- **GIVEN** a neutral ledge snap, **THEN** the name is "Ledge Grind".
- **GIVEN** a GRIND tap 100 ms before the rail and a fresh right at the snap, **THEN** the stance is Unity.
- **GIVEN** a grind, **WHEN** a new direction starts during it, **THEN** the clip does not change.

**Ground dances (R7)**
- **GIVEN** a speed of 1.4 m/s, **WHEN** Q is pressed, **THEN** no dance starts; at 1.5 m/s, **THEN** a dance starts.
- **GIVEN** Nia, **WHEN** E is pressed with no direction, **THEN** the Cross Step plays for 2 beats and pays 150 points.
- **GIVEN** Marcus, **WHEN** Q is pressed with no direction, **THEN** the dance is Swag Surf; with up, **THEN** it is Drumline Count.

**Manual (R8, F1, F2)**
- **GIVEN** a roll at 5 m/s with no rail in snap range, **WHEN** F is held for 0.2 s, **THEN** the state is manual, and push and brake are off.
- **GIVEN** F held at 2.9 m/s, **THEN** no manual starts; at 3.0 m/s, **THEN** a manual starts.
- **GIVEN** F held with a fresh up at 3 m/s, **THEN** the clip is `manual_toe` and the link is 40 + 15 x meters + 20.
- **GIVEN** a roll at 8 m/s toward a ledge, **WHEN** F is held from 0.1 s before the ledge comes in snap range, **THEN** no manual starts and the skater snaps to the ledge.
- **GIVEN** F held for 0.2 s toward a rail 2 s away, **THEN** a manual starts, and the grind snaps when the rail is in range.
- **GIVEN** a manual, **WHEN** F is let go, or JUMP is pressed, or the speed drops under 3 m/s, **THEN** the manual ends clean with no speed loss.
- **GIVEN** a manual, **WHEN** a rail comes in snap range, **THEN** the manual ends clean and the grind snaps.
- **GIVEN** F1 with m = 0.3, side = +1, s = 0.2, dt = 1/60, **THEN** m becomes 0.3043.
- **GIVEN** a manual with no balance input, **WHEN** |m| reaches 1 (about 1.25 s), **THEN** the state is rolling, the landing result is a stumble, and the speed is 0.7 times the speed of the step before.
- **GIVEN** a manual of 20 m that ends clean off the beat, **THEN** the link is 340.
- **GIVEN** a manual with `manualFriction` 0 and the balance held near 0, **WHEN** the meters reach 30 at 8 m/s, **THEN** the combo holds one manual link of 490, and the bank comes 0.8 s after the cap.
- **GIVEN** a manual that rolls onto a ramp, **THEN** the manual link is added at the launch and the air starts a new link.

**Landings, combo, and beat (R9, R10, F5 to F7)**
- **GIVEN** the same air with TRICK held 0.8 s up to the touchdown, **THEN** the link is 134, the speed is 0.7 times, and the style meter drops 0.25.
- **GIVEN** TRICK let go 0.05 s before the touchdown, **THEN** the landing is a stumble; at 0.11 s, **THEN** it is clean.
- **GIVEN** a TRICK press 0.05 s before the touchdown and held through it, **THEN** no grab starts and the landing is clean.
- **GIVEN** a stumble on a beat, **THEN** B is 1.
- **GIVEN** a touchdown offset of 20 ms, **THEN** B is 1.75; 21 ms, 1.5; 60 ms, 1.5; 61 ms, 1.
- **GIVEN** a grind snap, a manual press, and a dance end, **THEN** the beat offset uses those moments.
- **GIVEN** no beat clock, **THEN** B is 1.
- **GIVEN** the same trick 4 times in one combo, **THEN** the links pay P, P x 0.5, P x 0.25, and 0, and the 4th adds no multiplier.
- **GIVEN** a combo with 10 scoring links, **WHEN** an 11th scoring link is added, **THEN** the multiplier stays 10.
- **GIVEN** a run with the 3 links of F7 (520, 510, 268) and 0.8 s of flat roll, **THEN** the pending points are 1298, the multiplier is 3, and the score adds 3894.
- **GIVEN** pending 1298, **WHEN** the skater bails on a grind, **THEN** the score adds 325, the speed is 0.5 times, and the style meter drops 0.5.
- **GIVEN** a bail with 0 pending, **THEN** the bank is 0 and the style meter drops 0.5.
- **GIVEN** a teleport, **THEN** the combo ends and the pending points are lost.

**Accessibility and names (R12, R13)**
- **GIVEN** one-button mode and a rail in snap range, **WHEN** TRICK is pressed, **THEN** the skater snaps to the rail.
- **GIVEN** one-button mode on the ground with no rail, **WHEN** TRICK is tapped, **THEN** the next dance of the one-button set starts at the release; **WHEN** TRICK is held 0.5 s, **THEN** a manual starts and no dance.
- **GIVEN** one-button mode in the air with no rail, **WHEN** TRICK is pressed in 3 airs, **THEN** the grabs are Mute Grab, Japan Grab, and Side Grab, and no landing is a stumble.
- **GIVEN** G bound to grind, **WHEN** the player binds G to jump, **THEN** the bind is refused and G still grinds; F does nothing for grind.
- **GIVEN** the list of all trick names, **THEN** each name is in the approved list of this GDD and no name contains a word of the banned list.
- **Performance**: the trick input adds under 0.1 ms per sim step on the phone tier (`npm run perf:check`).
- **Evidence**: Vitest for every sim criterion; Playwright on the keyboard, a simulated gamepad, and touch on a Pixel 7 viewport, with screenshots of the flick ring and the HUD trick line.

## Prototype and Playtest Plan

1. **Greybox prototype** (`prototypes/trick-input/`, no import of `src/`, per AGENTS.md): the capsule skater, one rail, one kicker, and a flat pad. Text labels in place of clips. The fresh-direction rule, the manual balance, and the flick on touch. 2 to 3 days.
2. **Playtest 1** (5 or more players, keyboard and phone): measure the share of tricks that came out as the player wanted (target 90% or more), the share of push taps that turned into an unwanted Up and of carves that turned into an unwanted Left or Right (target under 5% each), and the time to the first 3-link combo with a manual (target under 3 minutes). Verdict: PROCEED, PIVOT, or KILL. Record it in `docs/playtest-metrics.md`.
3. **Tune** `dirBefore`, `dirAfter`, `flickMin`, and the manual knobs from the data.
4. **Production**: the implementation issues (sim, input, animation, HUD, tutorial).
5. **Skater review**: real Atlanta skaters review the move set, the names, and the dance slots before release (AGENTS.md, Pillar 5).

## Open Questions

| # | Question | Default in this GDD | Owner | By |
|---|---|---|---|---|
| Q1 | Marcus's Jam Groove, Bankhead Bounce, and Snap Lean have no direction slot. Add a third style set later, or keep them in the one-button set only? | One-button mode only | Owner | Before the animation story |
| Q2 | Does SPIN do anything in the air (a flat spin trick)? | No, in version 1 | Owner | After playtest 1 |
| Q3 | Are "Makio Grind", "Royale Grind", "Rocket Grab", and "Tuck Knee" the right names for quad skaters? What is the final name of the Side Grab? Do Toe Spin, Sit Spin, Smooth Quad, Drumline Count, Jam Step, and Jam Groove get a source or a new name? | Yes to the 4 names; "Side Grab" until the review; "rink move (no source yet)" | Skater reviewers, owner | Before release |
| Q5 | Does `SKATE.airTurnRate` go up so that spins pay (R4)? | No change before playtest 1 | Owner | After playtest 1 |
| Q4 | Does the touch label GROOVE change to TRICK? | Yes | Owner | HUD story |

## Review log

**2026-11-22, `design-review` (independent agent, lean depth): NEEDS REVISION.** All 7 questions of #324 are answered, and the arithmetic of F1 to F7 was correct. Fixed in this revision:

1. Blocker: spins could not happen at `SKATE.airTurnRate` 3 rad/s, and the spin-error stumble punished a steer in the air. Fix: only full half turns pay, a partial turn is clean, the examples use no spin, and Q5 asks about the turn rate.
2. Blocker: the manual cap and the link window conflicted. Fix: the manual link is added at `manualCapMeters`.
3. Blocker: one-button mode had no precedence. Fix: the table in R12.
4. Blocker: the phone flick had no time to resolve. Fix: the trick starts at `flickMin`, at the lift, or at `flickMaxMs`.
5. The P range in F5 was wrong (the grind has no cap). Fixed.
6. The neutral grind name did not agree. Fix: the neutral stance keeps the present "(edge) Grind" name.
7. SPIN dances would play at half length. Fix: `beats` and `points` per dance.
8. The dance judgment moment: kept at the end of the dance, as now.
9. A held GRIND before a rail started a manual. Fix: `manualDelay` 0.15 s and a new criterion.
10. The gamepad push row was wrong. Fixed.
11. The playtest now measures unwanted Left and Right from carves.
12. "Liu Kang Grab" trademark risk: added to R13 and Q3.
13. The clip budget now states the Meshy model.
14. to 17. The SPIN up slot is reserved, relaxed timing covers `dirAfter` and `flickMaxMs`, and the F1 wording is fixed. The GDD stays in `docs/gdd/` because #324 asks for a GDD in `docs/`.

A second review did not run.

**Pass 2, 2026-11-22: `creative-director`, `art-director`, `qa-lead`: CONCERNS from each.** The owner answered 3 new choices (all the recommended option): add ATL Rydin as a new clip (12 new clips in total), Swag Surf in Marcus's neutral slot, and the placeholder name "Side Grab" now. Fixed in this revision:

1. Six moves had no source. Every neutral slot now holds a sourced dance, and the other moves say "rink move (no source yet)" (R7).
2. "Crisscross" is the Cross Step, and ATL Rydin has the SPIN up slot (R7, clip list).
3. "Liu Kang Grab" became "Side Grab" now (R4, R13).
4. The anchor moment ends with The Prep on the beat (Pillar 5).
5. R10 says that a trick input never causes a bail, and it defines a respawn.
6. The trick list shows the dance origin only, and a song title only after its lyric check (R13).
7. Pose and silhouette specs for each new clip; `manual_toe` rolls on the front wheels with the toe stops clear; `grind_royale` is a T shape (clip list).
8. The landing feedback tiers, the HUD style rules, and the flick ring rules (Visual/Audio, UI).
9. Clip risks: the two-hand and shin IK targets, Marcus first, 7 clips with a new source, the clip groups in `skater-anim.js`.
10. The sim input contract (`dir`, `dirAge`), the one-button set, the `landingGrace` rule, and `manualFriction` (R8, R12, Interactions, Edge Cases).
11. The repeat decay edge case after the capped manual was wrong. Fixed.
12. The acceptance criteria went from 21 items to 62 (with the performance and evidence items), with each rule and formula covered.

A third review did not run.
