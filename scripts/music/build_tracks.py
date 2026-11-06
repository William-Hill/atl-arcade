#!/usr/bin/env python3
"""Turn chosen ACE-Step takes into the game's loops, tracks.json and provenance.json.

  ~/tools/ACE-Step-1.5/.venv-cpu/bin/python scripts/music/build_tracks.py TAKES_DIR id:seed [id:seed@BPM/BARS ...]

`@BPM/BARS` grids a take at its measured tempo when ACE-Step rendered it
steadily but not at the prompted BPM (the drift check runs against BPM).

For each take: loop_take.py measures it and cuts the loop; the loop is set to
-16 LUFS (single gain, peaks under -1 dBFS) and encoded to Opus in Ogg
(96 kb/s) and AAC in MP4 (96 kb/s, for browsers without Opus). Both files
are decoded back with ffmpeg and matched to the loop sample by sample (lag
and length) to prove the encode keeps the bar grid.
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "assets", "music")
PY = sys.executable
SR = 48000
TARGET_LUFS = -16.0


def run(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def lufs(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = err[err.rindex("Summary:") :]
    integ = float(summary.split("I:")[1].split("LUFS")[0])
    peak = float(summary.split("Peak:")[1].split("dBFS")[0])
    return integ, peak


def decoded(path):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)


def lag_fast(ref, got, search=4096):
    a = ref[: SR * 4].mean(axis=1)
    b = got[: SR * 4 + search].mean(axis=1)
    n = 1
    while n < len(a) + len(b):
        n *= 2
    c = np.fft.irfft(np.fft.rfft(b, n) * np.conj(np.fft.rfft(a, n)), n)
    c = np.r_[c[-search:], c[: search + 1]]
    return int(np.argmax(c)) - search


def main():
    takes, jobs = sys.argv[1], sys.argv[2:]
    spec = {t["id"]: t for t in json.load(open(os.path.join(HERE, "tracks.spec.json")))["tracks"]}
    ace_root = os.environ.get("ACE_STEP_ROOT", os.path.expanduser("~/tools/ACE-Step-1.5"))
    ace_commit = run("git", "-C", ace_root, "rev-parse", "HEAD").stdout.strip()
    tracks, prov = [], []
    for job in jobs:
        tid, rest = job.split(":")
        seed, _, grid = rest.partition("@")
        s = dict(spec[tid])
        prompted_bpm = s["bpm"]
        if grid:
            bpm, bars = grid.split("/")
            s["bpm"], s["loopBars"] = float(bpm) if "." in bpm else int(bpm), int(bars)
        take = os.path.join(takes, f"{tid}-s{seed}.wav")
        render = json.load(open(os.path.join(takes, f"{tid}-s{seed}.json")))
        loop_wav = os.path.join(takes, f"{tid}-loop.wav")
        res = json.loads(run(PY, os.path.join(HERE, "loop_take.py"), take, "--bpm", str(s["bpm"]), "--bars", str(s["loopBars"]), "--out", loop_wav).stdout.strip().splitlines()[-1])
        if "loop" not in res:
            sys.exit(f"{tid}: {res.get('rejected')}")
        loop = res["loop"]
        integ, peak = lufs(loop_wav)
        gain = TARGET_LUFS - integ
        gain = min(gain, -1.0 - peak)
        norm = os.path.join(takes, f"{tid}-loop-norm.wav")
        y, _ = sf.read(loop_wav, always_2d=True)
        sf.write(norm, y * 10 ** (gain / 20), SR, subtype="PCM_24")
        ogg = os.path.join(OUT, f"{tid}.ogg")
        m4a = os.path.join(OUT, f"{tid}.m4a")
        run("ffmpeg", "-y", "-hide_banner", "-v", "error", "-i", norm, "-c:a", "libopus", "-b:a", "96k", "-vbr", "on", "-application", "audio", "-map_metadata", "-1", ogg)
        run("ffmpeg", "-y", "-hide_banner", "-v", "error", "-i", norm, "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-map_metadata", "-1", m4a)
        ref, _ = sf.read(norm, always_2d=True, dtype="float32")
        checks = {}
        for f in (ogg, m4a):
            d = decoded(f)
            checks[os.path.basename(f)] = {"bytes": os.path.getsize(f), "decodedSamples": len(d), "lagSamples": lag_fast(ref, d)}
        L = loop["samples"]
        # The manifest's grid only holds if both encodes start on sample 0;
        # Opus keeps the exact length, AAC may pad its last frame (loopEnd is explicit).
        for name, c in checks.items():
            if c["lagSamples"] != 0:
                sys.exit(f"{tid}: {name} is shifted by {c['lagSamples']} samples")
            if name.endswith(".ogg") and c["decodedSamples"] != L:
                sys.exit(f"{tid}: {name} decodes to {c['decodedSamples']} samples, want {L}")
            if not L <= c["decodedSamples"] < L + 2048:
                sys.exit(f"{tid}: {name} decodes to {c['decodedSamples']} samples, want {L} (+AAC padding)")
        entry = {
            "id": tid,
            "title": s["title"],
            "file": f"{tid}.ogg",
            "fallback": f"{tid}.m4a",
            "bpm": s["bpm"],
            "firstDownbeat": 0,
            "bars": s["loopBars"],
            "loopStart": 0,
            "loopEnd": L / SR,
            "license": "MIT (ACE-Step 1.5 code and weights); output: original work for this repository, see LICENSE.md",
        }
        tracks.append(entry)
        prov.append(
            {
                "id": tid,
                "title": s["title"],
                "files": [f"{tid}.ogg", f"{tid}.m4a"],
                "tool": "ACE-Step 1.5 (https://github.com/ace-step/ACE-Step-1.5)",
                "toolCommit": ace_commit,
                "model": "ACE-Step/Ace-Step1.5 acestep-v15-turbo (DiT), vae, Qwen3-Embedding-0.6B text encoder; no 5 Hz LM (thinking off)",
                "prompt": {"caption": s["caption"], "lyrics": "[Instrumental]", "instrumental": True, "bpm": prompted_bpm, "keyscale": s.get("keyscale", ""), "timesignature": "4/4"},
                "seed": int(seed),
                "settings": {k: render[k] for k in ("duration", "inferenceSteps", "thinking", "device", "threads")},
                "renderSeconds": render["renderSeconds"],
                "measured": {
                    "promptedBpm": prompted_bpm,
                    "gridBpm": s["bpm"],
                    "bestFitBpm": res["measuredBpm"],
                    "takeFirstDownbeat": res["firstDownbeat"],
                    "loopStartInTake": loop["startSeconds"],
                    "loopStartBar": loop["startBar"],
                    "driftMsPerBar": loop["driftMsPerBar"],
                    "jitterMs": loop["jitterMs"],
                    "maxAbsOffsetMs": loop["maxAbsOffsetMs"],
                    "seamSimilarity": loop["seamSimilarity"],
                },
                "loop": {"bars": s["loopBars"], "samples": L, "seconds": L / SR, "crossfadeSamples": loop["fadeSamples"]},
                "loudness": {"sourceLufs": integ, "sourcePeakDbfs": peak, "gainDb": round(gain, 2)},
                "encode": checks,
                "credits": "No paid credits: rendered on this VM's CPU (8 threads, no GPU).",
                "license": "ACE-Step 1.5 code and model weights: MIT. The model card says the output may be used commercially. Output: original work for this repository. See LICENSE.md.",
            }
        )
        print(json.dumps({"id": tid, "loop": loop, "encode": checks, "gainDb": round(gain, 2)}))
    json.dump({"sampleRate": SR, "tracks": tracks}, open(os.path.join(OUT, "tracks.json"), "w"), indent=2)
    open(os.path.join(OUT, "tracks.json"), "a").write("\n")
    import datetime

    json.dump({"date": datetime.date.today().isoformat(), "pipeline": "scripts/music/ace_render.py -> scripts/music/loop_take.py -> scripts/music/build_tracks.py", "tracks": prov}, open(os.path.join(OUT, "provenance.json"), "w"), indent=2)
    open(os.path.join(OUT, "provenance.json"), "a").write("\n")


if __name__ == "__main__":
    main()
