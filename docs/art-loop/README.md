# The art loop

Agents raise the art quality of Skate ATL in rounds. One round has four steps:

1. **Capture.** The asset lab renders one building in the real game at six fixed views.
2. **Judge.** A judge agent scores the captures with the rubric in `judge.md` and writes a report.
3. **Direct.** A director agent reads the report and the code, and writes a ranked change list (`director.md`).
4. **Build.** An engineer agent makes the top changes, with tests. Then the next round starts at step 1.

The idea comes from gen-city-auto by Gregg Tavares (MIT license, https://github.com/greggman/gen-city-auto, `agents/`). We changed it for Three.js, for Atlanta, and for the political rules in `AGENTS.md`.

## Capture

Run the lab for one building style. `LAB_PICK` 0 is the most typical building of that style, at least 150 m inside the level.

```bash
LAB_KIND=brick-loft LAB_PICK=0 LAB_LOOK=pbr npx playwright test e2e/lab.spec.js
```

The PNGs go to `reports/lab/<kind>-<pick>-<look>/`. The views are `facade` (8 m), `street` (25 m), `corner` (35 m), `mid` (70 m), `far` (250 m), and `aerial`. `info.json` has the building ID and the URL of each view, so a person can open the same camera in a browser.

The style IDs are in `src/level/geo/styles.js`. The lab code is `src/level/geo/lab.js`.

## Reports

Save each judge report as `docs/art-loop/reports/<kind>-r<round>-judge.md`. Save each director report as `docs/art-loop/reports/<kind>-r<round>-direction.md`. Keep every round, so the score history stays visible.

## Limits of the lab now

- The lab has one time of day: the day sky. There is no golden hour, night, or rain yet.
- The lab shows the building in its street, with the neighbors and the trees. It cannot isolate the building.
- The headless capture uses SwiftShader, a software GPU. It is slow (about 20 s for each view), but the image is the same as on a real GPU.
