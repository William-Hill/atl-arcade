# ATL Arcade

Atlanta games on real open data, in one Phaser shell. The first game is Skate ATL.

- Concept: `docs/games/2026-10-30-skate-atl-concept.md`
- Prototypes: `prototypes/` (throwaway code, never imported by production)
- Session state: `production/session-state/active.md`

## Run

```sh
npm install
npm run dev
```

Open the prototype at `/prototypes/beat-lock-concept/`.

## Rules

- Prototype code never imports production code, and production never imports prototypes.
- Use dependency versions published at least 7 days ago.
- Record decisions in `docs/decisions.md`.
