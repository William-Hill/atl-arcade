// The page of the trick input prototype (#326): Three.js greybox render, DOM
// input, and the HUD. The rules are in the pure modules; this file only
// feeds them events and draws the state. It does not import src/ (AGENTS.md).

import * as THREE from "three";
import { CARVE_GUARD, DT, GDD_RULE, SHORT_FLICK, TRICK, withRelaxed } from "./constants.js";
import { activeFlicks, createInput, frameInput, keyDown, keyUp, padDisconnect, padSample, touchDown, touchMove, touchUp, touchStick } from "./input.js";
import { freshDir, isFresh } from "./direction.js";
import { applyEvent, run } from "./harness.js";
import { createSim, LEVEL, place, stepSim } from "./sim.js";
import { comboValue } from "./scoring.js";
import { ARROWS, DANCES, GRABS, STANCES, hudShort } from "./tricks.js";
import { metrics, PROFILES, pushTapSweep, routeBot, runSession, runTrial } from "./bots.js";
import { createIntentLog, feed, intend, intentMetrics, restartClock } from "./intent.js";

const params = new URLSearchParams(location.search);
const opts = { oneButton: false, relaxed: false, carveGuard: params.has("carveGuard"), gddRule: params.has("gddRule"), shortFlick: params.has("shortFlick"), skater: "nia", touch: params.has("touch") || matchMedia("(pointer: coarse)").matches };
let k = { ...TRICK, ...(opts.gddRule ? GDD_RULE : {}), ...(opts.carveGuard ? { carveGuard: CARVE_GUARD } : {}), ...(opts.shortFlick ? { flickMin: SHORT_FLICK } : {}) };
let sim = createSim({ k, skater: opts.skater });
let inp = createInput({ k });
let paused = params.has("paused");

// The intent log of an agent playtest (#326, intent.js). The agent says the
// trick it wants (playtest.intend) before it presses; the log pairs it with
// the trick that comes out and gives the 3 metrics (playtest.metrics).
const intentLog = createIntentLog();
const playtest = {
  intend: (dir, note = "") => {
    const e = intend(intentLog, dir, sim.t, note);
    return e.error ? e : { ok: true, dir, at: sim.t, rule: k.axisRule ? "axis" : "gdd" };
  },
  metrics: () => {
    const { rows, ...m } = intentMetrics(intentLog);
    return { ...m, rule: k.axisRule ? "axis" : "gdd", carveGuard: k.carveGuard != null, last: rows.slice(-10) };
  },
  rows: () => intentMetrics(intentLog).rows,
};

// --- Three.js scene -------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc8e8);
scene.fog = new THREE.Fog(0x9fc8e8, 40, 90);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-10, 20, 8);
scene.add(sun);

const pad = LEVEL.pad;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(pad.maxX - pad.minX, pad.maxZ - pad.minZ), new THREE.MeshLambertMaterial({ color: 0xb9b4a8 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(64, 32, 0x8f897c, 0xa39d90);
grid.scale.z = 0.5;
grid.position.y = 0.01;
scene.add(grid);
// Low walls around the pad.
const wallMat = new THREE.MeshLambertMaterial({ color: 0x7d8790 });
for (const [w, d, x, z] of [[64, 0.4, 0, pad.minZ], [64, 0.4, 0, pad.maxZ], [0.4, 32, pad.minX, 0], [0.4, 32, pad.maxX, 0]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), wallMat);
  m.position.set(x, 0.25, z);
  scene.add(m);
}
// The rail.
const rail = LEVEL.rail;
const railMesh = new THREE.Mesh(new THREE.BoxGeometry(rail.x1 - rail.x0, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0xffb000 }));
railMesh.position.set((rail.x0 + rail.x1) / 2, rail.h, rail.z);
scene.add(railMesh);
for (const x of [rail.x0 + 0.3, (rail.x0 + rail.x1) / 2, rail.x1 - 0.3]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, rail.h, 0.06), new THREE.MeshLambertMaterial({ color: 0x555555 }));
  post.position.set(x, rail.h / 2, rail.z);
  scene.add(post);
}
// The kicker: a wedge up toward +x.
const kk = LEVEL.kicker;
{
  const len = kk.x1 - kk.x0;
  const w = kk.zMax - kk.zMin;
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, kk.h)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4f88c6 }));
  m.position.set(kk.x0, 0, kk.zMin);
  scene.add(m);
}
// The capsule skater with a nose (the heading).
const skater = new THREE.Group();
const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf6f3ea });
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 6, 12), bodyMat);
body.position.y = 0.75;
skater.add(body);
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 10), new THREE.MeshLambertMaterial({ color: 0x101418 }));
nose.rotation.z = -Math.PI / 2;
nose.position.set(0.42, 0.9, 0);
skater.add(nose);
scene.add(skater);
const MODE_COLOR = { ground: 0xf6f3ea, air: 0x7fd1ff, grind: 0xffb000, manual: 0x9be07a };

