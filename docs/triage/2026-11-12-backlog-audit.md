# Backlog audit, 2026-11-12

Scope: the 33 open GitHub issues in `William-Hill/atl-arcade`. The check of each issue used the code on `origin/epic/city-look` (457 commits ahead of `main`), the merged PRs, and `docs/decisions.md`.

Important: many PRs merge into `epic/city-look`, not into `main`. Thus GitHub does not close their issues. Some open issues are done.

## Version scheme

The repo has no git tags. `package.json` has `0.0.1`. The repo uses the GitHub milestones M1 and M2. This audit adds three release labels:

| Label | Meaning |
|---|---|
| `v0.9.0` | City pitch demo: one polished neighborhood that the team can show to City of Atlanta staff |
| `v1.0.0` | Version 1 (milestone M2): public launch |
| `v1.1.0` | After launch: more neighborhoods and stretch work |

## Summary table

Status: done, partial, open, superseded. Type uses the labels that exist in the repo.

| # | Title (short) | Status | Type | P | Version | Verdict |
|---|---|---|---|---|---|---|
| 14 | Skate objects on real features | partial | enhancement | P1 | v1.0.0 | keep (rails and ramps on real features remain) |
| 16 | Toon shading and palette | superseded | design | — | — | superseded-by #157 |
| 18 | Full neighborhood and 5 to 10 landmarks | partial | enhancement | P1 | v1.0.0 | rescope: GPU frame time only |
| 19 | Rink finale level | open | enhancement | P1 | v1.0.0 | keep |
| 20 | Music: four tracks with licenses | partial | review | P0 | v0.9.0 | keep: owner decision on AI tracks |
| 21 | Leaderboard | open | enhancement | P1 | v1.0.0 | keep |
| 22 | Cultural and political review gate | open | review | P0 | v0.9.0 | keep, and add the legal items below |
| 23 | Deploy and route from open-data-atl | partial | infra | P0 | v0.9.0 | rescope: route, `og:` tags, smoke test |
| 24 | Touch controls (phone) | partial | enhancement | P1 | v1.0.0 | rescope: iOS Safari run, real-phone FPS |
| 74 | First load on a phone | partial | infra | P1 | v0.9.0 | keep: first frame 6.6 to 7.6 s, target 4 s |
| 76 | Teach the moves in 30 seconds | open | design | P0 | v0.9.0 | keep |
| 81 | NPC style to match the skaters | partial | art-pipeline | P2 | v1.0.0 | keep |
| 91 | Ground textures for toon | superseded | enhancement | — | — | superseded-by #158 |
| 92 | Landmark prompt template | open | enhancement | P2 | v1.1.0 | keep |
| 93 | Neighborhood select screen | open | enhancement | P2 | v1.1.0 | keep (blocked by #109) |
| 106 | Neighborhood material sets and murals | partial | art-pipeline | P1 | v1.0.0 | keep: real mural licenses |
| 107 | Clip blends, slide and bonk, foot IK | partial | art-pipeline | P1 | v1.0.0 | rescope: slide, bonk, hard-landing clips |
| 109 | Next neighborhood | open | data | P2 | v1.1.0 | keep |
| 110 | ACE-Step tracks drive the beat clock | done | design | — | — | close (PR 163) |
| 111 | Art direction: Jet Set Radio target | superseded | documentation | — | — | superseded-by `docs/art-direction-pbr.md` (#159) |
| 112 | Jet Set Radio shader pass | open | gameplay | P2 | v1.1.0 | keep (toon is still the phone and low default) |
| 114 | Style frames | partial | art-pipeline | P2 | v1.0.0 | keep: owner picks the frames |
| 115 | Generated assets batch | partial | art-pipeline | P2 | v1.0.0 | rescope: sign and mural concepts only |
| 116 | Motion capture of Atlanta skaters | open | review | P0 | v1.0.0 | keep: AGENTS.md requires a skater review |
| 117 | Animation polish in Cascadeur | open | art-pipeline | P2 | v1.1.0 | keep |
| 118 | Stretch: world on the beat | open | gameplay | P2 | v1.1.0 | keep |
| 220 | Landmarks 5: story cards, results, reset | open | enhancement | P0 | v0.9.0 | keep |
| 221 | Landmarks 6: claim effects | open | art-pipeline | P1 | v0.9.0 | keep |
| 222 | Landmarks 7: H4W skatepark | done | gameplay | — | — | close (PR 251) |
| 223 | Epic: landmark discovery | open | epic | P0 | v0.9.0 | keep (epic) |
| 245 | Phone portrait button overlap | partial | accessibility | P1 | v0.9.0 | rescope: tests at 360x640, SETTINGS 44 px |
| 246 | Pbr look on the phone tier | partial | infra | P1 | v0.9.0 | rescope: real-phone frame time only |
| 253 | Camera effects | open | enhancement | P1 | v0.9.0 | keep: PR 254 must target the epic |

## Duplicates and overlap

- #16, #111, #91, and #112 are the toon (Jet Set Radio) track. The pbr look replaced it on the high tier (#157, #158, #159). Toon is still the default on the phone and low tiers (`lookFor()` in `src/render/look.js`). Close #16, #91, and #111. Keep #112 as P2 for the phone and low tiers.
- #20 and #110 cover the music. #110 is done. #20 keeps only the license decision.
- #106 and #115 both ask for mural concepts. Put the mural work in #106.
- #107, #116, and #117 cover animation. #116 (real skaters) blocks the release. #117 needs Cascadeur, which does not connect now.

## Done, superseded, and stale

Close candidates (confirm each):

| # | Reason | Evidence |
|---|---|---|
| 110 | done | PR 163, `assets/music/LICENSE.md`, `e2e/music.spec.js` |
| 222 | done | PR 251, `src/level/skatepark.js`, `e2e/skatepark.spec.js` |
| 16 | superseded | `docs/style-sheet-pbr.md` (#157); toon code stays |
| 91 | superseded | #158, `assets/textures/ground-pbr/*` |
| 111 | superseded | `docs/art-direction-pbr.md` (PRs 164, 204) |

No issue is older than 60 days without activity. The oldest update is 2026-10-31.

## Epic coverage

#223 Epic: landmark discovery.

| Child | State |
|---|---|
| #216 data file and validator | closed (PR 247) |
| #217 pure landmark module | closed (PR 250) |
| #218 map icons and Guide tab | closed (PR 255) |
| #219 rings, banners, chimes | closed (PR 256) |
| #222 H4W skatepark | done, issue open (PR 251) |
| #220 story cards, results row, reset | open, not started (only the reset logic in `src/sim/landmarks.js`) |
| #221 claim effects | open, only the shapes in `fx.js` |

Orphans: none.

## Dependencies and order

1. PR 254 (#253) targets `main`. Its branch does not contain `epic/city-look`. Rebase it onto the epic and change the base.
2. #220 before #221: the claim effects play at the story card moment.
3. #22 review gate before any demo to City staff.
4. A merge of `epic/city-look` into `main` before #23. Production deploys from `main`.
5. #109 before #93. The select screen needs a second neighborhood.
6. #116 before the v1.0.0 release (AGENTS.md: real skaters review the move set).

Next up (v0.9.0, highest priority first): #220, #76, #22, #23, #253, #221, #245, #246, #74.

## City pitch: release readiness

The pitch document is in PR 45 (`docs/pitch/2026-11-01-official-game-of-atlanta.md`). It is open and not merged since 2026-11-02. It lists the legal risks in section 7.

### What is ready

- One real neighborhood: BeltLine Eastside, from OpenStreetMap and City of Atlanta data, with 8 landmark GLBs, the H4W skatepark, and trees from the City canopy data.
- Landmark discovery: data with cited sources, map icons, the Guide tab, rings, banners, and chimes (#216 to #219).
- The pbr look on desktop, pbr lite and toon on phones, touch controls, a quality governor, photo mode.
- Four original music tracks with provenance.
- A Vercel deploy with a stable URL for the epic (`skate-atl-city-look.vercel.app`).

### What blocks the pitch demo (v0.9.0)

1. **Merge `epic/city-look` into `main`.** The 457 commits of the city look are not on `main` and not in production. No issue tracks this. New chore issue, P0.
2. **#22 review gate.** No `docs/review/` exists. Add these items to the gate:
   - The moving cars (`src/sim/cars.js`, IDM traffic). AGENTS.md forbids "traffic danger as content". Decide: parked cars only, or calm traffic with no danger.
   - Real landmark names (Ponce City Market, Krog Street Market, BeltLine). These are registered marks. Add a "no affiliation" notice, or use generic names, until a license exists (pitch section 7.2).
   - The murals are original work. Record this for the City (pitch section 7.3).
   - The fact cards: replace Wikipedia sources with official sources (pitch section 7.6).
3. **#220 story cards.** The epic has no payoff without them. The pitch sells the educational value.
4. **#76 teach the moves.** City staff will play once, without help.
5. **#23 deploy route.** A link from the open-data-atl site, `og:` tags for a share preview, and a smoke test on the production URL.
6. **#20 music decision.** Decide if AI-made tracks meet "original or local tracks with written licenses". Record it in `docs/decisions.md`.
7. **A pitch one-pager and demo script.** Update PR 45 with the current state, then merge it. New documentation issue, P0.

### What the pitch demo should have (v0.9.0, P1)

- #253 camera effects and #221 claim effects (the "wow" in a live demo).
- #245 and #246: a check on one real mid-range phone. All frame times now come from SwiftShader, not a phone GPU.
- #74: the first frame on a phone is 6.6 to 7.6 s. The target is 4 s.

### What a public launch as the official city game needs (v1.0.0)

- #116 review of the move set by real Atlanta skaters (AGENTS.md rule).
- A WCAG 2.1 AA check of the menus and an accessible text page for the facts. The ADA Title II rule applies to City web content (pitch section 7.5). New accessibility issue, P0.
- A lawyer review of pitch section 7: the city seal, landmark marks, COPPA, and Georgia student data law.
- #19 rink finale and #21 leaderboard (the Version 1 scope in the concept). The leaderboard must have no names in a teacher mode.
- Real-phone performance (#24) and an iOS Safari run.

## Proposed changes

Create the missing labels:

```bash
gh label create P0 --color b60205 --description "Foundational / blocking"
gh label create P1 --color d93f0b --description "Closes the loop"
gh label create P2 --color fbca04 --description "Polish / nice-to-have"
gh label create epic --color 5319e7 --description "Epic with child issues"
gh label create v0.9.0 --color 0e8a16 --description "City pitch demo"
gh label create v1.0.0 --color 0e8a16 --description "Version 1 public launch (M2)"
gh label create v1.1.0 --color 0e8a16 --description "After launch"
```

Add priority and version labels:

```bash
for n in 20 22 23 76 220 223; do gh issue edit $n --add-label P0 --add-label v0.9.0; done
for n in 74 221 245 246 253; do gh issue edit $n --add-label P1 --add-label v0.9.0; done
gh issue edit 116 --add-label P0 --add-label v1.0.0
for n in 14 18 19 21 24 106 107; do gh issue edit $n --add-label P1 --add-label v1.0.0; done
for n in 81 114 115; do gh issue edit $n --add-label P2 --add-label v1.0.0; done
for n in 92 93 109 112 117 118; do gh issue edit $n --add-label P2 --add-label v1.1.0; done
gh issue edit 223 --add-label epic
gh issue edit 14 --add-label enhancement
gh issue edit 19 --add-label enhancement
gh issue edit 21 --add-label enhancement
```

Close (each one needs your confirmation; post a one-line comment first):

```bash
gh issue close 110 --reason completed --comment "Done in PR 163 on epic/city-look."
gh issue close 222 --reason completed --comment "Done in PR 251 on epic/city-look."
gh issue close 16 --reason "not planned" --comment "Superseded by the pbr style sheet (#157). The toon code stays for the phone and low tiers."
gh issue close 91 --reason "not planned" --comment "Superseded by the pbr ground sets (#158)."
gh issue close 111 --reason "not planned" --comment "Superseded by docs/art-direction-pbr.md (#159)."
```

Rescope comments (post the remaining acceptance items) on #18, #23, #24, #107, #115, #245, #246.

New issues:

1. #257 Merge `epic/city-look` into `main` and deploy production (infra, P0, v0.9.0).
2. #258 City pitch one-pager and demo script; update and merge PR 45 (documentation, P0, v0.9.0).
3. #259 WCAG 2.1 AA check and an accessible text page for the facts (accessibility, P0, v1.0.0).

## Applied, 2026-11-12

- Labels: created P0, P1, P2, epic, v0.9.0, v1.0.0, v1.1.0, and added them to 28 open issues.
- Closed: #110 and #222 (done); #16, #91, #111 (not planned, superseded).
- Created: #257, #258, #259.
- Rescope comments: #18, #23, #24, #107, #115, #245, #246.
- Not done: the base change of PR 254.

Other action: change the base of PR 254 to `epic/city-look` after a rebase.

## Release plan

| Release | Items |
|---|---|
| v0.9.0 City pitch demo | #257, #258, #22, #220, #76, #23, #20, #223 (epic), #253, #221, #245, #246, #74 |
| v1.0.0 Version 1 | #116, #259, #19, #21, #24, #14, #18, #106, #107, #81, #114, #115 |
| v1.1.0 After launch | #109, #93, #92, #112, #117, #118 |
