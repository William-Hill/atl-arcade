# Skate ATL design evaluation (for the City pitch demo)

Date: 2026-11-13. Build: `epic/city-look` checkout at `/Users/william-meroxa/Development/atl-arcade-design-audit`.

## What I verified and what I did not

Verified in code or data (I opened the file):
- `src/sim/landmarks.js` (find, claim, banner, save logic)
- `src/sim/skate/constants.js` (combo, style, scoring numbers) and `src/sim/skate/goals.js` (`RUN_TIME` = 150)
- `src/sim/fact-cards.js`, `src/ui/results.js`, `src/ui/hud.js`, `src/ui/layout.js` (`startHint`)
- `levels/beltline-eastside/goals.json`, `landmarks.json`, `facts.json`
- `src/main.js` (grep only: cars, tracker wiring, results, free run)
- `prototypes/greybox-skate/REPORT.md` (M0 numbers)

Only read in docs (not checked in running code):
- The concept, `docs/playtest-metrics.md`, `docs/skate-features.md`, `docs/landmarks.md`
- The landmark discovery GDD. I read it from the working tree of `/Users/william-meroxa/Development/atl-arcade/design/gdd/landmark-discovery.md`. I had no shell, so I could not run `git show origin/main:...`. The commit `0c1e49f7` that added it is in that tree.
- The three Autopilot reports (11-07, 11-08, 11-09). These came from a scripted agent, not a human.
- Claims about frame rate, phone tier and effects.

I did not run the game. I did not check the car collision code in detail.

## 1. Core loop health

Concept: 30 s loop = grind, launch, trick, dance, keep the combo. 5 min loop = one run (2 to 3 min) with a goal list. Session = 3 to 5 routes ending at a rink, then leaderboard and share card.