function render() {
  skater.position.set(sim.x, sim.y, sim.z);
  skater.rotation.y = -sim.yaw;
  bodyMat.color.setHex(MODE_COLOR[sim.mode]);
  // A greybox pose in place of a clip: lean for a manual, tuck for a grab.
  body.rotation.z = sim.mode === "manual" ? sim.manual.m * 0.4 + (sim.manual.toe ? -0.3 : 0.3) : 0;
  body.scale.y = sim.mode === "air" && sim.air.grab ? 0.7 : 1;
  const { hx, hz } = { hx: Math.cos(sim.yaw), hz: Math.sin(sim.yaw) };
  camera.position.set(sim.x - hx * 7, sim.y + 4, sim.z - hz * 7);
  camera.lookAt(sim.x + hx * 2, sim.y + 1, sim.z + hz * 2);
  renderer.render(scene, camera);
  hud();
}

// --- HUD ------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const TAG_TEXT = { PERFECT: "★ PERFECT", GOOD: "✓ GOOD", WOBBLE: "~ WOBBLE" };
let lastTrickShown = null;
let tagUntil = 0;
let tagText = null;
const logLines = [];

function hud() {
  const s = sim;
  $("status").innerHTML = `<b>${s.mode.toUpperCase()}</b> · ${s.speed.toFixed(1)} m/s · ${s.skater === "nia" ? "Nia" : "Marcus"}<br/>device: ${inp.lastDevice}${opts.oneButton ? " · <b>one-button</b>" : ""}${opts.relaxed ? " · <b>relaxed</b>" : ""}${opts.shortFlick ? " · <b>flick 16 px</b>" : ""}${opts.carveGuard ? " · <b>carve guard</b>" : ""}${opts.gddRule ? " · <b>GDD rule</b>" : " · axis rule"}<br/>score ${s.combo.score}`;
  const tr = s.trick || lastTrickShown;
  if (s.trick) lastTrickShown = { ...s.trick, until: s.t + 1.2 };
  const show = tr && (s.trick || s.t < tr.until);
  $("trick").querySelector(".name").textContent = show ? `${ARROWS[tr.dir] || ""} ${tr.name}` : "";
  $("trick").querySelector(".clip").textContent = show ? `[clip: ${tr.clip}]${tr.held ? " · held" : ""}` : "";
  const tagEl = $("trick").querySelector(".tag");
  if (s.t < tagUntil && tagText) {
    tagEl.style.display = "inline-block";
    tagEl.textContent = TAG_TEXT[tagText];
    tagEl.style.color = tagText === "WOBBLE" ? "#ddd" : "#ffb000";
  } else tagEl.style.display = "none";
  const c = s.combo;
  const names = c.links.map((l) => `${l.tag === "PERFECT" ? "★" : l.tag === "GOOD" ? "✓" : ""}${hudShort(l.name)}`);
  const line = names.length > 3 ? `+${names.length - 3} ${names.slice(-3).join(" + ")}` : names.join(" + ");
  $("combo").innerHTML = c.active ? `${line} <b>x${c.multiplier}</b><div class="score">${c.pending} pending · ${comboValue(c)}</div>` : c.lastBanked ? `<div class="score">banked +${c.lastBanked}</div>` : "";
  // The fresh window (R3): -dirBefore .. +dirAfter around now.
  const fr = frameInput.lastFrame || {};
  const span = k.dirBefore + k.dirAfter + 0.25;
  const x = (dt) => ((dt + k.dirBefore + 0.25) / span) * 100;
  const age = fr.lastDirAt > -1e9 ? s.t - fr.lastDirAt : null;
  const fresh = k.axisRule ? freshDir(fr.dirHist, s.t, k) !== "n" : fr.lastDir && isFresh(fr.lastDir, fr.lastDirAt, s.t, k, fr.lastDirHeld);
  $("dirs").innerHTML = `dir <b>${ARROWS[fr.dir || "n"]}</b> · lastDir <b>${ARROWS[fr.lastDir || "n"]}</b> ${age != null ? `${Math.round(age * 1000)} ms ago` : ""}<br/>fresh now: <b>${fresh ? "YES" : "no"}</b> · balance ${(fr.balance ?? 0).toFixed(2)}
    <div class="win"><div class="fresh" style="left:${x(-k.dirBefore)}%;width:${x(k.dirAfter) - x(-k.dirBefore)}%"></div><div class="now" style="left:${x(0)}%"></div>${age != null && age < k.dirBefore + 0.25 ? `<div class="ev" style="left:${x(-age)}%">${ARROWS[fr.lastDir]}</div>` : ""}</div>`;
  $("log").innerHTML = logLines.slice(-7).join("<br/>");
  // Manual balance bar, beside the projected skater.
  const bar = $("manualbar");
  if (s.mode === "manual") {
    const p = new THREE.Vector3(s.x, s.y + 1, s.z).project(camera);
    bar.style.display = "block";
    bar.style.left = `${((p.x + 1) / 2) * innerWidth + 56}px`;
    bar.style.top = `${((1 - p.y) / 2) * innerHeight - 80}px`;
    const m = s.manual.m;
    bar.querySelector(".marker").style.top = `${((m + 1) / 2) * 100}%`;
    bar.querySelector(".marker").style.opacity = Math.abs(m) >= 0.7 ? (Math.floor(s.t * 8) % 2 ? 1 : 0.5) : 1;
  } else bar.style.display = "none";
  ringHud();
}

