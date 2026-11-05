"""Evidence for the full PBR ground sets (#158), from the sets on disk and
the screenshots of scripts/assets/ground-pbr-shots.mjs:

  python3 scripts/assets/ground-pbr-evidence.py <shots dir>

Writes into <shots dir>:
- contact-sheet.png: per set, the three maps and the rendered swatch (top
  and skating height) in the game's pbr light.
- tiling-<set>.png: each map tiled 3 x 3, to see seams and repeats.
- pair-trail.png, pair-street.png: BEFORE (the game) | AFTER (the preview).
- evidence.json and evidence.md: the seam ratio of every map (the step
  across the tile edge over the mean step inside: about 1 is seamless), the
  repeat score, the rendered JPG vs KTX2 PSNR, and the download and GPU
  memory per set and tier.
"""

import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
SETS = ["sidewalk", "brick", "asphalt", "trail"]
MAPS = ["albedo", "normal", "orm"]
TIERS = {"high": 1024, "phone": 512}
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def label(img, text, size=26):
    d = ImageDraw.Draw(img)
    f = font(size)
    box = d.textbbox((0, 0), text, font=f)
    d.rectangle([0, 0, box[2] + 20, box[3] + 14], fill=(0, 0, 0))
    d.text((10, 6), text, font=f, fill=(255, 255, 255))
    return img


def arr(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255


def seam_ratio(a):
    inner = (np.abs(np.diff(a, axis=0)).mean() + np.abs(np.diff(a, axis=1)).mean()) / 2
    edge = (np.abs(a[0] - a[-1]).mean() + np.abs(a[:, 0] - a[:, -1]).mean()) / 2
    return round(float(edge / inner), 3)


def psnr(a, b):
    mse = ((a - b) ** 2).mean()
    return round(float(10 * np.log10(1 / mse)), 2) if mse > 0 else 99.0


def gpu(size, bpp):
    total, s = 0, size
    while s >= 1:
        total += s * s * bpp
        s //= 2
    return total


def mb(b):
    return f"{b / 1e6:.2f}"


def main(shots):
    shots = pathlib.Path(shots)
    out = {"sets": {}, "pairs": {}, "ktx2Render": {}}
    cells = []
    for s in SETS:
        d = ROOT / "assets/textures/ground-pbr" / s
        meta = json.loads((d / "set.json").read_text())
        seams = {m: seam_ratio(arr(d / f"{m}_high.jpg")) for m in MAPS}
        # Tiling sheet: each map 3 x 3 at 256 px a tile.
        row = []
        for m in MAPS:
            t = Image.open(d / f"{m}_phone.jpg").convert("RGB").resize((256, 256), Image.LANCZOS)
            sheet = Image.new("RGB", (768, 768))
            for i in range(3):
                for j in range(3):
                    sheet.paste(t, (i * 256, j * 256))
            row.append(label(sheet, f"{s} {m} 3x3 (seam {seams[m]})", 22))
        tiling = Image.new("RGB", (768 * 3 + 16, 768), (255, 255, 255))
        for i, im in enumerate(row):
            tiling.paste(im, (i * 776, 0))
        tiling.save(shots / f"tiling-{s}.png")
        tiers = {}
        for tier, size in TIERS.items():
            f = meta["files"]
            jpg = sum(f[f"{m}_{tier}.jpg"] for m in MAPS)
            ktx = sum(f[f"{m}_{tier}.ktx2"] for m in MAPS)
            tiers[tier] = {"downloadJpg": jpg, "downloadKtx2": ktx, "gpuJpg": 3 * gpu(size, 4), "gpuKtx2": 3 * gpu(size, 1)}
        render = {}
        a, b = shots / f"swatch-{s}-skate.png", shots / f"swatch-{s}-skate-ktx2.png"
        if a.exists() and b.exists():
            render = {"swatchSkatePsnr": psnr(arr(a), arr(b))}
        out["sets"][s] = {"asset": meta["asset"], "tileMeters": meta["tileMeters"], "seam": seams, "blotchAfter": meta["metricsAfter"]["blotch"], "metricsAfter": meta["metricsAfter"], "ktx2Quality": meta["ktx2Quality"], "tiers": tiers, **render}
        # Contact sheet row: maps + rendered swatches.
        thumbs = [label(Image.open(d / f"{m}_phone.jpg").convert("RGB").resize((360, 360)), f"{s}: {m}", 18) for m in MAPS]
        for v in ["top", "skate"]:
            p = shots / f"swatch-{s}-{v}.png"
            if p.exists():
                im = Image.open(p).convert("RGB")
                im = im.crop((280, 0, 1000, 720)).resize((360, 360), Image.LANCZOS)
                thumbs.append(label(im, f"{s}: in game, {'top' if v == 'top' else '1.6 m'}", 18))
        cells.append(thumbs)
    cols = max(len(r) for r in cells)
    sheet = Image.new("RGB", (cols * 368, len(cells) * 368 + 50), (255, 255, 255))
    ImageDraw.Draw(sheet).text((10, 10), "Ground PBR sets (#158): albedo | normal | ORM (R AO, G rough, B metal) | rendered, pbr look", font=font(24), fill=(0, 0, 0))
    for r, row in enumerate(cells):
        for c, im in enumerate(row):
            sheet.paste(im, (c * 368, 50 + r * 368))
    sheet.save(shots / "contact-sheet.png")
    for name in ["trail", "street"]:
        b, a = shots / f"{name}-BEFORE.png", shots / f"{name}-AFTER.png"
        if not (a.exists() and b.exists()):
            continue
        pair = Image.new("RGB", (2560 + 16, 720), (255, 255, 255))
        pair.paste(label(Image.open(b).convert("RGB"), f"BEFORE: {name}, current game (pbr look)"), (0, 0))
        pair.paste(label(Image.open(a).convert("RGB"), f"AFTER: {name}, ground-pbr preview, same camera and light"), (1296, 0))
        pair.save(shots / f"pair-{name}.png")
        k = shots / f"{name}-AFTER-ktx2.png"
        out["pairs"][name] = {"beforeAfterPsnr": psnr(arr(a), arr(b))}
        if k.exists():
            out["ktx2Render"][name] = psnr(arr(a), arr(k))
    (shots / "evidence.json").write_text(json.dumps(out, indent=2) + "\n")
    lines = ["| Set | Tier | Download JPG (MB) | Download KTX2 (MB) | GPU JPG, RGBA8 + mips (MB) | GPU KTX2, BC7/ASTC + mips (MB) |", "|---|---|---|---|---|---|"]
    for s, v in out["sets"].items():
        for tier, t in v["tiers"].items():
            lines.append(f"| {s} | {tier} ({TIERS[tier]} px) | {mb(t['downloadJpg'])} | {mb(t['downloadKtx2'])} | {mb(t['gpuJpg'])} | {mb(t['gpuKtx2'])} |")
    lines += ["", "| Set | Scan (CC0) | Tile (m) | Seam albedo / normal / ORM | Blotch (repeat) | Swatch JPG vs KTX2 render PSNR (dB) |", "|---|---|---|---|---|---|"]
    for s, v in out["sets"].items():
        sm = v["seam"]
        lines.append(f"| {s} | {v['asset']} | {v['tileMeters']} | {sm['albedo']} / {sm['normal']} / {sm['orm']} | {v['blotchAfter']} | {v.get('swatchSkatePsnr', '-')} |")
    (shots / "evidence.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(json.dumps({"pairs": out["pairs"], "ktx2Render": out["ktx2Render"]}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ground-pbr-shots")
