# The face decal on the toon skater

Playwright headless Chromium (SwiftShader), 1280x720, `/?skater=nia&mute=1&view=fixed`.
The fixed camera is 0.55 m in front of the face. The test holds each face state and stops the idle clip.
`e2e/skater-face.spec.js` ("in the game the toon skater keeps the face decal") writes the `game-*.png` files.

- `before-fix-closed-smile.png`: the toon material before the fix, with the face held at closed eyes and a smile. The painted open eyes show, so the decal is gone.
- `game-open-neutral.png`, `game-closed-smile.png`, `game-happy-open.png`: the fix. Each face state changes the eyes and the mouth.
- `compare-head.png`: the head area (400x400) of the before image, then closed-smile and happy-open after the fix.
