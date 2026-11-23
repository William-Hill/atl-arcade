#!/usr/bin/env python3
"""Turn the CC0 placeholder tracks (#20) into game loops, license files and tracks.json entries.

  python scripts/music/build_cc0_tracks.py WORK_DIR

Needs librosa, soundfile and numpy (as loop_take.py) and ffmpeg.

For each track in cc0.spec.json: download the source file from OpenGameArt
into WORK_DIR (once), check its SHA-256, decode it to 48 kHz, and let
loop_take.py measure the tempo grid and cut a loop of `bars` bars. The BPM in
tracks.json is the one that makes the loop exactly `bars` bars of whole
samples (bars * 240 * 48000 / samples); it differs from the measured tempo by
less than half a sample per loop. Then the same loudness, encode and
sample-exact decode checks as build_tracks.py run. The script writes
assets/music/<id>.LICENSE.md, assets/music/cc0-sources.json, and merges the
entries into assets/music/tracks.json after the tracks that are already there.
"""
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

from build_tracks import HERE, OUT, PY, SR, TARGET_LUFS, decoded, lag_fast, lufs, run

LICENSE_FILE = "CC0-1.0.txt"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url, dest):
    if not os.path.exists(dest):
        subprocess.run(["curl", "-sSfL", "-m", "300", "-o", dest, url], check=True)
    return dest


def license_md(t, entry, prov):
    return f"""# {t['title']} — license

| Field | Value |
|---|---|
| Track | {t['title']} |
| Author | {t['author']} ({t['authorUrl']}) |
| Source page | {t['sourcePage']} |
| Source file | {t['sourceFile']} (SHA-256 `{t['sha256']}`) |
| Posted | {t['posted']} |
| Accessed | {prov['accessed']} |
| License | CC0 1.0 Universal (public domain dedication). The OpenGameArt page lists CC0 as the only license. |
| License text | `{LICENSE_FILE}` in this folder, and https://creativecommons.org/publicdomain/zero/1.0/legalcode |
| Files in the game | `{entry['file']}`, `{entry['fallback']}` |

## What CC0 allows

The author gave up all copyright and related rights in the work (CC0 1.0). Skate ATL may copy, change, and publish the track, also for commercial use, with no attribution. We credit the author all the same, in this file and in `cc0-sources.json`.

## What we changed

- Cut a loop of {entry['bars']} bars ({prov['loop']['seconds']:.3f} s) from {prov['loop']['startSeconds']:.3f} s into the source, with a {prov['loop']['crossfadeSamples']} sample crossfade at the wrap.
- Resampled to 48 kHz, set the loudness to about -16 LUFS ({prov['loudness']['gainDb']:+.2f} dB), and encoded to Opus (Ogg) and AAC (MP4) at 96 kb/s.

## Author's note on the source page

> {t['authorNote']}

## Status

Placeholder for the City pitch (v0.9.0). Tracks by local Atlanta artists replace it for Version 1 (v1.0.0), see #20 and `docs/decisions.md`.
"""


