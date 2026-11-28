# Spike: building heights from the USGS 3DEP LiDAR

- Date: 2026-11-27
- Branch: `claude/lidar-heights-spike` (from `origin/main` 0cff15f9)
- Source research: `docs/research/2026-11-27-github-tools-gameplay-gis-characters.md`, GIS item 1
- Status: in the build (no flag). The spike first used a `?heights=lidar` flag, now removed

## Verdict: PROCEED, with a rule for trees and a date check

The LiDAR gives a measured height for 724 of the 1,042 buildings in the level. It finds real errors in the current heights. Two problems need rules: tree canopy over houses, and buildings from after 2018.

Evidence: `e2e/__screenshots__/lidar-ponce-before.png` and `lidar-ponce-after.png`, `lidar-windsor-before.png` and `lidar-windsor-after.png`.

## Data

- Sets: `GA_Statewide_B2_2018` and `GA_Statewide_B3_2018` (USGS 3DEP, public domain), EPT on AWS, EPSG:3857, z in meters.
- The level box meets 263 EPT nodes with 10,806,285 points, which is 57.7 MB of LAZ. The fetch took 25 s.
- Classes in the box: 2 ground, 6 building, 3 to 5 vegetation, 17 bridge deck.

## Method

1. `scripts/lidar-fetch.py` walks the EPT octree and downloads each node that meets the box to `raw/lidar/` (git-ignored).
2. `scripts/lidar-heights.py` measures each footprint. It takes about 4 s.
   - Roof points: class 6 points with **one return**, inside the footprint shrunk by 0.75 m.
   - Ground: the median class 2 z in a ring 1.5 m to 8 m outside the footprint.
   - Heights: p50, p90, and p99 of roof z minus ground.
3. The pick of one height (first `scripts/lidar-pick.mjs`, now `lidarHeight()` in `scripts/build-block.mjs`):
   - p90 if p90 − p50 ≤ 3 m, else p50.
   - Capped by the type cap of the build (`OVERTURE_CAP`: 12 m for a house).
   - At least 50 roof points and 30 m².
   - The 7 `heights.json` overrides and the 5 OSM `height` tags stay as they are.
4. The spike applied the heights with a `?heights=lidar` flag. The build now uses `raw/lidar-heights.json` directly, with the same rules in `lidarHeight()` and `buildingHeight()`.

## Results

| Current source | Buildings with a LiDAR height | Median (LiDAR − level), m | LiDAR > 3 m higher | LiDAR > 3 m lower |
|---|---|---|---|---|
| overture | 639 | −0.04 | 186 | 34 |
| overture-capped | 47 | −1.20 | 0 | 23 |
| default | 24 | 1.20 | 7 | 2 |
| levels | 14 | 2.35 | 4 | 1 |

- 480 buildings change by more than 1 m. 257 change by more than 3 m.
- Overture has no bias (median −0.04 m), but its error is large for single buildings.

### Named buildings

| Building | Level now | LiDAR (p50 / p90 / p99) | Note |
|---|---|---|---|
| 725 Ponce | 39.4 m (12 OSM levels × 3.2 + 1) | 56.05 / 60.96 / 62.89 | The level is too low. Office floors are taller than 3.2 m. The LiDAR value is used |
| Ponce City Market | 50 m (OSM `height`) | 35.04 / 42.67 / 61.87 | One box cannot show the main mass and the tower. The tag stays. Building parts are the real fix |
| Kroger at 725 Ponce | 7 m (override) | 11.13 / 11.23 / 14.32 | The override is probably too low. Not changed in this spike |
| Telephone Factory Lofts | 17.8 m (override) | 16.33 / 17.54 / 20.6 | Agrees |
| Ponce City Market shipping room | 7 m (override) | 7.4 / 7.6 / 7.72 | Agrees |
| Signal House | 68.2 m (override) | 22.83 / 22.88 / 26.69 | 2018 shows a building under construction or the one before it. The override stays |
| Overline Residences, FORTH Hotel, 619 Ponce | overrides | no roof points | Built after 2018. Correct: no LiDAR value |
| The Windsor | 14.45 m (Overture) | 21.87 / 22.23 / 23.32 | The level is too low |

## Problems found and their fixes

1. **Trees marked as building.** On many houses, class 6 had points 20 m to 38 m over the ground. On the 8 worst footprints, 23% to 76% of them had more than one return, which is the signature of canopy. Fix: keep single-return points only. This removed 746,803 points.
2. **Dense canopy can still give one return.** Two houses still read 25 m and 28 m. Fix: the type cap of the build (12 m for a house), the same rule as for Overture.
3. **Buildings from after 2018.** They have no roof points, or the points of a construction site (Signal House). Fix for now: the `heights.json` overrides win. A full fix needs a year built for each building, for example from the city permits or the county tax data.

## Not done or not verified

- Tests after the build change (2026-11-27): Vitest 2,613 of 2,613 pass. Playwright: `beltline.spec.js` and `landmarks.spec.js` pass. In `claim-targets.spec.js`, 3 of 6 tests time out (the toon desktop, toon phone, and pbr desktop rides). The toon desktop case times out the same way on the old heights (`origin/main` level), at a load average of about 20, so the LiDAR heights do not cause it. The cause is not found.

- The heights are not checked against a survey. Only the 5 named buildings with a public source were compared.
- No person compared the screenshots with photos of the real skyline.
- The building points from 2018 are not used for roof shapes.
- The 267 buildings with no height are not studied. 259 of them have no single-return class 6 points. Some are small sheds, some are under trees, and some are new.
- The FPS was not measured. The flag changes only the heights.
- The PDAL tool was not used. It is not installed. laspy with lazrs reads the EPT LAZ nodes directly, with no native install.

## Next steps

1. Done on 2026-11-27, on this branch: LiDAR is a height source in the build (`buildingHeight()` in `scripts/build-block.mjs`), and the `?heights=lidar` flag is removed. See `docs/decisions.md`, "Building heights from the USGS 3DEP LiDAR".
2. Re-bake the isometric full map (`scripts/bake-iso-map.mjs`), which still shows the old heights.
4. Review the Kroger override (7 m against 11.2 m measured).
5. Get a year built for each building, to find the other buildings from after 2018.
6. Use the roof points for Ponce City Market building parts: the main mass at about 36 m to 43 m, and the tower at about 62 m.

## Rebuild

1. Install the Python tools:

   ```bash
   pip install laspy==2.7.0 lazrs==0.8.2 pyproj==3.8.0 shapely==2.2.0 numpy==2.5.5
   ```

2. Download the points:

   ```bash
   python3 -I scripts/lidar-fetch.py levels/beltline-eastside/
   ```

3. Measure the heights:

   ```bash
   python3 -I scripts/lidar-heights.py levels/beltline-eastside/
   ```

4. Write the building source file, then the level:

   ```bash
   node scripts/building-sources.mjs levels/beltline-eastside/
   ```

   ```bash
   node scripts/build-block.mjs --bbox 33.7560,-84.3685,33.7735,-84.3580 --out levels/beltline-eastside --name beltline-eastside --title "BeltLine Eastside Trail: Ponce City Market to Krog Street Market" --offline
   ```