| Loop | In the concept | Built (verified) | Gap |
|---|---|---|---|
| 30 s | Grind, air, manual, style, beat bonus | Hop 50, vert air 200, grind 100 + 300/s, dance moves 150 to 160, beat x1.5, repeat decay, multiplier cap 10 (`constants.js`) | No human has measured it. The harness proves reach only (`REPORT.md`: "Not tried"). |
| 5 min | Run, goal list, "one more run" | A 150 s run. Goals: score 6,000, combo 1,000, 3 fact cards, 2 gap goals. Medals 2,500 / 6,000 / 12,000 (`goals.json`). Landmark claims add at most 1,000 per run (`runCap`). | The results screen shows only score, best combo, goals, music, "Skate again" (`results.js`). It shows no landmark claim and no story card. |
| Session | 3 to 5 routes, rink, leaderboard, share | One level. Found and Claimed spots persist in the browser (`atl.landmarks`). | No rink (#19), no leaderboard (#21), no unlock content, no second level. |

Where the loop breaks:
1. After "Time!", the only action is "Skate again". Nothing carries forward that the player can see, except gold icons on the map.
2. The level is about 1.9 km long (PCM at z -895, Studioplex at z +901). At 12 m/s that is about 160 s one way. A 150 s run cannot reach both ends. Landmark claims and the 150 s timer pull against each other.
3. Free run (`?run=free`) has no timer, but by the GDD it gives no claims and no rings. The mode where a player can explore is the mode where the landmark game is off.
4. Autopilot landed 0 grinds in 15 blind tries across 3 reports. The harness cannot see ledge positions, so this is not proof of a bug. It does show that rails are not signposted: the game has 22 benches and 195 curbs as grindables, and the agent never found one.
5. Autopilot never reported a combo, a dance move or a beat hit. The 30 s loop at its center is unobserved in all three reports.

## 2. Pillar and anti-pillar check

| Pillar or rule | Verdict | Evidence |
|---|---|---|
| 1 Flow over failure | Mostly honored. | A bail ends the combo, not the run. The fence replaced the edge respawn (11-08). But the 150 s timer ends play and drops input silently (11-09: skater "looked stuck" for 90 s after "Time!"). |
| 2 Every block is real | Honored, with a cost. | OSM footprints, real heights. Landmark signs are generic ("CITY MARKET", "STUDIO YARDS", `landmarks.md`). The skatepark position is approximate (`skate-features.md`). Recognition is the hook, so fake names weaken it. |
| 3 The city teaches, never lectures | Honored. | Fact pop-up 2 s, no pause. Banner waits while the pop-up shows (`stepBanner` `hold`). Story card only on map and results (but not built, see 5). |
| 4 Atlanta looks good | Partly. | 11-08: the camera passed through the edge fence and showed sky-colored void. Skater clips into trees and walls. 11-09: camera at 0.77 m, skater torso fills the screen. |
| 5 Style is Atlanta | Content present, review missing. | Dances named "Bankhead Bounce", "Walk It Out", "The Prep", "Swag Surf" (`constants.js`). `goals.json` notes: "Real skaters have not reviewed them." |
| Anti-pillar: no traffic hazard | Conflict. | See below. |
| Anti-pillar: no seamless open city | Honored. | One bounded level with a fence. |

Conflict 1, round timer vs free-skate exploration. The concept itself asks for a 2 to 3 minute timer, so the timer is not a breach of the concept. The breach is the pair "1.9 km level" plus "150 s" plus "no claims in free run". Pillar 1 says the game never punishes. A hard input cut is not a fail state, but it feels like one. The 10 s overtime only helps an active combo.

Conflict 2, moving cars. `AGENTS.md`: "No crime, police, or traffic danger as content. Obstacles are cones, crowds, and construction." The build has 54 to 68 moving cars by default (`main.js`: `carsOn` is true unless `?cars=0`; `docs/decisions.md` 2026-11-05). The decision says "Calm traffic only. Cars never threaten the skater". Cars yield at crosswalks. But a car is a "solid box for the skater" (`main.js` comment), so it is an obstacle that is not a cone, crowd or construction. An older decision (`decisions.md` line 290) still says "the level has no traffic". The two entries disagree. A City reviewer will see cars on Ponce de Leon. Decide the policy and write it down.

## 3. Onboarding and the concept hypothesis

Hypothesis: "a new player chains a 3-move combo within 3 minutes; accidental rail falls under 1 per minute."

- Evidence: the scripted `combo` session made a 3-link combo at 3.47 s. The scripted `rails` session fell 2.48 times per minute, on purpose. The report says "Not tried" and "Too few grinds to judge" (`REPORT.md`). William waived the human session on 2026-10-31.
- Verdict: **untested**. No cold-start human has played. Two Autopilot runs plus one more never landed a grind.
- Onboarding in the build: one text line, "Press any key or click to start the beat" / "Tap to start the beat" (`layout.js`). It teaches no control, no grind, no dance. #76 is open.
- The beat start is itself a hurdle. The hint hides only after the beat runs.
- Scaffolding is missing: no isolated grind lesson, no rail highlight, no "why did I bail" feedback.

## 4. Progression and motivation (SDT)

- Autonomy: good. Free movement, two skaters, music select, many lines. Weakened by the 150 s timer.
- Competence: mixed. Medal "next at N" is shown. Combo, multiplier and beat tags exist. Bail cause is not explained. Effects (speed lines, bursts) are off on the `low` tier (11-08). The phone is the top priority tier, and I did not verify that effects run there.
- Relatedness: real places are strong. No crew, no rink crowd, no rival, no leaderboard. The two skaters have names, but no story use was seen.
- Second session: weak.
  - The GDD unlocks outfits at 7, 14 and 20 claims. The data has only 13 claim spots (6 buildings, 4 bridges, 2 parks, 1 skatepark) plus 2 edge markers. The GDD says 20 plus 2. Unlock counts must become 5, 9 and 13, or more spots must ship.
  - The outfit content does not exist (GDD open question 7).
  - Claim points are small: all 13 sum to 4,000 and `runCap` is 1,000, against a 12,000 gold medal. Claims do not move the medal.
  - The only visible reward for a claim is a gold map icon. The story card (#220) and the claim effect (#221) are not built.

## 5. Educational and civic value

- Landmark discovery is integrated into play. Find (silent zone) leads to a banner with one sourced line, then a ring and a challenge, then a claim. It follows pillar 3. Verified in `sim/landmarks.js`.
- The payoff is missing. The story card with 3 to 5 sourced facts is the "trophy". The Guide tab shows a "plain" panel; the code comment says the card design is #220. The results screen shows none of it.
- Fact cards are a separate system (GDD: "none" interaction). There are 3 cards (concept said 9). Each is a dataset trivia line ("{NAME} covers {N} acres of city park land", `facts.json`). They give 250 points and a goal. They are collectibles, not tied to place stories.
- Two layers teach different things with different UI, so the player cannot tell they are one "guide".
- Source rule: landmark facts may cite a public source, not only the catalog (`decisions.md` 2026-11-07). Open: primary sources for several landmarks (GDD question 4). A fact with no source must not ship.
- No fact or landmark view exists on the results screen. For a City demo, results is the natural place to show "what you learned".

## 6. Top 10 recommendations (ranked by impact on a City pitch demo)

| # | Recommendation | Effort | Issue |
|---|---|---|---|
| 1 | Build the story cards and a results row "Spots claimed this run" with NEW stamps. This is the visible civic payoff. | M | #220 |
| 2 | Build the first 60 seconds: replace the start hint with a guided first hop, grind and 3-link combo. Highlight real rails. Then run 5 cold-start playtests and record the hypothesis numbers. | M | #76 (the playtest: new) |
| 3 | Fix the timer and exploration conflict. Allow claims and rings in a free "Tour" run, or lengthen the demo run. Show the end of the run softly, not as a silent input cut. | M | new |
| 4 | Build the claim moment: "SPOT CLAIMED" burst, ring fade, chime. It is the anchor moment of the GDD. | S | #221 |
| 5 | Settle the traffic policy before showing the City. Either default `?cars` off near the trail and give cars no collision, or write the exception in `docs/decisions.md` and `AGENTS.md`. Remove the stale "no traffic" line. | S | new |
| 6 | Give claims a reward. Set outfit unlocks to the number of shipped spots (5, 9, 13), make at least one outfit, and raise claim points or the cap so claims matter to medals. | M | new |
| 7 | Add a leaderboard and a share card. This gives the second-session hook and a social loop. | M | #21 |
| 8 | Merge the two teaching layers. Show fact cards and landmark lines in one Guide. Put a "Source: City of Atlanta open data" tag on each card. Make the "3 fact cards" goal point to a place. | S | new |
| 9 | Fix camera and clip problems: fence camera, 0.77 m distance, tree and wall clipping. Check that effects run on the phone tier. | S to M | #253 follow-up (new) |
| 10 | Rink finale. It is the concept's peak and the "set" end. Defer it. Ship a cheap "Set complete" results screen first. Add the skater review of moves, goals and challenges as a release gate. | L (rink); S (interim) | #19 (interim: new) |

Not ranked: more neighborhoods. One strong neighborhood with cards, claims and a clear start beats a second thin one.

## Overall verdict

The movement and the landmark data layer are strong. The build is a good first neighborhood. The pitch risk is in three places: the player never sees the learning payoff (no story cards, no results row), a new player gets no teaching, and the cars conflict with the written political rule. These are small to medium fixes and none needs new art.