def main():
    work = sys.argv[1]
    os.makedirs(work, exist_ok=True)
    spec = json.load(open(os.path.join(HERE, "cc0.spec.json")))
    entries, prov = [], []
    for t in spec["tracks"]:
        tid = t["id"]
        src = fetch(t["sourceFile"], os.path.join(work, f"{tid}-source{os.path.splitext(t['sourceFile'])[1]}"))
        got = sha256(src)
        if got != t["sha256"]:
            sys.exit(f"{tid}: SHA-256 {got}, want {t['sha256']}")
        wav = os.path.join(work, f"{tid}-48k.wav")
        run("ffmpeg", "-y", "-hide_banner", "-v", "error", "-i", src, "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", wav)
        loop_wav = os.path.join(work, f"{tid}-loop.wav")
        res = json.loads(run(PY, os.path.join(HERE, "loop_take.py"), wav, "--bpm", str(t["bpm"]), "--bars", str(t["bars"]), "--out", loop_wav).stdout.strip().splitlines()[-1])
        if "loop" not in res:
            sys.exit(f"{tid}: {res.get('rejected')}")
        loop = res["loop"]
        L = loop["samples"]
        bpm = round(t["bars"] * 240 * SR / L, 6)
        integ, peak = lufs(loop_wav)
        gain = min(TARGET_LUFS - integ, -1.0 - peak)
        norm = os.path.join(work, f"{tid}-loop-norm.wav")
        y, _ = sf.read(loop_wav, always_2d=True)
        sf.write(norm, y * 10 ** (gain / 20), SR, subtype="PCM_24")
        ogg = os.path.join(OUT, f"{tid}.ogg")
        m4a = os.path.join(OUT, f"{tid}.m4a")
        run("ffmpeg", "-y", "-hide_banner", "-v", "error", "-i", norm, "-c:a", "libopus", "-b:a", "96k", "-vbr", "on", "-application", "audio", "-map_metadata", "-1", ogg)
        # ffmpeg's AAC encoder drops a last part frame: pad the input with the
        # loop start to whole 1024-sample frames. loopEnd is explicit, so the
        # pad never plays.
        pad = (-L) % 1024
        aac_in = norm
        if pad:
            aac_in = os.path.join(work, f"{tid}-loop-aac.wav")
            sf.write(aac_in, np.concatenate([y, y[:pad]]) * 10 ** (gain / 20), SR, subtype="PCM_24")
        run("ffmpeg", "-y", "-hide_banner", "-v", "error", "-i", aac_in, "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-map_metadata", "-1", m4a)
        ref, _ = sf.read(norm, always_2d=True, dtype="float32")
        checks = {}
        for f in (ogg, m4a):
            d = decoded(f)
            checks[os.path.basename(f)] = {"bytes": os.path.getsize(f), "decodedSamples": len(d), "lagSamples": lag_fast(ref, d)}
        for name, c in checks.items():
            if c["lagSamples"] != 0:
                sys.exit(f"{tid}: {name} is shifted by {c['lagSamples']} samples")
            if name.endswith(".ogg") and c["decodedSamples"] != L:
                sys.exit(f"{tid}: {name} decodes to {c['decodedSamples']} samples, want {L}")
            if not L <= c["decodedSamples"] < L + 2048:
                sys.exit(f"{tid}: {name} decodes to {c['decodedSamples']} samples, want {L} (+AAC padding)")
        entry = {
            "id": tid,
            "title": t["title"],
            "author": t["author"],
            "file": f"{tid}.ogg",
            "fallback": f"{tid}.m4a",
            "bpm": bpm,
            "firstDownbeat": 0,
            "bars": t["bars"],
            "loopStart": 0,
            "loopEnd": L / SR,
            "license": f"CC0 1.0, {t['title']} by {t['author']} (OpenGameArt); see {tid}.LICENSE.md",
        }
        p = {
            "id": tid,
            "title": t["title"],
            "author": t["author"],
            "authorUrl": t["authorUrl"],
            "sourcePage": t["sourcePage"],
            "sourceFile": t["sourceFile"],
            "sourceSha256": t["sha256"],
            "posted": t["posted"],
            "accessed": spec["accessed"],
            "license": "CC0-1.0",
            "style": t["style"],
            "files": [f"{tid}.ogg", f"{tid}.m4a", f"{tid}.LICENSE.md"],
            "measured": {
                "nominalBpm": t["bpm"],
                "bestFitBpm": res["measuredBpm"],
                "gridBpm": bpm,
                "sourceFirstDownbeat": res["firstDownbeat"],
                "loopStartBar": loop["startBar"],
                "driftMsPerBar": loop["driftMsPerBar"],
                "jitterMs": loop["jitterMs"],
                "meanOffsetMs": loop["meanOffsetMs"],
                "maxAbsOffsetMs": loop["maxAbsOffsetMs"],
                "seamSimilarity": loop["seamSimilarity"],
            },
            "loop": {"bars": t["bars"], "samples": L, "seconds": L / SR, "startSeconds": loop["startSeconds"], "crossfadeSamples": loop["fadeSamples"]},
            "loudness": {"sourceLufs": integ, "sourcePeakDbfs": peak, "gainDb": round(gain, 2)},
            "encode": checks,
            "credits": "No paid credits. Downloaded from OpenGameArt; measured and encoded on this VM's CPU.",
        }
        with open(os.path.join(OUT, f"{tid}.LICENSE.md"), "w") as f:
            f.write(license_md(t, entry, p))
        entries.append(entry)
        prov.append(p)
        print(json.dumps({"id": tid, "bpm": bpm, "loop": loop, "encode": checks, "gainDb": round(gain, 2)}))

    path = os.path.join(OUT, "tracks.json")
    meta = json.load(open(path))
    ids = {e["id"] for e in entries}
    meta["tracks"] = [x for x in meta["tracks"] if x["id"] not in ids] + entries
    with open(path, "w") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    with open(os.path.join(OUT, "cc0-sources.json"), "w") as f:
        json.dump({"date": spec["accessed"], "pipeline": "scripts/music/build_cc0_tracks.py (loop_take.py, build_tracks.py checks)", "issue": "#20", "status": "placeholders for v0.9.0; Atlanta artists for v1.0.0", "tracks": prov}, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
