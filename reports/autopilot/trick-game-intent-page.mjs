// usage: node game-page.mjs <R> <scratch dir>; run from the repo (uses its Playwright)
// Opens the real game with the Autopilot bridge and adds an intent log as
// window.__atl.playtest (intend, metrics, rows). The agent calls it through
// the bridge: game.call("atl.playtest", "intend", dir).
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const [R, SP] = process.argv.slice(2);
const require = createRequire(process.cwd() + "/package.json");
const { chromium } = require("@playwright/test");
const log = (l) => appendFileSync(`${SP}/game${R}.log`, l + "\n");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => log(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => log(`[pageerror] ${e.message}`));

await page.addInitScript(() => {
  const held = new Set();
  const trials = [];
  let pending = null;
  let cand = null;
  let lastKey = null;
  let evIdx = 0;
  let lastLinks = 0; // the links of the combo in the frame before a bank (a bank clears them)
  let lastManual = false; // true when those links have a manual
  // The move kinds that each button can start: a move event of another kind
  // (for example the end of a dance that was busy at the press) is not the result.
  const FITS = { trick: ["style", "dance", "grab"], spin: ["style", "dance", "grab", "spin"], grind: ["grind", "manual"] };
  const banks = [];
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const DIRKEY = { KeyW: "u", ArrowUp: "u", KeyS: "d", ArrowDown: "d", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };
  const BTN = { KeyQ: "trick", KeyE: "spin", KeyF: "grind" };
  const dirs = () => [...new Set([...held].map((k) => DIRKEY[k]).filter(Boolean))];
  const close = (result, source) => {
    if (!pending) return;
    Object.assign(pending, { result: result?.dir ?? null, kind: result?.kind ?? null, name: result?.name ?? null, source, resolvedAt: now() });
    pending = null;
    cand = null;
  };
  const trickOf = (s) => {
    if (!s) return null;
    if (s.trick) return { kind: s.trick.kind, dir: s.trick.dir ?? "n", id: s.trick.id, name: s.trick.name };
    if (s.state === "grind" && s.grind) return { kind: "grind", dir: s.grind.stance ?? "n", id: s.grind.id };
    if (s.manual) return { kind: "manual", dir: s.manual.dir ?? "n" };
    if (s.state === "air" && s.grab) return { kind: "grab", dir: s.grab.dir ?? "n", name: s.grab.name };
    if (s.style) return { kind: "dance", dir: s.style.dir ?? "n", name: s.style.name };
    return null;
  };
  addEventListener("keydown", (e) => {
    held.add(e.code);
    if (pending && BTN[e.code] && pending.pressAt === null) {
      pending.pressAt = now();
      pending.button = BTN[e.code];
      pending.heldAtPress = dirs();
      const sk = window.__atl?.skater;
      pending.busyAtPress = sk?.trick ? sk.trick.kind : null;
      pending.stateAtPress = sk?.state ?? null;
      pending.speedAtPress = sk ? +sk.speed.toFixed(2) : null;
    }
  }, true);
  addEventListener("keyup", (e) => held.delete(e.code), true);
  function tick() {
    requestAnimationFrame(tick);
    const atl = window.__atl;
    if (!atl?.skater) return;
    const s = atl.skater;
    const tr = trickOf(s);
    const key = tr ? `${tr.kind}:${tr.id ?? ""}:${tr.name ?? ""}` : null;
    const t = now();
    if (pending && pending.pressAt !== null) {
      if (key && key !== lastKey && !cand) cand = { at: t, kind: tr.kind, dir: tr.dir, key };
      if (cand) {
        if (tr && key === cand.key && t - cand.at >= 0.15) close({ ...tr }, "state");
        else if (!tr || key !== cand.key) close({ kind: cand.kind, dir: cand.dir ?? null }, "state-short");
      }
    }
    lastKey = key;
    const ev = atl.events;
    if (ev.length < evIdx) evIdx = 0;
    for (; evIdx < ev.length; evIdx++) {
      const e = ev[evIdx];
      if (e.type === "move" && pending && pending.pressAt !== null && !cand && e.dir && !pending.busyAtPress && (FITS[pending.button] ?? []).includes(e.move)) close({ kind: e.move, dir: e.dir, name: e.name }, "move");
      if (e.type === "bank") banks.push({ t, points: e.points, links: Math.max(lastLinks, atl.combo?.links?.length ?? 0), manual: lastManual });
    }
    lastLinks = atl.combo?.links?.length ?? 0;
    lastManual = (atl.combo?.links ?? []).some((l) => l.move === "manual");
    if (pending && t - (pending.pressAt ?? pending.at) > (pending.button === "spin" ? 3.5 : 2.5)) close(null, "timeout");
  }
  requestAnimationFrame(tick);
  const playtest = {
    intend(dir) {
      const d = String(dir ?? "n").toLowerCase()[0];
      if (pending && cand) close({ kind: cand.kind, dir: cand.dir ?? null }, "superseded-seen");
      else if (pending) close(null, "superseded");
      pending = { i: trials.length, at: now(), intended: "nlrud".includes(d) ? d : "n", heldAtIntend: dirs(), state: window.__atl?.skater?.state ?? null, pressAt: null, button: null, heldAtPress: null };
      trials.push(pending);
      return { ok: true, trial: pending.i };
    },
    metrics() {
      const done = trials.filter((x) => x.pressAt !== null);
      const open = done.filter((x) => x.source === undefined); // pressed, not resolved yet
      const closed = done.filter((x) => x.source !== undefined);
      const got = closed.filter((x) => x.result !== null);
      const wanted = got.filter((x) => x.result === x.intended);
      const push = closed.filter((x) => x.intended !== "u" && (x.heldAtPress ?? []).includes("u"));
      const carve = closed.filter((x) => !"lr".includes(x.intended) && (x.heldAtPress ?? []).some((h) => h === "l" || h === "r"));
      const firstCombo = banks.find((b) => (b.links ?? 0) >= 3 && b.manual);
      return {
        trials: closed.length,
        intentsWithoutPress: trials.length - done.length,
        open: open.length,
        noTrick: closed.length - got.length,
        noTrickBusy: closed.filter((x) => x.result === null && x.busyAtPress).length,
        wantedShare: closed.length ? wanted.length / closed.length : null,
        wanted: wanted.length,
        unwantedUpFromPush: push.length ? push.filter((x) => x.result === "u").length / push.length : null,
        upFromPush: push.filter((x) => x.result === "u").length,
        pushTrials: push.length,
        unwantedLRFromCarve: carve.length ? carve.filter((x) => x.result === "l" || x.result === "r").length / carve.length : null,
        lrFromCarve: carve.filter((x) => x.result === "l" || x.result === "r").length,
        carveTrials: carve.length,
        firstCombo: firstCombo ? firstCombo.t : null,
        banks: banks.length,
        misses: closed.filter((x) => x.result !== x.intended).map((x) => ({ i: x.i, intended: x.intended, result: x.result, kind: x.kind, button: x.button, held: x.heldAtPress, busy: x.busyAtPress, state: x.stateAtPress, speed: x.speedAtPress, source: x.source })),
      };
    },
    rows: () => trials,
  };
  const attach = () => (window.__atl ? (window.__atl.playtest = playtest) : setTimeout(attach, 100));
  attach();
});

await page.goto(`http://localhost:5191/?run=free&autopilot=1&autopilot_url=ws%3A%2F%2F127.0.0.1%3A8765%2Fv1%2Fbridge`);
await page.waitForFunction(() => window.__atl?.playtest && window.__atl.ready, null, { timeout: 120000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${SP}/gstart${R}.png` });
while (!existsSync(`${SP}/gdump${R}`)) await page.waitForTimeout(1000);
const out = await page.evaluate(() => ({ metrics: window.__atl.playtest.metrics(), rows: window.__atl.playtest.rows() }));
await page.screenshot({ path: `${SP}/gend${R}.png` });
writeFileSync(`${SP}/gdump${R}.json`, JSON.stringify(out, null, 1));
await browser.close();
