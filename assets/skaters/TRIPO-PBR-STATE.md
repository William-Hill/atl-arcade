# Tripo PBR regeneration — working state (2026-11-05)

## Current review status

The latest candidates are in `assets/skaters/<name>/raw/forward-v2/`.
Each GLB has 65 joints and two clips: `push` and `coast`.
The push uses an outward stroke, skate recovery, and weight transfer.
The coast keeps both skates on the floor.

Nia's arm span increased from 1.23 m to 1.51 m. Her height remains 1.70 m.
Her upper arms measure 0.26 m. Her forearms measure 0.23 m.
The mesh and skeleton use the same deformation.

The user judged the Tripo tests as good dances, but rejected them as forward motion.
Those tests cost 40 credits. The balance changed from 2795 to 2755.
The new forward motion uses Blender scripts and costs no credits.

Nia now has a larger arm stroke, variable elbow flex, and torso counter-rotation.
Her head keeps a forward gaze.

Marcus had a second rig defect: his right thigh twisted 113 degrees around its length.
The corrected hip and knee positions reduce that twist to 12.64 degrees.
The shorts weights now preserve the attachment seams and distribute the bend across the cloth.
The ankle weights distribute the bend through the boot cuffs and lower calves.
The soles and wheels remain rigid.

The forward checks pass for knee clearance, knee direction, support position, and loop continuity.
Maximum part separation growth is 0.00001 m for Nia and 0.00656 m for Marcus.
The minimum knee distances in `push` are 0.193 m and 0.298 m.
The largest foot steps are 1.80 degrees and 2.24 degrees at 30 fps.

Marcus's new deformation check fails on v1 and passes on v2.
It checks every frame of both clips. It measures edges at least 3 mm long.
The worst frame's 99th-percentile edge ratios changed as follows:

| Region | v1 | v2 |
| --- | ---: | ---: |
| Shorts | 2.80 | 1.20 |
| Left ankle | 1.91 | 1.18 |
| Right ankle | 2.36 | 1.19 |

The ratio is the posed edge length divided by its rest length.
The limit remains 1.25. This percentile limit does not cover every edge.
Isolated shorts edges still reach 1.56 times their rest length.
Both folders contain `.blend` sources, GLBs, front/side MP4s, frame sheets, and audit reports.

These files remain review candidates. They do not replace the game assets.
A full clip rebuild and runtime review remain open.
Marcus's fingers still follow each hand as one region.
The earlier `forward-v1` files remain available for comparison.

## Earlier motion candidates

The user also rejected Nia `review-v4` and Marcus `review-v6`.
Their knees collide or bend inward. Their shared motion is unacceptable.
These candidates supply repaired geometry, but their animation remains rejected.
The new knee audit fails on both exports.
See `docs/characters/skating-motion-research-2026-11-05.md`.

The user rejected the earlier videos. The completion claims below are historical
and incorrect. The `raw/*-animated.glb` files are rejected review assets.

The new checks measure deformation in the exported GLBs:

- Marcus's jacket had one influence: `Spine2`. Both shorts legs followed
  `RightUpLeg`. Failed automatic weights left these rigid assignments in place.
- Adjacent Marcus parts separated by up to 0.73055 m in the original review.
- The right foot turned about 52 degrees between adjacent `coast` frames.
  Quaternion targets remove the Euler discontinuity.
- Nia's jacket also failed the seam check. Shared boundary weights address this.
- Marcus's source contains split vertices at UV boundaries. Weld coincident
  vertices before mesh reduction. Keep the UV data on face corners.

The repair scripts write separate review directories. They do not replace the
game assets. Review approval and runtime verification remain open.

Sources for the repaired geometry:

| Character | Directory under `assets/skaters/` | Triangles | Joints | Clips |
| --- | --- | ---: | ---: | ---: |
| Nia | `nia/raw/review-v4/` | 23,472 | 65 | 24 |
| Marcus | `marcus/raw/review-v6/` | 39,074 | 65 | 24 |

Both directories contain rejected `coast` and `bail` MP4 videos, a contact sheet,
`rig-audit.json`, and `provenance.json`. Video names include the review version.

