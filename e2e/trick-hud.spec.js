import { expect, test, devices } from "@playwright/test";
import { CHIP_MS } from "../src/ui/trick-hud-text.js";

// The trick HUD (#330, docs/ux/trick-hud.md) and the PERFECT hit stop
// (#338) in the real game: the trick line (E1), the live trick chip and
// the hold bar and beat pips (E2, E3), the manual balance bar (E4), the
// touch flick ring and card (E5), and the trick list (E6). Screenshots at
// 1280 x 720 and on a Pixel 7 viewport, and in grayscale (R12.4).
//
// The beat tag needs a beat on the audio clock. The software renderer here
// cannot hit a beat on purpose, so the PERFECT and GOOD tests replace the
// judge of the running beat clock in the page (window.__atl.beat.judgeNow).

const shot = (name) => `e2e/__screenshots__/trick-hud-${name}.png`;

function profile(name) {
  const { defaultBrowserType, ...rest } = devices[name]; // eslint-disable-line no-unused-vars
  return rest;
}

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/.test(msg.location()?.url ?? "")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function ready(page, query = "") {
  await page.goto(`/?level=greybox&mute=1&intro=0${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
}

async function grayscale(page, name) {
  await page.addStyleTag({ content: "html { filter: grayscale(1) !important; }" });
  await page.screenshot({ path: shot(`grayscale-${name}`) });
  await page.addStyleTag({ content: "html { filter: none !important; }" });
}

// Starts the beat clock and makes every judged moment `tag`.
async function forceBeat(page, tag) {
  await page.evaluate(async (t) => {
    const clock = window.__atl.beat;
    await clock.start();
    clock.judgeNow = () => ({ tag: t, onBeat: t !== null, offsetMs: t === "PERFECT" ? 0 : t === "GOOD" ? 40 : 200 });
  }, tag);
}

// A grab in the air: up and away, a TRICK press with a left (Japan Grab).
const GRAB_LEFT = [
  { frames: 40, input: { push: true } },
  { frames: 1, input: { jump: true } },
  { frames: 8, input: {} },
  { frames: 1, input: { style1: true, flick: { style1: "l" } } },
  { frames: 6, input: {} },
];

const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("desktop 1280 x 720", () => {
  test("E1 and E2: a PERFECT Japan Grab shows on the trick line and the chip; the hit stop runs; the tag shows for 900 ms of wall time", async ({ page }) => {
    const errors = collectErrors(page);
    await ready(page);
    await forceBeat(page, "PERFECT");
    // Watch the chip on each frame: the wall time of the PERFECT look.
    await page.evaluate(() => {
      window.__chip = { on: null, off: null };
      const tag = document.getElementById("hud-tag");
      const tick = () => {
        const perfect = tag.dataset.look === "perfect" && tag.dataset.shown === "1";
        const now = performance.now();
        if (perfect && window.__chip.on === null) window.__chip.on = now;
        if (!perfect && window.__chip.on !== null && window.__chip.off === null) window.__chip.off = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const count0 = await page.evaluate(() => window.__atl.hitStop.count);
    await page.evaluate((script) => {
      window.__ride = { done: false };
      window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 }).then(() => (window.__ride.done = true));
    }, [...GRAB_LEFT, { frames: 90, input: {} }]);
    await page.waitForFunction(() => window.__atl.combo.links.some((l) => l.name === "Japan Grab"), null, { timeout: 60000, polling: "raf" });
    await page.waitForFunction(() => document.getElementById("hud-tag").dataset.look === "perfect", null, { timeout: 5000, polling: "raf" });
    const hud = await page.evaluate(() => ({
      combo: document.getElementById("hud-combo").textContent,
      mult: document.querySelector("#hud-combo .hud-mult").textContent,
      pending: document.getElementById("hud-pending").textContent,
      tag: document.getElementById("hud-tag").textContent,
      border: getComputedStyle(document.getElementById("hud-tag")).outlineWidth,
      link: window.__atl.combo.links.find((l) => l.name === "Japan Grab"),
      stop: window.__atl.hitStop,
    }));
    expect(hud.link).toMatchObject({ dir: "l", tag: "PERFECT" });
    expect(hud.combo).toContain("← Japan Grab ★");
    expect(hud.mult).toMatch(/^ x\d+$/);
    expect(hud.pending).toMatch(/^[\d,]+$/);
    expect(hud.tag).toBe("★ PERFECT ← Japan Grab");
    expect(hud.border).toBe("3px");
    expect(hud.stop.ms).toBe(60);
    expect(hud.stop.count).toBeGreaterThan(count0);
    await page.screenshot({ path: shot("perfect-desktop") });
    await grayscale(page, "perfect-desktop");
    // The tag time is on the wall clock: 900 ms, the hit stop does not change it.
    await page.waitForFunction(() => window.__chip.off !== null, null, { timeout: 10000 });
    const shown = await page.evaluate(() => window.__chip.off - window.__chip.on);
    test.info().annotations.push({ type: "PERFECT tag wall time", description: `${Math.round(shown)} ms` });
    expect(shown).toBeGreaterThanOrEqual(CHIP_MS.result - 50);
    expect(shown).toBeLessThanOrEqual(CHIP_MS.result + 250);
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("?hitstop=0 turns the hit stop off", async ({ page }) => {
    await ready(page, "&hitstop=0");
    await forceBeat(page, "PERFECT");
    await page.evaluate((script) => window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 }), [...GRAB_LEFT, { frames: 60, input: {} }]);
    const stop = await page.evaluate(() => ({ ms: window.__atl.hitStop.ms, count: window.__atl.hitStop.count, perfect: window.__atl.events.some((e) => e.type === "move" && e.beatTag === "PERFECT") }));
    expect(stop).toEqual({ ms: 0, count: 0, perfect: true });
  });

  test("E2: GOOD, WOBBLE, the hold bar, and Busy with the beat pips", async ({ page }) => {
    const errors = collectErrors(page);
    await ready(page);
    // The hold bar: a grab held in the air (the render stops mid-air).
    await page.evaluate((script) => {
      window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 });
    }, [...GRAB_LEFT.slice(0, 3), { frames: 1, input: { style1: true, flick: { style1: "u" } } }, { frames: 200, input: { style1: true } }]);
    await page.waitForFunction(
      () => {
        const ok = !document.getElementById("hud-hold").hidden && window.__atl.skater.grab?.hold > 0.2;
        if (ok) window.__atl.renderPaused = true;
        return ok;
      },
      null,
      { timeout: 60000, polling: "raf" },
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    expect(await page.evaluate(() => document.getElementById("hud-tag").textContent)).toBe("↑ Rocket Grab");
    await page.screenshot({ path: shot("hold-bar-desktop") });
    await grayscale(page, "hold-bar-desktop");
    // WOBBLE: the grab is still held at the touchdown.
    await page.evaluate(() => (window.__atl.renderPaused = false));
    await page.waitForFunction(() => document.getElementById("hud-tag").dataset.look === "wobble", null, { timeout: 60000, polling: "raf" });
    const wobble = await page.evaluate(() => ({ text: document.getElementById("hud-tag").textContent, style: getComputedStyle(document.getElementById("hud-tag")).outlineStyle, combo: document.getElementById("hud-combo").textContent }));
    expect(wobble.text).toBe("~ WOBBLE ↑ Rocket Grab");
    expect(wobble.style).toBe("dotted");
    expect(wobble.combo).toContain("↑ Rocket Grab ~");
    await page.screenshot({ path: shot("wobble-desktop") });
    await grayscale(page, "wobble-desktop");

    // Busy: ATL Rydin (8 beats), then a TRICK press while it runs.
    await page.evaluate((script) => {
      window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 });
    }, [{ frames: 40, input: { push: true } }, { frames: 1, input: { style2: true, flick: { style2: "u" } } }, { frames: 60, input: {} }, { frames: 1, input: { style1: true } }, { frames: 400, input: {} }]);
    await page.waitForFunction(
      () => {
        const ok = document.getElementById("hud-tag").dataset.look === "busy";
        if (ok) window.__atl.renderPaused = true;
        return ok;
      },
      null,
      { timeout: 60000, polling: "raf" },
    );
    const busy = await page.evaluate(() => ({ text: document.getElementById("hud-tag").textContent, pips: document.querySelectorAll("#hud-pips .hud-pip").length, pipsShown: !document.getElementById("hud-pips").hidden, past: document.querySelectorAll('#hud-pips .hud-pip[data-past="1"]').length }));
    expect(busy.text).toBe("… BUSY: ATL Rydin");
    expect(busy).toMatchObject({ pips: 8, pipsShown: true });
    await page.screenshot({ path: shot("busy-desktop") });
    await grayscale(page, "busy-desktop");
    // After 600 ms with no new press, the dance chip shows again.
    await page.evaluate(() => (window.__atl.renderPaused = false));
    await page.waitForFunction(() => document.getElementById("hud-tag").textContent === "↑ ATL Rydin", null, { timeout: 5000, polling: "raf" });

    // GOOD: a dance on the beat.
    await forceBeat(page, "GOOD");
    await page.evaluate((script) => {
      window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 });
    }, [{ frames: 40, input: { push: true } }, { frames: 1, input: { style2: true, flick: { style2: "l" } } }, { frames: 200, input: {} }]);
    await page.waitForFunction(
      () => {
        const ok = document.getElementById("hud-tag").dataset.look === "good";
        if (ok) window.__atl.renderPaused = true;
        return ok;
      },
      null,
      { timeout: 60000, polling: "raf" },
    );
    expect(await page.evaluate(() => document.getElementById("hud-tag").textContent)).toBe("✓ GOOD ← Toe Spin");
    await page.screenshot({ path: shot("good-desktop") });
    await grayscale(page, "good-desktop");
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("E4: the manual bar is 180 px high beside the skater, off the HUD column and the minimap", async ({ page }) => {
    const errors = collectErrors(page);
    await ready(page);
    await page.evaluate((script) => {
      window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 });
    }, [{ frames: 50, input: { push: true } }, { frames: 300, input: { grind: true, balance: 0 } }]);
    await page.waitForFunction(
      () => {
        const m = window.__atl.skater.manual;
        const ok = Boolean(m) && Math.abs(m.balance) > 0.3 && window.__atl.trickHud.manualBar.visible;
        if (ok) window.__atl.renderPaused = true;
        return ok;
      },
      null,
      { timeout: 60000, polling: "raf" },
    );
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const box = (q) => {
        const r = document.querySelector(q)?.getBoundingClientRect();
        return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      };
      return { track: box("#manual-bar .mb-track"), bar: box("#manual-bar"), hud: box("#hud"), minimap: box("#minimap"), labels: [...document.querySelectorAll("#manual-bar .mb-label")].map((n) => n.textContent), state: window.__atl.trickHud.manualBar, opacity: getComputedStyle(document.getElementById("manual-bar")).opacity };
    });
    expect(info.track.height).toBe(180);
    expect(info.labels).toEqual(["W", "S"]);
    expect(overlap(info.bar, info.hud)).toBe(false);
    if (info.minimap) expect(overlap(info.bar, info.minimap)).toBe(false);
    expect(info.opacity).toBe("1");
    await page.screenshot({ path: shot("manual-bar-desktop") });
    await grayscale(page, "manual-bar-desktop");
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("E6: T opens the trick list and pauses the game; the tabs change the TRICK dances; Escape closes it and gives the focus back", async ({ page }) => {
    const errors = collectErrors(page);
    await ready(page);
    await page.locator("canvas").first().focus().catch(() => {});
    await page.keyboard.press("KeyT");
    await expect(page.locator("#trick-list")).toHaveAttribute("open", "");
    const t0 = await page.evaluate(() => window.__atl.skater.time);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__atl.skater.time)).toBe(t0);
    const nia = await page.evaluate(() => ({
      sections: [...document.querySelectorAll("#trick-list section h3")].map((h) => h.firstChild.textContent),
      trick: [...document.querySelectorAll("#trick-list section.tl-trick .tl-cell span")].map((n) => n.textContent),
      selected: document.querySelector('#trick-list [role="tab"][aria-selected="true"]').textContent,
      origin: document.querySelector('#trick-list [data-dance="Bankhead Bounce"] small').textContent,
      input: document.getElementById("trick-list-input").textContent,
    }));
    expect(nia.sections).toEqual(["Air: grabs", "Rail: grind stances", "Ground: TRICK dances", "Ground: SPIN dances", "Manual"]);
    expect(nia.selected).toBe("Nia");
    expect(nia.trick).toEqual(["• Bankhead Bounce", "↑ Swag Surf", "← Walk It Out", "→ The Prep", "↓ Snap Lean"]);
    expect(nia.origin).toBe("Bankhead, west Atlanta, 1995");
    expect(nia.input).toMatch(/^Direction \(W A S D/);
    await page.screenshot({ path: shot("list-desktop") });
    await grayscale(page, "list-desktop");
    // The detail panel of a dance, with its sources; Escape closes the detail first.
    await page.click('#trick-list [data-dance="Swag Surf"]');
    await expect(page.locator("#trick-list .tl-detail")).toBeVisible();
    expect(await page.locator("#trick-list .tl-detail a").first().getAttribute("rel")).toBe("noopener");
    await page.screenshot({ path: shot("list-detail-desktop") });
    await page.keyboard.press("Escape");
    await expect(page.locator("#trick-list .tl-detail")).toBeHidden();
    await expect(page.locator("#trick-list")).toHaveAttribute("open", "");
    // The Marcus tab (Right arrow on the tab).
    await page.locator("#trick-list-tab-nia").focus();
    await page.keyboard.press("ArrowRight");
    const marcus = await page.evaluate(() => [...document.querySelectorAll("#trick-list section.tl-trick .tl-cell span")].map((n) => n.textContent));
    expect(marcus).toEqual(["• Swag Surf", "↑ Drumline Count", "← Walk It Out", "→ The Prep", "↓ Jam Step"]);
    expect(await page.locator('#trick-list [data-dance="Jam Step"] small').textContent()).toBe("no source yet");
    await page.keyboard.press("Escape");
    await expect(page.locator("#trick-list")).not.toHaveAttribute("open", "");
    // The TRICKS button opens it, and the focus goes back to the button.
    await page.click("#tricks-toggle");
    await expect(page.locator("#trick-list")).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tricks-toggle");
    // The game goes on after the close.
    await page.waitForFunction((t) => window.__atl.skater.time > t, t0, { timeout: 10000 });
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("E6: the gamepad View/Back button opens the list, RB changes the tab, B closes it; the settings has a Trick list button", async ({ page }) => {
    await ready(page);
    const pad = (pressed) => ({ connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })), axes: [0, 0, 0, 0] });
    const poll = (p) => page.evaluate((x) => window.__atl.trickHud.trickList.pollPad(x), p);
    await poll(pad([]));
    await poll(pad([8]));
    expect(await page.evaluate(() => window.__atl.trickHud.trickList.isOpen)).toBe(true);
    await poll(pad([]));
    await poll(pad([5]));
    expect(await page.evaluate(() => window.__atl.trickHud.trickList.skater)).toBe("marcus");
    await poll(pad([]));
    await poll(pad([1]));
    expect(await page.evaluate(() => window.__atl.trickHud.trickList.isOpen)).toBe(false);
    await poll(pad([]));
    // Settings, then "Trick list".
    await page.keyboard.press("KeyO");
    await page.click("#settings-tricks-open");
    expect(await page.evaluate(() => ({ list: window.__atl.trickHud.trickList.isOpen, settings: document.getElementById("settings-menu").open }))).toEqual({ list: true, settings: false });
  });
});

test.describe("reduced motion", () => {
  test("E4: the manual bar has a fixed place, no pulse, and the ! mark near the limit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await page.evaluate((script) => {
      window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 });
    }, [{ frames: 50, input: { push: true } }, { frames: 300, input: { grind: true, balance: -0.3 } }]);
    await page.waitForFunction(
      () => {
        const m = window.__atl.skater.manual;
        const ok = Boolean(m) && Math.abs(m.balance) >= 0.7 && window.__atl.trickHud.manualBar.visible;
        if (ok) window.__atl.renderPaused = true;
        return ok;
      },
      null,
      { timeout: 60000, polling: "raf" },
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    const info = await page.evaluate(() => ({ state: window.__atl.trickHud.manualBar, alert: !document.querySelector("#manual-bar .mb-alert").hidden, opacity: document.querySelector("#manual-bar .mb-marker").style.opacity, w: window.innerWidth, h: window.innerHeight }));
    expect(info.alert).toBe(true);
    expect(info.opacity).toBe("1");
    expect(info.state.x).toBeCloseTo(info.w / 2 + 120, 0);
    expect(info.state.y).toBeCloseTo(info.h / 2, 0);
    await page.screenshot({ path: shot("manual-bar-reduced") });
    await grayscale(page, "manual-bar-reduced");
  });
});

for (const orientation of ["portrait", "landscape"]) {
  test.describe(`Pixel 7 ${orientation}`, () => {
    const p = profile("Pixel 7");
    const viewport = orientation === "portrait" ? p.viewport : { width: p.viewport.height, height: p.viewport.width };
    test.use({ ...p, viewport });

    test(`E5: a touch on TRICK in the air shows 4 chips at 40 px and the card; a 24 px drag right lights → Side Grab (${orientation})`, async ({ page }) => {
      const errors = collectErrors(page);
      await ready(page);
      const cdp = await page.context().newCDPSession(page);
      const btn = await page.evaluate(() => {
        const r = document.querySelector(".touch-style1").getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      });
      // A drop from 30 m: a long air.
      await page.evaluate(() => {
        window.__atl.resetSkater([0, 30, 0], 0);
      });
      await page.waitForFunction(() => window.__atl.skater.state === "air", null, { timeout: 20000, polling: "raf" });
      // The touch-down and the 30 px drag go in while the sim is paused, so
      // they reach the same sample (the software renderer is slower than
      // flickMaxMs between 2 touch events; see e2e/trick-touch.spec.js).
      await page.evaluate(() => (window.__atl.renderPaused = true));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: btn.x, y: btn.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: btn.x + 30, y: btn.y + 1 }] });
      await page.evaluate(() => (window.__atl.renderPaused = false));
      await page.waitForFunction(() => window.__atl.trickHud.flickCard?.visible && window.__atl.trickHud.flickCard.ctx === "air" && window.__atl.trickHud.flickCard.lit === "r", null, { timeout: 10000, polling: "raf" });
      await page.evaluate(() => (window.__atl.renderPaused = true));
      // 4 chips with their centers 40 px from the button center.
      const ring = await page.evaluate(() => {
        const ring = document.querySelector(".flick-ring-style1");
        const rr = ring.getBoundingClientRect();
        return [...ring.querySelectorAll(".flick-arrow:not(.flick-n)")].map((a) => {
          const r = a.getBoundingClientRect();
          return Math.hypot(r.left + r.width / 2 - rr.left, r.top + r.height / 2 - rr.top);
        });
      });
      expect(ring).toHaveLength(4);
      for (const d of ring) {
        expect(d).toBeGreaterThan(36);
        expect(d).toBeLessThanOrEqual(40.5);
      }
      const card = await page.evaluate(() => window.__atl.trickHud.flickCard.text);
      expect(card).toEqual(["\u2022 Mute Grab tap", "\u2191 Rocket Grab", "\u2190 Japan Grab", "\u25B6 \u2192 Side Grab", "\u2193 Tuck Knee"]);
      await page.evaluate(() => (window.__atl.renderPaused = true));
      const lit = await page.evaluate(() => {
        const box = (q) => {
          const r = document.querySelector(q)?.getBoundingClientRect();
          return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
        };
        return {
          cell: document.querySelector('#flick-card .fc-cell[data-lit="1"]').textContent,
          ringDir: document.querySelector(".flick-ring-style1").dataset.dir,
          card: box("#flick-card"),
          minimap: box("#minimap"),
          stick: box(".touch-stick-base"),
          buttons: [...document.querySelectorAll(".touch-btn")].map((b) => b.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)),
          label: document.querySelector(".touch-style1").textContent,
          ticks: { trick: document.querySelectorAll(".flick-ring-style1 .flick-arrow:not(.flick-n)").length, jump: document.querySelectorAll(".flick-ring-jump").length },
        };
      });
      expect(lit.cell).toBe("▶ → Side Grab");
      expect(lit.ringDir).toBe("r");
      expect(lit.label).toBe("TRICK");
      expect(lit.ticks).toEqual({ trick: 4, jump: 0 });
      for (const s of lit.buttons) expect(s).toBeGreaterThanOrEqual(44);
      if (lit.minimap) expect(overlap(lit.card, lit.minimap)).toBe(false);
      if (lit.stick) expect(overlap(lit.card, lit.stick)).toBe(false);
      await page.screenshot({ path: shot(`flick-card-${orientation}`) });
      await grayscale(page, `flick-card-${orientation}`);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.evaluate(() => (window.__atl.renderPaused = false));
      // The ring and the card hide 150 ms after the lift.
      await page.waitForFunction(() => !window.__atl.trickHud.flickCard.visible, null, { timeout: 5000, polling: "raf" });
      expect(errors, errors.join(" | ")).toEqual([]);
    });

    test(`E4 and E6: the manual bar is 160 px high and off the touch controls; the TRICKS button opens the list (${orientation})`, async ({ page }) => {
      const errors = collectErrors(page);
      await ready(page);
      await page.evaluate((script) => {
        window.__atl.runScript(script, { position: [0, 0, 0], yaw: 0 });
      }, [{ frames: 50, input: { push: true } }, { frames: 300, input: { grind: true, balance: 0 } }]);
      await page.waitForFunction(
        () => {
          const m = window.__atl.skater.manual;
          const ok = Boolean(m) && Math.abs(m.balance) > 0.3 && window.__atl.trickHud.manualBar.visible;
          if (ok) window.__atl.renderPaused = true;
          return ok;
        },
        null,
        { timeout: 60000, polling: "raf" },
      );
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => {
        const box = (q) => {
          const r = document.querySelector(q)?.getBoundingClientRect();
          return r && r.width ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
        };
        return { track: box("#manual-bar .mb-track"), bar: box("#manual-bar"), blocks: ["#hud", ".touch-buttons", ".touch-stick-base", "#minimap"].map(box).filter(Boolean), tricks: box("#tricks-toggle"), settings: box("#settings-toggle"), photo: box("#photo-toggle"), minimap: box("#minimap") };
      });
      expect(info.track.height).toBe(160);
      for (const b of info.blocks) expect(overlap(info.bar, b)).toBe(false);
      // The TRICKS button: 44 px or larger, beside SETTINGS, over no other button.
      expect(info.tricks.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(info.tricks.y - info.settings.y)).toBeLessThan(2);
      for (const o of [info.settings, info.photo, info.minimap].filter(Boolean)) expect(overlap(info.tricks, o)).toBe(false);
      await page.screenshot({ path: shot(`manual-bar-${orientation}`) });
      await grayscale(page, `manual-bar-${orientation}`);
      await page.evaluate(() => (window.__atl.renderPaused = false));
      await page.tap("#tricks-toggle");
      await expect(page.locator("#trick-list")).toHaveAttribute("open", "");
      const list = await page.evaluate(() => ({ input: document.getElementById("trick-list-input").textContent, button: document.querySelector("#trick-list section.tl-air h3 small").textContent, tab: document.querySelector("#trick-list-tab-nia").getBoundingClientRect().height }));
      expect(list.input).toBe("Flick the button. A tap gives the • trick.");
      expect(list.button).toBe("TRICK");
      expect(list.tab).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: shot(`list-${orientation}`) });
      await grayscale(page, `list-${orientation}`);
      await page.tap("#trick-list .tl-close");
      await expect(page.locator("#trick-list")).not.toHaveAttribute("open", "");
      expect(errors, errors.join(" | ")).toEqual([]);
    });
  });
}
