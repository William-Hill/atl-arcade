// Shared helpers for the mobile audit re-run on epic/city-look.
// Same method as the #65 scripts (../../mobile/scripts/). No imports from
// src/ or prototypes/.
//
// This computer has no GPU. All runs use SwiftShader (a software GPU on the
// CPU). The frame times are relative numbers only: they are NOT phone GPU
// numbers.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium, devices } from "@playwright/test";

export const OUT = resolve(import.meta.dirname, "..");
export const BASE = process.env.BASE ?? "http://localhost:5184";
export const LEVEL_URL = (q = "", level = "beltline-eastside") => `${BASE}/?level=${level}${q ? `&${q}` : ""}`;

export function loadAverage() {
  return execSync("uptime").toString().trim().replace(/^.*load average: /, "");
}

// The four profiles of this audit. WebKit is not installed, so the iPhone
// profiles run in Chromium with the iPhone viewport, DPR, touch and UA.
// "Small phone" is the Galaxy S5 descriptor: 360x640, DPR 3, Android UA.
export const PROFILES = [
  { key: "iPhone15-port", device: "iPhone 15" },
  { key: "iPhone15-land", device: "iPhone 15 landscape" },
  { key: "Pixel7-port", device: "Pixel 7" },
  { key: "small-360x640", device: "Galaxy S5" },
];

export function profile(name) {
  const d = { ...devices[name] };
  delete d.defaultBrowserType;
  return d;
}

export async function launch() {
  return chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
}

export async function waitReady(page, timeout = 300000) {
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout, polling: 200 });
}

// Counts every WebGL draw call and its triangles in all passes (main pass,
// shadow pass, post passes). renderer.info resets per pass, so the GL calls
// are the true count. Install with context.addInitScript(DRAW_COUNTER).
export const DRAW_COUNTER = () => {
  const c = { calls: 0, triangles: 0 };
  window.__drawCount = c;
  const tri = (mode, count, inst = 1) => (mode === 4 ? (count / 3) * inst : mode === 5 || mode === 6 ? Math.max(0, count - 2) * inst : 0);
  const wrap = (proto) => {
    if (!proto) return;
    const de = proto.drawElements;
    proto.drawElements = function (mode, count, ...r) {
      c.calls++;
      c.triangles += tri(mode, count);
      return de.call(this, mode, count, ...r);
    };
    const da = proto.drawArrays;
    proto.drawArrays = function (mode, first, count) {
      c.calls++;
      c.triangles += tri(mode, count);
      return da.call(this, mode, first, count);
    };
    for (const name of ["drawElementsInstanced", "drawArraysInstanced"]) {
      const f = proto[name];
      if (!f) continue;
      proto[name] = function (mode, a, b, ...r) {
        c.calls++;
        const count = name === "drawArraysInstanced" ? b : a;
        const inst = name === "drawArraysInstanced" ? r[0] : r[1];
        c.triangles += tri(mode, count, inst);
        return f.call(this, mode, a, b, ...r);
      };
    }
  };
  wrap(window.WebGL2RenderingContext?.prototype);
  wrap(window.WebGLRenderingContext?.prototype);
  // WEBGL_multi_draw: one call per sub-draw is what a GPU driver does, but
  // three.js counts one draw per batch. Count the sub-draws, and the batches.
  const gp = window.WebGL2RenderingContext?.prototype.getExtension;
  if (gp) {
    c.multiDrawBatches = 0;
    window.WebGL2RenderingContext.prototype.getExtension = function (n) {
      const ext = gp.call(this, n);
      if (ext && n === "WEBGL_multi_draw" && !ext.__wrapped) {
        ext.__wrapped = true;
        for (const name of ["multiDrawElementsWEBGL", "multiDrawElementsInstancedWEBGL", "multiDrawArraysWEBGL", "multiDrawArraysInstancedWEBGL"]) {
          const f = ext[name];
          if (!f) continue;
          ext[name] = function (mode, ...args) {
            c.multiDrawBatches++;
            // counts list, offset, ... drawcount is the last arg
            const counts = args[0];
            const off = args[1];
            const drawcount = args[args.length - 1];
            for (let i = 0; i < drawcount; i++) {
              c.calls++;
              c.triangles += tri(mode, counts[off + i]);
            }
            return f.call(this, mode, ...args);
          };
        }
      }
      return ext;
    };
  }
};

// Counts draws over n frames.
export async function drawsPerFrame(page, n = 20) {
  return page.evaluate(async (n) => {
    const c = window.__drawCount;
    await new Promise((ok) => requestAnimationFrame(ok));
    const c0 = c.calls;
    const t0 = c.triangles;
    const b0 = c.multiDrawBatches ?? 0;
    for (let i = 0; i < n; i++) await new Promise((ok) => requestAnimationFrame(ok));
    return { calls: Math.round((c.calls - c0) / n), triangles: Math.round((c.triangles - t0) / n), multiDrawBatches: Math.round(((c.multiDrawBatches ?? 0) - b0) / n), frames: n };
  }, n);
}

// Real touches through CDP. Every touch event lists all fingers that are
// down (same helper as e2e/touch.spec.js).
export async function fingers(page) {
  const cdp = await page.context().newCDPSession(page);
  const down = new Map();
  const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...down.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
  return {
    async start(id, x, y) {
      down.set(id, { x, y });
      await send("touchStart");
    },
    async move(id, x, y) {
      down.set(id, { x, y });
      await send("touchMove");
    },
    async end(id) {
      down.delete(id);
      if (down.size > 0) await send("touchMove");
      else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    async tap(id, x, y, ms = 120) {
      await this.start(id, x, y);
      await page.waitForTimeout(ms);
      await this.end(id);
    },
  };
}

// The centers of the touch targets.
export async function targets(page) {
  return page.evaluate(() => {
    const c = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    };
    const zone = document.querySelector(".touch-stick-zone")?.getBoundingClientRect();
    const base = c(".touch-stick-base");
    return {
      stick: base ?? (zone && { x: zone.left + zone.width * 0.4, y: zone.top + zone.height * 0.6 }),
      jump: c(".touch-jump"),
      grind: c(".touch-grind"),
      style1: c(".touch-style1"),
      style2: c(".touch-style2"),
      switch: c(".touch-switch"),
      viewport: { w: innerWidth, h: innerHeight },
    };
  });
}

export function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  if (!s.length) return { frames: 0 };
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const median = at(0.5);
  return { frames: s.length, medianMs: +median.toFixed(1), medianFps: +(1000 / median).toFixed(1), p95FrameMs: +at(0.95).toFixed(1), maxMs: +s[s.length - 1].toFixed(1) };
}
