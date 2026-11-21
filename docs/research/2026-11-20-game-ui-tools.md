# Game UI tools spike (#299, #300 first half)

Date: 2026-11-20. Branch: `feat/299-ui-tools` from `epic/city-look`. Epic: #298.

## Result

- Keep 3 free tools as references: the motion design skill, `threejs-game-ui-designer`, and `game-ui-ux`. Use `logo-generator-skill` for its design rules only.
- Skip the 2 paid tools. This session has no HiAPI key and no Scenario key.
- Do not install the skills into `.claude/skills/` in the repository yet. See "Install" below.
- Build the title screen and the in-game text graphics in code (DOM and CSS). The mock title screen in this spike uses no image generation and no paid key.
- The 3 logo options are in `assets/brand/logo-options/`. The owner must choose 1 before the final logo and the key art.

## Versions tested

All commits are 7 days old or older (cutoff 2026-11-13).

| Tool | Repository | Commit | Commit date | License |
|---|---|---|---|---|
| Motion design skill (637 techniques) | `gongnyang/awesome-ai-motion` | `1e3c249073c61b42ceb556d7800f628d565d9312` | 2026-09-30 | MIT |
| Logo generator | `op7418/logo-generator-skill` | `bf4e9ac4d4428bda261afcfe981871ceb92d94e6` | 2026-04-16 | MIT (README) |
| Three.js game skills | `majidmanzarpour/threejs-game-skills` | `8286774b22a2566bf894dbc825825c16921866af` | 2026-09-27 | MIT |
| Gamedev agent skills | `gamedev-skills/awesome-gamedev-agent-skills` | `c6ca6c41c839b68319ffc08430b99ab768debc32` | 2026-11-12 | Apache-2.0 |

Logo build dependencies (not added to `package.json`): `opentype.js@2.0.0` (2026-05-06), `@fontsource/bungee@5.3.0`, `@fontsource/anton@5.3.0`, `@fontsource/bowlby-one@5.3.0` (all 2026-07-19).

The motion skill repository is an inference. The sandbox network blocks x.com, so I could not open the X post. A GitHub search for "637 techniques" gives 1 match: `gongnyang/awesome-ai-motion` ("637 motion techniques ... and an agent skill"). The owner must confirm that this is the tool from the post.

## What each tool did

### 1. Motion design skill (`gongnyang/awesome-ai-motion`)

- Contents: `SKILL.md`, `index.json` with 637 effect cards, 128 rendered clips, 11 recipes, and 7 routes. The `SKILL.md` text is in Korean and English. The parameter names in `index.json` are in Korean only.
- Test: I used the `jq` lookup from `SKILL.md`. The "Branding" row of the decision table gives `kinetic-type-sweep`, `giant-mask-reveal`, and `piece-assembly`. Recipe R10 "Title Opener" gives exact timings: mask reveal (yPercent 110 → 0, 1.05 s, line gap 0.35 s, power3.out), then char stagger (y 64 px → 0, 0.62 s, stagger 0.035 s), then underline draw (1.35 s).
- I used the R10 timings in CSS in the mock title screen (see below). The timings feel correct: the logo is in place at 1.35 s, and the menu is ready at 2.7 s.
- Not tested: `node scripts/render.mjs` (the MP4 and GIF renderer). The session's safety check stopped me from running a script from a downloaded repository. The repository has pre-rendered clips for each "done" effect, so the render is not necessary to choose a motion.
- Keys: none. Render needs Node 20+, ffmpeg, Playwright Chromium (all present here).
- Verdict: **keep** as a reference for #305 (callouts) and the intro. Read the cards and recipes. Copy timings, not files. The effects use GSAP; our code can use CSS or the Web Animations API with the same numbers.

### 2. `op7418/logo-generator-skill`

