# GVHMR video mocap test: blocked (no GPU)

Date: 2026-11-21. Branch: `claude/wizardly-mayer-binhnd` from `main`.

## Result

- **Blocked.** This cloud session has no CUDA GPU and no Blender. GVHMR needs a CUDA GPU with approximately 8 GB of memory. Thus no clip was made, no clip was retargeted to Nia, and no comparison images were made.
- No money was spent. No GPU was rented.
- No asset changed. The clip table in `scripts/blender/nia_clips.py` did not change. `assets/skaters/nia/mocap-test/` does not exist.
- The license check (step 3) is complete. See "Licenses" below. **The pipeline cannot be used for a shipped clip.** GVHMR and SMPL-X are for non-commercial research only.

## Environment check (step 2)

| Check | Result |
|---|---|
| `nvidia-smi` | `command not found`. No NVIDIA driver, no `/usr/local/cuda*`. |
| GPU | None. CPU: 4 cores. Memory: 15 GB. |
| `blender` | Not installed. `download.blender.org` is reachable, so Blender 5.1 can be installed for a CPU-only retarget step. |
| `huggingface.co` (GVHMR checkpoints) | Blocked by the network policy (proxy `403`). |
| `smpl-x.is.tue.mpg.de` (SMPL-X body model) | Blocked by the network policy (proxy `403`). |
| `commons.wikimedia.org` (test video) | Blocked by the network policy (proxy `403`). |

Thus a GPU is not the only blocker for this environment. The checkpoints, the body model, and the test video are also out of reach.

## Licenses (step 3)

Commits read: `squall01337/mixamo-llm-mocap` at `da5e7cc48557f0272832429a8df3fbf2b3c1273d`, `zju3dv/GVHMR` at `ee960bb6e2ea2d381aa97f08e9b71ef320b624b1` (the `HEAD` of each on 2026-11-21). The commit dates were not available from this session. Before a real run, use a commit that is 7 days old or older.

| Part | License | Commercial use |
|---|---|---|
| `mixamo-llm-mocap` code | MIT (the `LICENSE` file). | Yes. |
| `mixamo-llm-mocap` clips and plates in its repo | MIT (the `LICENSE` file). | Yes. We do not use them. |
| GVHMR code (`zju3dv/GVHMR`) | Custom: "educational, research and non-profit purposes only". Modifications must be open source and "prohibited for commercial use". | **No.** Commercial use needs written permission from the authors (contact in the `LICENSE` file). |
| GVHMR checkpoint `gvhmr_siga24_release.ckpt` | No separate license. The pipeline README says "Its pretrained checkpoints carry their own terms". Treat it as the GVHMR license. The install guide gets it from `huggingface.co/camenduru/GVHMR`, an unofficial mirror. | **No.** |
| SMPL-X body model (`SMPLX_NEUTRAL.npz`) | MPI license, registration required. Non-commercial scientific research only. A commercial license is sold separately (Meshcapade). Not read again in this session (site blocked). | **No.** A person must register and accept the license. An agent cannot do this. |
| SMPL body model (GVHMR rendering and evaluation) | Same terms as SMPL-X. | **No.** |
| HMR2.0 checkpoint (4D-Humans) | Code: MIT. The weights are trained to output SMPL, so the SMPL license also applies to their use. | Code yes; model use limited by SMPL. |
| ViTPose-H checkpoint | Apache-2.0 (the code `LICENSE`). The weights are trained on COCO; check the dataset terms. | Code yes. |
| YOLOv8x checkpoint (Ultralytics) | AGPL-3.0. | Only under AGPL-3.0, or with a paid Ultralytics license. |
| MediaPipe Pose Landmarker | Apache-2.0. | Yes. |
| Blender | GPL-3.0-or-later. Output files are not covered by the GPL. | Yes. |
| Mixamo rig of Nia | Nia's rig is from Tripo (`assets/skaters/nia/provenance.json`), not a Mixamo download. The Mixamo terms do not apply to our model. | Yes. |

