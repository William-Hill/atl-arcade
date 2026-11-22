"""Skate ATL: GVHMR video mocap test on Nia, on a Modal GPU (evaluation only).

This is the Modal version of scripts/mocap/gvhmr_colab.ipynb. It does the same
14 steps, but it needs no browser: an agent can run all of it with `modal run`.
The Blender and retarget scripts are the same files (nia_rig_profile.py,
nia_mocap_clip.py, nia_mocap_compare.py). The script sends your local copy of
scripts/mocap/ and assets/skaters/nia/skater.glb to the container, so a fix in
those files is used at the next run without a push.

LICENSE LIMITS. READ BEFORE YOU RUN.
- GVHMR code and checkpoint: educational, research and non-profit use only.
- SMPL-X body model: non-commercial scientific research only. Each user must
  register at https://smpl-x.is.tue.mpg.de/ and accept the license. This script
  does not download SMPL-X.
- YOLOv8x checkpoint: AGPL-3.0.
- Do not ship the output in the game. It is an evaluation clip.

ONE-TIME SETUP (on your computer)
    pip install "modal==1.6.4"
    modal token new                       # browser login, one time
    modal volume create skate-atl-mocap
    modal volume put skate-atl-mocap SMPLX_NEUTRAL.npz /SMPLX_NEUTRAL.npz

STEPS (run from the repository root)
    # 1. Checkpoints to the volume (CPU, approximately 5.3 GB, one time) and SMPL-X check
    modal run scripts/mocap/gvhmr_modal.py::setup
    # 2. Video candidates on Wikimedia Commons, with license and creator
    modal run scripts/mocap/gvhmr_modal.py::candidates
    # 3. Cut the chosen video and look at 4 frames (CPU, no GPU cost)
    modal run scripts/mocap/gvhmr_modal.py::preview --commons-file "File:....webm" --t0 2 --t1 10
    # 4. The full run on a GPU: estimate, retarget, clip, compare, provenance
    modal run scripts/mocap/gvhmr_modal.py::run --commons-file "File:....webm" --t0 2 --t1 10
    # For a Pexels video, use --pexels-page, --pexels-file-url and --pexels-creator in steps 3 and 4.
    # To use another GPU: MOCAP_GPU=L4 modal run ...   (the default is T4)

OUTPUTS
- Local: scripts/mocap/.out/<time>/  (git ignores it). It holds the files that
  can go to git (mocap_test_push.glb, clip_report.json, compare/, video_source.json,
  provenance.json) and log.txt.
- Volume: skate-atl-mocap:/out/<time>/ holds the same files, and also drive-only/
  (the SMPL-X result, the raw retarget and the overlay video). Never put
  drive-only/ data in git. To get it: modal volume get skate-atl-mocap /out/<time> .
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import modal

# ---------------------------------------------------------------- config (same pins as the notebook)
ATL_BRANCH = "claude/wizardly-mayer-binhnd"
MOCAP_REPO = "https://github.com/squall01337/mixamo-llm-mocap"
MOCAP_COMMIT = "da5e7cc48557f0272832429a8df3fbf2b3c1273d"  # 2026-09-26
GVHMR_REPO = "https://github.com/zju3dv/GVHMR"
GVHMR_COMMIT = "ee960bb6e2ea2d381aa97f08e9b71ef320b624b1"  # 2026-09-15
BLENDER_URL = "https://download.blender.org/release/Blender5.1/blender-5.1.2-linux-x64.tar.xz"
CKPT_BASE = "https://huggingface.co/camenduru/GVHMR/resolve/main"  # unofficial mirror of the GVHMR checkpoints
EXCLUDE_NEWER = "2026-11-14"  # project rule: dependency versions 7 days old or older
GPU = os.environ.get("MOCAP_GPU", "T4")

VOL_NAME = "skate-atl-mocap"
VOL = "/vol"
ATL = "/atl"  # the local scripts/mocap and Nia's GLB are copied here
MOCAP = "/mocap"
GVHMR = f"{MOCAP}/tools/GVHMR"
VENV_PY = "/gvhmr-venv/bin/python"
BLENDER = "/opt/blender/blender"
UA = "skate-atl-mocap-eval/0.1 (research evaluation script)"

CKPT_FILES = {
    "gvhmr/gvhmr_siga24_release.ckpt": "gvhmr/gvhmr_siga24_release.ckpt",
    "yolo/yolov8x.pt": "yolo/yolov8x.pt",
    "vitpose/vitpose-h-multi-coco.pth": "vitpose/vitpose-h-multi-coco.pth",
    "hmr2/epoch%3D10-step%3D25000.ckpt": "hmr2/epoch=10-step=25000.ckpt",
}

# The repository root on your computer. In the container this path is not used.
REPO_ROOT = Path(__file__).resolve().parents[2] if modal.is_local() else Path("/")

# ---------------------------------------------------------------- image
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "git", "curl", "wget", "xz-utils", "ffmpeg",
        # Blender 5.1 in background mode
        "libegl1", "libgl1", "libxi6", "libxkbcommon0", "libxrender1", "libsm6", "libxxf86vm1",
        "libxfixes3", "libx11-6", "libglib2.0-0",
        # Mesa EGL as a fallback if the NVIDIA EGL library is not in the container
        "libegl-mesa0", "libgl1-mesa-dri",
    )
    .run_commands(
        f"mkdir -p /opt/blender && wget -q -O /tmp/b.tar.xz {BLENDER_URL}"
        " && tar xf /tmp/b.tar.xz -C /opt/blender --strip-components=1 && rm /tmp/b.tar.xz",
        f"git clone -q {MOCAP_REPO} {MOCAP} && git -C {MOCAP} checkout -q {MOCAP_COMMIT}",
        f"git clone -q {GVHMR_REPO} {GVHMR} && git -C {GVHMR} checkout -q {GVHMR_COMMIT}",
        "pip install -q 'uv==0.13.8'",
        # System Python 3.11: MediaPipe feet and hands, the retarget (numpy), the overlay (av), Commons (requests).
        f"uv pip install -q --system --exclude-newer {EXCLUDE_NEWER}"
        " mediapipe opencv-python-headless numpy av requests matplotlib",
        # GVHMR venv: Python 3.10, CUDA 12.1 wheels (the GPU is not needed to install).
        "uv venv -q -p 3.10 /gvhmr-venv",
        f"uv pip install -q -p {VENV_PY} --index-url https://download.pytorch.org/whl/cu121"
        " torch==2.3.0+cu121 torchvision==0.18.0+cu121",
        f"uv pip install -q -p {VENV_PY} --exclude-newer {EXCLUDE_NEWER}"
        " https://dl.fbaipublicfiles.com/pytorch3d/packaging/wheels/py310_cu121_pyt230/"
        "pytorch3d-0.7.6-cp310-cp310-linux_x86_64.whl",
    )
    # The lock file comes from the local repository, so a fix to it rebuilds only these layers.
    .add_local_file(str(REPO_ROOT / "scripts/mocap/gvhmr-requirements-lock.txt"),
                    "/tmp/gvhmr-requirements-lock.txt", copy=True)
    .run_commands(
        f"uv pip install -q -p {VENV_PY} -r /tmp/gvhmr-requirements-lock.txt",
        f"uv pip install -q -p {VENV_PY} --no-deps -e {GVHMR}",
        f"uv pip install -q -p {VENV_PY} --exclude-newer {EXCLUDE_NEWER} yacs",
    )
    # MediaPipe (feet and hands in step 9) loads libGLESv2.so.2. A separate layer, so the layers above stay cached.
    .apt_install("libgles2")
    # Graphics libraries from the NVIDIA driver, for Blender's EGL (Workbench renders in step 12).
    .env({"NVIDIA_DRIVER_CAPABILITIES": "all", "PYTHONUNBUFFERED": "1"})
    .add_local_dir(str(REPO_ROOT / "scripts/mocap"), f"{ATL}/scripts/mocap",
                   ignore=[".out", "__pycache__", "*.ipynb"])
    # nia_mocap_clip.py runs prune_static_channels() from this file (read only, not changed).
    .add_local_file(str(REPO_ROOT / "scripts/blender/nia_clips.py"), f"{ATL}/scripts/blender/nia_clips.py")
    .add_local_file(str(REPO_ROOT / "assets/skaters/nia/skater.glb"), f"{ATL}/assets/skaters/nia/skater.glb")
)

app = modal.App("skate-atl-gvhmr-mocap", image=image)
volume = modal.Volume.from_name(VOL_NAME, create_if_missing=True)

# ---------------------------------------------------------------- helpers (run in the container)
LOG: list[str] = []


def sh(cmd: str, cwd: str | None = None, env: dict | None = None, show=None, check=True) -> str:
    """Run a shell command. Keep the full output in LOG. Print all lines, or only the lines
    where show(line) is true. If the command fails, print the last 60 lines and stop."""
    LOG.append(f"$ {cmd}")
    print(f"$ {cmd}")
    p = subprocess.run(["bash", "-c", cmd], cwd=cwd, env={**os.environ, **(env or {})},
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    LOG.append(p.stdout)
    for line in p.stdout.splitlines():
        if show is None or show(line):
            print(line)
    if check and p.returncode != 0:
        print("---- last 60 lines ----")
        print("\n".join(p.stdout.splitlines()[-60:]))
        raise RuntimeError(f"command failed ({p.returncode}): {cmd}")
    return p.stdout


def sha256(path: str) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def commons_info(titles: list[str]) -> list[dict]:
    import html
    import re
    import requests

    def strip(s):
        return html.unescape(re.sub("<[^>]+>", "", s or "")).strip()

    r = requests.get("https://commons.wikimedia.org/w/api.php", headers={"User-Agent": UA}, params={
        "action": "query", "titles": "|".join(titles), "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata|metadata", "format": "json"}, timeout=60).json()
    out = []
    for p in r.get("query", {}).get("pages", {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata", {})
        meta = {m["name"]: m["value"] for m in (ii.get("metadata") or []) if isinstance(m, dict) and "name" in m}
        out.append({"title": p.get("title"), "url": ii.get("url"), "page": ii.get("descriptionurl"),
                    "mime": ii.get("mime"), "w": ii.get("width"), "h": ii.get("height"),
                    "seconds": meta.get("playtime_seconds") or meta.get("length"),
                    "license": strip(em.get("LicenseShortName", {}).get("value")),
                    "license_url": strip(em.get("LicenseUrl", {}).get("value")),
                    "creator": strip(em.get("Artist", {}).get("value")),
                    "credit": strip(em.get("Credit", {}).get("value"))})
    return out


def video_source(commons_file: str, pexels_page: str, pexels_file_url: str, pexels_creator: str,
                 t0: float, t1: float) -> dict:
    """Notebook cell 8, first part: find the video and check its license."""
    import datetime
    import re
    allowed = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? [0-9.]+|CC-BY(-SA)?-[0-9.]+|Pexels License)", re.I)
    if commons_file:
        info = commons_info([commons_file])[0]
        assert info["url"], f"{commons_file} not found on Commons"
        src = {"site": "Wikimedia Commons", "title": info["title"], "page": info["page"], "file_url": info["url"],
               "creator": info["creator"], "credit": info["credit"], "license": info["license"],
               "license_url": info["license_url"]}
    elif pexels_file_url:
        assert pexels_page and pexels_creator, "set --pexels-page and --pexels-creator too"
        src = {"site": "Pexels", "title": pexels_page.rstrip("/").rsplit("/", 1)[-1], "page": pexels_page,
               "file_url": pexels_file_url, "creator": pexels_creator, "license": "Pexels License",
               "license_url": "https://www.pexels.com/license/"}
    else:
        raise SystemExit("Set --commons-file, or --pexels-page, --pexels-file-url and --pexels-creator.")
    assert allowed.match(src["license"]), f"license {src['license']!r} is not on the allowed list; choose another video"
    assert 5.0 <= t1 - t0 <= 15.0, "use 5 to 15 s of video"
    src.update({"trim_s": [t0, t1], "downloaded": datetime.datetime.utcnow().isoformat() + "Z"})
    return src


def cut_plate(src: dict, plate_dir: str) -> str:
    """Notebook cell 8, second part: download, cut T0..T1, 30 fps, at most 1280 px wide."""
    import json
    os.makedirs(plate_dir, exist_ok=True)
    ext = os.path.splitext(src["file_url"].split("?")[0])[1]
    raw = os.path.join(plate_dir, "source" + ext)
    sh(f'curl -sSL --fail -A "{UA}" -o "{raw}" "{src["file_url"]}"')
    src["sha256"] = sha256(raw)
    plate = os.path.join(plate_dir, "skate.mp4")
    t0, t1 = src["trim_s"]
    sh(f'ffmpeg -loglevel error -y -ss {t0} -to {t1} -i "{raw}" '
       f'-vf "scale=\'min(1280,iw)\':-2,fps=30" -an -c:v libx264 -crf 18 -pix_fmt yuv420p "{plate}"')
    json.dump(src, open(os.path.join(plate_dir, "video_source.json"), "w"), indent=1)
    return plate


def four_frames(plate: str, out_png: str) -> None:
    import cv2
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    cap = cv2.VideoCapture(plate)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fig, ax = plt.subplots(1, 4, figsize=(16, 4))
    for k, f in enumerate([0, n // 3, 2 * n // 3, n - 1]):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if ok:
            ax[k].imshow(img[..., ::-1])
        ax[k].set_title(f"frame {f}")
        ax[k].axis("off")
    fig.savefig(out_png, dpi=80, bbox_inches="tight")


def blender_filter(line: str) -> bool:
    return not any(s in line for s in ("Draco", "INFO", "WARNING"))


# ---------------------------------------------------------------- remote functions
@app.function(volumes={VOL: volume}, timeout=3 * 3600)
def setup_remote() -> dict:
    """Notebook cells 3 and 6, without the GPU: check SMPL-X, download the checkpoints to the volume."""
    # The checkpoints download first, so the setup does useful work before SMPL-X is on the volume.
    smplx = f"{VOL}/SMPLX_NEUTRAL.npz"
    weights = {}
    for remote, local in CKPT_FILES.items():
        dst = f"{VOL}/checkpoints/{local}"
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            sh(f'curl -sSL --fail -o "{dst}.part" "{CKPT_BASE}/{remote}" && mv "{dst}.part" "{dst}"')
        weights[local] = {"url": f"{CKPT_BASE}/{remote}", "bytes": os.path.getsize(dst), "sha256": sha256(dst)}
        print(local, weights[local]["bytes"])
    import json
    json.dump(weights, open(f"{VOL}/checkpoints/weights.json", "w"), indent=1)
    volume.commit()
    sh(f"{BLENDER} --version | head -1")
    volume.reload()
    assert os.path.exists(smplx), (
        f"{VOL_NAME}:/SMPLX_NEUTRAL.npz not found (the checkpoints are on the volume). Register at "
        "https://smpl-x.is.tue.mpg.de/, accept the license, download SMPL-X v1.1 (NPZ+PKL), then: "
        "modal volume put skate-atl-mocap SMPLX_NEUTRAL.npz /SMPLX_NEUTRAL.npz")
    return {"smplx_sha256": sha256(smplx), "weights": weights}


@app.function(timeout=600)
def candidates_remote() -> list[dict]:
    """Notebook cell 7: roller-skating videos on Wikimedia Commons, with license data."""
    import requests
    api = "https://commons.wikimedia.org/w/api.php"
    titles = set()
    for q in ["roller skating filetype:video", "roller skate filetype:video", "roller derby filetype:video",
              "rink skating filetype:video"]:
        r = requests.get(api, headers={"User-Agent": UA}, params={"action": "query", "list": "search", "srsearch": q,
                         "srnamespace": 6, "srlimit": 30, "format": "json"}, timeout=60).json()
        titles |= {s["title"] for s in r.get("query", {}).get("search", [])}
    r = requests.get(api, headers={"User-Agent": UA}, params={"action": "query", "list": "categorymembers",
                     "cmtitle": "Category:Videos of roller skating", "cmtype": "file", "cmlimit": 50,
                     "format": "json"}, timeout=60).json()
    titles |= {m["title"] for m in r.get("query", {}).get("categorymembers", [])}
    titles = sorted(titles)
    out = []
    for i in range(0, len(titles), 40):
        out += commons_info(titles[i:i + 40])
    return out


@app.function(timeout=1200)
def preview_remote(commons_file: str, pexels_page: str, pexels_file_url: str, pexels_creator: str,
                   t0: float, t1: float) -> dict:
    """Notebook cell 8 on a CPU: cut the video and show 4 frames, so you can check it before the GPU run."""
    src = video_source(commons_file, pexels_page, pexels_file_url, pexels_creator, t0, t1)
    plate = cut_plate(src, "/tmp/plate")
    four_frames(plate, "/tmp/plate/frames.png")
    return {"video_source": src, "frames_png": open("/tmp/plate/frames.png", "rb").read()}


@app.function(gpu=GPU, volumes={VOL: volume}, timeout=3 * 3600)
def run_remote(commons_file: str, pexels_page: str, pexels_file_url: str, pexels_creator: str,
               t0: float, t1: float, clip_name: str, ref_clip: str, atl_commit: str, stamp: str) -> dict:
    import datetime
    import glob
    import json
    import shutil

    # 2. GPU check
    out = sh("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader")
    gpu_name = out.split(",")[0].strip()
    mem_mib = int(out.split(",")[1].split()[0])
    assert mem_mib >= 7500, f"{gpu_name} has {mem_mib} MiB; GVHMR needs approximately 8 GB."

    # 3 and 6. SMPL-X and checkpoints from the volume (run ::setup first)
    smplx = f"{VOL}/SMPLX_NEUTRAL.npz"
    assert os.path.exists(smplx), "SMPL-X not on the volume. Run ::setup first (see the docstring)."
    assert os.path.exists(f"{VOL}/checkpoints/weights.json"), "checkpoints not on the volume. Run ::setup first."
    smplx_sha = sha256(smplx)
    weights = json.load(open(f"{VOL}/checkpoints/weights.json"))
    ck = f"{GVHMR}/inputs/checkpoints"
    os.makedirs(ck, exist_ok=True)
    for local in CKPT_FILES.values():
        dst = f"{ck}/{local}"
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            os.symlink(f"{VOL}/checkpoints/{local}", dst)
    os.makedirs(f"{ck}/body_models/smplx", exist_ok=True)
    if not os.path.exists(f"{ck}/body_models/smplx/SMPLX_NEUTRAL.npz"):
        os.symlink(smplx, f"{ck}/body_models/smplx/SMPLX_NEUTRAL.npz")

    # 4 and 5. Versions and the GVHMR import chain (needs the GPU)
    bl_ver = sh(f"{BLENDER} --version").splitlines()[0]
    sh(f'{VENV_PY} -c "import torch; print(torch.__version__, torch.cuda.get_device_name(0)); '
       "from hmr4d.utils.smplx_utils import make_smplx; from hmr4d.model.gvhmr.gvhmr_pl_demo import DemoPL; "
       "from hmr4d.utils.preproc import Tracker; print('GVHMR import chain OK')\"", cwd=GVHMR)

    # 8. Video
    src = video_source(commons_file, pexels_page, pexels_file_url, pexels_creator, t0, t1)
    plate_dir = f"{MOCAP}/plates/skate"
    cut_plate(src, plate_dir)

    # 9. GVHMR estimate (GPU). Writes plates/skate/smplx.npz.
    sys_py = shutil.which("python3")
    sh(f"{VENV_PY} pipeline/estimate_pose_gvhmr.py --video plates/skate/skate.mp4 "
       f"--out plates/skate/landmarks.json --smplx-only --feet-python {sys_py}",
       cwd=MOCAP, env={"GVHMR_ROOT": GVHMR})
    assert os.path.exists(f"{plate_dir}/smplx.npz"), "GVHMR did not write smplx.npz; read the log above"

    # 10. Retarget to Nia. Support foot "none": every foot lock is off, because a lock stops the skate.
    work = "/work"
    os.makedirs(work, exist_ok=True)
    glb = f"{ATL}/assets/skaters/nia/skater.glb"
    sh(f"{BLENDER} -b --factory-startup -P {ATL}/scripts/mocap/nia_rig_profile.py -- --in {glb} "
       f"--out {work}/nia.json --save-blend {work}/nia_rest.blend", show=lambda l: "rig-profile" in l)
    spec = {
        "name": "skate", "action_name": clip_name, "clip_dir": "clips/skate",
        "landmarks": "plates/skate/landmarks.json", "smplx": "plates/skate/smplx.npz",
        "rig_profile": f"{work}/nia.json", "estimator": "gvhmr_siga24", "src_fps": 30, "dst_fps": 30,
        "smplx_retarget": {
            "pin_static_feet": False,      # no body correction from static feet
            "contact_threshold": 1.01,     # GVHMR static flags never count
            "contact_max_speed": 0.0,      # no "slow foot" contacts
            "contact_still_px": 0.0,       # no "still on screen" contacts
            "contact_swing_height": 10.0,  # no single-support contacts
            "contact_geo_speed": 0.0,      # no floor-geometry contacts
            "floor_snap": True,            # height only: a free foot near the floor goes down to it
        },
    }
    json.dump(spec, open(f"{work}/skate_spec.json", "w"), indent=1)
    sh(f"{sys_py} pipeline/retarget_smplx.py --spec {work}/skate_spec.json --rig-profile {work}/nia.json", cwd=MOCAP)

    # 11. In place, wheel lock with leg IK, loop, bake, export GLB
    outd = f"{work}/mocap-test"
    os.makedirs(outd, exist_ok=True)
    sh(f"{BLENDER} -b --factory-startup -P {ATL}/scripts/mocap/nia_mocap_clip.py -- --in {glb} "
       f"--motion {MOCAP}/clips/skate/motion.npz --name {clip_name} --out {outd}/{clip_name}.glb "
       f"--report {outd}/clip_report.json", show=blender_filter)
    report = json.load(open(f"{outd}/clip_report.json"))
    assert report["glb_bytes"] < 10_000_000, "GLB over 10 MB"

    # 12. Comparison with the hand-keyed clip
    speed = report["source_speed_m_s"] if report["source_speed_m_s"] > 0.3 else 3.0
    sh(f"{BLENDER} -b --factory-startup -P {ATL}/scripts/mocap/nia_mocap_compare.py -- --ref {glb} "
       f"--ref-clip {ref_clip} --mocap {outd}/{clip_name}.glb --mocap-clip {clip_name} --out {outd}/compare "
       f"--speed {speed} --fps 30", show=lambda l: any(s in l for s in ("compare]", "Error", "Traceback")))

    # 13. Optional overlay of the raw retarget on the video. A failure here does not stop the test.
    sh(f"{sys_py} pipeline/render_review.py --spec {work}/skate_spec.json --clip clips/skate "
       f"--scene {work}/nia_rest.blend --blender {BLENDER} --views front --no-details",
       cwd=MOCAP, check=False, show=lambda l: True)

    # 14. Provenance
    prov = {
        "asset": f"{clip_name}: GVHMR video mocap test clip on Nia (evaluation only, not shipped)",
        "date": datetime.date.today().isoformat(),
        "status": "evaluation only. Do not ship: GVHMR and SMPL-X are licensed for non-commercial research only.",
        "tools": {
            "mixamo-llm-mocap": {"repo": MOCAP_REPO, "commit": MOCAP_COMMIT, "license": "MIT"},
            "GVHMR": {"repo": GVHMR_REPO, "commit": GVHMR_COMMIT,
                      "license": "educational, research and non-profit use only; modifications open source; "
                                 "no commercial use"},
            "blender": bl_ver,
            "atl-arcade": {"branch": ATL_BRANCH, "commit": atl_commit,
                           "scripts": ["scripts/mocap/gvhmr_modal.py", "scripts/mocap/nia_rig_profile.py",
                                       "scripts/mocap/nia_mocap_clip.py", "scripts/mocap/nia_mocap_compare.py"]},
            "gpu": gpu_name,
            "runner": f"Modal ({GPU})",
        },
        "model_weights": {
            **{k: {**v, "source": "unofficial Hugging Face mirror (camenduru/GVHMR) of the GVHMR release checkpoints"}
               for k, v in weights.items()},
            "SMPLX_NEUTRAL.npz": {"version": "SMPL-X v1.1", "sha256": smplx_sha,
                                  "license": "MPI SMPL-X license: non-commercial scientific research only; "
                                             "not redistributed"},
        },
        "weight_licenses": {"gvhmr_siga24_release.ckpt": "GVHMR license (non-commercial)",
                            "yolov8x.pt": "AGPL-3.0 (Ultralytics)",
                            "vitpose-h-multi-coco.pth": "Apache-2.0 code (ViTPose); trained on COCO",
                            "hmr2 epoch=10-step=25000.ckpt": "MIT code (4D-Humans); outputs SMPL, so the SMPL "
                                                             "license applies",
                            "mediapipe pose/hand landmarker": "Apache-2.0"},
        "video_source": src,
        "retarget_spec": spec,
        "clip_report": report,
        "outputs": {os.path.relpath(p, outd): os.path.getsize(p)
                    for p in glob.glob(f"{outd}/**/*", recursive=True) if os.path.isfile(p)},
    }
    json.dump(prov, open(f"{outd}/provenance.json", "w"), indent=1)
    shutil.copy(f"{plate_dir}/video_source.json", outd)

    # Copy to the volume. drive-only/ is SMPL-X derived data and video: never for git.
    dst = f"{VOL}/out/{stamp}"
    shutil.copytree(outd, dst)
    os.makedirs(f"{dst}/drive-only", exist_ok=True)
    for p in [f"{plate_dir}/smplx.npz", f"{MOCAP}/clips/skate/motion.npz", f"{MOCAP}/clips/skate/curves.json"] \
            + glob.glob(f"{MOCAP}/clips/skate/review_*.mp4"):
        if os.path.exists(p):
            shutil.copy(p, f"{dst}/drive-only")
    open(f"{dst}/log.txt", "w").write("\n".join(LOG))
    volume.commit()

    # Only the git-safe files go back to the local computer.
    files = {os.path.relpath(p, outd): open(p, "rb").read()
             for p in glob.glob(f"{outd}/**/*", recursive=True) if os.path.isfile(p)}
    files["log.txt"] = "\n".join(LOG).encode()
    return files


# ---------------------------------------------------------------- local entry points
def _local_out(stamp: str) -> Path:
    d = REPO_ROOT / "scripts/mocap/.out" / stamp
    d.mkdir(parents=True, exist_ok=True)
    return d


@app.local_entrypoint()
def setup():
    r = setup_remote.remote()
    print("SMPL-X sha256", r["smplx_sha256"])
    for k, v in r["weights"].items():
        print(k, v["bytes"], v["sha256"][:16])


@app.local_entrypoint()
def candidates():
    import json
    import time
    rows = candidates_remote.remote()
    for c in rows:
        print(f"{c['title']}\n    {c['license']} | {(c['creator'] or '')[:60]} | {c['w']}x{c['h']} | "
              f"{c['seconds']} s | {c['page']}")
    d = _local_out("candidates-" + time.strftime("%Y%m%d-%H%M%S"))
    (d / "candidates.json").write_text(json.dumps(rows, indent=1))
    print(len(rows), "candidates, also in", d / "candidates.json")
    print("Choose one skater, full body, steady camera, side or front view, push or glide, 5 to 15 s.")


@app.local_entrypoint()
def preview(commons_file: str = "", pexels_page: str = "", pexels_file_url: str = "", pexels_creator: str = "",
            t0: float = 0.0, t1: float = 10.0):
    import json
    import time
    r = preview_remote.remote(commons_file, pexels_page, pexels_file_url, pexels_creator, t0, t1)
    d = _local_out("preview-" + time.strftime("%Y%m%d-%H%M%S"))
    (d / "frames.png").write_bytes(r["frames_png"])
    (d / "video_source.json").write_text(json.dumps(r["video_source"], indent=1))
    print(json.dumps(r["video_source"], indent=1))
    print("Look at the 4 frames before the GPU run:", d / "frames.png")


@app.local_entrypoint()
def run(commons_file: str = "", pexels_page: str = "", pexels_file_url: str = "", pexels_creator: str = "",
        t0: float = 0.0, t1: float = 10.0, clip_name: str = "mocap_test_push", ref_clip: str = "push"):
    import time
    try:
        commit = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
                                capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", str(REPO_ROOT), "status", "--porcelain", "scripts/mocap"],
                               capture_output=True, text=True).stdout.strip()
        if dirty:
            commit += " (with local changes in scripts/mocap)"
    except OSError:
        commit = "unknown"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    files = run_remote.remote(commons_file, pexels_page, pexels_file_url, pexels_creator, t0, t1,
                              clip_name, ref_clip, commit, stamp)
    d = _local_out(stamp)
    for rel, data in files.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    print("outputs in", d)
    print(f"drive-only data (do not commit) is on the volume: modal volume get {VOL_NAME} /out/{stamp}/drive-only")
