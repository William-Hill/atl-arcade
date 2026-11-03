# Skater pipelines compared (M1-10, #42)

Status: 2026-11-02. This compares two pipelines that make a playable skater from one concept image. Marcus "Tempo" Reid, the second skater, came from pipeline A.

- **Pipeline A:** Tripo Studio (image to 3D, retopology, Mixamo auto rig), then Blender cleanup and the M1-02 clips in a script, then a Draco GLB. Nia came from this pipeline in M1-01.
- **Pipeline B:** img2character, the `img2threejs/plugin-character` plugin for the img2 harness (`img2 add img2threejs/plugin-character`).

## Result

| | Pipeline A (Tripo) | Pipeline B (img2character) |
|---|---|---|
| Output | A textured, skinned GLB (17,006 triangles, 2,071,416 bytes) | A code-only, procedural Three.js model. The rig emitter writes a TypeScript module. No GLB. |
| Time for Marcus | About 5 minutes in Tripo Studio, and 6.7 s for the Blender build (`scripts/blender/skater_build.py`) | Not run. See the reason below. |
| Cost | 115 Tripo credits (55 model, 40 retopology, 20 rig), and 6 Autosprite credits for the concept art | Free (Apache-2.0). It runs on the agent host. |
| Rig | Mixamo skeleton, 65 `mixamorig:` joints, one skin. The five views and 24 contact sheets show no broken skin. | The rig emitter is "milestone 0": it skins a synthetic capsule that it builds from the bone chain, not the reconstructed mesh (`tools/rig_emit_rig.py`). |
| Clip retargeting to M1-02 | Yes, with no change to the clips. `nia_clips.py` keys the clips by Mixamo bone name, so the same script drives the Marcus rig. Only the rest foot positions changed. | No. The plugin docs list "retargeting between skeletons" under "What this pipeline does not solve" (`reference/animation-contract.md`). Its joint matcher is "positional, never by name", so it cannot use the Mixamo names. |
| T-pose gate (scripted sessions) | Pass: 272 samples, worst IoU 0.521 (limit 0.8) | Not run |

## Why pipeline B was not run

The task said to try pipeline B first, and to record the reason if it cannot rig or retarget to the M1-02 clip set. The evidence comes from the plugin source on its default branch, commit `377ddf8` (2026-10-10). The npm installer pins tag `v0.2.0`, commit `796dd9c`. The source was cloned and read. It was not installed and not run.

1. The M1-02 clips are keyed on a Mixamo rig by bone name. The plugin cannot retarget between skeletons. Its own contract says so.
2. The plugin does not make a mesh. It reads the skeleton of a GLB that already has a skin, or it builds a procedural skeleton for the img2threejs code-only model. To get a skinned GLB, pipeline B needs the output of pipeline A first.
3. The game loads a Draco GLB with `GLTFLoader` (`src/render/skater-model.js`). A TypeScript rig module is a different asset format, and it would need a second loader path.
4. The plugin reports 4 of its 12 rig checks as `error` on a real run today, because "four of the twelve checks have no input producer yet" (plugin README).
5. The installer writes `~/.img2`, links a launcher into `PATH`, and links the plugin into the agent hosts. The user chose not to install it, because of points 1 to 4.

The package version passed the 7-day rule: `@img2threejs/character` 0.2.0 was published on 2026-10-10, and `@img2threejs/img2` 0.4.0 on 2026-10-07.

## Tripo Agentic Canvas

The user asked to use Tripo Agentic Canvas (announced 2026-10-29) for pipeline A. The account did not have it: the top-left menu showed only the 3D Workspace tools, and `studio.tripo3d.ai/canvas` went back to the home page. The Tripo post says that the beta is for Max and Team users first, and rolls out to all accounts gradually. Marcus was made in the 3D Workspace with the same settings as Nia. Agentic Canvas has the same steps as nodes (Upload, HD Model, Smart Mesh, rig, export), so it can replace the manual clicks for skater 3 when the account gets it.

## Recommendation

Use pipeline A for the next skaters. The clip script and `skater_build.py` make the work after Tripo one command. Look at pipeline B again if the plugin adds cross-rig retargeting and a GLB output.

## Not verified

- Real Atlanta skaters did not review the Marcus look or the move set. That review is a release rule.
- Pipeline B was not measured. The table gives what its source and docs say.
