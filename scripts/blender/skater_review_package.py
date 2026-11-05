"""Encode the review frames and record the source hashes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--name", required=True, choices=("nia", "marcus"))
    args = parser.parse_args()
    directory = args.directory.resolve()
    frames = directory / "video-frames"
    manifest = json.loads((frames / "frames.json").read_text())
    audit = json.loads((directory / "rig-audit.json").read_text())
    assert audit["separation_pass"] and audit["coast_foot_motion_pass"]
    outputs = []
    for clip in manifest:
        if clip["clip"] not in ("coast", "bail"):
            continue
        assert clip["frames"] == list(range(clip["start"], clip["end"] + 1))
        output = directory / f"{args.name}-{directory.name}-{clip['clip']}.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-framerate", "30",
            "-start_number", str(clip["start"]),
            "-i", str(frames / clip["clip"] / "%04d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
            "-movflags", "+faststart", str(output),
        ], check=True)
        probe = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
            "-show_entries", "stream=nb_read_frames,width,height,r_frame_rate",
            "-of", "json", str(output),
        ]))
        stream = probe["streams"][0]
        assert int(stream["nb_read_frames"]) == len(clip["frames"])
        assert stream["r_frame_rate"] == "30/1"
        outputs.append({"file": output.name, "sha256": digest(output), **stream})
    sheet = Image.new("RGB", (960, len(manifest) * 430), "#252525")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
    for row, clip in enumerate(manifest):
        samples = [clip["frames"][0], clip["frames"][len(clip["frames"]) // 2], clip["frames"][-1]]
        for col, frame in enumerate(samples):
            image = Image.open(frames / clip["clip"] / f"{frame:04d}.png").convert("RGB")
            sheet.paste(image.resize((320, 400)), (320 * col, 430 * row))
            draw.text((320 * col + 8, 430 * row + 405),
                      f"{clip['clip']} / frame {frame}", fill="white", font=font)
    sheet.save(directory / "contact-sheet.png")
    source = ROOT / "assets/skaters" / args.name / "raw" / (
        "nia-animated.blend" if args.name == "nia" else "marcus-rig-work.blend")
    asset = directory / f"{args.name}-review.glb"
    provenance = {
        "date": datetime.now(timezone.utc).isoformat(),
        "tool": "Blender 5.2.2 LTS, local bpy scripts; FFmpeg H.264",
        "prompt": "Repair disconnected body parts and unstable foot motion. Render new review videos.",
        "credits": 0,
        "source": str(source.relative_to(ROOT)),
        "source_sha256": digest(source),
        "asset": asset.name,
        "asset_sha256": digest(asset),
        "scripts": {name: digest(ROOT / "scripts/blender" / name) for name in (
            "skater_repair.py", "nia_clips.py", "skater_rig_audit.py",
            "skater_review_render.py", "skater_review_package.py")},
        "videos": outputs,
        "verification": {
            "clips_checked": audit["clips_checked"],
            "adjacent_pairs": audit["adjacent_pairs"],
            "max_separation_increase_m": audit["worst_separation"][0]["increase_m"],
            "coast_max_foot_step_degrees": max(audit["foot_max_step_degrees"]["coast"].values()),
            "pose_sample_interval": "6 Blender frames at 24 fps",
            "foot_sample_interval": "Every Blender frame at 24 fps",
            "video_fps": 30,
        },
        "status": "Review candidate. User approval and game verification remain open.",
    }
    (directory / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps(provenance["verification"], indent=2))
    for video in outputs:
        print(directory / video["file"])


if __name__ == "__main__":
    main()
