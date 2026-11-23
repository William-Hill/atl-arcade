// Automated playtest 1 of the trick input prototype (#326). Headless Chromium.
//
//   node prototypes/trick-input/playtest/playtest.mjs [--port 5193]
//
// It starts the Vite dev server, opens the prototype, and:
//   1. drives the real DOM input paths (keyboard, a fake gamepad, CDP touch)
//      in real time and checks the trick that comes out;
//   2. runs the route bot and takes the screenshots;
//   3. runs the synthetic player sessions and the sweeps in the browser;
//   4. writes results.json, results.md, and screenshots/ next to this file.
//
// The synthetic players are a model of human timing, not humans. The human
// playtest (5 or more players) stays open: see ../REPORT.md.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const shots = join(here, "screenshots");
mkdirSync(shots, { recursive: true });
const argPort = process.argv.indexOf("--port");
const PORT = argPort > 0 ? Number(process.argv[argPort + 1]) : 5193;
const URL = `http://localhost:${PORT}/prototypes/trick-input/index.html`;

const results = { date: new Date().toISOString().slice(0, 10), checks: [], consoleErrors: [], screenshots: [] };
const check = (name, ok, detail = {}) => {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail) : ""}`);
};

// --- Dev server ----------------------------------------------------------------

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("vite did not start")), 60000);
  const on = (b) => {
    if (String(b).includes("Local:")) {
      clearTimeout(to);
      res();
    }
  };
  server.stdout.on("data", on);
  server.stderr.on("data", on);
});

const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(ctxOpts, query = "") {
  const ctx = await browser.newContext(ctxOpts);
  // A fake gamepad the test can steer (window.__fakePad).
  await ctx.addInitScript(() => {
    window.__fakePad = { connected: false, axes: [0, 0, 0, 0], buttons: Array(17).fill(0) };
    navigator.getGamepads = () => [window.__fakePad.connected ? { connected: true, id: "fake", axes: window.__fakePad.axes, buttons: window.__fakePad.buttons.map((v) => ({ value: v, pressed: v > 0.5 })) } : null];
  });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && results.consoleErrors.push(m.text()));
  page.on("pageerror", (e) => results.consoleErrors.push(String(e)));
  await page.goto(URL + query);
  await page.waitForFunction(() => window.__ti && window.__ti.sim);
  await sleep(500);
  return { ctx, page };
}

async function shot(page, name, caption) {
  const path = join(shots, name);
  await page.screenshot({ path });
  results.screenshots.push({ file: `screenshots/${name}`, caption });
}

// The skater in a ramp air (vy 5, about 1 s) on the open pad.
const airReset = (page, extra = {}) => page.evaluate((o) => window.__ti.reset({ x: 10, z: 8, yaw: 0, speed: 6, mode: "air", vy: 5, base: 100, baseName: "Ramp Air", ...o }), extra);

try {
  // ---------------------------------------------------------------- desktop
  const { ctx: dctx, page } = await open({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  // 1a. Real keyboard: A, then Q 60 ms later, in the air: Japan Grab.
  {
    const got = [];
    for (let i = 0; i < 5; i++) {
      await airReset(page);
      await sleep(250);
      await page.keyboard.down("KeyA");
      await sleep(60);
      await page.keyboard.down("KeyQ");
      await sleep(120);
      got.push(await page.evaluate(() => window.__ti.sim.air && window.__ti.sim.air.grab && window.__ti.sim.air.grab.id));
      if (i === 0) await shot(page, "01-keyboard-japan-grab.png", "Real keyboard input: A then Q in the air gives the Japan Grab. The text label stands in for the clip.");
      await page.keyboard.up("KeyQ");
      await page.keyboard.up("KeyA");
      await sleep(900);
    }
    check("keyboard: A then Q (60 ms) in the air gives Japan Grab, 5 of 5", got.every((g) => g === "japan"), { got });
  }

  // 1b. Real keyboard: W held 1 s to push, then Q on the ground: the neutral dance (R3).
  {
    await page.evaluate(() => window.__ti.reset({ x: -10, z: 8, yaw: 0, speed: 3 }));
    await page.keyboard.down("KeyW");
    await sleep(1000);
    await page.keyboard.down("KeyQ");
    await sleep(150);
    const name = await page.evaluate(() => window.__ti.sim.trick && window.__ti.sim.trick.name);
    await page.keyboard.up("KeyQ");
    await page.keyboard.up("KeyW");
    check("keyboard: W held 1 s, then Q gives the neutral dance (Bankhead Bounce)", name === "Bankhead Bounce", { name });
    await sleep(1500);
  }

  // 1c. Real keyboard: a W tap 80 ms before Q on the ground: Up (Swag Surf).
  {
    await page.evaluate(() => window.__ti.reset({ x: -10, z: 8, yaw: 0, speed: 5 }));
    await sleep(200);
    await page.keyboard.down("KeyW");
    await sleep(40);
    await page.keyboard.up("KeyW");
    await sleep(40);
    await page.keyboard.down("KeyQ");
    await sleep(150);
    const name = await page.evaluate(() => window.__ti.sim.trick && window.__ti.sim.trick.name);
    await page.keyboard.up("KeyQ");
    check("keyboard: a W tap 80 ms before Q gives Up (Swag Surf)", name === "Swag Surf", { name });
    await shot(page, "02-keyboard-dance-up.png", "A fresh W tap before Q on the ground: Swag Surf (Nia, Up). The panel at the top right shows the fresh window of R3.");
    await sleep(1500);
  }

  // 1d. Fake gamepad: stick left, then Y.
  {
    await page.evaluate(() => (window.__fakePad.connected = true));
    await airReset(page);
    await sleep(250);
    await page.evaluate(() => (window.__fakePad.axes = [-0.9, 0, 0, 0]));
    await sleep(60);
    await page.evaluate(() => (window.__fakePad.buttons[3] = 1));
    await sleep(120);
    const id = await page.evaluate(() => window.__ti.sim.air && window.__ti.sim.air.grab && window.__ti.sim.air.grab.id);
    await page.evaluate(() => {
      window.__fakePad.buttons[3] = 0;
      window.__fakePad.axes = [0, 0, 0, 0];
    });
    check("gamepad: stick left, then Y gives Japan Grab", id === "japan", { id });
    await sleep(1200);
    // Stick at 0.49 is no direction.
    await airReset(page);
    await sleep(250);
    await page.evaluate(() => (window.__fakePad.axes = [-0.49, 0, 0, 0]));
    await sleep(60);
    await page.evaluate(() => (window.__fakePad.buttons[3] = 1));
    await sleep(160);
    const id2 = await page.evaluate(() => window.__ti.sim.air && window.__ti.sim.air.grab && window.__ti.sim.air.grab.id);
    await page.evaluate(() => {
      window.__fakePad.buttons[3] = 0;
      window.__fakePad.axes = [0, 0, 0, 0];
      window.__fakePad.connected = false;
    });
    check("gamepad: stick at 0.49 gives the neutral Mute Grab", id2 === "mute", { id: id2 });
    await sleep(1200);
  }

  // 2. Route bot screenshots (paused, so the frame does not move).
  await page.evaluate(() => window.__ti.pause(true));
  for (const [stop, file, caption] of [
    ["grind", "03-route-grind.png", "Route bot: Rail Grind with GRIND held."],
    ["manual", "04-route-manual-bar.png", "The grind-to-manual link: GRIND held off the rail end. The balance bar (F1) shows beside the skater, with zone patterns and W/S arrows."],
    ["grab", "05-route-japan-grab.png", "Off the kicker: a left tap and TRICK give the Japan Grab; the combo line shows the links and the multiplier."],
  ]) {
    await page.evaluate(() => window.__ti.reset({}));
    const r = await page.evaluate((s) => window.__ti.route({ stop: s, seed: 3 }), stop);
    await shot(page, file, caption);
    check(`route bot reaches "${stop}"`, r.mode === (stop === "grab" ? "air" : stop), r);
  }
  {
    await page.evaluate(() => window.__ti.reset({}));
    const r = await page.evaluate(() => window.__ti.route({ seed: 3 }));
    await shot(page, "06-route-combo-banked.png", "The first 3-link combo with a manual banks.");
    check("route bot banks a 3-link combo with a manual", r.firstComboSec != null && r.names.length >= 3, r);
    results.route = r;
  }
  // Grayscale check of the HUD (R12.4): shape and text, not color alone.
  await page.evaluate(() => window.__ti.reset({}));
  await page.evaluate(() => window.__ti.route({ stop: "manual", seed: 3 }));
  await page.addStyleTag({ content: "html { filter: grayscale(1); }" });
  await shot(page, "07-grayscale-manual-bar.png", "Grayscale: the balance bar reads from the hatching, the marker shape, and the W/S labels (R12.4).");
  await page.addStyleTag({ content: "html { filter: none; }" });
  await page.evaluate(() => window.__ti.pause(false));

  // 3. Synthetic sessions, sweeps, and routes in the browser.
  const t0 = Date.now();
  results.sessions = await page.evaluate(() => window.__ti.bots({ trials: 150, seed: 11 }));
  results.sweepPush = await page.evaluate(() => window.__ti.sweep({}));
  results.routes = await page.evaluate(() => window.__ti.routes({}));
  results.knobs = {};
  for (const [name, o, devs] of [
    ["dirBefore 0.10", { dirBefore: 0.1 }, ["keyboard", "gamepad"]],
    ["dirBefore 0.25", { dirBefore: 0.25 }, ["keyboard", "gamepad"]],
    ["dirAfter 0", { dirAfter: 0 }, ["keyboard", "gamepad"]],
    ["flickMin 16", { flickMin: 16 }, ["touch"]],
    ["flickMin 40", { flickMin: 40 }, ["touch"]],
  ]) {
    results.knobs[name] = await page.evaluate(([oo, dd]) => window.__ti.bots({ trials: 150, seed: 11, devices: dd, kOverride: oo }), [o, devs]);
  }
  results.botSeconds = (Date.now() - t0) / 1000;
  await page.evaluate(() => window.__ti.reset({}));
  await sleep(1500);
  results.desktopFps = await page.evaluate(() => window.__ti.frameRate());
  await dctx.close();

  // ---------------------------------------------------------------- phone
  const { ctx: pctx, page: phone } = await open({ ...devices["Pixel 7"] }, "?touch");
  const cdp = await pctx.newCDPSession(phone);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 1 })) });
  const center = async (b) => phone.evaluate((bb) => {
    const r = document.querySelector(`.tbtn[data-b="${bb}"]`).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, b);

  // A flick right on TRICK in the air: Side Grab. A screenshot with the ring up.
  {
    await airReset(phone);
    await sleep(250);
    const [x, y] = await center("trick");
    // One move: a CDP touch event waits for a frame, and SwiftShader frames
    // at the phone viewport are slow, so a drag in many steps can pass the
    // 120 ms flickMaxMs in sim time.
    await touch("touchStart", [[x, y]]);
    await touch("touchMove", [[x + 30, y]]);
    await sleep(40);
    await phone.evaluate(() => window.__ti.pause(true));
    await shot(phone, "08-phone-flick-ring.png", "Pixel 7: a flick right from TRICK in the air. The ring shows 4 arrows with the short trick names; the lit arrow is the resolved direction (Side Grab).");
    const id = await phone.evaluate(() => window.__ti.sim.air && window.__ti.sim.air.grab && window.__ti.sim.air.grab.id);
    await phone.evaluate(() => window.__ti.pause(false));
    await touch("touchEnd", []);
    check("phone: a 30 px flick right on TRICK in the air gives Side Grab", id === "side", { id });
    await sleep(1200);
  }
  // A tap: Mute Grab.
  {
    await airReset(phone);
    await sleep(250);
    const [x, y] = await center("trick");
    await touch("touchStart", [[x, y]]);
    await sleep(50);
    await touch("touchEnd", []);
    await sleep(80);
    const id = await phone.evaluate(() => window.__ti.sim.air && window.__ti.sim.air.grab && window.__ti.sim.air.grab.id);
    check("phone: a tap on TRICK in the air gives Mute Grab", id === "mute", { id });
    await sleep(1200);
  }
  // A flick up on SPIN on the ground: ATL Rydin.
  {
    await phone.evaluate(() => window.__ti.reset({ x: -10, z: 8, yaw: 0, speed: 5 }));
    await sleep(200);
    const [x, y] = await center("spin");
    await touch("touchStart", [[x, y]]);
    await sleep(16);
    await touch("touchMove", [[x, y - 30]]);
    await sleep(60);
    await touch("touchEnd", []);
    await sleep(60);
    const name = await phone.evaluate(() => window.__ti.sim.trick && window.__ti.sim.trick.name);
    check("phone: a flick up on SPIN on the ground gives ATL Rydin", name === "ATL Rydin", { name });
    await shot(phone, "09-phone-atl-rydin.png", "Pixel 7: a flick up from SPIN starts ATL Rydin (8 beats). The touch layout keeps 5 buttons: JUMP, GRIND, TRICK, SPIN, SWITCH.");
  }
  const nButtons = await phone.evaluate(() => document.querySelectorAll(".tbtn").length);
  const labels = await phone.evaluate(() => [...document.querySelectorAll(".tbtn")].map((e) => e.textContent));
  check("phone: 5 buttons, and the style1 button says TRICK", nButtons === 5 && labels.includes("TRICK") && !labels.includes("GROOVE"), { labels });
  results.phoneFps = await phone.evaluate(() => window.__ti.frameRate());
  await pctx.close();
  check("no console errors", results.consoleErrors.length === 0, { errors: results.consoleErrors.slice(0, 5) });
} finally {
  await browser.close();
  // npx starts vite as a child: stop the whole process group.
  try {
    process.kill(-server.pid);
  } catch {
    server.kill();
  }
}

// --- Write the results ---------------------------------------------------------

writeFileSync(join(here, "results.json"), JSON.stringify(results, null, 2) + "\n");
const pct = (v) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
const md = [];
md.push(`# Playtest 1 results (automated, ${results.date})`, "", "Generated by `playtest.mjs`. Synthetic players, not humans.", "");
md.push("## Real-browser input checks", "", "| Check | Result |", "|---|---|");
for (const c of results.checks) md.push(`| ${c.name} | ${c.ok ? "PASS" : "FAIL"} |`);
md.push("", "## Synthetic sessions (150 trials each)", "", "| Device | Player | As wanted | Unwanted Up from push | Unwanted L/R from carve | Median latency (ms) |", "|---|---|---|---|---|---|");
for (const s of results.sessions) md.push(`| ${s.device} | ${s.profile} (${s.label}) | ${pct(s.wantedShare)} | ${pct(s.unwantedUpFromPush)} (n ${s.pushTrials}) | ${pct(s.unwantedLRFromCarve)} (n ${s.carveTrials}) | ${s.medianLatencyMs} |`);
md.push("", "## Push taps with no pause (worst case)", "", "| dirBefore (s) | Tap period (s) | Neutral tricks that came out Up |", "|---|---|---|");
for (const s of results.sweepPush) md.push(`| ${s.dirBefore} | ${s.period} | ${pct(s.upShare)} |`);
md.push("", "## Knob sweeps (mean over the 5 players)", "", "| Knob | Device | As wanted | Unwanted Up | Unwanted L/R |", "|---|---|---|---|---|");
const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
const base = (dev) => results.sessions.filter((s) => s.device === dev);
for (const dev of ["keyboard", "gamepad", "touch"]) md.push(`| typical | ${dev} | ${pct(mean(base(dev), (x) => x.wantedShare))} | ${pct(mean(base(dev), (x) => x.unwantedUpFromPush))} | ${pct(mean(base(dev), (x) => x.unwantedLRFromCarve))} |`);
for (const [name, rows] of Object.entries(results.knobs)) {
  for (const dev of [...new Set(rows.map((r) => r.device))]) {
    const g = rows.filter((r) => r.device === dev);
    md.push(`| ${name} | ${dev} | ${pct(mean(g, (x) => x.wantedShare))} | ${pct(mean(g, (x) => x.unwantedUpFromPush))} | ${pct(mean(g, (x) => x.unwantedLRFromCarve))} |`);
  }
}
md.push("", "## Route bot: first 3-link combo with a manual", "", "| Player | Seconds | Attempts | Links | Banked |", "|---|---|---|---|---|");
for (const r of results.routes) md.push(`| ${r.profile} | ${r.firstComboSec == null ? "none" : r.firstComboSec.toFixed(2)} | ${r.attempts} | ${r.names ? r.names.join(" + ") : "-"} | ${r.banked ?? "-"} |`);
md.push("", `Frame rate (headless, SwiftShader): desktop ${results.desktopFps.toFixed(1)} FPS, Pixel 7 viewport ${results.phoneFps.toFixed(1)} FPS. Bot run time in the browser: ${results.botSeconds.toFixed(1)} s.`, "");
md.push("## Screenshots", "");
for (const s of results.screenshots) md.push(`- \`${s.file}\`: ${s.caption}`);
writeFileSync(join(here, "results.md"), md.join("\n") + "\n");
const failed = results.checks.filter((c) => !c.ok).length;
console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed. Results in ${join(here, "results.md")}`);
process.exit(failed ? 1 : 0);