The audit sampled all 24 clips. Maximum separation growth fell from 0.73055 m
to 0.00571 m for Marcus, and from 0.13224 m to 0.00002 m for Nia.
Nia's largest right-foot step in `coast` fell from 51.79 to 5.01 degrees.

The weld before reduction removed the visible Marcus surface damage.
The separate texture-bake experiment in `review-v5` failed visual review.
Use `scripts/blender/SKATER-REPAIR.md` for rebuild commands and limits.
Marcus's fingers still follow the hand as one region.

Repo for deliverables: ~/Development/atl-arcade-epic (branch epic/city-look)
Deliverables: assets/skaters/<name>/raw/<name>-tripo-pbr.glb (not in git),
concept PNGs in docs/characters/concept/<name>/, provenance updates in
assets/skaters/<name>/provenance.json (same shape as existing).

## Step 1 done — concept images
- Chosen set: Codex imagegen (codex exec, built-in image_gen). Files:
  docs/characters/concept/<name>/<name>-pbr-{front,left,back}.png
- Alternates kept: <name>-autosprite-{front,left,back}.png (18 cr spent,
  ids in docs/characters/concept/<name>/provenance.json — already updated).
- Upload copies for Playwright sandbox: ~/Development/drawl/.playwright-mcp/uploads/

## Nia — task 72bfc452-df28-4e58-83bb-e89a35341a9a
- Image to 3D multiview: front+left+back (right empty), HD Model,
  H3.1 Best Quality, Generate in Parts ON (Balanced) -> ~18 parts,
  1,919,686 tris. Button showed 60. Saved in Segment workspace.
- Retopology: Quad, Smart Mesh P1.0 on, polygon count 9000 — DONE (40 cr).
- Texture: Generate Texture 20 cr, Remove Lighting ON, 4K — DONE.
- Remaining: PBR maps 5 cr (workspace/texture-pbr/<taskid>),
  rig Humanoid + Mixamo 20 cr, export GLB 4k + skeleton
  -> nia-tripo-pbr.glb. Checklist in handoff (fingers, face, 4 wheels/skate,
  no logos, even lighting, parts split).

## Marcus — not started
Same flow: multiview gen (~60), retopo 40, texture 20, pbr 5, rig 20.
Images: docs/characters/concept/marcus/marcus-pbr-{front,left,back}.png
Upload from ~/Development/drawl/.playwright-mcp/uploads/marcus-pbr-*.png

## Credits
- Balance start 2970. After Nia gen+retopo+texture: 2910.
  (60-credit gen charge has not visibly posted — verify at end.)
- Handoff budget ~115/char; actual running ~145/char (parts flow splits
  texture into its own 20-cr step + 5-cr PBR).

## Playwright notes
- MCP upload root restricted to ~/Development/drawl — copy files there first.
- browser_take_screenshot returns images; browser_evaluate returns small JSON.
- Multiview mode = 2nd icon (cube) in Generate Model panel: F/L/R/B slots.
- "Generate in Parts" routes to /workspace/segmentation/<taskid> after gen.
- GLB download: browser download dir likely ~/Downloads or .playwright-mcp/.

## Update — Nia export
- Rigged export on detail/rigging pages offers FBX ONLY (Blender preset,
  4k, Export Skeleton on). Exported as nia-tripo-pbr.zip to
  ~/Development/drawl/.playwright-mcp/ — unzipped to nia-tripo-pbr/
  (FBX + .fbm folder: 22 per-part base_color/normal/metallic maps). NOT yet
  copied to assets/skaters/nia/raw/.
- Balance 2885 after rig (20). Retopo-page Export dialog open now —
  checking whether it offers GLB for the unrigged parts model.
- Rig: Humanoid + Mixamo preset, skeleton visible, done.

## Update 2 — Nia export done, Marcus starting
- Rigged export in this UI = FBX only (Blender preset, 4k, skeleton on).
  Downloaded nia-tripo-pbr.zip -> unzipped at
  ~/Development/drawl/.playwright-mcp/nia-tripo-pbr/ (FBX + .fbm: 22 parts,
  base_color/normal/metallic maps). Copy to assets/skaters/nia/raw/ at end.
- GLB not offered anywhere on rigged export path — note deviation in
  provenance (user produces GLB in Blender anyway).