- Contents: `SKILL.md`, design pattern notes, a showcase HTML template, `scripts/svg_to_png.py` (needs `cairosvg`), and `scripts/generate_showcase.py` (needs `GEMINI_API_KEY`).
- The skill makes abstract geometric marks (dots, lines, nodes) in a `0 0 100 100` view box, 6 or more variants. It does not make wordmarks with letters, and #300 asks for a wordmark that reads at 32 px.
- Test: I used its rules (few shapes, negative space, scale check, SVG with grouped parts) for the 3 wordmarks. I made 3 options, not 6, because the owner asked for 3.
- Not run: `svg_to_png.py` (`cairosvg` is not installed; I used Playwright Chromium for the PNG files) and `generate_showcase.py` (no `GEMINI_API_KEY`).
- Keys: `GEMINI_API_KEY` for showcase images only. Not present.
- Verdict: **skip as a tool, keep the rules.** It is for icon marks, not lettering. A text logo needs real letter outlines, so I used OFL fonts and `opentype.js` (see #300 below).

### 3. `majidmanzarpour/threejs-game-skills` (`threejs-game-ui-designer`)

- Contents: 9 skills with a director skill. `threejs-game-ui-designer` is short (34 lines) and points to `references/ui-patterns.md`. That file has good, specific rules: HUD zones, primary action first, focus/hover/pressed/disabled states, safe-area insets, 44 px touch targets, fixed-width numbers, and a list of "web page defaults" to avoid (cream panels, pill buttons, monospace labels, numbered section labels).
- Test: I made 1 mock title screen with these rules: `prototypes/title-screen-mock/index.html`. It imports nothing from `src/`. The game does not load it. `?logo=a|b|c` picks a logo option.
- Evidence (Playwright 1.63.0 Chromium, 0 console errors, 0 failed requests):
  - `docs/research/2026-11-20-game-ui-tools/title-mock-desktop.jpg` (1280 x 720)
  - `docs/research/2026-11-20-game-ui-tools/title-mock-phone.jpg` (iPhone 13, 390 x 664)
  - `docs/research/2026-11-20-game-ui-tools/title-mock-desktop-0.9s.jpg` (logo rising at 0.9 s)
  - The keyboard focus is on "Play" when the screen opens. The menu ends 52 px above the bottom on desktop and 49 px on the phone.
- Keys: the sibling skills need `GEMINI_API_KEY` (images), `TRIPO_API_KEY` (3D), `ELEVENLABS_API_KEY` (audio). None is present. `threejs-game-ui-designer` itself needs no key.
- Scaffold conflict: **yes, if we use the scaffold.** The bundled scaffold (`threejs-gameplay-systems/assets/threejs-vite-game`) is Vite 8 + TypeScript 6 + three 0.184, with `tsc && vite build`. Our project is plain JavaScript modules, Vite 8.3.5, three 0.186.1, and no `tsconfig.json`. Do not use the scaffold or the director's "full game" path. The UI designer skill and its reference have no TypeScript; they work with our code as they are.
- Verdict: **keep `threejs-game-ui-designer` and `references/ui-patterns.md`.** Skip the director, the scaffold, and the 3 generator skills (each needs a key and overlaps with our Meshy pipeline).

### 4. `gamedev-skills/awesome-gamedev-agent-skills` (`game-ui-ux`)

- Contents: 79 skills and a router. `skills/disciplines/game-ui-ux/SKILL.md` (184 lines) is engine-neutral, but all code samples are Godot 4.7 or Unity 6.3.
- Useful rules for us: text at least 18 px at 1080p on PC; text contrast at least 4.5:1 (Xbox Accessibility Guidelines 101 and 102); one focused control on each screen; a screen stack for title → settings → confirm; HUD driven by events, not by polling.
- Test: I checked the mock against these rules. The tagline is 16 to 22 px (`clamp`), and the buttons are 20 to 24 px. The focus outline is a separate style from hover. Gamepad focus was not tested (the mock has no gamepad input).
- Keys: none.
- Verdict: **keep as a checklist** for the title, pause, and settings screens. Skip the code samples.

### 5. Paid tools (not tested)

| Tool | Key | Status |
|---|---|---|
| `HiAPIAI/hiapi-game-asset-studio-skill` | HiAPI key | Skipped: no key in this session. |
| `scenario-labs/skills` | Scenario key | Skipped: no key in this session. |

`manicinc/logomaker` and `movy` (free) were not in the scope of this session.

## Install

Issue #299 asks for the skills in the project `.claude/skills/`. I did not commit them, for 2 reasons:

1. Other cloud sessions work on this repository now. A committed skill loads into every session on its next start, and its instructions apply there too. That needs the owner's decision.
2. The useful parts are 3 short files. A link to the commit is enough for now.

Owner decision, 2026-11-21: defer the install. See `docs/decisions.md`, 2026-11-21.

To install later, at the tested commits:

```bash
git clone https://github.com/majidmanzarpour/threejs-game-skills /tmp/tgs && git -C /tmp/tgs checkout 8286774b22a2566bf894dbc825825c16921866af
mkdir -p .claude/skills && cp -r /tmp/tgs/skills/threejs-game-ui-designer .claude/skills/
```

```bash
git clone https://github.com/gamedev-skills/awesome-gamedev-agent-skills /tmp/gas && git -C /tmp/gas checkout c6ca6c41c839b68319ffc08430b99ab768debc32
cp -r /tmp/gas/skills/disciplines/game-ui-ux .claude/skills/
```

## #300 logo options

Files: `assets/brand/logo-options/`. Script: `scripts/brand/logo-options.mjs`. Each SVG and PNG has a `<file>.provenance.json`.

| Option | Font (SIL OFL 1.1) | Idea | 32 px |
|---|---|---|---|
| A. Peach Sticker | Bungee | Stacked SKATE / ATL on a die-cut sticker, tilted -6°, with a Georgia peach | "ATL" reads. "SKATE" is hard to read. |
| B. Trail Speed | Anton | One slanted line, 3 lane stripes, a trail swoosh (BeltLine) | Both words read. |
| C. Phoenix Wheel | Bowlby One | Round badge: a skate wheel, a rising phoenix ("Resurgens"), ATL large, SKATE on a ribbon | "ATL" reads. "SKATE" does not read. |

- All letters are vector outlines. The SVG files need no font.
- No generative model. Credits: 0.
- The options do not copy any game logo, team logo, or the city seal. There is no graffiti tag lettering.
- I changed 2 drawings after the first render, for the political rules: the first phoenix (5 fanned feathers) looked like a cannabis leaf, and a peach with a cleft can read as the peach emoji joke. Both are now redrawn.
- Preview: `assets/brand/logo-options/preview-sheet.png` (light and dark, with real 64 px and 32 px renders).
- 2026-11-21: the owner chose option B. Final logo: `assets/brand/logo/`. Key art: `assets/brand/key-art/`. See `docs/decisions.md` (2026-11-21).

## Keys needed (summary)

| Key | Used by | Present here |
|---|---|---|
| `GEMINI_API_KEY` | logo-generator showcase, `threejs-image-generator` | No |
| `TRIPO_API_KEY` | `threejs-3d-generator` | No |
| `ELEVENLABS_API_KEY` | `threejs-audio-generator` | No |
| HiAPI key | hiapi-game-asset-studio | No |
| Scenario key | scenario-labs | No |

No key is committed.
