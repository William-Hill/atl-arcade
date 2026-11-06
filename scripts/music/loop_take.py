#!/usr/bin/env python3
"""Measure an ACE-Step take against its nominal tempo grid and cut a seamless loop.

  ~/tools/ACE-Step-1.5/.venv-cpu/bin/python scripts/music/loop_take.py TAKE.wav --bpm 100 --bars 24 [--out loop.wav]

Prints one JSON object: the best-fit BPM, the first downbeat, the per-bar
offsets of the onsets from the nominal grid, the drift (linear slope, ms per
bar) and, with --out, the loop window. The loop is exactly `bars` bars long
(bars * 4 * 60 / bpm seconds, a whole number of samples at 48 kHz); its first
`--fade-beats` beats are crossfaded with the audio just past the loop end, so
the wrap from the last sample back to the first continues the take.
"""
import argparse
import json

import librosa
import numpy as np
import soundfile as sf

HOP = 96  # 2 ms at 48 kHz


def fold(env, frame_t, period, res=0.001, sigma=0.004):
    """Circular histogram of the onset envelope at `period`; returns (phase, peak score)."""
    nb = int(round(period / res))
    idx = np.floor((frame_t % period) / res).astype(int) % nb
    h = np.bincount(idx, weights=env, minlength=nb)
    k = np.arange(-4 * int(sigma / res), 4 * int(sigma / res) + 1)
    g = np.exp(-0.5 * (k * res / sigma) ** 2)
    hs = np.real(np.fft.ifft(np.fft.fft(h) * np.fft.fft(np.roll(np.pad(g, (0, nb - len(g))), -len(k) // 2))))
    i = int(np.argmax(hs))
    return i * res, hs[i] / max(1e-9, env.sum()), hs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--bpm", type=float, required=True)
    ap.add_argument("--bars", type=int, default=0)
    ap.add_argument("--out")
    ap.add_argument("--fade-beats", type=float, default=1.0)
    ap.add_argument("--max-drift", type=float, default=2.0, help="ms per bar")
    ap.add_argument("--max-jitter", type=float, default=6.0, help="ms, sd of the bar offsets about the drift line")
    ap.add_argument("--skip-bars", type=int, default=1, help="bars after the first downbeat that the loop may not start in")
    args = ap.parse_args()

    y, sr = sf.read(args.wav, always_2d=True)
    mono = y.mean(axis=1).astype(np.float32)
    env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=HOP)
    env = np.maximum(env - np.median(env), 0)
    t = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=HOP)
    # Low band (kick and bass) and harmonic change for the downbeat.
    low = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=HOP, fmax=200, n_mels=12)
    chroma = librosa.feature.chroma_stft(y=mono, sr=sr, hop_length=HOP * 8)
    nov = np.r_[0, np.sqrt((np.diff(chroma, axis=1) ** 2).sum(axis=0))]
    nov_t = librosa.frames_to_time(np.arange(len(nov)), sr=sr, hop_length=HOP * 8)

    # Tempo: the best fold over +-2 BPM around the nominal value.
    best = (0, args.bpm, 0)
    for bpm in np.arange(args.bpm - 2, args.bpm + 2.0001, 0.005):
        ph, score, _ = fold(env, t, 60 / bpm)
        if score > best[0]:
            best = (score, float(bpm), ph)
    for bpm in np.arange(best[1] - 0.005, best[1] + 0.0051, 0.0005):
        ph, score, _ = fold(env, t, 60 / bpm)
        if score > best[0]:
            best = (score, float(bpm), ph)
    measured_bpm = best[1]

    beat = 60 / args.bpm
    bar = 4 * beat
    phase, beat_score, _ = fold(env, t, beat)
    # Downbeat: which of the four beat slots carries the most kick and chord change.
    slot = []
    for k in range(4):
        at = phase + k * beat
        lk = np.sum(low * (np.abs(((t - at + bar / 2) % bar) - bar / 2) < 0.03))
        ch = np.sum(nov * (np.abs(((nov_t - at + bar / 2) % bar) - bar / 2) < 0.05))
        slot.append((lk / max(1e-9, low.sum()), ch / max(1e-9, nov.sum())))
    score = [a + b for a, b in slot]
    k = int(np.argmax(score))
    first_downbeat = phase + k * beat

    # Per-bar offsets from the nominal grid: the shift that best lines the
    # bar's onsets up with its four grid beats. The search follows the
    # previous bar's offset (+-15 ms), so a take whose tempo is off shows as
    # a steady ramp (its drift), not as a sawtooth that wraps at the limit.
    offsets = []
    prev = 0.0
    n_bars = int((t[-1] - first_downbeat) // bar)
    for b in range(n_bars):
        b0 = first_downbeat + b * bar
        sel = (t >= b0 - beat / 2) & (t < b0 + bar - beat / 2)
        tt, ee = t[sel], env[sel]
        if ee.sum() <= 0:
            offsets.append(None)
            continue
        shifts = prev + np.arange(-0.015, 0.0151, 0.0005) if b else np.arange(-0.04, 0.0401, 0.0005)
        sc = []
        for sh in shifts:
            d = np.abs(((tt - b0 - sh + beat / 2) % beat) - beat / 2)
            sc.append(np.sum(ee * np.exp(-0.5 * (d / 0.006) ** 2)))
        prev = float(shifts[int(np.argmax(sc))])
        offsets.append(round(prev * 1000, 2))

    result = {
        "file": args.wav,
        "sampleRate": sr,
        "seconds": round(len(mono) / sr, 3),
        "nominalBpm": args.bpm,
        "measuredBpm": round(measured_bpm, 4),
        "beatScore": round(float(beat_score), 4),
        "downbeatSlotScores": [round(s, 4) for s in score],
        "firstDownbeat": round(first_downbeat, 4),
        "barOffsetsMs": offsets,
    }

    def drift(lo, hi):
        xs = [(i, o) for i, o in enumerate(offsets[lo:hi]) if o is not None]
        if len(xs) < 3:
            return None, None
        x, o = np.array(xs, dtype=float).T
        slope, icpt = np.polyfit(x, o, 1)
        resid = o - (slope * x + icpt)
        return float(slope), float(np.std(resid))

    if args.bars:
        L = int(round(args.bars * bar * sr))
        F = int(round(args.fade_beats * beat * sr))
        last_start = (len(mono) - L - F) / sr
        cands = []
        for b in range(args.skip_bars, n_bars):
            s_t = first_downbeat + b * bar
            if s_t > last_start:
                break
            sl, sd = drift(b, b + args.bars)
            if sl is None:
                continue
            s = int(round(s_t * sr))
            # Seam: how alike the bar at the loop start and the bar just past the end are.
            A = librosa.feature.mfcc(y=mono[s : s + int(bar * sr)], sr=sr, n_mfcc=20).mean(axis=1)
            B = librosa.feature.mfcc(y=mono[s + L : s + L + int(bar * sr)], sr=sr, n_mfcc=20).mean(axis=1)
            seam = float(np.dot(A, B) / (np.linalg.norm(A) * np.linalg.norm(B)))
            rms = float(np.sqrt(np.mean(mono[s : s + L] ** 2)))
            cands.append({"startBar": b, "start": s, "drift": sl, "jitter": sd, "seam": seam, "rms": rms})
        ok = [c for c in cands if abs(c["drift"]) <= args.max_drift and c["jitter"] <= args.max_jitter]
        result["candidates"] = len(cands)
        if not ok:
            result["rejected"] = "no window within the drift and jitter limits" if cands else "take too short for the loop"
            print(json.dumps(result, default=float))
            return
        loud = max(c["rms"] for c in ok)
        ok = [c for c in ok if c["rms"] >= 0.8 * loud] or ok
        c = max(ok, key=lambda c: c["seam"] - abs(c["drift"]) * 0.01)
        s = c["start"]
        seg = y[s : s + L].copy()
        tail = y[s + L : s + L + F]
        w = np.linspace(0, 1, F, endpoint=False)[:, None]
        seg[:F] = seg[:F] * w + tail * (1 - w)
        offs = [o for o in offsets[c["startBar"] : c["startBar"] + args.bars] if o is not None]
        result["loop"] = {
            "startBar": c["startBar"],
            "startSeconds": round(s / sr, 5),
            "samples": L,
            "seconds": round(L / sr, 5),
            "bars": args.bars,
            "fadeSamples": F,
            "driftMsPerBar": round(c["drift"], 3),
            "jitterMs": round(c["jitter"], 3),
            "meanOffsetMs": round(float(np.mean(offs)), 3),
            "maxAbsOffsetMs": round(float(np.max(np.abs(offs))), 3),
            "seamSimilarity": round(c["seam"], 4),
        }
        if args.out:
            # The loop starts on the bar line plus the mean onset offset, so
            # the beat clock's grid sits on the audible beats.
            sh = int(round(result["loop"]["meanOffsetMs"] / 1000 * sr))
            s2 = s + sh
            seg = y[s2 : s2 + L].copy()
            tail = y[s2 + L : s2 + L + F]
            seg[:F] = seg[:F] * w + tail * (1 - w)
            result["loop"]["startSeconds"] = round(s2 / sr, 5)
            sf.write(args.out, seg, sr, subtype="PCM_24")
    print(json.dumps(result, default=float))


if __name__ == "__main__":
    main()