- Marcus: generate page open. Multiview = 2nd icon in upload row
  (cube icon; 3rd icon is batch "up to 10"). Upload front/left/back,
  Parts ON Balanced (toggle persists from Nia run), Generate ~60.
  Then: retopo Quad+SmartMesh+9000 (40) -> texture Remove Lighting+4K (20)
  -> PBR (5) -> rig Humanoid+Mixamo (20) -> Export FBX.

## Update 3 — Marcus uploaded
- Multiview icon trick that worked: click file input inside the slot's
  labeled container (label 'Front'/'Left'/'Back' → walk up 6 parents →
  input[type=file] → .click()) → browser_file_upload.
- Marcus front/left/back uploaded to slots (right stays empty).
- Decision: retopo at ~18k for both (user picked option B to test jaw/
  blink headroom; slider showed 500..10000 range — if input clamps,
  use 10000 and note it).
- MetaHuman note: EULA restricts assets to Unreal — can't ship converted
  MetaHumans in three.js; decals remain the plan, 18k is a jaw test.

## Marcus task id: 6ae6dfcf-85d3-4484-b13e-c7c074b84696
- Generate clicked 04:41Z -> routed to /workspace/segmentation/<id>.
- Settings: HD Model, H3.1, multiview F/L/B, Parts ON Balanced, 8K off, 60 cr.
- Next: wait for gen -> retopo (try 18000; clamp to 10000 if capped) ->
  texture Remove Lighting+4K (20) -> PBR (5) -> rig Mixamo (20) -> FBX export.
- Nia rigged FBX download: ~/Development/drawl/.playwright-mcp/nia-tripo-pbr/

## Update 4 — Marcus
- Gen done: 26 parts, saved. Balance 2825 (60 charged).
- Retopo: 18000 accepted in polygon field, Retopology 40 clicked ~04:44Z.
- Next on return: /workspace/texture|texture-pbr|rigging + generate/<id>
  for the same task id, then FBX export -> marcus-tripo-pbr.zip.

## Update 5 — Marcus texture running
- Texture: Remove Lighting on, 4K, Generate Texture 20 clicked ~04:45Z.
- Then: texture-pbr (5) -> rigging Mixamo (20) -> FBX export via
  /workspace/generate/<id> or rigging page -> marcus-tripo-pbr.zip.
- Cleanup after both: copy nia+marcus zips/dirs to assets/skaters/<name>/raw/,
  update assets/skaters/<name>/provenance.json, report ids+credits+tris.

## Update 6 — Marcus GLB + rig issue
- Detail/rigging Export gave marcus-tripo-pbr.glb (76 MB) at
  ~/Development/drawl/.playwright-mcp/ — 26 meshes, 78 images, 0 skins:
  UNRIGGED parts model at 4k. Keep as backup input for Blender re-rig.
- Rig charge never posted (balance 2800 before/after click). Verify rig
  state on /workspace/rigging/6ae6dfcf-85d3-4484-b13e-c7c074b84696;
  if "Auto Rig 20" shows again, rig did not run — click it, wait, then
  export rigged FBX (Blender preset, 4k, skeleton on).
- Nia: rigged FBX verified visually (skeleton drawn); zip at
  .playwright-mcp/nia-tripo-pbr.zip, unzipped to nia-tripo-pbr/.

## FINAL — 2026-11-05
- Nia DONE: rigged Mixamo FBX + per-part textures in raw/, provenance written.
- Marcus: unrigged 18k GLB (76MB) + marcus-tripo-parts.fbx (58.7MB for
  mixamo.com) in raw/, provenance written. Tripo rig failed = poly cap.
- Blender MCP confirmed live (localhost:9876, addon in running Blender);
  GLB->FBX done headless via scripts/blender/marcus_glb_to_fbx.py.
- Balance end: 2800 (from 2970). Recorded decisions in docs/decisions.md.
- User's next step: upload marcus-tripo-parts.fbx to mixamo.com, then
  skater_build.py for both (heights: Nia 1.70 m, Marcus 1.78 m).

