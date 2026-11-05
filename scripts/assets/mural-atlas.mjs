// Paints the pbr mural atlas: 16 original mural designs on a 4 x 4 atlas
// (the same cell layout as createMuralAtlas() in src/render/murals.js and
// muralMesh() in src/level/geo/geo-mesh.js), in headless Chromium with the 2D
// canvas. Every shape is drawn from code with a fixed seed, so a rerun gives
// the same pixels. No photos, no image model, no third-party art.
//
// Each design is painted on a 3:1 "wall" (1536 x 512, the median aspect of
// the BeltLine murals, see docs/murals.md), then a paint pass adds brush
// strokes, roughness, weathering, and a ragged dry-brush edge that shows the
// brick or stucco wall under it. The 3:1 wall is squeezed into its square
// cell; the mural quad stretches it back.
//   node scripts/assets/mural-atlas.mjs [--out assets/murals] [--sheet docs/murals] [--seed 1979] [--size 2048] [--quality 0.82]
// Writes mural-atlas.jpg (color, sRGB), mural-roughness.jpg (linear, red =
// roughness / 0.85), provenance.json, and the contact sheet.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { MURAL_WORDS } from "../../src/render/murals.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const out = opt("--out", join(here, "../../assets/murals"));
const sheetDir = opt("--sheet", join(here, "../../docs/murals"));
const seed = Number(opt("--seed", 1979));
const size = Number(opt("--size", 2048));
const quality = Number(opt("--quality", 0.82));
const roughSize = size / 4;

// One entry per atlas cell (cell = row * 4 + column, row 0 at the top).
// `word` is MURAL_WORDS[cell] (issue #80: no neighborhood names).
const DESIGNS = [
  {
    name: "Peach sunset skyline",
    wall: "brick",
    motifs: ["skyline silhouette", "sunset", "tree canopy"],
  },
  {
    name: "Trail through the canopy",
    wall: "stucco",
    motifs: ["the BeltLine trail", "forest canopy", "skaters and walkers"],
  },
  {
    name: "Skater over rainbow arcs",
    wall: "brick",
    motifs: ["roller skater", "dogwood petals", "color arcs"],
  },
  {
    name: "Dogwood branch",
    wall: "brick",
    motifs: ["dogwood blossoms", "branch", "bokeh"],
  },
  {
    name: "Wheel sun over the Piedmont",
    wall: "stucco",
    motifs: ["skate wheel sun", "rolling hills", "pines", "trail"],
  },
  {
    name: "Three peaches",
    wall: "brick",
    motifs: ["peaches", "peach leaves", "dogwood"],
  },
  {
    name: "River flow with heron",
    wall: "stucco",
    motifs: ["river", "great blue heron", "fish", "river stones"],
  },
  {
    name: "Stride sequence",
    wall: "brick",
    motifs: ["skaters in motion", "sun stripes"],
  },
  {
    name: "Thrasher at dawn",
    wall: "stucco",
    motifs: ["brown thrasher (state bird)", "pine forest", "dawn"],
  },
  {
    name: "Record sun and dancers",
    wall: "brick",
    motifs: ["music", "vinyl record", "sound waves", "dancers"],
  },
  {
    name: "Magnolia sunshine",
    wall: "stucco",
    motifs: ["magnolia blossoms", "sun"],
  },
  {
    name: "Porch row neighbors",
    wall: "brick",
    motifs: ["shotgun houses", "neighbors", "pennants", "community"],
  },
  {
    name: "Smooth leaves",
    wall: "stucco",
    motifs: ["magnolia leaves (abstract)", "color fields"],
  },
  {
    name: "Crowd wave",
    wall: "brick",
    motifs: ["community", "dancing crowd", "wave ribbon", "confetti"],
  },
  {
    name: "Night rink",
    wall: "brick",
    motifs: ["roller rink", "skaters", "lights", "stars"],
  },
  {
    name: "Skyline night shine",
    wall: "stucco",
    motifs: ["skyline silhouette", "moon", "stars", "fireflies", "magnolia"],
  },
];

