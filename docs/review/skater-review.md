# Real skater review (M2-05, #22)

- **Status: open, v1.0.0.** Owner decision on #22 (2026-11-23): the real skater review stays open for Version 1. The agent content checklist (`docs/review/content-checklist.md`) covers the pitch.
- **Rule (`AGENTS.md`):** real skaters review the move set before release.
- **Goal:** real Atlanta roller skaters check that each move name, each animation and the rink feel are correct and respectful. Record each reviewer and each result.

## Reviewers

| Name (or handle, with consent) | Skate style and home rink | Years on skates | Date | Build or URL | Consent to credit (yes / no) |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

## How to run a session

1. Open the build with a clear day: `/?level=beltline-eastside&weather=clear&time=14`.
2. Let the reviewer play 10 minutes with no help. Then show each move below.
3. For each move, ask: Is the name correct? Does the motion look right on skates? Is it respectful? Would you change it?
4. Write the result in the table: **OK**, **Change** (with the change), or **Remove**.
5. Record any new move the reviewer wants, with its name and a source (a video or a rink).

## Move list

Source: `src/sim/skate/constants.js` (`STYLE`), `src/sim/skate/run.js`, `src/input/bindings.js`, `docs/characters/atl-dance-references.md`. Main branch, 2026-11-23.

### Skating

| Move | Input (keyboard) | Notes for the reviewer | Result | Reviewer notes |
|---|---|---|---|---|
| Push and stride | W, Shift to speed up | ATL stride with the carve step on beat 2 (Nia), crossover carves (Marcus) | | |
| Carve and turn | A / D or arrows | Lean into the turn | | |
| Skate backward | R | Switch between forward and backward | | |
| Brake | S or Down | Toe-stop drag (Marcus) | | |
| Idle | none | Nia: hand on the hip, toe tap, head nod. Marcus: drum count | | |

### Air and grind

| Move | Input | Points | Notes for the reviewer | Result | Reviewer notes |
|---|---|---|---|---|---|
| Hop | Space | 50 | Jump on flat ground or off a grind | | |
| Ramp Air | Space at a kicker | 100 | Launch off a kicker or a ramp | | |
| Vert Air | Ride up a quarter pipe | 200 | Air over the quarter pipe lip | | |
| Rail Grind | Hold F near a rail | 35 per meter | Is a grind on roller skates named and shown correctly? | | |
| Ledge Grind | Hold F near a ledge or curb | 35 per meter | Same question | | |
| Long Rail Grind / Long Ledge Grind | A grind of 10 m or more | | The "Long" name | | |

### Style moves: Groove (Q) and Spin (E)

| Move | Button | Skaters | Atlanta source | Result | Reviewer notes |
|---|---|---|---|---|---|
| Bankhead Bounce | Q (Groove) | Nia, Marcus | Wikipedia, AJC, STEEZY | | |
| Walk It Out | Q (Groove) | Nia, Marcus | KAXE, AJC, STEEZY, Howcast | | |
| The Prep | Q (Groove) | Nia, Marcus | USA Roller Sports | | |
| Swag Surf | Q (Groove) | Nia, Marcus | Wikipedia, uDiscover, HAS Dance University | | |
| Snap Lean | Q (Groove) | Nia, Marcus | Wikipedia, AJC (text only, no video) | | |
| Crisscross (Cross Step) | Q (Groove) | Nia, Marcus | USA Roller Sports (name only, no steps) | | |
| Smooth Quad | Q (Groove) | Nia, Marcus | No Atlanta source | | |
| Jam Groove | Q (Groove) | Marcus | No Atlanta source (Tripo motion) | | |
| Drumline Count | Q (Groove) | Marcus | No Atlanta source (Meshy text to motion) | | |
| Jam Step | Q (Groove) | Marcus | No Atlanta source (Meshy text to motion) | | |
| Toe Spin | E (Spin) | Nia, Marcus | Rink move | | |
| Sit Spin | E (Spin) | Nia, Marcus | Rink move | | |

Moves that are not in the game, by decision: Whoop Rico (no source for the steps), Nae Nae (clip exists, not in `STYLE`), and the moves with a content flag in `docs/characters/atl-dance-references.md`. Ask the reviewers which ATL moves are missing (for example ATL Rydin, the snake walk).

### The rink and the run

| Item | Question | Result | Reviewer notes |
|---|---|---|---|
| Beat bonus | Does landing moves on the beat feel like rink skating? | | |
| Music | Do the 3 tracks fit an Atlanta rink and trail? | | |
| Skaters | Do Nia and Marcus look and move like Atlanta skaters (outfit, skates, stance)? | | |
| Words | Are the HUD words ("SKATE!", "NICE COMBO" to "ATL LEGEND", "SPOT CLAIMED") right for skaters? | | |
| Goals | Are the targets (6,000 score, 1,000 combo, 2 gaps) fair for a new player? | | |

## Outcome

| Date | Reviewers | Moves OK | Moves to change | Moves to remove | Issues opened |
|---|---|---|---|---|---|
| | | | | | |

Open an issue with the labels `review` and `P1` for each change or removal, and link it here. #22 closes when every flagged item is fixed or recorded with a reason.
