// Touch and layout checks at 390x844 (portrait) and 844x390 (landscape).
// iPhone 15 descriptor (touch, DPR 3, iOS UA) in Chromium; WebKit is not
// installed. Writes touch.json and screenshots.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUT, LEVEL_URL, launch, profile, waitReady, loadAverage } from "./common.mjs";

const browser = await launch({ gpu: true });
const report = { load: loadAverage(), views: [] };

async function touch(cdp, type, points) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
}

const skaterState = (page) =>
  page.evaluate(() => {
    const s = window.__atl.skater;
    return { position: s.position.map((v) => +v.toFixed(3)), speed: +s.speed.toFixed(3), yaw: +s.yaw.toFixed(3), state: s.state, look: window.__atl.cameraLook, beatRunning: window.__atl.beat.running, audioState: window.__atl.beat.ctx?.state ?? "no context", scale: visualViewport.scale, scrollY };
  });

for (const [w, h] of [
  [390, 844],
  [844, 390],
]) {
  const ctx = await browser.newContext({ ...profile("iPhone 15"), viewport: { width: w, height: h }, screen: { width: w, height: h } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(LEVEL_URL());
  await waitReady(page);
  await page.waitForTimeout(4000);
  const name = `${w}x${h}`;
  await page.screenshot({ path: resolve(OUT, `touch-${name}-start.jpg`), type: "jpeg", quality: 75 });

  const page0 = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]')?.content ?? null;
    const cs = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], fontSize: s.fontSize, color: s.color, display: s.display, touchAction: s.touchAction, userSelect: s.userSelect || s.webkitUserSelect, overscroll: s.overscrollBehavior };
    };
    const buttons = [...document.querySelectorAll("#skater-select button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { skater: b.dataset.skater, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), right: Math.round(innerWidth - r.right) };
    });
    // Text that the viewport cuts off.
    const clipped = [...document.querySelectorAll("#hud *, #shell-info *, #skater-select *, #attribution")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1);
    }).map((el) => el.id || el.className || el.tagName);
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const overlap = (a, b) => a && b && a.width && b.width && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    return {
      viewportMeta: meta,
      inner: [innerWidth, innerHeight],
      html: cs("html"),
      body: cs("body"),
      canvas: cs("#stage"),
      hud: cs("#hud"),
      hint: { ...cs("#hud-hint"), text: document.getElementById("hud-hint")?.textContent },
      shellInfo: { ...cs("#shell-info"), text: document.querySelector("#shell-info span")?.textContent },
      attribution: { ...cs("#attribution"), text: document.getElementById("attribution")?.textContent, hidden: document.getElementById("attribution")?.hidden },
      skaterButtons: buttons,
      hudLabel: cs(".hud-label"),
      clipped,
      overlaps: {
        hudWithShellInfo: overlap(rect("#hud"), rect("#shell-info")),
        hudWithSkaterSelect: overlap(rect("#hud"), rect("#skater-select")),
        attributionWithSkaterSelect: overlap(rect("#attribution"), rect("#skater-select")),
        pulseWithSkaterSelect: overlap(rect("#hud-pulse"), rect("#skater-select")),
      },
      reducedMotionQueryHonored: null,
      fullscreenApi: typeof document.documentElement.requestFullscreen,
    };
  });

  const before = await skaterState(page);
  // 1. A tap in the center of the canvas.
  await page.touchscreen.tap(w / 2, h / 2);
  await page.waitForTimeout(1500);
  const afterTap = await skaterState(page);
  // 2. A hold in the lower half (a common "push" gesture), 1.5 s.
  await touch(cdp, "touchStart", [[w / 2, h * 0.8]]);
  await page.waitForTimeout(1500);
  await touch(cdp, "touchEnd", []);
  const afterHold = await skaterState(page);
  // 3. A swipe left to right across the canvas.
  await touch(cdp, "touchStart", [[w * 0.2, h * 0.6]]);
  for (let i = 1; i <= 10; i++) {
    await touch(cdp, "touchMove", [[w * 0.2 + (w * 0.6 * i) / 10, h * 0.6]]);
    await page.waitForTimeout(16);
  }
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(800);
  const afterSwipe = await skaterState(page);
  // 4. A swipe up (a common "jump" gesture).
  await touch(cdp, "touchStart", [[w / 2, h * 0.8]]);
  for (let i = 1; i <= 8; i++) {
    await touch(cdp, "touchMove", [[w / 2, h * 0.8 - (h * 0.4 * i) / 8]]);
    await page.waitForTimeout(16);
  }
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(400);
  const afterSwipeUp = await skaterState(page);
  // 5. A pinch out on the HUD text (not the canvas), to test page zoom.
  const hx = 120;
  const hy = 60;
  await touch(cdp, "touchStart", [[hx - 10, hy], [hx + 10, hy]]);
  for (let i = 1; i <= 8; i++) {
    await touch(cdp, "touchMove", [[hx - 10 - i * 12, hy], [hx + 10 + i * 12, hy]]);
    await page.waitForTimeout(16);
  }
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(600);
  const afterPinch = await skaterState(page);
  await page.screenshot({ path: resolve(OUT, `touch-${name}-after-gestures.jpg`), type: "jpeg", quality: 75 });

  // Contrast: the luminance of the scene behind the HUD text, from a shot
  // with the HUD and the shell text hidden.
  await page.evaluate(() => {
    for (const id of ["hud", "shell-info", "skater-select", "attribution"]) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = "hidden";
    }
  });
  const bgShot = (await page.screenshot({ type: "png" })).toString("base64");
  await page.evaluate(() => {
    for (const id of ["hud", "shell-info", "skater-select", "attribution"]) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = "";
    }
  });
  const areas = { hudTop: page0.hud.rect, shellInfo: page0.shellInfo.rect, hint: page0.hint.rect };
  const bg = await page.evaluate(
    async ({ b64, areas }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      const lin = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const out = {};
      for (const [key, [x, y, w, h]] of Object.entries(areas)) {
        if (!w || !h) continue;
        const d = g.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;
        let max = 0;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const L = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
          sum += L;
          n++;
          if (L > max) max = L;
        }
        out[key] = { meanL: +(sum / n).toFixed(3), maxL: +max.toFixed(3) };
      }
      return out;
    },
    { b64: bgShot, areas },
  );
  // WCAG contrast of the text colors on the brightest and the mean background.
  const L = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a, b) => +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
  const contrast = {};
  for (const [key, color] of [["hint #ffd166 on hint area", "#ffd166"], ["paper #f3f3f7 on HUD area", "#f3f3f7"], ["paper #f3f3f7 on shell-info area", "#f3f3f7"], ["pink #ff5fb2 on HUD area", "#ff5fb2"]]) {
    const area = key.includes("hint area") ? bg.hint : key.includes("shell-info") ? bg.shellInfo : bg.hudTop;
    if (area) contrast[key] = { onMean: ratio(L(color), area.meanL), onBrightest: ratio(L(color), area.maxL) };
  }

  report.views.push({ name, layout: page0, gestures: { before, afterTap, afterHold, afterSwipe, afterSwipeUp, afterPinch }, background: bg, contrast });
  await ctx.close();
}

// Reduced motion: does the page read the media query at all?
{
  const ctx = await browser.newContext({ ...profile("iPhone 15"), reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(LEVEL_URL("mute=1"));
  await waitReady(page);
  report.reducedMotion = await page.evaluate(() => ({ matches: matchMedia("(prefers-reduced-motion: reduce)").matches, hudTagTransition: getComputedStyle(document.querySelector(".hud-tag")).transition }));
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, "touch.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