// Runs in the page. Everything it needs is inside it.
function paint({ size, roughSize, seed, words, designs, quality }) {
  const W = 1536;
  const H = 512;
  const TAU = Math.PI * 2;
  const S = size / 4;
  const RS = roughSize / 4;
  const FONT = "DejaVu Sans";

  function mulberry(a) {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNoise(s) {
    const r = mulberry(s);
    const perm = new Uint8Array(512);
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
    const g = new Float32Array(256).map(() => r());
    const h = (ix, iy) => g[perm[(perm[ix & 255] + iy) & 255]];
    const noise = (x, y) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const u = fx * fx * (3 - 2 * fx);
      const v = fy * fy * (3 - 2 * fy);
      const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * u;
      const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * u;
      return a + (b - a) * v;
    };
    const fbm = (x, y, oct = 4) => {
      let sum = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < oct; o += 1) {
        sum += noise(x, y) * amp;
        norm += amp;
        amp *= 0.5;
        x *= 2.03;
        y *= 2.03;
      }
      return sum / norm;
    };
    return { noise, fbm, hash: h };
  }
  const smooth = (a, b, x) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const hex = (c) => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];

  // ---------- motif helpers (all original shapes) ----------
  function vgrad(ctx, stops, y0 = 0, y1 = H) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    return g;
  }
  function fillAll(ctx, style) {
    ctx.fillStyle = style;
    ctx.fillRect(0, 0, W, H);
  }
  function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function leaf(ctx, x, y, len, wid, ang, color, rib) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.25, -wid, len * 0.75, -wid, len, 0);
    ctx.bezierCurveTo(len * 0.75, wid, len * 0.25, wid, 0, 0);
    ctx.fill();
    if (rib) {
      ctx.strokeStyle = rib;
      ctx.lineWidth = Math.max(1.5, wid * 0.12);
      ctx.beginPath();
      ctx.moveTo(len * 0.05, 0);
      ctx.quadraticCurveTo(len * 0.5, -wid * 0.12, len * 0.95, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
  function dogwood(
    ctx,
    x,
    y,
    r,
    rot,
    {
      petal = "#f6efe2",
      shade = "#e2d6c2",
      tip = "#b4566b",
      center = "#b9b45a",
    } = {},
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    for (let k = 0; k < 4; k += 1) {
      ctx.save();
      ctx.rotate((k * TAU) / 4 + Math.sin(k * 1.7) * 0.08);
      const g = ctx.createLinearGradient(0, 0, r, 0);
      g.addColorStop(0, shade);
      g.addColorStop(0.35, petal);
      g.addColorStop(1, petal);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(r * 0.1, 0);
      ctx.bezierCurveTo(
        r * 0.28,
        -r * 0.58,
        r * 0.92,
        -r * 0.56,
        r * 1.0,
        -r * 0.12,
      );
      ctx.lineTo(r * 0.88, 0);
      ctx.lineTo(r * 1.0, r * 0.12);
      ctx.bezierCurveTo(r * 0.92, r * 0.56, r * 0.28, r * 0.58, r * 0.1, 0);
      ctx.fill();
      ctx.fillStyle = tip;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.ellipse(r * 0.9, 0, r * 0.08, r * 0.14, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = shade;
      ctx.lineWidth = Math.max(1, r * 0.03);
      for (const s of [-0.22, 0, 0.22]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.2, 0);
        ctx.quadraticCurveTo(r * 0.55, r * s * 1.3, r * 0.82, r * s);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    for (let i = 0; i < 9; i += 1)
      circle(
        ctx,
        Math.cos(i * 2.4) * r * 0.1 * Math.sqrt(i),
        Math.sin(i * 2.4) * r * 0.1 * Math.sqrt(i),
        r * 0.07,
        i % 2 ? center : "#8f9a3c",
      );
    ctx.restore();
  }
  // An open magnolia seen from above: six broad petals around a green
  // cone with a ring of red-brown stamens.
  function magnolia(ctx, x, y, r, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const petal = (ang, len, wid, c0, c1) => {
      ctx.save();
      ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, 0, 0, -len);
      g.addColorStop(0, c0);
      g.addColorStop(0.5, c1);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(
        -wid * 1.1,
        -len * 0.35,
        -wid * 0.7,
        -len * 0.92,
        0,
        -len,
      );
      ctx.bezierCurveTo(wid * 0.7, -len * 0.92, wid * 1.1, -len * 0.35, 0, 0);
      ctx.fill();
      ctx.strokeStyle = "rgba(160,140,110,0.5)";
      ctx.lineWidth = Math.max(1, r * 0.012);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -len * 0.15);
      ctx.quadraticCurveTo(wid * 0.08, -len * 0.55, 0, -len * 0.9);
      ctx.stroke();
      ctx.restore();
    };
    for (let k = 0; k < 6; k += 1)
      petal((k * TAU) / 6 + 0.26, r, r * 0.42, "#e6dcc8", "#fbf7ee");
    for (let k = 0; k < 3; k += 1)
      petal((k * TAU) / 3 + 0.8, r * 0.62, r * 0.3, "#eae0cc", "#fffaf2");
    for (let i = 0; i < 26; i += 1) {
      const a = (i * TAU) / 26;
      ctx.strokeStyle = i % 2 ? "#a8503a" : "#c0704a";
      ctx.lineWidth = r * 0.03;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12);
      ctx.lineTo(Math.cos(a) * r * 0.24, Math.sin(a) * r * 0.24);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(
      -r * 0.03,
      -r * 0.03,
      r * 0.02,
      0,
      0,
      r * 0.14,
    );
    g.addColorStop(0, "#d8d88a");
    g.addColorStop(1, "#8f9a4a");
    circle(ctx, 0, 0, r * 0.14, g);
    ctx.restore();
  }
  function magnoliaLeaves(ctx, x, y, r, rot, rand) {
    for (let k = 0; k < 5; k += 1) {
      const a = rot + (k - 2) * 0.6 + (rand() - 0.5) * 0.2;
      const under = k % 2 === 0;
      leaf(
        ctx,
        x,
        y,
        r * (1.9 + rand() * 0.5),
        r * 0.5,
        a,
        under ? "#8a5a2e" : "#2f5d3a",
        under ? "#b07a44" : "#6f9f6a",
      );
    }
  }
  function peach(ctx, x, y, r, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    leaf(
      ctx,
      r * 0.05,
      -r * 0.92,
      r * 1.1,
      r * 0.3,
      -0.5,
      "#4f8f4a",
      "#2f6b3e",
    );
    leaf(
      ctx,
      -r * 0.05,
      -r * 0.92,
      r * 0.8,
      r * 0.24,
      -2.4,
      "#3f7a44",
      "#2f5d3a",
    );
    const g = ctx.createRadialGradient(
      -r * 0.35,
      -r * 0.35,
      r * 0.1,
      0,
      0,
      r * 1.05,
    );
    g.addColorStop(0, "#ffd99a");
    g.addColorStop(0.45, "#f7a35f");
    g.addColorStop(0.8, "#e8674f");
    g.addColorStop(1, "#c94a44");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.82);
    ctx.bezierCurveTo(
      r * 0.7,
      -r * 1.05,
      r * 1.1,
      -r * 0.3,
      r * 0.95,
      r * 0.25,
    );
    ctx.bezierCurveTo(r * 0.8, r * 0.85, r * 0.3, r * 1.0, 0, r * 0.95);
    ctx.bezierCurveTo(
      -r * 0.3,
      r * 1.0,
      -r * 0.8,
      r * 0.85,
      -r * 0.95,
      r * 0.25,
    );
    ctx.bezierCurveTo(-r * 1.1, -r * 0.3, -r * 0.7, -r * 1.05, 0, -r * 0.82);
    ctx.fill();
    ctx.strokeStyle = "rgba(170,60,50,0.55)";
    ctx.lineWidth = r * 0.06;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.78);
    ctx.bezierCurveTo(r * 0.25, -r * 0.3, r * 0.22, r * 0.4, 0, r * 0.9);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,240,210,0.35)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.45, -r * 0.35, r * 0.18, r * 0.3, 0.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  function skyline(
    ctx,
    x0,
    x1,
    base,
    hmax,
    color,
    rand,
    { windows = null } = {},
  ) {
    ctx.fillStyle = color;
    let x = x0;
    const tops = [];
    while (x < x1) {
      const w = 22 + rand() * 46;
      const tall = rand() < 0.3;
      const h = hmax * (tall ? 0.6 + rand() * 0.4 : 0.22 + rand() * 0.38);
      ctx.fillRect(x, base - h, w, h + 2);
      const kind = rand();
      if (tall && kind < 0.35) {
        ctx.beginPath();
        ctx.moveTo(x, base - h);
        ctx.lineTo(x + w / 2, base - h - w * 0.7);
        ctx.lineTo(x + w, base - h);
        ctx.fill();
        ctx.fillRect(x + w / 2 - 1.5, base - h - w * 0.7 - 26, 3, 28);
      } else if (tall && kind < 0.6) {
        ctx.fillRect(x + w * 0.2, base - h - h * 0.12, w * 0.6, h * 0.12 + 1);
        ctx.fillRect(x + w * 0.35, base - h - h * 0.2, w * 0.3, h * 0.1 + 1);
      } else if (tall && kind < 0.8) {
        ctx.beginPath();
        ctx.arc(x + w / 2, base - h, w / 2, Math.PI, 0);
        ctx.fill();
      }
      tops.push([x, w, h]);
      x += w + 2 + rand() * 10;
    }
    if (windows) {
      ctx.fillStyle = windows;
      for (const [bx, w, h] of tops)
        for (let wy = base - h + 8; wy < base - 6; wy += 11)
          for (let wx = bx + 5; wx < bx + w - 5; wx += 9)
            if (rand() < 0.28) ctx.fillRect(wx, wy, 4, 5);
    }
  }
  function canopyRow(ctx, y, rmin, rmax, colors, rand, x0 = -40, x1 = W + 40) {
    for (let x = x0; x < x1; x += rmin * 0.9) {
      const r = rmin + rand() * (rmax - rmin);
      const c = colors[Math.floor(rand() * colors.length)];
      circle(ctx, x, y - r * 0.4 + rand() * r * 0.3, r, c);
    }
    ctx.fillStyle = colors[0];
    ctx.fillRect(x0, y, x1 - x0, H - y + 10);
  }
  function pine(ctx, x, base, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - h * 0.03, base - h * 0.2, h * 0.06, h * 0.2);
    for (let k = 0; k < 4; k += 1) {
      const y = base - h * 0.15 - k * h * 0.2;
      const w = h * (0.34 - k * 0.07);
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.lineTo(x, y - h * 0.34);
      ctx.lineTo(x + w, y);
      ctx.fill();
    }
  }
  function hills(ctx, base, amp, freq, phase, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H + 10);
    for (let x = 0; x <= W; x += 8)
      ctx.lineTo(
        x,
        base -
          amp *
            (0.6 * Math.sin((x / W) * TAU * freq + phase) +
              0.4 * Math.sin((x / W) * TAU * freq * 2.3 + phase * 1.7)),
      );
    ctx.lineTo(W, H + 10);
    ctx.fill();
  }
  // A roller skater (side view, facing +x) with feet at (x, y), h tall.
  // `phase` 0..1 swings the stride.
  function skater(
    ctx,
    x,
    y,
    h,
    color,
    phase = 0,
    { skin = null, skate = null, flip = false } = {},
  ) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    const s = Math.sin(phase * TAU);
    const hip = [0, -h * 0.5];
    const lean = 0.32;
    const sh = [
      hip[0] + Math.sin(lean) * h * 0.3,
      hip[1] - Math.cos(lean) * h * 0.3,
    ];
    const limb = (pts, w) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    };
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const back = [-h * (0.32 + 0.08 * s), -h * 0.06];
    const knee1 = [h * 0.14, -h * 0.3];
    const front = [h * (0.12 + 0.06 * s), -h * 0.05];
    limb([hip, [-h * 0.12, -h * 0.28], back], h * 0.085);
    limb([hip, knee1, front], h * 0.09);
    const skateFoot = (p, ang) => {
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(ang);
      ctx.fillStyle = skate ?? color;
      ctx.beginPath();
      ctx.roundRect(-h * 0.05, -h * 0.05, h * 0.15, h * 0.07, h * 0.02);
      ctx.fill();
      for (const wx of [-h * 0.03, h * 0.02, h * 0.07])
        circle(ctx, wx, h * 0.035, h * 0.022, color);
      ctx.restore();
    };
    skateFoot(back, -0.35);
    skateFoot(front, 0);
    ctx.lineWidth = h * 0.15;
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(sh[0], sh[1]);
    ctx.stroke();
    limb(
      [
        sh,
        [sh[0] + h * (0.14 + 0.06 * s), sh[1] + h * 0.1],
        [sh[0] + h * (0.26 + 0.04 * s), sh[1] + h * 0.02],
      ],
      h * 0.06,
    );
    limb(
      [
        sh,
        [sh[0] - h * 0.13, sh[1] + h * 0.1],
        [sh[0] - h * (0.26 + 0.04 * s), sh[1] + h * 0.16],
      ],
      h * 0.06,
    );
    circle(ctx, sh[0] + h * 0.06, sh[1] - h * 0.12, h * 0.075, skin ?? color);
    ctx.restore();
  }
  function person(ctx, x, base, h, color, arms = 0.4, { skin = null } = {}) {
    ctx.save();
    ctx.translate(x, base);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-h * 0.13, 0);
    ctx.lineTo(-h * 0.1, -h * 0.62);
    ctx.quadraticCurveTo(0, -h * 0.74, h * 0.1, -h * 0.62);
    ctx.lineTo(h * 0.13, 0);
    ctx.fill();
    ctx.lineWidth = h * 0.07;
    for (const side of [-1, 1]) {
      const a = side * arms;
      ctx.beginPath();
      ctx.moveTo(side * h * 0.09, -h * 0.6);
      ctx.lineTo(
        side * h * 0.09 + Math.sin(a) * h * 0.38,
        -h * 0.6 - Math.cos(a) * h * 0.38 * (arms > 1.6 ? -1 : 1),
      );
      ctx.stroke();
    }
    circle(ctx, 0, -h * 0.84, h * 0.12, skin ?? color);
    ctx.restore();
  }
  function note(ctx, x, y, s, color, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.5, s * 0.35, -0.4, 0, TAU);
    ctx.fill();
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    ctx.moveTo(s * 0.43, -s * 0.1);
    ctx.lineTo(s * 0.43, -s * 1.6);
    ctx.quadraticCurveTo(s * 0.9, -s * 1.3, s * 1.0, -s * 0.8);
    ctx.stroke();
    ctx.restore();
  }
  function word(
    ctx,
    text,
    x,
    y,
    maxW,
    size,
    {
      font = `900 SIZEpx ${FONT}`,
      fill = "#f3ead8",
      outline = null,
      shadow = null,
      rot = 0,
      align = "center",
      outlineW = 0.12,
    } = {},
  ) {
    let px = size;
    const set = () => (ctx.font = font.replace("SIZE", px.toFixed(1)));
    set();
    while (ctx.measureText(text).width > maxW && px > 10) {
      px *= 0.96;
      set();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.fillText(text, px * 0.06, px * 0.07);
      if (outline) {
        ctx.strokeStyle = shadow;
        ctx.lineWidth = px * outlineW;
        ctx.strokeText(text, px * 0.06, px * 0.07);
      }
    }
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = px * outlineW;
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return px;
  }
  function glow(ctx, color, blur, fn) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    fn();
    ctx.restore();
  }

  // ---------- the 16 designs ----------
  const DRAW = [
    // 0 ATL: peach sunset skyline.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#e8775f", "#f2a65a", "#f7cf87", "#fbe6b8"]));
      const sx = W * 0.64;
      const sy = H * 0.66;
      const sr = H * 0.46;
      const sg = ctx.createLinearGradient(0, sy - sr, 0, sy);
      sg.addColorStop(0, "#fbe08a");
      sg.addColorStop(1, "#ef8a4c");
      circle(ctx, sx, sy, sr, sg);
      ctx.fillStyle = "#f7cf87";
      for (let k = 0; k < 6; k += 1)
        ctx.fillRect(
          sx - sr,
          sy - sr * 0.45 + k * sr * 0.13,
          sr * 2,
          3 + k * 3.2,
        );
      skyline(ctx, W * 0.3, W * 1.02, H * 0.84, H * 0.62, "#5b3a5e", r);
      skyline(ctx, -20, W * 0.34, H * 0.86, H * 0.32, "#6e4a68", r);
      canopyRow(ctx, H * 0.9, 26, 46, ["#2f6340", "#3f7a4a", "#4f8f4a"], r);
      word(ctx, wd, W * 0.2, H * 0.47, W * 0.32, H * 0.6, {
        fill: "#f6eedd",
        outline: "#1f5f66",
        shadow: "#5b3a5e",
        outlineW: 0.08,
      });
    },
    // 1 BELTLINE: the trail through the canopy.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#a9d8e2", "#d6eee9", "#f3f1dc"]));
      canopyRow(ctx, H * 0.52, 30, 55, ["#8fbf7a", "#a2c98a", "#7fb07a"], r);
      canopyRow(ctx, H * 0.66, 36, 70, ["#5f9a5a", "#6fa862", "#4f8a50"], r);
      ctx.fillStyle = "#e8dcc6";
      ctx.beginPath();
      ctx.moveTo(W * 0.3, H + 5);
      ctx.bezierCurveTo(
        W * 0.48,
        H * 0.82,
        W * 0.4,
        H * 0.66,
        W * 0.56,
        H * 0.5,
      );
      ctx.lineTo(W * 0.575, H * 0.5);
      ctx.bezierCurveTo(W * 0.48, H * 0.68, W * 0.7, H * 0.82, W * 0.76, H + 5);
      ctx.fill();
      ctx.strokeStyle = "#f6efe0";
      ctx.lineWidth = 3;
      ctx.setLineDash([16, 14]);
      ctx.beginPath();
      ctx.moveTo(W * 0.53, H + 5);
      ctx.bezierCurveTo(
        W * 0.56,
        H * 0.82,
        W * 0.46,
        H * 0.66,
        W * 0.567,
        H * 0.5,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      canopyRow(ctx, H * 0.96, 30, 60, ["#2f6340", "#3a7045"], r, -40, W * 0.3);
      canopyRow(
        ctx,
        H * 0.96,
        30,
        60,
        ["#2f6340", "#3a7045"],
        r,
        W * 0.78,
        W + 40,
      );
      skater(ctx, W * 0.5, H * 0.86, H * 0.26, "#2b4a6b", 0.2, {
        skin: "#8a5a3c",
        skate: "#e8665a",
      });
      skater(ctx, W * 0.53, H * 0.64, H * 0.12, "#6b3a5e", 0.7, {
        skin: "#c08a60",
        skate: "#f2b544",
      });
      person(ctx, W * 0.63, H * 0.9, H * 0.22, "#e9813f", 0.25, {
        skin: "#5a3a2a",
      });
      person(ctx, W * 0.66, H * 0.91, H * 0.2, "#2a8c8c", 0.3, {
        skin: "#d9a07a",
      });
      person(ctx, W * 0.555, H * 0.58, H * 0.08, "#d9577a", 0.3);
      ctx.fillStyle = "#e8665a";
      ctx.beginPath();
      ctx.moveTo(W * 0.06, H * 0.12);
      ctx.lineTo(W * 0.42, H * 0.1);
      ctx.lineTo(W * 0.4, H * 0.21);
      ctx.lineTo(W * 0.42, H * 0.32);
      ctx.lineTo(W * 0.06, H * 0.34);
      ctx.lineTo(W * 0.08, H * 0.23);
      ctx.fill();
      word(ctx, wd, W * 0.24, H * 0.22, W * 0.32, H * 0.18, {
        fill: "#fbf3e2",
        shadow: "#a8413c",
      });
    },
    // 2 SKATE ATL: a skater over color arcs.
    (ctx, r, wd) => {
      fillAll(ctx, "#f3ead8");
      const cols = [
        "#2a8c8c",
        "#f2b544",
        "#e8665a",
        "#6b4f9e",
        "#8cc7d9",
        "#f3ead8",
      ];
      cols.forEach((c, i) =>
        circle(ctx, W * 0.72, H * 1.15, H * (1.25 - i * 0.18), c),
      );
      ctx.strokeStyle = "#2b2a4a";
      ctx.lineCap = "round";
      for (let k = 0; k < 6; k += 1) {
        ctx.lineWidth = 7 - k * 0.6;
        ctx.beginPath();
        ctx.moveTo(W * (0.5 - k * 0.012), H * (0.42 + k * 0.07));
        ctx.lineTo(W * (0.6 - k * 0.006), H * (0.42 + k * 0.07));
        ctx.stroke();
      }
      skater(ctx, W * 0.72, H * 0.9, H * 0.78, "#2b2a4a", 0.15, {
        skin: "#7a4a32",
        skate: "#e8665a",
      });
      for (let k = 0; k < 9; k += 1)
        dogwood(
          ctx,
          W * (0.44 + r() * 0.12),
          H * (0.15 + r() * 0.7),
          14 + r() * 14,
          r() * TAU,
        );
      word(ctx, wd, W * 0.24, H * 0.5, W * 0.4, H * 0.34, {
        fill: "#f2b544",
        outline: "#2b2a4a",
        shadow: "#e8665a",
        outlineW: 0.1,
      });
    },
    // 3 DOGWOOD: a blossoming branch.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#1d5a62", "#2a8384", "#3d9a8e"]));
      ctx.globalAlpha = 0.16;
      for (let k = 0; k < 26; k += 1)
        circle(
          ctx,
          r() * W,
          r() * H,
          20 + r() * 60,
          k % 2 ? "#cfe8d8" : "#f6d7a8",
        );
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#5b3a2a";
      ctx.lineCap = "round";
      const branch = (pts, w) => {
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        ctx.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
        ctx.stroke();
      };
      branch(
        [
          -20,
          H * 0.75,
          W * 0.3,
          H * 0.55,
          W * 0.55,
          H * 0.75,
          W * 0.95,
          H * 0.3,
        ],
        22,
      );
      branch(
        [
          W * 0.3,
          H * 0.63,
          W * 0.36,
          H * 0.4,
          W * 0.42,
          H * 0.3,
          W * 0.5,
          H * 0.12,
        ],
        11,
      );
      branch(
        [
          W * 0.62,
          H * 0.62,
          W * 0.66,
          H * 0.8,
          W * 0.72,
          H * 0.88,
          W * 0.8,
          H * 0.9,
        ],
        9,
      );
      branch(
        [
          W * 0.78,
          H * 0.45,
          W * 0.82,
          H * 0.6,
          W * 0.9,
          H * 0.7,
          W * 1.02,
          H * 0.68,
        ],
        8,
      );
      const spots = [
        [0.12, 0.62],
        [0.24, 0.52],
        [0.36, 0.38],
        [0.47, 0.16],
        [0.44, 0.62],
        [0.58, 0.66],
        [0.7, 0.84],
        [0.8, 0.88],
        [0.68, 0.48],
        [0.82, 0.36],
        [0.9, 0.66],
        [0.94, 0.26],
      ];
      for (const [u, v] of spots) {
        leaf(
          ctx,
          W * u,
          H * v,
          50 + r() * 30,
          14,
          r() * TAU,
          "#5f9a4a",
          "#3f7a3a",
        );
        dogwood(
          ctx,
          W * u + (r() - 0.5) * 30,
          H * v + (r() - 0.5) * 20,
          40 + r() * 34,
          r() * TAU,
        );
      }
      word(ctx, wd, W * 0.2, H * 0.2, W * 0.3, H * 0.2, {
        font: `italic 700 SIZEpx Bitstream Charter`,
        fill: "#f6eedd",
        shadow: "#16464c",
      });
    },
    // 4 ROLL ON: a skate wheel sun over Piedmont hills.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#8ccbdc", "#c8e6e2", "#fbefc8"]));
      const wx = W * 0.7;
      const wy = H * 0.36;
      const wr = H * 0.25;
      circle(ctx, wx, wy, wr * 1.25, "rgba(255,226,150,0.5)");
      circle(ctx, wx, wy, wr, "#f2b544");
      circle(ctx, wx, wy, wr * 0.55, "#f7d27a");
      circle(ctx, wx, wy, wr * 0.32, "#e9813f");
      ctx.strokeStyle = "#e9a03a";
      ctx.lineWidth = 6;
      for (let k = 0; k < 10; k += 1) {
        const a = (k * TAU) / 10;
        ctx.beginPath();
        ctx.moveTo(wx + Math.cos(a) * wr * 0.6, wy + Math.sin(a) * wr * 0.6);
        ctx.lineTo(wx + Math.cos(a) * wr * 0.92, wy + Math.sin(a) * wr * 0.92);
        ctx.stroke();
      }
      circle(ctx, wx, wy, wr * 0.12, "#f3ead8");
      hills(ctx, H * 0.6, 40, 1.3, 0.4, "#b9cf7a");
      hills(ctx, H * 0.7, 46, 1.7, 2.1, "#7fb05a");
      for (let k = 0; k < 16; k += 1)
        pine(
          ctx,
          W * (0.02 + k * 0.065 + r() * 0.02),
          H * (0.74 + r() * 0.04),
          70 + r() * 50,
          k % 2 ? "#2f5f3f" : "#3a6b45",
        );
      hills(ctx, H * 0.86, 36, 1.1, 4.0, "#4f8a4a");
      ctx.strokeStyle = "#efe4cc";
      ctx.lineWidth = 26;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-10, H * 0.98);
      ctx.bezierCurveTo(W * 0.3, H * 0.8, W * 0.55, H * 1.02, W + 10, H * 0.84);
      ctx.stroke();
      skater(ctx, W * 0.4, H * 0.89, H * 0.18, "#6b3a5e", 0.4, {
        skin: "#8a5a3c",
        skate: "#f2b544",
      });
      word(ctx, wd, W * 0.24, H * 0.26, W * 0.38, H * 0.3, {
        fill: "#e8665a",
        outline: "#fbf3e2",
        shadow: "#6b3a5e",
        outlineW: 0.1,
      });
    },
    // 5 PEACH: three peaches on a striped field.
    (ctx, r, wd) => {
      for (let k = 0; k < 24; k += 1) {
        ctx.fillStyle = k % 2 ? "#f6cfa0" : "#f3b98a";
        ctx.fillRect((k * W) / 24, 0, W / 24 + 1, H);
      }
      circle(ctx, W * 0.66, H * 0.52, H * 0.46, "#2a8c8c");
      circle(ctx, W * 0.66, H * 0.52, H * 0.4, "#33999a");
      peach(ctx, W * 0.58, H * 0.6, H * 0.2, -0.2);
      peach(ctx, W * 0.75, H * 0.58, H * 0.18, 0.25);
      peach(ctx, W * 0.665, H * 0.42, H * 0.22, 0);
      for (const [u, v] of [
        [0.92, 0.18],
        [0.95, 0.75],
        [0.44, 0.85],
        [0.47, 0.14],
      ])
        dogwood(ctx, W * u, H * v, 34, r() * TAU);
      word(ctx, wd, W * 0.22, H * 0.5, W * 0.36, H * 0.42, {
        fill: "#fbf3e2",
        outline: "#c2493f",
        shadow: "#8a3a3a",
        outlineW: 0.09,
      });
    },
    // 6 FLOW: a river with a heron.
    (ctx, r, wd) => {
      fillAll(ctx, "#cfe8e6");
      const bands = [
        "#a9d6dc",
        "#7fc0cc",
        "#f3ead8",
        "#5aa7b8",
        "#3d8aa6",
        "#cfe8e6",
        "#2f6f96",
        "#24577e",
        "#8cc7d9",
        "#1f4a6b",
      ];
      bands.forEach((c, i) => {
        const y0 = H * (0.12 + i * 0.09);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(0, H + 10);
        for (let x = 0; x <= W; x += 8)
          ctx.lineTo(
            x,
            y0 +
              Math.sin((x / W) * TAU * 1.6 + i * 0.7) * 22 +
              Math.sin((x / W) * TAU * 4 + i) * 6,
          );
        ctx.lineTo(W, H + 10);
        ctx.fill();
      });
      for (let k = 0; k < 14; k += 1) {
        ctx.fillStyle = k % 3 ? "#8a9aa6" : "#a8b4ba";
        ctx.beginPath();
        ctx.ellipse(
          r() * W,
          H * (0.9 + r() * 0.08),
          30 + r() * 40,
          12 + r() * 10,
          0,
          0,
          TAU,
        );
        ctx.fill();
      }
      for (let k = 0; k < 6; k += 1) {
        const fx = W * (0.3 + r() * 0.4);
        const fy = H * (0.55 + r() * 0.25);
        ctx.fillStyle = "#e9813f";
        ctx.beginPath();
        ctx.ellipse(fx, fy, 22, 8, 0.1, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(fx - 18, fy);
        ctx.lineTo(fx - 32, fy - 9);
        ctx.lineTo(fx - 32, fy + 9);
        ctx.fill();
      }
      // Heron.
      ctx.save();
      ctx.translate(W * 0.82, H * 0.86);
      ctx.fillStyle = "#4f6584";
      ctx.strokeStyle = "#3d4f6a";
      ctx.lineCap = "round";
      ctx.lineWidth = 6;
      for (const lx of [-8, 8]) {
        ctx.beginPath();
        ctx.moveTo(lx, -150);
        ctx.lineTo(lx * 1.5, 0);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, -185, 62, 40, -0.35, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(-40, -200);
      ctx.bezierCurveTo(-70, -250, -20, -270, -40, -320);
      ctx.stroke();
      circle(ctx, -42, -328, 16, "#4f6584");
      ctx.fillStyle = "#e2b04a";
      ctx.beginPath();
      ctx.moveTo(-50, -334);
      ctx.lineTo(-110, -322);
      ctx.lineTo(-50, -320);
      ctx.fill();
      ctx.fillStyle = "#cfd8e2";
      ctx.beginPath();
      ctx.ellipse(10, -175, 48, 18, -0.4, 0, TAU);
      ctx.fill();
      ctx.restore();
      word(ctx, wd, W * 0.2, H * 0.24, W * 0.3, H * 0.34, {
        fill: "#fbf3e2",
        outline: "#1f4a6b",
        outlineW: 0.09,
      });
    },
    // 7 STRIDE: a motion sequence of skaters.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#f7c86a", "#f0a65a", "#e8775f", "#c85a6e"]));
      ctx.globalAlpha = 0.25;
      for (let k = 0; k < 12; k += 1) {
        ctx.fillStyle = "#fbe8c0";
        ctx.beginPath();
        ctx.moveTo(W * 0.5, H * 1.2);
        ctx.arc(
          W * 0.5,
          H * 1.2,
          W,
          Math.PI + (k / 12) * Math.PI,
          Math.PI + ((k + 0.5) / 12) * Math.PI,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#4a2c4f";
      ctx.fillRect(0, H * 0.86, W, H * 0.14);
      ctx.fillStyle = "#f3ead8";
      for (let x = 10; x < W; x += 90) ctx.fillRect(x, H * 0.9, 50, 6);
      const cols = ["#1f5f66", "#2f6fa6", "#f3ead8", "#6b4f9e", "#2f6340"];
      cols.forEach((c, i) =>
        skater(
          ctx,
          W * (0.12 + i * 0.17),
          H * 0.86,
          H * (0.5 + i * 0.05),
          c,
          i / 5,
          { skate: i === 2 ? "#2b2a4a" : "#f2b544" },
        ),
      );
      word(ctx, wd, W * 0.8, H * 0.18, W * 0.32, H * 0.22, {
        fill: "#4a2c4f",
        outline: "#fbe8c0",
        outlineW: 0.12,
      });
    },
    // 8 GLIDE: a brown thrasher over the pines at dawn.
    (ctx, r, wd) => {
      fillAll(
        ctx,
        vgrad(ctx, ["#9fc9d6", "#e7e2cf", "#f7c59f", "#f3a98a"], 0, H * 0.8),
      );
      circle(ctx, W * 0.2, H * 0.62, H * 0.16, "#fbe0a8");
      hills(ctx, H * 0.7, 30, 1.2, 1, "#a9a4b6");
      hills(ctx, H * 0.76, 24, 2.1, 3, "#7d8a8f");
      for (let k = 0; k < 34; k += 1)
        pine(
          ctx,
          W * (k / 33) + (r() - 0.5) * 20,
          H * (0.92 + r() * 0.06),
          90 + r() * 90,
          ["#2f5f3f", "#24503a", "#3a6b45"][k % 3],
        );
      canopyRow(ctx, H * 0.98, 20, 40, ["#24503a", "#2f5f3f"], r);
      // A brown thrasher gliding, seen from above, flying to the right.
      ctx.save();
      ctx.translate(W * 0.45, H * 0.4);
      ctx.rotate(-0.1);
      const bird = "#a0522d";
      ctx.fillStyle = "#8a4526";
      ctx.beginPath();
      ctx.moveTo(-50, -12);
      ctx.lineTo(-230, -44);
      ctx.quadraticCurveTo(-250, 0, -230, 44);
      ctx.lineTo(-50, 12);
      ctx.fill();
      for (const side of [-1, 1]) {
        ctx.fillStyle = bird;
        ctx.beginPath();
        ctx.moveTo(30, side * 14);
        ctx.bezierCurveTo(50, side * 70, 10, side * 150, -40, side * 205);
        const tips = 6;
        for (let f = 0; f < tips; f += 1) {
          const t = (f + 1) / tips;
          ctx.lineTo(
            -40 - t * 60 + (f % 2 ? 10 : 0),
            side * (205 - t * 120 - (f % 2 ? 8 : 0)),
          );
        }
        ctx.bezierCurveTo(-90, side * 50, -60, side * 20, -40, side * 12);
        ctx.fill();
        ctx.strokeStyle = "#efe2c4";
        ctx.lineWidth = 5;
        for (const o of [0.45, 0.6]) {
          ctx.beginPath();
          ctx.moveTo(10 - o * 40, side * 30);
          ctx.quadraticCurveTo(
            -20 - o * 30,
            side * (70 + o * 40),
            -50 - o * 30,
            side * (120 + o * 40),
          );
          ctx.stroke();
        }
        ctx.strokeStyle = "#7a3b22";
        ctx.lineWidth = 2.5;
        for (let f = 0; f < 5; f += 1) {
          ctx.beginPath();
          ctx.moveTo(-40 - f * 10, side * (40 + f * 4));
          ctx.lineTo(-60 - f * 12, side * (150 - f * 16));
          ctx.stroke();
        }
      }
      ctx.fillStyle = bird;
      ctx.beginPath();
      ctx.ellipse(0, 0, 90, 30, 0, 0, TAU);
      ctx.fill();
      circle(ctx, 92, 0, 26, bird);
      ctx.fillStyle = "#3a2a20";
      ctx.beginPath();
      ctx.moveTo(112, -8);
      ctx.quadraticCurveTo(160, -6, 172, 6);
      ctx.lineTo(114, 7);
      ctx.fill();
      circle(ctx, 102, -11, 5, "#f2b544");
      circle(ctx, 102, -11, 2.4, "#2b2a4a");
      circle(ctx, 102, 11, 5, "#f2b544");
      circle(ctx, 102, 11, 2.4, "#2b2a4a");
      ctx.restore();
      for (const [u, v, s] of [
        [0.75, 0.2, 0.6],
        [0.82, 0.3, 0.45],
        [0.68, 0.32, 0.4],
      ]) {
        ctx.strokeStyle = "#5b4a5e";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(W * u - 30 * s, H * v);
        ctx.quadraticCurveTo(W * u - 12 * s, H * v - 16 * s, W * u, H * v);
        ctx.quadraticCurveTo(
          W * u + 12 * s,
          H * v - 16 * s,
          W * u + 30 * s,
          H * v,
        );
        ctx.stroke();
      }
      word(ctx, wd, W * 0.84, H * 0.56, W * 0.26, H * 0.26, {
        fill: "#4a2c4f",
        outline: "#fbe8d0",
        outlineW: 0.1,
      });
    },
    // 9 A-TOWN: a record sun, sound waves, and dancers.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#33285e", "#4b3a7a", "#6b4f9e"]));
      const cx = W * 0.55;
      const cy = H * 0.55;
      const ring = ["#f2b544", "#e8665a", "#2a8c8c", "#8cc7d9"];
      for (let k = 14; k > 0; k -= 1) {
        ctx.strokeStyle = ring[k % 4];
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.arc(cx, cy, 150 + k * 34, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      circle(ctx, cx, cy, 170, "#2b2a4a");
      ctx.strokeStyle = "#3d3c66";
      ctx.lineWidth = 2;
      for (let k = 0; k < 14; k += 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, 70 + k * 7, 0, TAU);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(240,230,255,0.25)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, 130, -2.4, -1.6);
      ctx.stroke();
      circle(ctx, cx, cy, 62, "#f2b544");
      peach(ctx, cx, cy + 4, 30, 0);
      circle(ctx, cx, cy + 4, 5, "#2b2a4a");
      for (let k = 0; k < 9; k += 1)
        note(
          ctx,
          W * (0.28 + r() * 0.6),
          H * (0.2 + r() * 0.5),
          18 + r() * 12,
          ["#f3ead8", "#f2b544", "#8cc7d9"][k % 3],
          (r() - 0.5) * 0.6,
        );
      const dancers = [
        [0.08, "#f2b544", 2.6],
        [0.15, "#e8665a", 2.9],
        [0.86, "#8cc7d9", 2.7],
        [0.93, "#f3ead8", 3.0],
        [0.79, "#2a8c8c", 2.5],
      ];
      for (const [u, c, a] of dancers)
        person(ctx, W * u, H * 0.98, H * (0.42 + r() * 0.1), c, a, { skin: c });
      word(ctx, wd, W * 0.22, H * 0.2, W * 0.32, H * 0.24, {
        fill: "#f2b544",
        outline: "#2b2a4a",
        shadow: "#1d1a3a",
        outlineW: 0.1,
      });
    },
    // 10 SUNSHINE: magnolias and a sun.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#7fc0d6", "#bfe0da", "#f9e6b5"]));
      const sx = W * 0.72;
      const sy = H * 0.42;
      ctx.fillStyle = "rgba(247,200,90,0.55)";
      for (let k = 0; k < 18; k += 1) {
        const a = (k * TAU) / 18;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, W * 0.6, a, a + TAU / 36);
        ctx.fill();
      }
      circle(ctx, sx, sy, H * 0.3, "#f7c85a");
      circle(ctx, sx, sy, H * 0.24, "#f2b544");
      magnoliaLeaves(ctx, W * 0.14, H * 0.78, 90, -0.9, r);
      magnoliaLeaves(ctx, W * 0.36, H * 0.95, 80, -1.6, r);
      magnoliaLeaves(ctx, W * 0.92, H * 0.95, 70, -2.2, r);
      magnolia(ctx, W * 0.14, H * 0.74, 150, -0.15);
      magnolia(ctx, W * 0.36, H * 0.92, 120, 0.2);
      magnolia(ctx, W * 0.93, H * 0.94, 110, -0.1);
      word(ctx, wd, W * 0.42, H * 0.25, W * 0.4, H * 0.3, {
        fill: "#e8665a",
        outline: "#fbf3e2",
        shadow: "#a8413c",
        outlineW: 0.1,
      });
    },
    // 11 GOOD VIBES: a row of porches and neighbors.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#9fd3e0", "#d6eee9", "#f3f1dc"]));
      canopyRow(ctx, H * 0.55, 34, 64, ["#5f9a5a", "#4f8a50", "#6fa862"], r);
      const cols = [
        "#e8665a",
        "#f2b544",
        "#2a8c8c",
        "#9a86c2",
        "#8fc9a6",
        "#7fb6d6",
        "#f0a65a",
      ];
      const hw = W / 7.4;
      for (let i = 0; i < 7; i += 1) {
        const x = 20 + i * (hw + 10);
        const top = H * (0.42 + (i % 2) * 0.03);
        const base = H * 0.86;
        ctx.fillStyle = cols[i];
        ctx.fillRect(x, top, hw, base - top);
        ctx.fillStyle = "#4a3a4a";
        ctx.beginPath();
        ctx.moveTo(x - 10, top + 2);
        ctx.lineTo(x + hw / 2, top - hw * 0.42);
        ctx.lineTo(x + hw + 10, top + 2);
        ctx.fill();
        ctx.fillStyle = "#f3ead8";
        ctx.beginPath();
        ctx.moveTo(x + hw * 0.2, top - 4);
        ctx.lineTo(x + hw / 2, top - hw * 0.28);
        ctx.lineTo(x + hw * 0.8, top - 4);
        ctx.fill();
        ctx.fillStyle = "#f3ead8";
        ctx.fillRect(x - 6, H * 0.64, hw + 12, 9);
        for (const px of [0, 0.5, 1])
          ctx.fillRect(x - 4 + px * (hw - 2), H * 0.64, 8, base - H * 0.64);
        ctx.fillStyle = "#3a4a5e";
        ctx.fillRect(x + hw * 0.15, top + 22, hw * 0.26, 42);
        ctx.fillRect(x + hw * 0.58, top + 22, hw * 0.26, 42);
        ctx.fillStyle = "#5b3a2a";
        ctx.fillRect(x + hw * 0.36, H * 0.7, hw * 0.28, base - H * 0.7);
        ctx.fillStyle = "#c9b79a";
        ctx.fillRect(x - 8, base, hw + 16, 12);
      }
      ctx.fillStyle = "#7a9a5a";
      ctx.fillRect(0, H * 0.88, W, H * 0.12);
      ctx.strokeStyle = "#4a3a4a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.06);
      ctx.quadraticCurveTo(W / 2, H * 0.2, W, H * 0.06);
      ctx.stroke();
      for (let k = 0; k < 30; k += 1) {
        const t = (k + 0.5) / 30;
        const x = t * W;
        const y = H * 0.06 + 4 * t * (1 - t) * H * 0.07;
        ctx.fillStyle = cols[k % cols.length];
        ctx.beginPath();
        ctx.moveTo(x - 16, y);
        ctx.lineTo(x + 16, y);
        ctx.lineTo(x, y + 34);
        ctx.fill();
      }
      const folks = [
        [0.1, "#2b4a6b", 0.5],
        [0.24, "#6b3a5e", 2.7],
        [0.4, "#1f5f66", 0.3],
        [0.55, "#c2493f", 2.8],
        [0.7, "#4a2c4f", 0.4],
        [0.86, "#2f6340", 2.6],
      ];
      const skins = [
        "#5a3a2a",
        "#8a5a3c",
        "#c08a60",
        "#e0b08a",
        "#7a4a32",
        "#a87050",
      ];
      folks.forEach(([u, c, a], i) =>
        person(ctx, W * u, H * 0.97, H * 0.3, c, a, { skin: skins[i] }),
      );
      word(ctx, wd, W * 0.5, H * 0.26, W * 0.5, H * 0.24, {
        fill: "#4a2c4f",
        outline: "#fbf3e2",
        outlineW: 0.14,
      });
    },
    // 12 SMOOTH: big abstract leaves and color fields.
    (ctx, r, wd) => {
      fillAll(ctx, "#efe3cc");
      circle(ctx, W * 0.18, H * 0.4, H * 0.5, "#f2b544");
      circle(ctx, W * 0.62, H * 0.9, H * 0.62, "#e8775f");
      circle(ctx, W * 0.9, H * 0.15, H * 0.35, "#8cc7d9");
      ctx.fillStyle = "#2a8c8c";
      ctx.beginPath();
      ctx.moveTo(W * 0.35, 0);
      ctx.bezierCurveTo(W * 0.5, H * 0.4, W * 0.4, H * 0.7, W * 0.55, H);
      ctx.lineTo(W * 0.62, H);
      ctx.bezierCurveTo(W * 0.48, H * 0.7, W * 0.58, H * 0.4, W * 0.43, 0);
      ctx.fill();
      leaf(
        ctx,
        W * 0.02,
        H * 0.9,
        W * 0.36,
        H * 0.2,
        -0.45,
        "#2f5d3a",
        "#5f8f5a",
      );
      leaf(
        ctx,
        W * 0.5,
        H * 0.45,
        W * 0.3,
        H * 0.17,
        -0.2,
        "#8a5a2e",
        "#b07a44",
      );
      leaf(
        ctx,
        W * 0.66,
        H * 0.8,
        W * 0.32,
        H * 0.16,
        -0.6,
        "#3f7a4a",
        "#6fa862",
      );
      leaf(
        ctx,
        W * 0.98,
        H * 0.95,
        W * 0.24,
        H * 0.14,
        -2.6,
        "#2f5d3a",
        "#5f8f5a",
      );
      for (let k = 0; k < 5; k += 1)
        circle(ctx, W * (0.72 + k * 0.045), H * 0.42, 12, "#4a2c4f");
      ctx.fillStyle = "#2b2a4a";
      ctx.beginPath();
      ctx.roundRect(W * 0.04, H * 0.06, W * 0.22, H * 0.18, H * 0.09);
      ctx.fill();
      word(ctx, wd, W * 0.15, H * 0.15, W * 0.19, H * 0.13, {
        fill: "#efe3cc",
      });
    },
    // 13 SWAG SURF: a crowd wave.
    (ctx, r, wd) => {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, "#e8775f");
      g.addColorStop(0.5, "#c85a8a");
      g.addColorStop(1, "#6b4f9e");
      fillAll(ctx, g);
      ctx.fillStyle = "#f6c48a";
      ctx.beginPath();
      ctx.moveTo(0, H * 0.55);
      for (let x = 0; x <= W; x += 8)
        ctx.lineTo(x, H * 0.5 + Math.sin((x / W) * TAU * 2) * 40);
      for (let x = W; x >= 0; x -= 8)
        ctx.lineTo(x, H * 0.62 + Math.sin((x / W) * TAU * 2 + 0.6) * 40);
      ctx.fill();
      for (let k = 0; k < 70; k += 1) {
        ctx.fillStyle = ["#f2b544", "#8cc7d9", "#f3ead8", "#2a8c8c"][k % 4];
        ctx.save();
        ctx.translate(r() * W, r() * H * 0.45);
        ctx.rotate(r() * TAU);
        ctx.fillRect(-6, -3, 12, 6);
        ctx.restore();
      }
      const cols = ["#2b2a4a", "#1f5f66", "#4a2c4f", "#2f6fa6", "#3a2a4a"];
      for (let k = 0; k < 17; k += 1) {
        const lean = Math.sin(k * 0.6) * 0.35;
        ctx.save();
        ctx.translate(W * (0.03 + k * 0.058), H * 1.01);
        ctx.rotate(lean * 0.4);
        person(ctx, 0, 0, H * (0.4 + (k % 3) * 0.04), cols[k % 5], 2.75 + lean);
        ctx.restore();
      }
      word(ctx, wd, W * 0.5, H * 0.2, W * 0.5, H * 0.28, {
        fill: "#fbf3e2",
        outline: "#4a2c4f",
        shadow: "#3a2a4a",
        rot: -0.04,
        outlineW: 0.1,
      });
    },
    // 14 RINK: a night roller rink.
    (ctx, r, wd) => {
      fillAll(ctx, vgrad(ctx, ["#1d1f4a", "#2c2560", "#3a2a6b"]));
      for (let k = 0; k < 60; k += 1)
        circle(ctx, r() * W, r() * H * 0.5, 1.5 + r() * 2.5, "#e8e4ff");
      const lights = ["#ff6fa8", "#4fd6c8", "#f7c85a", "#8ab8ff"];
      for (let k = 0; k < 9; k += 1)
        glow(ctx, lights[k % 4], 40, () =>
          circle(
            ctx,
            W * (0.08 + k * 0.105),
            H * (0.12 + (k % 2) * 0.1),
            16,
            lights[k % 4],
          ),
        );
      ctx.fillStyle = "#5a4a8a";
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.78, W * 0.44, H * 0.2, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#f3ead8";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.78, W * 0.38, H * 0.15, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "#8a7ac0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.78, W * 0.26, H * 0.09, 0, 0, TAU);
      ctx.stroke();
      const sk = [
        [0.2, 0.78, "#ff6fa8", false],
        [0.36, 0.92, "#4fd6c8", false],
        [0.62, 0.93, "#f7c85a", false],
        [0.8, 0.8, "#8ab8ff", true],
        [0.5, 0.66, "#f3ead8", true],
      ];
      for (const [u, v, c, f] of sk)
        skater(ctx, W * u, H * v, H * 0.3 * (0.6 + v * 0.5), c, u, { flip: f });
      glow(ctx, "#ff6fa8", 30, () =>
        word(ctx, wd, W * 0.5, H * 0.34, W * 0.3, H * 0.34, {
          font: `700 SIZEpx Bitstream Charter`,
          fill: "#ffd1e6",
          outline: "#ff6fa8",
          outlineW: 0.06,
        }),
      );
    },
    // 15 SHINE: the skyline at night with fireflies.
    (ctx, r, wd) => {
      fillAll(
        ctx,
        vgrad(ctx, ["#17234a", "#2c4470", "#5a6a90", "#e8a87a"], 0, H * 0.85),
      );
      for (let k = 0; k < 80; k += 1)
        circle(ctx, r() * W, r() * H * 0.55, 1.2 + r() * 2.4, "#f3ead8");
      circle(ctx, W * 0.82, H * 0.2, 46, "#f7e7b8");
      circle(ctx, W * 0.82 + 20, H * 0.2 - 10, 42, "#1d2b53");
      skyline(ctx, W * 0.18, W * 0.95, H * 0.86, H * 0.58, "#151b38", r, {
        windows: "#f7c85a",
      });
      canopyRow(ctx, H * 0.92, 24, 44, ["#10182c", "#16223a"], r);
      for (let k = 0; k < 40; k += 1)
        glow(ctx, "#f7e27a", 14, () =>
          circle(
            ctx,
            r() * W,
            H * (0.6 + r() * 0.35),
            2.5 + r() * 2,
            "#fff3a8",
          ),
        );
      magnoliaLeaves(ctx, W * 0.08, H * 0.98, 70, -1.2, r);
      magnolia(ctx, W * 0.08, H * 0.92, 110, 0.15);
      glow(ctx, "#f7c85a", 24, () =>
        word(ctx, wd, W * 0.36, H * 0.3, W * 0.3, H * 0.34, {
          fill: "#f7c85a",
          outline: "#7a4a1a",
          outlineW: 0.06,
        }),
      );
    },
  ];

  // ---------- paint pass ----------
  const atlas = document.createElement("canvas");
  atlas.width = size;
  atlas.height = size;
  const actx = atlas.getContext("2d");
  actx.imageSmoothingQuality = "high";
  const rough = document.createElement("canvas");
  rough.width = roughSize;
  rough.height = roughSize;
  const rctx = rough.getContext("2d");
  rctx.imageSmoothingQuality = "high";
  const TW = 576;
  const TH = 192;
  const sheet = document.createElement("canvas");
  sheet.width = TW * 4 + 50;
  sheet.height = (TH + 34) * 4 + 10;
  const sctx = sheet.getContext("2d");
  sctx.fillStyle = "#1c1c22";
  sctx.fillRect(0, 0, sheet.width, sheet.height);
  sctx.imageSmoothingQuality = "high";
  const stats = [];

  for (let cell = 0; cell < 16; cell += 1) {
    const rand = mulberry(seed * 1000 + cell * 7919);
    const N = makeNoise(seed * 31 + cell);
    const design = document.createElement("canvas");
    design.width = W;
    design.height = H;
    const dctx = design.getContext("2d");
    DRAW[cell](dctx, rand, words[cell]);
    const src = dctx.getImageData(0, 0, W, H).data;
    const outImg = dctx.createImageData(W, H);
    const dst = outImg.data;
    const rImg = dctx.createImageData(W, H);
    const rd = rImg.data;
    const brick = designs[cell].wall === "brick";
    const brickBase = hex(["#a8604c", "#b06a50", "#9a5846"][cell % 3]);
    const mortar = hex("#c4b8a6");
    const stucco = hex(["#d9cfba", "#cfc4ae", "#ddd3c0"][cell % 3]);
    const border = 12 + rand() * 6;
    let coverSum = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        // The wall under the paint: a brick bond 5.6 px a course (about a
        // 7 m wall in 512 px), or stucco.
        let wall;
        let mort = 0;
        let tone = 0.5;
        if (brick) {
          const course = 5.6;
          const row = Math.floor(y / course);
          const bx = Math.floor((x + (row % 2) * 8) / 16);
          const my = y - row * course;
          const mx = x + (row % 2) * 8 - bx * 16;
          mort = Math.max(1 - smooth(0.4, 1.3, my), 1 - smooth(0.4, 1.5, mx));
          tone = N.hash(bx, row);
          const k =
            0.86 + tone * 0.24 + (N.noise(x * 0.4, y * 0.4) - 0.5) * 0.1;
          wall = brickBase.map((c, j) => c * k * (1 - mort) + mortar[j] * mort);
        } else {
          const k =
            0.93 +
            N.fbm(x / 22, y / 22, 3) * 0.12 +
            (N.noise(x * 0.6, y * 0.6) - 0.5) * 0.05;
          wall = stucco.map((c) => c * k);
        }
        // The ragged painted edge and a dry-brush band inside it.
        const d = Math.min(x, W - 1 - x, y, H - 1 - y);
        const edge =
          border +
          (N.fbm(x / 70 + 3.1, y / 70 + 7.7, 3) - 0.5) * 22 +
          (N.noise(x * 0.3, y * 0.3) - 0.5) * 6;
        let cov = smooth(edge - 1.2, edge + 1.2, d);
        // Brush strokes: an anisotropic noise along a slowly turning stroke direction.
        const ang = N.fbm(x / 300 + 11, y / 300 + 5, 2) * TAU * 1.5;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const u = x * ca + y * sa;
        const v = -x * sa + y * ca;
        const stroke =
          N.noise(u / 28, v / 2.4) * 0.7 + N.noise(u / 9, v / 1.2) * 0.3;
        const band = smooth(0, 30, d - edge);
        cov *= band + (1 - band) * smooth(0.35, 0.62, stroke + band * 0.4);
        // Weathering: a chalky fade in patches and near the ground.
        const wth =
          smooth(0.58, 0.82, N.fbm(x / 160 + 21, y / 160 + 2, 3)) * 0.1 +
          Math.pow(y / H, 5) * 0.06;
        let mod =
          1 + (stroke - 0.5) * 0.09 + (N.noise(x * 0.5, y * 0.5) - 0.5) * 0.035;
        if (brick) mod *= 1 - mort * 0.1 + (tone - 0.5) * 0.04;
        else mod *= 0.97 + N.fbm(x / 22, y / 22, 3) * 0.06;
        for (let j = 0; j < 3; j += 1) {
          let p = src[i + j] * mod;
          p = p + (Math.min(255, (p + wall[j]) * 0.5 + 18) - p) * wth;
          dst[i + j] = Math.max(
            0,
            Math.min(255, wall[j] + (p - wall[j]) * cov),
          );
        }
        dst[i + 3] = 255;
        // Roughness (stored as roughness / 0.85, the material's roughness):
        // satin exterior paint 0.68-0.8, chalky patches rougher, bare brick 0.92-0.96.
        const paintR = 0.72 + (stroke - 0.5) * 0.1 + wth * 0.8;
        const wallR = brick ? 0.92 + mort * 0.04 : 0.9;
        const rr = wallR + (paintR - wallR) * cov;
        const g = Math.max(0, Math.min(255, Math.round((rr / 0.85) * 255)));
        rd[i] = g;
        rd[i + 1] = g;
        rd[i + 2] = g;
        rd[i + 3] = 255;
        coverSum += cov;
      }
    }
    dctx.putImageData(outImg, 0, 0);
    const cx = (cell % 4) * S;
    const cy = Math.floor(cell / 4) * S;
    actx.drawImage(design, 0, 0, W, H, cx, cy, S, S);
    const rc = document.createElement("canvas");
    rc.width = W;
    rc.height = H;
    rc.getContext("2d").putImageData(rImg, 0, 0);
    rctx.drawImage(
      rc,
      0,
      0,
      W,
      H,
      (cell % 4) * RS,
      Math.floor(cell / 4) * RS,
      RS,
      RS,
    );
    const tx = 10 + (cell % 4) * (TW + 10);
    const ty = 10 + Math.floor(cell / 4) * (TH + 34);
    sctx.drawImage(design, 0, 0, W, H, tx, ty, TW, TH);
    sctx.fillStyle = "#e8e8ee";
    sctx.font = `600 15px ${FONT}`;
    sctx.textBaseline = "top";
    sctx.fillText(
      `${String(cell).padStart(2, "0")}  ${designs[cell].name}  ·  ${designs[cell].wall}`,
      tx,
      ty + TH + 7,
    );
    stats.push({ cell, paintCoverage: +(coverSum / (W * H)).toFixed(3) });
  }
  return {
    color: atlas.toDataURL("image/jpeg", quality),
    roughness: rough.toDataURL("image/jpeg", 0.9),
    sheet: sheet.toDataURL("image/jpeg", 0.9),
    stats,
  };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const t0 = Date.now();
  const res = await page.evaluate(paint, {
    size,
    roughSize,
    seed,
    words: MURAL_WORDS,
    designs: DESIGNS,
    quality,
  });
  const ms = Date.now() - t0;
  await mkdir(out, { recursive: true });
  await mkdir(sheetDir, { recursive: true });
  const bytes = (url) => Buffer.from(url.split(",")[1], "base64");
  const color = bytes(res.color);
  const rough = bytes(res.roughness);
  await writeFile(join(out, "mural-atlas.jpg"), color);
  await writeFile(join(out, "mural-roughness.jpg"), rough);
  await writeFile(join(sheetDir, "contact-sheet.jpg"), bytes(res.sheet));
  const gpu = (s) => Math.round(s * s * 4 * 1.33);
  const provenance = {
    asset: "murals",
    description:
      "16 original painted-wall mural designs for the trail-facing walls of the BeltLine Eastside level (pbr look): a 4 x 4 color atlas and a roughness atlas in the cell layout of muralMesh() (src/level/geo/geo-mesh.js).",
    generated: new Date().toISOString().slice(0, 10),
    tool: {
      art: "scripts/assets/mural-atlas.mjs: Chromium 2D canvas via Playwright (@playwright/test 1.63.0). Every shape is drawn from code: Bezier paths, circles, gradients, and system DejaVu Sans / Bitstream Charter lettering. A per-pixel paint pass (seeded value noise) adds brush strokes, roughness, weathering, and a ragged dry-brush edge over painted brick or stucco.",
      generator:
        "deterministic: same seed, same pixels (up to the browser's JPEG encoder)",
    },
    command: `node scripts/assets/mural-atlas.mjs --seed ${seed} --size ${size} --quality ${quality}`,
    seed,
    prompt: "none (no generative model)",
    credits: { meshy: 0, tripo: 0, imageGeneration: 0, total: 0 },
    originality:
      "All 16 designs are original work drawn from code for ATL Arcade. They do not copy or imitate any real mural or the recognizable style of any artist, and they contain no brands, logos, or third-party artwork. Lettering is MURAL_WORDS from src/render/murals.js (no neighborhood names, issue #80).",
    license: "Original work for ATL Arcade.",
    files: {
      "mural-atlas.jpg": {
        size: [size, size],
        colorSpace: "srgb",
        bytes: color.length,
        gpuBytes: gpu(size),
        layout:
          "4 x 4 cells, cell = row * 4 + column, row 0 at the top (flipY texture)",
      },
      "mural-roughness.jpg": {
        size: [roughSize, roughSize],
        colorSpace: "linear",
        bytes: rough.length,
        gpuBytes: gpu(roughSize),
        encoding:
          "gray = roughness / 0.85 (ROUGHNESS.mural), read from the green channel by MeshStandardMaterial.roughnessMap",
      },
    },
    totalBytes: color.length + rough.length,
    totalGpuBytes: gpu(size) + gpu(roughSize),
    designs: DESIGNS.map((d, cell) => ({
      cell,
      word: MURAL_WORDS[cell],
      ...d,
      ...res.stats[cell],
    })),
  };
  await writeFile(
    join(out, "provenance.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  console.log(
    `painted in ${ms} ms: color ${color.length} B, roughness ${rough.length} B, GPU ${(provenance.totalGpuBytes / 1048576).toFixed(1)} MiB`,
  );
} finally {
  await browser.close();
}
