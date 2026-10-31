# Active session

- Concept: Skate ATL — beat-lock concept prototype
- Hypothesis: If the player pushes on the beat, speed and combo feedback feel locked to the music. True if the player holds a 16-beat combo within 2 minutes and input-to-beat offsets stay within ±60 ms after calibration.
- Riskiest assumption: the browser audio clock plus input timing give a satisfying beat lock on desktop and mobile Safari.
- Path: Engine (Phaser 4 in the browser; the browser is the target platform)
- Scope: one straight pseudo-3D road; synthesized 100 BPM beat on the Web Audio clock; push on beat (Space/tap); grind on rails (hold Down on beat); two dance moves (Left/Right on beat on flat); combo counter; calibration slider; offset histogram overlay.
- Cut: art, menus, forks, fact cards, leaderboard, medals, music files, mobile polish, architecture.
- Phase: Phase 6 — Playtest debrief (prototype runs; automated clock check passed: 32 aligned taps, mean 1.9 ms, sd 1.6 ms, 100% within ±60 ms; human feel not yet tested)
- Location: prototypes/beat-lock-concept/
