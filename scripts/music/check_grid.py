#!/usr/bin/env python3
"""Check the game's music files against the beat clock grid in tracks.json (#20).

  python scripts/music/check_grid.py [--loops 3] [--out reports/m2-music-grid.json]

Needs librosa, soundfile and numpy (as loop_take.py) and ffmpeg.

For each track: decode the Ogg file the game plays (48 kHz), repeat the loop
`--loops` times as the beat clock does (beat 0 = firstDownbeat, the loop
wraps at loopEnd), and find the onsets. Then, for each bar of the beat
clock's grid (bars * 240 / bpm seconds each), find the shift (+-40 ms) that
best lines the bar's onsets up with its 4 grid beats. A correct BPM gives a
flat line of shifts (drift near 0 ms per bar, also across the wraps); a
correct offset gives shifts near 0 ms. The script also folds the whole onset
envelope at the beat length: the peak is the mean beat phase in ms.
Writes one JSON report; src/audio/music-grid.test.js reads it.
"""
import argparse
import json
import os
import subprocess

import librosa
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MUSIC = os.path.join(ROOT, "assets", "music")
SR = 48000
HOP = 96  # 2 ms


def decode(path):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def check(track, loops):
    y = decode(os.path.join(MUSIC, track["file"]))
    s0, s1 = int(round(track["loopStart"] * SR)), int(round(track["loopEnd"] * SR))
    head = y[int(round(track["firstDownbeat"] * SR)) : s1]
    body = np.concatenate([head] + [y[s0:s1]] * (loops - 1))
    env = librosa.onset.onset_strength(y=body, sr=SR, hop_length=HOP)
    env = np.maximum(env - np.median(env), 0)
    t = librosa.frames_to_time(np.arange(len(env)), sr=SR, hop_length=HOP)
    beat = 60 / track["bpm"]
    bar = 4 * beat
    n_bars = int(round(len(body) / SR / bar))
    offsets = []
    for b in range(n_bars):
        b0 = b * bar
        sel = (t >= b0 - beat / 2) & (t < b0 + bar - beat / 2)
        tt, ee = t[sel], env[sel]
        shifts = np.arange(-0.04, 0.0401, 0.0005)
        sc = [np.sum(ee * np.exp(-0.5 * ((np.abs(((tt - b0 - sh + beat / 2) % beat) - beat / 2)) / 0.006) ** 2)) for sh in shifts]
        offsets.append(round(float(shifts[int(np.argmax(sc))]) * 1000, 2))
    x = np.arange(len(offsets), dtype=float)
    slope, icpt = np.polyfit(x, offsets, 1)
    # Fold: the mean beat phase of all onsets, -beat/2..beat/2 in ms.
    res = 0.0005
    nb = int(round(beat / res))
    idx = np.floor(((t + beat / 2) % beat) / res).astype(int) % nb
    h = np.convolve(np.bincount(idx, weights=env, minlength=nb), np.exp(-0.5 * (np.arange(-24, 25) * res / 0.004) ** 2), mode="same")
    fold_ms = (int(np.argmax(h)) * res - beat / 2) * 1000
    wraps = [round((track["loopEnd"] - track["firstDownbeat"]) / bar + k * track["bars"]) for k in range(loops - 1)]
    return {
        "id": track["id"],
        "bpm": track["bpm"],
        "bars": track["bars"],
        "loops": loops,
        "barsChecked": len(offsets),
        "wrapBars": wraps,
        "meanOffsetMs": round(float(np.mean(offsets)), 3),
        "maxAbsOffsetMs": round(float(np.max(np.abs(offsets))), 3),
        "driftMsPerBar": round(float(slope), 4),
        "driftMsOverRun": round(float(slope) * (len(offsets) - 1), 3),
        "foldPhaseMs": round(fold_ms, 2),
        "barOffsetsMs": offsets,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loops", type=int, default=3)
    ap.add_argument("--out", default=os.path.join(ROOT, "reports", "m2-music-grid.json"))
    ap.add_argument("--ids", nargs="*")
    args = ap.parse_args()
    meta = json.load(open(os.path.join(MUSIC, "tracks.json")))
    tracks = [t for t in meta["tracks"] if not args.ids or t["id"] in args.ids]
    out = {"tool": "scripts/music/check_grid.py", "sampleRate": SR, "librosa": librosa.__version__, "tracks": []}
    for t in tracks:
        r = check(t, args.loops)
        out["tracks"].append(r)
        print(f"{r['id']}: {r['bpm']} BPM, {r['barsChecked']} bars, mean {r['meanOffsetMs']} ms, max {r['maxAbsOffsetMs']} ms, drift {r['driftMsPerBar']} ms/bar, fold {r['foldPhaseMs']} ms")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
