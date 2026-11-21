# Fast travel for the City pitch demo (#271)

Status: PROPOSED, not decided. The repository owner decides.
Date: 2026-11-13. Base: `epic/city-look` at `73200b8`.
Related: #260 (landmark loop pacing), design audit findings B3 and B8 (`production/audits/2026-11-13-design-audit/REPORT.md`, PR 267).

## The question

Does fast travel stay in the City pitch demo, and with which limits?

## How fast travel works today

- **Where it is.** The full map (`src/ui/fullmap.js`, key M or the minimap expand button). A click or a tap picks a target. "Travel here" or the T key moves the skater. The map hint reads "click, then T: travel".
- **The move.** `fastTravel(x, z)` in `src/main.js` calls `travelSpot()` (`src/level/geo/travel.js`). The skater lands on the nearest trail, path, sidewalk, or street point, outside every building, at rest, and faces along the strip. The score stays. The combo ends (`teleportRun()` in `src/sim/skate/run.js`).
- **The targets.** Any target: a place on the map, a park, or a landmark spot in any state. An Unknown spot is a target too. The map shows Unknown spots as "?" icons, so a player can travel to a spot that is not found yet. The landmark tracker finds that spot on the next tick.
- **Challenges.** The travel tick ends every challenge attempt (`obs.teleported` in `src/sim/landmarks.js`). A travel cannot claim a gap by itself (e2e test E-3 in `e2e/landmarks.spec.js`).
- **Timed rounds.** Travel works in a timed 150 s round. The map pauses the simulation, so the round timer stops while the map is open. A travel costs 0 s of round time.
- **Builds.** Fast travel is ON in the dev server and OFF in a production build. `?travel=1` or `?travel=0` sets it in both (`docs/decisions.md`, 2026-11-04). The Vercel deploy is a production build, so the current demo URL has no fast travel. The audit ran on the dev server, so fast travel was on in the audit runs. The agent did not use it.

## The pacing facts

- The BeltLine Eastside level is about 1.9 km long. It has 15 spots: 13 claim spots and 2 edge markers.
- The skater cap after pushes is 12 m/s (`src/sim/skate/constants.js`). One end to the other takes about 160 s with no tricks and no stops. A round is 150 s (`RUN_TIME` in `src/sim/skate/goals.js`).
- In audit run 2, the first 25 s gave 2 claims and 3 finds. After that, the gaps were 20 to 60 s. Round 2 had 0 claims. 8 of 15 spots were never found.
- Found and claimed states carry over between rounds. Each new round starts at the spawn, with the near spots done.

## Options

| Option | What the player can do | Effect on the landmark loop pacing | Effort | Risk for a City demo |
|---|---|---|---|---|
| **A. Keep as is** (off in the demo build) | No fast travel in the demo. Dev and `?travel=1` keep it. | All travel stays on foot. Far spots stay out of reach in a 150 s round. Round 2 and later stay slow, because the near spots are done. The fix must come from #260 (Tour mode or a longer round). | None. Record the decision. | Low for the build. High for pacing: a viewer can reach the far end only if #260 ships first. |
| **B. Found and claimed spots only** (`?travel=found`) | Travel only to a spot that is Found or Claimed. No travel to a place, a park, or an Unknown spot. | Discovery stays on foot: the player must skate to find a spot. A return trip to a found spot costs 0 s. In round 2 and later, the player can go to a far found spot and claim it. This fixes the "far spot out of reach" part of B3. It does not shorten the first find of a far spot. | Small. Built in this PR behind `?travel=found` (OFF by default). To ship it, change one default in `travelMode()` and record the decision. | Low. The claim still needs the challenge. A player can skip the skate between found spots, so fewer combos happen on the way. |
| **C. Tour mode only** (#260) | Travel only in the no-timer Tour mode, with the rule of A or B. Timed rounds have no travel. | The timed round keeps its full travel time. Tour mode has no timer, so travel is a comfort, not a fix. B3 in the timed round stays open. | Medium. It needs the Tour mode of #260 first, then one check of the mode in `main.js`. | Medium. It is blocked until #260 ships. If the demo shows the timed round, the viewer sees no travel and the far spots stay out of reach. |
| **D. Any point, all modes** (the dev rule in the demo) | Travel to any place, park, or spot, also an Unknown one. | It skips the loop. A player can travel to each "?" icon and find most spots in a few minutes, with almost no skating. The audit pacing data no longer applies. | Tiny. Change one default. | High. The demo can look like a teleport menu, not a skate game. It removes the reason to explore. |

## Recommendation

**Option B: found and claimed spots only.** It keeps the core of the loop (skate to discover) and it removes the dead time of the return trips. It also helps the timed round now, with no wait for #260. The code is ready to try behind `?travel=found`, so the owner can play it before the decision. Option B also fits Tour mode later: Tour mode can use the same rule.

Before the demo, one Autopilot run with `?travel=found` should show the claims per minute in rounds 2 and 3, next to audit run 2.

## What this PR changes

- `src/ui/travel-rule.js`: a pure rule. `travelMode(param, { dev })` reads the `travel` URL parameter. `canTravelTo(mode, spot)` says if a pick is a target. `travelHint(mode)` gives the map hint.
- `src/ui/fullmap.js`: a `travelMode` option. With "found", a pick that is not a Found or Claimed spot has no target, and the "Travel here" button hides. The hint reads "click a found spot, then T: travel".
- `src/main.js`: reads the mode once and passes it to the full map.
- The default does not change. No parameter: "any" in the dev server, "off" in a production build. `?travel=1` and `?travel=0` work as before.

## How to try it

- Dev server: `npm run dev`, then open `/?level=beltline-eastside&travel=found`.
- A production build (`npm run build`, `npm run preview`) with `?travel=found` works the same way.

## Evidence

- Vitest: `src/ui/travel-rule.test.js` (7 tests).
- Playwright: `e2e/landmark-map.spec.js`, test "?travel=found: travel goes only to a Found or Claimed spot (#271)". Screenshot: `e2e/__screenshots__/fullmap-travel-found.png`.
- The existing travel tests pass with no change: `e2e/fullmap.spec.js` ("fast travel: pick a landmark...", "?travel=0 turns fast travel off") and `e2e/landmark-map.spec.js` ("a click opens the panel of each state...").
- Not verified: no person played option B, and no Autopilot run used it.

## After the decision

The acceptance of #271 asks for 3 things. The owner picks an option. Then a follow-up change:

1. Sets the production default in `travelMode()` (for B: return "found" when `dev` is false).
2. Replaces the PROPOSED entry in `docs/decisions.md` with the decision.
3. Checks that the map hint matches (the hint already follows the mode).
