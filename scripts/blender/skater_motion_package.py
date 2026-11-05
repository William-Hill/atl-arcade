"""Package the front and side views of a motion test."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package_clip(folder, name, clip, count, cycles, filename, asset_hash):
    command = ["ffmpeg", "-y", "-loglevel", "error"]
    for view in ("front", "side"):
        manifests = json.loads((folder / view / "frames.json").read_text())
        manifest = next(m for m in manifests if m["clip"] == clip)
        assert manifest["frames"][:count] == list(range(count))
        if "source_sha256" in manifest:
            assert manifest["source_sha256"] == asset_hash, "The frames use a different GLB."
        command += ["-framerate", "30", "-i", str(folder / view / clip / "%04d.png")]
    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
    labels = Image.new("RGBA", (1280, 800))
    label_draw = ImageDraw.Draw(labels)
    label_draw.rectangle((0, 0, 1280, 54), fill=(0, 0, 0, 140))
    label_font = ImageFont.truetype(font_path, 24)
    for x, view in ((20, "Front"), (660, "Side")):
        label_draw.text((x, 14), f"{name.capitalize()} / {clip} / {view}", fill="white", font=label_font)
    label_path = folder / f"{clip}-labels.png"
    labels.save(label_path)
    command += ["-i", str(label_path)]
    filters = (f"[0:v][1:v]hstack=inputs=2,trim=end_frame={count},"
               f"loop=loop={cycles - 1}:size={count}:start=0,setpts=N/(30*TB)[motion];"
               "[motion][2:v]overlay=0:0[v]")
    output = folder / filename
    command += ["-filter_complex", filters, "-map", "[v]", "-c:v", "libx264",
                "-frames:v", str(count * cycles), "-pix_fmt", "yuv420p",
                "-crf", "18", "-movflags", "+faststart", str(output)]
    subprocess.run(command, check=True)
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_frames,r_frame_rate,width,height", "-of", "json", str(output),
    ]))["streams"][0]
    assert int(probe["nb_read_frames"]) == count * cycles
    assert probe["r_frame_rate"] == "30/1"
    font = ImageFont.truetype(font_path, 16)
    samples = list(range(0, count, max(1, count // 30)))
    if samples[-1] != count - 1:
        samples.append(count - 1)
    for view in ("front", "side"):
        sheet = Image.new("RGB", (8 * 240, ((len(samples) + 7) // 8) * 324), "#222222")
        draw = ImageDraw.Draw(sheet)
        for index, frame in enumerate(samples):
            image = Image.open(folder / view / clip / f"{frame:04d}.png").convert("RGB")
            x, y = index % 8 * 240, index // 8 * 324
            sheet.paste(image.resize((240, 300)), (x, y))
            draw.text((x + 6, y + 302), f"{frame / 30:.2f}s / {frame}", fill="white", font=font)
        sheet.save(folder / f"{clip}-{view}-sequence.jpg")
    print(output)
    return {"file": output.name, "sha256": digest(output), "cycles": cycles, **probe}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True, choices=("nia", "marcus"))
    parser.add_argument("--kind", choices=("tripo", "forward"), default="tripo")
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--travel-speed", type=float,
                        help="The speed used for the preview renders, in meters per second.")
    args = parser.parse_args()
    forward = args.kind == "forward"
    assert args.version > 0
    folder_name = ("forward-v" if forward else "tripo-motion-v") + str(args.version)
    folder = ROOT / "assets/skaters" / args.name / "raw" / folder_name
    provenance_path = folder / "provenance.json"
    provenance = json.loads(provenance_path.read_text())
    provenance.pop("video", None)
    if forward:
        asset = folder / f"{args.name}-forward.glb"
        asset_hash = digest(asset)
        provenance["videos"] = [
            package_clip(folder, args.name, clip, provenance["cycle_frames"], 3,
                         f"{args.name}-forward-v{args.version}-{clip}.mp4", asset_hash)
            for clip in ("push", "coast")
        ]
        provenance["preview_travel_m_s"] = (args.travel_speed if args.travel_speed is not None
                                            else 2 if args.name == "nia" else 2.5)
        for view in ("front", "side"):
            for manifest in json.loads((folder / view / "frames.json").read_text()):
                if "travel_speed_m_s" in manifest:
                    assert manifest["travel_speed_m_s"] == provenance["preview_travel_m_s"]
        provenance["source_sha256"] = digest(Path(provenance["source"]))
    else:
        metadata = json.loads((folder / "retarget.json").read_text())
        asset = folder / f"{args.name}-motion-test.glb"
        provenance["retarget"] = metadata
        provenance["source_sha256"] = digest(ROOT / metadata["source_fbx"])
        provenance["videos"] = [package_clip(
            folder, args.name, "coast", metadata["output_frames"], 1,
            f"{args.name}-tripo-motion-test-v{args.version}.mp4", digest(asset))]
    provenance["asset_sha256"] = digest(asset)
    provenance["script_sha256"] = {
        name: digest(ROOT / "scripts/blender" / name)
        for name in ("nia_clips.py", "skater_forward_motion.py", "skater_motion_retarget.py",
                     "skater_motion_audit.py", "skater_rig_audit.py", "skater_review_render.py",
                     "skater_motion_package.py", "skater_weight_refine.py")
    }
    provenance["motion_audit"] = json.loads((folder / "motion-audit.json").read_text())
    provenance["rig_audit"] = json.loads((folder / "rig-audit.json").read_text())
    provenance["video_views"] = ["front on left", "side on right"]
    provenance["status"] = "Motion test for user review. No game integration."
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n")


if __name__ == "__main__":
    main()