function shortNames(button) {
  const ctx = sim.mode === "air" ? "air" : "ground";
  const out = {};
  for (const d of ["l", "r", "u", "d"]) {
    if (button === "grind") out[d] = STANCES[d].word;
    else if (button === "spin") out[d] = DANCES.spin[d].name;
    else out[d] = ctx === "air" ? GRABS[d].name : DANCES.trick[sim.skater][d].name;
  }
  return out;
}

function ringHud() {
  const ring = $("ring");
  const f = activeFlicks(inp)[0];
  if (!f || !opts.touch) {
    ring.innerHTML = "";
    return;
  }
  ring.style.left = `${f.x0}px`;
  ring.style.top = `${f.y0}px`;
  const names = shortNames(f.button);
  const pos = { l: [-40, 0], r: [40, 0], u: [0, -40], d: [0, 40] };
  ring.innerHTML = ["l", "r", "u", "d"].map((d) => `<span class="${f.resolved && f.resolved.dir === d ? "lit" : ""}" style="left:${pos[d][0] * (d === "l" || d === "r" ? 1.9 : 1)}px;top:${pos[d][1]}px">${ARROWS[d]} ${names[d]}</span>`).join("");
}

function onEvents(events) {
  for (const e of events) {
    if (e.type === "trick") logLines.push(`${e.t.toFixed(2)} ${ARROWS[e.dir]} ${e.name}`);
    if (e.type === "link") {
      logLines.push(`${e.t.toFixed(2)}   +${e.earned} ${e.name}${e.tag ? ` ${e.tag}` : ""}`);
      if (e.tag) {
        tagText = e.tag;
        tagUntil = sim.t + 0.8;
      }
    }
    if (e.type === "bank") logLines.push(`${e.t.toFixed(2)} BANK +${e.banked}`);
    if (e.type === "land" && e.result === "stumble") logLines.push(`${e.t.toFixed(2)} wobble`);
  }
  while (logLines.length > 40) logLines.shift();
}

// --- Loop -------------------------------------------------------------------

let wallAtStep = performance.now();
const simTimeAt = (ms) => sim.t + Math.max(0, Math.min(DT, (ms - wallAtStep) / 1000));

function step() {
  const t = Math.round((sim.t + DT) * 1e9) / 1e9;
  pollPad(t);
  const f = frameInput(inp, t);
  frameInput.lastFrame = f;
  stepSim(sim, f);
  wallAtStep = performance.now();
  onEvents(sim.events);
  feed(intentLog, f.dirHist, sim.events);
}

