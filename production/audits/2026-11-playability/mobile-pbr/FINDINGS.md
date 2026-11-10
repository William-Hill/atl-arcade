# Mobile playability audit, re-run on the city look

**Date:** 2026-11-10. **Build:** `epic/city-look` at `9aa4105`. The touch fix of this branch is in the "after" touch run only. **Auditor:** an agent. No real phone was used. **Method:** the same as #65 (`../mobile/FINDINGS.md`, `../mobile/scripts/`), with four profiles and two looks. The scripts are in `scripts/`. The data is in `measurements.json`, `load.json`, `touch.json` (after the fix) and `touch-before-fix.json` (before the fix).

## Score

**Mobile playability: 3 / 5** (it was 1 / 5 in #65). A touch player can push, steer, brake, jump, grind, dance, turn the camera, and ride into the edge fence. The edge hint shows. Before this branch, a touch player could not skate backward (switch). Two P1 items stay: the photo and settings buttons cover the skater buttons in portrait (#245), and the pbr look is very slow on the phone tier (#246).

## What the audit used

| Profile | Playwright descriptor | Viewport (CSS px) | DPR | Canvas px (phone tier, pixel ratio 1.5) |
|---|---|---|---|---|
| iPhone 15 portrait | `iPhone 15` | 393 x 659 | 3 | 589 x 988 |
| iPhone 15 landscape | `iPhone 15 landscape` | 734 x 343 | 3 | 1101 x 514 |
| Pixel 7 | `Pixel 7` | 412 x 839 | 2.625 | 618 x 1258 |
| Small phone | `Galaxy S5` | 360 x 640 | 3 | 540 x 960 |

- **Tier.** The phone tier, forced with `?quality=phone`. This computer has no GPU, and SwiftShader alone gets the low tier. A real phone gets the phone tier from `qualityFor()` (`src/render/quality.js`).
- **Looks.** `?look=toon` (the phone default) and `?look=pbr` (a choice in the settings menu).
- **GPU.** SwiftShader only (a software GPU on the CPU), on a 4-core cloud machine. **The frame times are NOT phone GPU numbers.** Use them only to compare the runs with each other. The #65 audit also had an Apple M4 Max GPU; this audit did not.
- **Engine.** Chromium. WebKit is not installed, so the iPhone profiles use the iPhone viewport, DPR, touch and user agent in Blink.
- **Touch.** Real touches through CDP `Input.dispatchTouchEvent` (pointerType "touch").
- **Governor.** Off (`?governor=0`) for the measurements, so each run keeps one tier.
- **Draw calls.** `scripts/common.mjs` counts every WebGL draw call in all passes (the main pass, the post passes, a multi-draw counts each sub-draw). `renderer.info` resets on each pass, so the column "last pass" is the main pass count of three.js. These counts are not the same method as #65; compare the looks, not the audits.

## Measurements

### Frame, draws, triangles (`measurements.json`)

The skater pushes with the touch stick for 9 s on BeltLine Eastside. CPU throttle 1x. Load average 1.7 to 4.0 (only this audit ran).

| Profile | Look | Median frame ms | Median FPS | p95 frame ms | Draw calls (all passes) | Triangles | Draw calls (last pass) | JS heap MB | Ready ms |
|---|---|---|---|---|---|---|---|---|---|
| iPhone 15 portrait | toon | 150 | 6.7 | 183 | 142 | 247,634 | 69 | 54.6 | 9,781 |
| iPhone 15 portrait | pbr | 1,333 | 0.8 | 2,317 | 206 | 311,468 | 88 | 49.3 | 12,512 |
| iPhone 15 landscape | toon | 150 | 6.7 | 200 | 222 | 283,433 | 85 | 63.0 | 11,708 |
| iPhone 15 landscape | pbr | 850 | 1.2 | 1,717 | 255 | 382,992 | 102 | 67.6 | 12,785 |
| Pixel 7 | toon | 167 | 6.0 | 200 | 138 | 249,287 | 69 | 56.8 | 10,937 |
| Pixel 7 | pbr | 1,583 | 0.6 | 2,483 | 198 | 308,762 | 86 | 59.0 | 11,245 |
| Small phone | toon | 150 | 6.7 | 183 | 127 | 241,692 | 64 | 66.5 | 10,826 |
| Small phone | pbr | 1,083 | 0.9 | 2,067 | 210 | 352,982 | 84 | 45.5 | 11,483 |

On the phone tier, the pbr look has 6 to 9 times the frame time of toon in SwiftShader, 15 to 65 % more draw calls, and 25 to 46 % more triangles. Landscape draws the most, because the wide view shows more of the city.

### First load (`load.json`)

`vite preview` of `dist/`, empty cache, 9 Mbps down, 1.5 Mbps up, 60 ms RTT, CPU 4x, phone tier.

| Profile | Look | Requests | Transfer | Before first frame | First contentful paint | First game frame | Load screen gone | Last network activity |
|---|---|---|---|---|---|---|---|---|
| Pixel 7 | toon | 134 | 7.48 MB | 16 req, 5.41 MB | 244 ms | 12,968 ms | 14,139 ms | 22,956 ms |
| Pixel 7 | pbr | 213 | 15.77 MB | 20 req, 5.58 MB | 220 ms | 16,218 ms | 17,423 ms | 34,148 ms |
| Small phone | toon | 134 | 7.48 MB | 16 req, 5.41 MB | 232 ms | 13,328 ms | 14,222 ms | 23,486 ms |

The first game frame is later than in #65 (6.6 s), but the two runs are not the same: here SwiftShader draws on the throttled CPU, and #65 used a real GPU. Do not read it as a regression without a run on a GPU.

The biggest files before the first frame:

1. `rapier_wasm3d_bg-*.wasm`: 3,010 kB. It is now a separate file (#74). `vite preview` sends it with no compression. With gzip it is 1,141 kB, so a host that compresses `application/wasm` saves 1.8 MB.
2. `skater-1024-*.glb`: 1,764 kB (the phone skater, 1024 textures).
3. `main-*.js`: 263 kB (gzip).
4. `level-*.js`: 150 kB (gzip).

A load screen with progress now shows from the first paint.

## Touch play (`touch.json`, after the fix)

Each profile and look: a tap starts the beat, then push, GROOVE, SPIN, steer left and right, JUMP, brake, SWITCH (twice), a drag on the open screen, and a ride into the east edge fence. Grind is on the greybox straight rail. The walkers, the NPC skaters and the moving cars are off (as in `e2e/edge-fence.spec.js`).

| Profile | Look | Tap starts beat | Push | Steer L / R | Brake | JUMP | Grind (greybox) | GROOVE | SPIN | SWITCH (on / off) | Camera drag | Fence stop | Edge hint | Page errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iPhone 15 portrait | toon | yes | yes | yes / yes | yes | yes | yes | yes | yes | yes / yes | 6.3 m | yes at x 482.02 (fence 482.31) | yes | 0 |
| iPhone 15 portrait | pbr | yes | yes | yes / yes | yes | yes | yes | yes | yes | yes / yes | 12.6 m | yes at x 482.02 (fence 482.31) | yes | 0 |
| iPhone 15 landscape | toon | yes | yes | yes / yes | yes | yes | yes | yes | yes | yes / yes | 13.5 m | yes at x 482.02 (fence 482.31) | yes | 0 |
| iPhone 15 landscape | pbr | yes | yes | yes / yes | yes | no | yes | yes | yes | yes / yes | 12.69 m | yes at x 482.02 (fence 482.31) | yes | 0 |
| Pixel 7 | toon | yes | yes | yes / yes | yes | yes | yes | yes | yes | yes / yes | 8.71 m | yes at x 482.02 (fence 482.31) | yes | 0 |
| Pixel 7 | pbr | yes | yes | yes / yes | yes | no | yes | no | yes | no / no | 8.64 m | yes at x 482.02 (fence 482.31) | yes | 0 |
| Small phone | toon | yes | yes | yes / yes | yes | yes | yes | yes | yes | yes / yes | 7.39 m | yes at x 482.02 (fence 482.31) | yes | 0 |
| Small phone | pbr | yes | yes | yes / yes | yes | no | yes | yes | yes | yes / yes | 8.41 m | yes at x 482.02 (fence 482.31) | yes | 0 |

"no" in a pbr row: at about 1 FPS in SwiftShader, the action did not show in the time limit of the script. The same action works in toon on the same profile.

### What a touch player cannot do that a keyboard player can

| Action | Keyboard | Touch before this branch | Touch now |
|---|---|---|---|
| Switch (ride backward) | R | No control: `switch` was always false in `mapTouch()` | SWITCH button |
| A tap shorter than one frame | Lost (the keyboard is the same) | Lost | Kept for one input sample (`createButtonState()`) |
| Camera look | Mouse drag, right stick | A drag on the open screen | Same. With both thumbs on the stick and a button, no thumb is free to look. |
| Photo mode camera fly | WASD, E, Q, Shift | Drag to look only. No fly, no up or down. | Same (P2, MOB2-7) |
| Minimap north or heading | N | N button, 31 x 30 px | Same (P2, MOB2-6) |
| Full map | M, arrows, C, V, T, + and - | Map button, drag, pinch, on-screen buttons | Same |
| Debug colliders | H | None | Same (a developer tool, not needed) |

## HUD at each size (`touch.json`: `layoutStart`, `layoutAtFence`, `layoutFullHud`)

"Full HUD" is the longest HUD a player sees: a combo, the pending score, a move tag, the balance meter, the run timer, and the edge hint, all at the same time.

| Profile | Overlaps at the start | Overlaps at the fence | Overlaps with the full HUD |
|---|---|---|---|
| iPhone 15 portrait | hint x PHOTO, skater select x PHOTO, skater select x SETTINGS | pulse x PHOTO, skater select x PHOTO and SETTINGS | combo x PHOTO, pulse x PHOTO, skater select x PHOTO and SETTINGS |
| iPhone 15 landscape | none | pulse x PHOTO | STYLE meter x stick base, BALANCE meter x stick base, pulse x PHOTO |
| Pixel 7 | as iPhone 15 portrait | as iPhone 15 portrait | as iPhone 15 portrait |
| Small phone | as iPhone 15 portrait | pulse x skater select, pulse x PHOTO, skater select x PHOTO and SETTINGS | as at the fence, and combo x PHOTO |

- The edge fence hint does not overlap another item at any size. On the small phone it takes 3 lines, and the HUD column then fills the left side from the top to 430 of 640 px (`touch-small-360x640-toon-fullhud.jpg`).
- No item is off the screen.
- The SWITCH button of this branch overlaps no item at any size.
- **Text size.** Under 14 px: the map credit (12 px), the skater names and styles (12 to 13 px), GRIND (13 px), GROOVE (11 px), SPIN (12 px), SWITCH (10 px; it fits its 56 px circle), PHOTO (13 px), SETTINGS (13 px).
- **Contrast** (the text on its own pill, on a white and on a black scene). Under 4.5:1: the touch button labels (3.93:1 on a white scene; the labels have a text shadow), and the "Nia" name (2.69:1, pink on a pill with alpha). All HUD texts are 4.5:1 or more.
- **Small targets.** The minimap buttons are 30 to 31 px (N, hide, full map). The PHOTO button is 98 x 36 px. WCAG 2.5.8 (AA) asks for 24 px; the project rule is 44 px.

## Findings

### The #65 items

| Id | #65 sev | Status | Evidence now |
|---|---|---|---|
| MOB-1 | P0 | **Fixed** (#71). Push, steer, brake, jump, grind, both dances and the camera work on touch. Switch was missing; this branch adds it. | `touch.json`, `touch-*-fence.jpg`, `touch-*-grind.jpg` |
| MOB-2 | P0 | **Fixed** for toon (the phone tier, #72, and the governor). **Open** for pbr: see MOB2-2. | `measurements.json` |
| MOB-3 | P1 | **Fixed.** The hint is "Tap to start the beat". The keyboard help is hidden. Small regression: PHOTO and SETTINGS show the key letters P and O (MOB2-1). | `touch-*-start.jpg` |
| MOB-4 | P1 | **Fixed.** The credit is one short line in the top left corner. A tap shows the full text. In the run before the fix, the beat pulse touched the credit at the fence on Pixel 7 and the small phone in pbr (P2; the pulse moves with the beat). | `touch-before-fix.json`, `touch-small-360x640-toon-start.jpg` |
| MOB-5 | P1 | **Partly fixed** (#74 is open). A load screen shows. The Rapier WASM is a separate file. The phone skater GLB is 1,764 kB. The first game frame is under 4 s only on a real GPU (not measured here). | `load.json`, `load-settled-*.jpg` |
| MOB-6 | P1 | **Moved, P2.** The pulse is not under the Marcus button now. It is under the PHOTO button on every profile, and under the skater select on the small phone. | `touch.json` |
| MOB-7 | P2 | **Fixed.** `viewport-fit=cover` and safe-area insets. | `index.html`, `src/shell.css` |
| MOB-8 | P2 | **Fixed.** `body.touch` has `overscroll-behavior: none` and `user-select: none`. | `src/shell.css` |
| MOB-9 | P2 | **Open** (#97). No fullscreen button. | `touch.json` (`reducedMotion.fullscreenButton: false`) |
| MOB-10 | P2 | **Fixed** for the HUD (pills, 14 px or more, 4.5:1 or more). **Open** for the touch buttons, the skater select and the map credit (see above). | `touch.json` |
| MOB-11 | P2 | **Partly fixed** (#97). The effects and the camera shake read `prefers-reduced-motion`. There is no option in the game. | `src/render/effects/fx.js`, `src/render/effects/feel.js` |
| MOB-12 | P2 | **Open** (#97). The style-ready cue is a color change only. | `src/shell.css` (`.hud-style[data-ready="1"]`) |
| MOB-13 | P2 | **Open** (#97). A skater change reloads the page. | `src/ui/skater-select.js` |

### New findings

| Id | Sev | Finding | Evidence | Fix | Issue |
|---|---|---|---|---|---|
| MOB2-1 | P1 | In portrait, the PHOTO and SETTINGS buttons cover the Nia and Marcus buttons. A tap on the covered part opens photo mode or the settings menu. The texts are on top of each other. The pulse dot is under PHOTO (P2). The buttons show the key letters P and O. | `touch.json` (`layoutStart.overlaps`), `touch-small-360x640-toon-fullhud.jpg`, `touch-Pixel7-port-toon-start.jpg` | Give the top bar one row with no overlap at 360 to 412 px wide. Hide the key letters on touch. | #245 |
| MOB2-2 | P1 | The pbr look on the phone tier: 6 to 9 times the frame time of toon (SwiftShader), up to 65 % more draw calls, 15.77 MB against 7.48 MB of download. A phone player can select it in the settings menu. | `measurements.json`, `load.json`, `measure-*-pbr.jpg` | Hide pbr on phones, or make a pbr lite with a budget measured on a real phone | #246 |
| MOB2-3 | P1 | A touch player could not skate backward: `switch` was always false in `mapTouch()`, and the overlay had no button. | `touch-before-fix.json` (`switch: "no control"`) | SWITCH button in `src/input/touch.js` and `src/input/touch-map.js` | **Fixed in this branch** |
| MOB2-4 | P2 | A button tap that starts and ends between two input samples is lost. At 6 FPS in SwiftShader, a 120 ms tap can fall inside one frame. A slow phone with the governor at its last step has the same risk. | `touch-before-fix.log`, `createButtonState()` tests | Keep a press until the next sample | **Fixed in this branch** |
| MOB2-5 | P2 | In landscape (343 px high), the STYLE and BALANCE meters and the edge hint are over the rest place of the stick base. The stick floats to the thumb, so it still works, but the thumb covers the meters. `e2e/phone-layout.spec.js` "landscape › no item overlaps" fails on `balance x stick` on the base branch and on this branch. | `touch-iPhone15-land-*-fullhud.jpg` | Move the stick rest place lower, or the meters higher, in short landscape | — |
| MOB2-6 | P2 | Text under 14 px and contrast under 4.5:1 on the touch buttons (3.93:1), the skater select (2.69:1 for "Nia") and the credit. Minimap buttons are 30 px. | `touch.json` (`under14px`, `under45`, `smallTargets`) | A darker button fill (alpha 0.7), 14 px labels, 44 px minimap buttons | — |
| MOB2-7 | P2 | Photo mode on touch: a drag turns the camera, but the camera cannot fly (WASD, E, Q are keyboard only). | `src/ui/photo-panel.js` | Use the touch stick to fly in photo mode | — |
| MOB2-8 | P2 | `vite preview` sends the 3 MB Rapier WASM with no compression. Gzip makes it 1.1 MB. The deploy (#23) must compress `application/wasm`. | `load.json` | A host rule for WASM compression | — |
| MOB2-9 | P2 | On the small phone, the full HUD with the 3-line edge hint fills the left side to 430 of 640 px. | `touch-small-360x640-toon-fullhud.jpg` | A shorter edge hint on a compact screen | — |

## The touch fix in this branch

- `src/input/touch-map.js`: `TOUCH_BUTTONS` has `switch`. `mapTouch()` passes `buttons.switch` through. `createButtonState()` keeps the held state per pointer and keeps a press for one sample after a short tap.
- `src/input/touch.js`: a fifth button, SWITCH (56 px), with the aria label "Switch: ride backward or forward". The buttons use `createButtonState()`.
- `src/shell.css`: the top row of the thumb arc is SWITCH (56 px), GROOVE (64 px) and SPIN (62 px). It ends 162 px above the pad bottom (under the landscape minimap, which ends 184 px above). SWITCH ends 190 px from the pad right edge, and the stick base rest place moves 8 px to the left, so SWITCH stays clear of the stick base on a 360 px screen. Each label has 4.7 px or more of space to the inner edge of its circle (`buttons-*.png`). The first layout of this branch had SWITCH at 50 px and GROOVE at 56 px; the labels touched the circle edge, so the sizes changed. The "after" touch run (`touch.json`, `touch-*.jpg`) used that first layout; the e2e tests below ran on the final layout.
- Tests: `src/input/touch-map.test.js` (SWITCH, the button list, the tap latch). `e2e/touch.spec.js` (SWITCH on iPhone 15 and Pixel 7, its size, no overlap with the stick base, and every label inside its circle with 4 px to spare). SWITCH is in the overlap lists of `e2e/phone-layout.spec.js`, `e2e/minimap.spec.js`, `e2e/settings.spec.js` and `e2e/photo-mode.spec.js`.

## A limit of the harness

CDP `Input.dispatchTouchEvent` does not send `pointerup` for one finger while another finger stays down: the `pointerup` comes when the last finger lifts. In the "before" touch run, this held GROOVE down after its tap, so the dance repeated and the JUMP and SPIN checks failed. That was the harness, not the game. The "after" run and the new e2e test press each button as the only finger down. A real phone sends `pointerup` for each finger.

## Verified

- Touch play (push, steer, brake, jump, grind, GROOVE, SPIN, SWITCH, camera drag, the east edge fence and its hint) on four profiles and two looks, in Chromium.
- The draw calls, the triangles and the relative frame time of both looks on the phone tier.
- The load size, the request count and the load times on the emulated network.
- The HUD layout, the overlaps, the text size and the contrast at four sizes.

## Not verified

- Any frame time on a real phone GPU. SwiftShader numbers compare runs only.
- iOS Safari (WebKit is not installed).
- Two fingers that lift one at a time (the CDP limit above). A real phone test must check a button tap while the stick is held.
- Heat, battery and GPU memory.
- Real skaters did not review the SWITCH button place.