### Why GitHub reports `NOASSERTION`

The `LICENSE` file of `mixamo-llm-mocap` starts with the full MIT text. Then it adds a "Third-party notes" section (Mixamo, GVHMR, SMPL-X, pytorch3d, Blender MCP). The extra text stops GitHub's license detector from matching the file to MIT exactly. Thus GitHub reports `NOASSERTION`. The code itself is MIT.

### License limit for Skate ATL

The goal is the official game of the City of Atlanta. That is a public release, and it can be a commercial use. A clip made with this pipeline is an output of GVHMR and SMPL-X. Thus:

1. Use the output for an internal test only. Do not ship it.
2. Before any shipped clip, get written permission from the GVHMR authors and a commercial SMPL-X license. Or use a different solver with a commercial license.

## Pipeline notes (from the README and `docs/INSTALL.md`)

- The pipeline was made and tested on Windows 10 with an RTX 4080 (16 GB). The install guide says Linux works with the same steps, without the Windows wheels.
- The SMPL-X path runs without the Blender UI: `estimate_pose_gvhmr.py --smplx-only` → `retarget_smplx.py` → `blender -b ... bl_motion.py`.
- The action spec sets the support foot for each phase. `"none"` is supported. Use `"none"` for each glide, because a foot lock stops the skate travel.
- The checkpoints are approximately 5.3 GB. `dpvo.pth` is not necessary for a steady camera.
- The README says the pipeline retargets to "your Mixamo rig". Nia has the 65 `mixamorig:` joints, so the bone names agree. The rest pose of the Tripo rig is not the Mixamo Y Bot rest pose. Check it with `setup_rig.py` before the first run.

## Options to continue (the owner must choose)

Prices are approximate public prices on 2026-11-21. Check the price before you pay.

| Option | GPU | Approximate cost for this test | Notes |
|---|---|---|---|
| Google Colab, free tier | T4, 16 GB | $0 | A GPU is not guaranteed. The session stops after some hours. Enough for one 5 to 15 s clip. |
| Google Colab Pay As You Go | T4 or L4 | $9.99 for 100 compute units (a T4 uses approximately 2 units each hour) | Units expire after 90 days. |
| Google Colab Pro | T4, L4, A100 | $9.99 each month | More reliable GPU access. |
| RunPod or Vast.ai, rented GPU | RTX 3090 or 4090, 24 GB | Approximately $0.20 to $0.70 each hour; the test needs 1 to 2 hours (install plus run) | Linux. A per-hour charge continues until you stop the machine. |
| Your own computer | An NVIDIA GPU with 8 GB or more | $0 | Connect it to a Claude session with Remote Control. The pipeline was made on Windows. |

For each option, a person must also:

1. Register at `smpl-x.is.tue.mpg.de`, accept the license, and download SMPL-X v1.1. An agent cannot accept a license for the team.
2. Choose the test video. Wikimedia Commons and Pexels are blocked in this environment. Use a video with a clear reuse license (CC BY, CC BY-SA, CC0, or the Pexels license). Record the URL, the creator, and the license.

If the owner wants the next session in this cloud environment to do the CPU steps (the retarget, the bake, the renders, the Playwright screenshots), the environment must allow `huggingface.co`, `commons.wikimedia.org`, and `upload.wikimedia.org`. The SMPL-X file must come from the owner.

## Steps not done

| Step | State |
|---|---|
| 1. Read the guide, decisions, clip script, provenance | Done. |
| 2. Environment check | Done. Blocked: no CUDA GPU. |
| 3. Licenses | Done (above). |
| 4. Test video | Not done. Blocked: no GPU, and Wikimedia Commons is blocked. |
| 5. to 8. Pipeline run, retarget, outputs, comparison images | Not done. Blocked: no GPU. |
| 9. This report | Done. |

There is no mocap clip, so this report cannot compare it with the hand-keyed `push` or `coast` clip.