## Update 7 — Marcus rigged via live Blender MCP socket (:9876)
- Method: imported nia rigged FBX armature (65 mixamorig bones), widened
  arm chain to Marcus proportions (wrist .40, elbow .26, foot .14),
  parented 26 parts + ARMATURE_AUTO (bone-heat warnings on some parts —
  needs weight cleanup pass or mixamo.com fallback).
- Outputs: assets/skaters/marcus/raw/marcus-blender-rigged.fbx +
  marcus-rig-work.blend (saved as copy, user's scene untouched).
- Pose test verified deformation via viewport screenshot.
- Caveat: execute_code through this socket double-applied twice — make
  rig code idempotent (absolute sets, not remaps).

## Update 8 — animation build
- scripts/blender/skater_build_parts.py created: parts-aware variant of
  skater_build.py (FBX/.blend input, joins parts to one mesh, same
  clip-keying + Draco export via nia_clips.py build_all()).
- Nia: running headless with nia-tripo-pbr FBX, height 1.70,
  out assets/skaters/nia/raw/nia-animated.glb.
- Marcus next: input raw/marcus-rig-work.blend (keeps MARCUS_RIG_WORK
  collection + armature), height 1.78.

## Update 9 — Marcus mesh was HD, not retopo
- marcus-animated.glb built = 1,954,933 tris: the generate-page GLB export
  ships original HD geometry, NOT the 18k retopo. Retopo'd version only
  exports from /workspace/retopology/<id>.
- Nia animated GLB is fine: 6.3MB, 1 mesh, 65 joints, 24 anims, 23,472 tris.
- Fix path for Marcus: export retopo'd model from retopology page ->
  re-parent parts to the fitted armature (saved in marcus-rig-work.blend)
  -> auto-weights -> rerun skater_build_parts.py.

## Update 10 — Marcus rebuild via Blender decimate
- Tripo exports always ship HD geometry (retopo result not downloadable
  from generate/retopology export dialogs; faces field just shows the
  10000 default). Plan: decimate the HD skinned mesh in Blender —
  --decimate flag added to skater_build_parts.py (collapse, keeps vgroups).
- Marcus rebuild: .blend input + --decimate 0.02 (~1.95M -> ~39k tris),
  height 1.78, out marcus-animated.glb (overwrites the 1.95M version).

## FINAL v2 — animated GLBs built
- nia-animated.glb: 6.2MB, 1 mesh, 65 joints, 24 clips, 23,472 tris
  (Tripo Mixamo rig path, Draco, JPEG textures q88)
- marcus-animated.glb: 7.3MB, 1 mesh, 66 joints, 24 clips, 39,098 tris
  (Blender-fitted mixamorig armature + auto-weights + 2% collapse decimate
  of the HD source; +1 extra joint vs Nia — likely a leaf bone)
- Both at assets/skaters/<name>/raw/<name>-animated.glb + -animated.blend
- NOT shipped: swap into skater.glb only after review. Remaining user
  steps: material masks, face decals, LODs, browser check.
- Marcus caveats: decimate (not quad retopo) topology; weight cleanup may
  be needed on some parts; feet slightly asymmetric (0.254/-0.192).

## Update 11 — Marcus weight failure found + rigid fix applied
- Animated GLB rendered T-pose: only 3,171/~20k verts had weights —
  bone-heat auto-weights failed on most of the 26 parts.
- Fix in marcus-rig-work.blend: all parts rigid-bound (100%) to nearest
  bone. Soft parts (part_0 torso 452k, part_1 shorts 262k, limb parts)
  still need smooth weights — trying per-part bone-heat on big parts next.
- Nia renders posed but skin/pants near-black — material/texture issue
  to check separately.

## Update 12 — Marcus deforms, quality caveats
- Hybrid weights worked: rigid accessories + per-part bone-heat on the 6
  big parts (all verts weighted). Rebuilt marcus-animated.glb (7.5MB,
  39k tris, 24 clips). Stills show real skating poses.
- Remaining artifacts: elbow gaps (rigid hand/forearm vs smooth skin),
  knee-pad separation on deep bends, texture speckle from decimate UVs.
- Fix options: weight cleanup in Blender (user step) or mixamo.com rig.
- Nia dark-skin material bug still open — renders posed but skin/joggers
  near-black; likely missing/dark base-color on those parts' materials.

## Update 13 — fix pass approved (user picked "fix both in Blender")
- Nia: check materials in nia-animated.blend — find why skin/jogger
  parts render near-black (missing/dark base color or bad node link);
  repair + re-export.
- Marcus: re-open marcus-rig-work.blend; bone-heat auto-weights on soft
  parts (hands/forearms/legs/shorts) to close elbow/knee gaps; keep
  rigid only for wheels/toe stops/knee pads/wristbands/skates.
  Then rebuild marcus-animated.glb + re-render stills.

## Update 14 — user rejected both stills/videos
- Nia: skin renders black (suspect hot metallic/rm map wiring), plus a
  foot-part spins in a clip (bad weights on one part). Fix: zero
  metallic on all mats, re-render, then inspect the foot part's vgroups.
- Marcus: rigid parts rig shows joint disconnects — rejected. Path:
  mixamo.com upload (marcus-tripo-parts.fbx staged) OR Tripo 9k re-retopo
  (+~85cr). Awaiting user decision.

## Update 15 — Nia skin still untextured in render
- Checked: 22 materials all have base_color img nodes LINKED to Principled
  (verified programmatically — no unlinked inputs, no missing file paths).
- Metallic zeroed (was darkening everything); specular set to 0.3.
- Remaining suspects: skin-part UVs broken, or a multiply/darkening node
  in those materials' chains. Needs interactive Blender inspection —
  user's lane. All sources staged in raw/.

## Update 16 — Nia UV bug found + fix applied
- Root cause of gray skin: joined mesh had 22 per-part UV layers
  (tripo_part_N_NewUVMap); materials sampled only the ACTIVE layer, so
  most parts sampled wrong UVs. fix_uv.py collapses them into one UVMap
  keyed by material_index -> part's own layer.
- Also applied: metallic=0 + specular 0.3 on all 22 materials.
- Verify: render nia-animated.blend again, then re-export GLB.
- Marcus rig fix pending: bone-heat on soft small parts (hands/forearms/
  pant legs); keep wheels/toe stops/knee pads/wristbands rigid.

## Update 17 — Nia still dark; UV merge may not have applied
- fix_uv.py printed no "polys copied" line — likely part_of() matched
  nothing (material names may differ from tripo_part_N_material), so the
  merge silently no-oped. Verify: uv_layers count still 22?
- Skin base_color JPEGs measure brown (lum .27-.36); textures exist and
  materials are linked. Remaining suspects: broken merge (above), vertex
  colors multiplying skin dark, or rm/metallic channel wiring.
- User wants continued debugging here; cloud session possible later.
- Marcus rig: joint seams from rigid binding remain open — plan is
  per-part bone-heat on soft parts, keep wheels/pads rigid.

## Update 18 — fixes applied
- Nia SOLVED: 22 per-part UV layers merged into one UVMap (fix_uv2.py,
  all 13305 polys copied via base-color-image part matching); metallic
  zeroed earlier. Verified: proper brown skin + outfit in render.
  Re-exported nia-animated.glb (6.26MB) — single TEXCOORD.
- Marcus: per-part bone-heat succeeded on all soft parts (multi-weight
  blending confirmed); toe stops/wheels/skates stay rigid. Rebuild +
  stills rendering in progress.
- Reproducible scripts in /tmp: fix_uv2.py, fix_marcus_soft.py,
  fix_nia_mat.py — copy to scripts/blender/ if kept.

## FINAL v3 — verified
- Nia: FIXED and verified — nia-animated.glb 6.26MB, correct skin/outfit
  in render, 23.5k tris, 65 joints, 24 clips, single UVMap.
- Marcus: improved — smooth bone-heat weights on all soft parts, rigid
  wheels/pads. marcus-animated.glb 7.49MB, 39k tris, 24 clips. Stills
  show clean deformation; residual artifacts: small wrist gap
  (air_japan), slight knee-pad separation (bail), jacket UV speckle
  from decimate (baked in, needs better source mesh to remove).
- Fix scripts to copy into scripts/blender/ if kept: /tmp/fix_uv2.py
  (UV merge), /tmp/fix_marcus_soft.py (per-part bone-heat),
  /tmp/fix_nia_mat.py (metallic=0), /tmp/reexport_nia.py.