let acc = 0;
let last = performance.now();
function loop(now) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    while (acc >= DT) {
      step();
      acc -= DT;
    }
  } else acc = 0;
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- DOM input ------------------------------------------------------------

addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Digit1") return toggle("oneButton");
  if (e.code === "Digit2") return toggle("relaxed");
  if (e.code === "Digit3") return toggle("skater");
  if (e.code === "Digit4") return toggle("touch");
  if (e.code === "Digit5") return toggle("shortFlick");
  if (e.code === "Digit6") return toggle("carveGuard");
  if (e.code === "Digit7") return toggle("gddRule");
  if (e.code === "Digit0") return reset();
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  keyDown(inp, e.code, simTimeAt(performance.now()));
});
addEventListener("keyup", (e) => keyUp(inp, e.code, simTimeAt(performance.now())));
addEventListener("blur", () => {
  const t = simTimeAt(performance.now());
  [...inp.down].forEach((c) => keyUp(inp, c, t));
});

function pollPad(t) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && [...pads].find((x) => x && x.connected);
  if (!p) return padDisconnect(inp, t);
  padSample(inp, [...p.axes], p.buttons.map((b) => (typeof b === "number" ? b : b.value)), t);
}

// Touch buttons (pointer events, so a mouse works with ?touch for tests).
const touchEl = $("touch");
for (const el of touchEl.querySelectorAll(".tbtn")) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("down");
    if (el.dataset.b !== "switch") touchDown(inp, e.pointerId, el.dataset.b, e.clientX, e.clientY, simTimeAt(performance.now()));
  });
  el.addEventListener("pointermove", (e) => touchMove(inp, e.pointerId, e.clientX, e.clientY, simTimeAt(performance.now())));
  const up = (e) => {
    el.classList.remove("down");
    touchUp(inp, e.pointerId, simTimeAt(performance.now()));
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}
const stickEl = $("stick");
const knob = stickEl.querySelector(".knob");
const stickMove = (e) => {
  const r = stickEl.getBoundingClientRect();
  const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
  const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
  knob.style.transform = `translate(${nx * 40}px, ${ny * 40}px)`;
  touchStick(inp, nx, -ny);
};
stickEl.addEventListener("pointerdown", (e) => {
  stickEl.setPointerCapture(e.pointerId);
  stickMove(e);
});
stickEl.addEventListener("pointermove", (e) => e.buttons && stickMove(e));
stickEl.addEventListener("pointerup", () => {
  knob.style.transform = "";
  touchStick(inp, 0, 0);
});

function applyTouchLayout() {
  touchEl.style.display = opts.touch ? "block" : "none";
}
applyTouchLayout();

function toggle(what) {
  if (what === "oneButton") opts.oneButton = !opts.oneButton;
  if (what === "relaxed") opts.relaxed = !opts.relaxed;
  if (what === "skater") opts.skater = opts.skater === "nia" ? "marcus" : "nia";
  if (what === "touch") opts.touch = !opts.touch;
  if (what === "shortFlick") opts.shortFlick = !opts.shortFlick;
  if (what === "carveGuard") opts.carveGuard = !opts.carveGuard;
  if (what === "gddRule") opts.gddRule = !opts.gddRule;
  applyTouchLayout();
  reset({ keepPos: true });
}

function reset({ keepPos = false, ...placeOpts } = {}) {
  k = { ...(opts.relaxed ? withRelaxed() : TRICK), ...(opts.shortFlick ? { flickMin: SHORT_FLICK } : {}), ...(opts.carveGuard ? { carveGuard: CARVE_GUARD } : {}), ...(opts.gddRule ? GDD_RULE : {}) };
  const old = sim;
  sim = createSim({ k, skater: opts.skater, oneButton: opts.oneButton });
  inp = createInput({ k });
  if (keepPos) place(sim, { x: old.x, z: old.z, yaw: old.yaw, speed: old.speed });
  if (Object.keys(placeOpts).length) place(sim, placeOpts);
  lastTrickShown = null;
  logLines.length = 0;
  restartClock(intentLog, sim.t);
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// --- Test hook for the Playwright playtest -----------------------------------

window.__ti = {
  get sim() {
    return sim;
  },
  get inp() {
    return inp;
  },
  pause(v = true) {
    paused = v;
  },
  paused: () => paused,
  playtest,
  reset(o = {}) {
    if (o.oneButton !== undefined) opts.oneButton = o.oneButton;
    if (o.relaxed !== undefined) opts.relaxed = o.relaxed;
    if (o.shortFlick !== undefined) opts.shortFlick = o.shortFlick;
    if (o.carveGuard !== undefined) opts.carveGuard = o.carveGuard;
    if (o.gddRule !== undefined) opts.gddRule = o.gddRule;
    if (o.skater) opts.skater = o.skater;
    if (o.touch !== undefined) {
      opts.touch = o.touch;
      applyTouchLayout();
    }
    const { oneButton, relaxed, shortFlick, carveGuard, gddRule, skater: _s, touch, ...rest } = o;
    void oneButton, relaxed, shortFlick, carveGuard, gddRule, _s, touch;
    reset(rest);
    return true;
  },
  // Raw events through the same input path, n frames, then a render.
  drive(events, frames) {
    run(sim, inp, events, frames, (s) => onEvents(s.events));
    render();
  },
  step(n = 1) {
    for (let i = 0; i < n; i++) step();
    render();
  },
  render,
  // Run the route bot to a stop condition, then show its state.
  route({ profile = 2, seed = 3, stop = null, maxSeconds = 60 } = {}) {
    const stops = {
      grind: (s) => s.mode === "grind" && s.grind.meters > 4,
      manual: (s, st) => s.mode === "manual" && st.grinded && s.manual.meters > 1.5,
      grab: (s) => s.mode === "air" && s.air.grab && s.air.grab.hold > 0.25,
      bank: () => false,
    };
    const r = routeBot({ profile: PROFILES[profile], seed, maxSeconds, stopWhen: stop ? stops[stop] : undefined, onFrame: (s) => onEvents(s.events) });
    sim = r.sim;
    inp = r.inp;
    frameInput.lastFrame = frameInput(inp, sim.t);
    render();
    return { firstComboSec: r.firstComboSec, attempts: r.attempts, names: r.bank ? r.bank.names : null, banked: r.bank ? r.bank.banked : null, mode: sim.mode, trick: sim.trick && sim.trick.name };
  },
  // The bot sessions, in the browser.
  bots({ trials = 150, seed = 11, devices = ["keyboard", "touch", "gamepad"], kOverride = null } = {}) {
    const kk2 = kOverride ? { ...TRICK, ...kOverride } : TRICK;
    const out = [];
    for (const device of devices) {
      for (const p of PROFILES) {
        const tr = runSession({ profile: p, device, trials, seed, k: kk2 });
        out.push({ device, profile: p.id, label: p.label, ...metrics(tr) });
      }
    }
    return out;
  },
  sweep({ periods = [0.4, 0.6, 1.0], dirBefore = [0.1, 0.15, 0.25] } = {}) {
    const out = [];
    for (const db of dirBefore) for (const period of periods) out.push({ dirBefore: db, period, upShare: pushTapSweep({ period, k: { ...TRICK, dirBefore: db } }) });
    return out;
  },
  routes({ seeds = [1, 2, 3, 4, 5] } = {}) {
    return PROFILES.map((p, i) => {
      const r = routeBot({ profile: p, seed: seeds[i] });
      return { profile: p.id, firstComboSec: r.firstComboSec, attempts: r.attempts, names: r.bank && r.bank.names, banked: r.bank && r.bank.banked };
    });
  },
  trial: runTrial,
  applyEvent: (e) => applyEvent(inp, e),
  profiles: PROFILES,
  frameRate: () => frameRate,
};

// A rough frame rate for the report.
let frameRate = 0;
{
  let n = 0;
  let t0 = performance.now();
  const tick = (now) => {
    n += 1;
    if (now - t0 >= 1000) {
      frameRate = (n * 1000) / (now - t0);
      n = 0;
      t0 = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Autopilot (#326): only in the dev server (npx vite) with ?autopilot=1. A
// production build has no bridge, so a link cannot connect a page to a port.
if (import.meta.env.DEV && params.get("autopilot") === "1") {
  import("./autopilot/connect.js").then(({ connectAutopilot }) =>
    connectAutopilot({ params, scene, camera, canvas: renderer.domElement, ti: window.__ti, intents: playtest, skaterObject: skater, render, threeRevision: THREE.REVISION }),
  );
}
