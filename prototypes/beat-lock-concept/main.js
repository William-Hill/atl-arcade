// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does pushing on the beat in the browser feel locked to the music?
// Date: 2026-10-30
import Phaser from "phaser";
import { BeatClock } from "./beat-clock.js";
import { buildRoad, segmentAt, project, SEGMENT_LENGTH } from "./road.js";

const W = 960;
const H = 540;
const PERFECT_MS = 45;
const GOOD_MS = 100;
const MAX_UNITS_PER_SEC = 9000;
const DRAW_SEGMENTS = 120;

const clock = new BeatClock({ bpm: 100 });
const road = buildRoad();
// Debug hooks for automated timing checks.
window.__clock = clock;
window.__stats = () => stats;

const stats = {
  offsets: [],
  hits: 0,
  misses: 0,
  combo: 0,
  maxCombo: 0,
  startedAt: 0,
  timeTo16: null,
  lastJudgment: "",
  lastJudgmentAt: 0,
};

const state = {
  speed: 0.25, // 0..1
  z: 0,
  pose: "idle",
  poseUntil: 0,
  lastBeatJudged: -1,
};

function resetStats() {
  stats.offsets.length = 0;
  stats.hits = 0;
  stats.misses = 0;
  stats.combo = 0;
  stats.maxCombo = 0;
  stats.timeTo16 = null;
  stats.startedAt = clock.running ? clock.now() : 0;
}

function act(action, domTimeStamp) {
  if (!clock.running) {
    clock.start();
    resetStats();
    return;
  }
  const t = clock.inputTime(domTimeStamp);
  const { index, offsetMs } = clock.judge(t);
  const abs = Math.abs(offsetMs);
  const seg = segmentAt(road, state.z);
  const onRail = seg.kind === "rail";

  let contextOk = true;
  if (action === "grind" && !onRail) contextOk = false;
  if ((action === "danceL" || action === "danceR") && onRail) contextOk = false;

  const doubleHit = index === state.lastBeatJudged;
  const timingOk = abs <= GOOD_MS;
  const ok = timingOk && contextOk && !doubleHit;

  if (ok) {
    state.lastBeatJudged = index;
    stats.offsets.push(offsetMs);
    stats.hits += 1;
    stats.combo += 1;
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
    if (stats.combo === 16 && stats.timeTo16 === null) stats.timeTo16 = clock.now() - stats.startedAt;
    const perfect = abs <= PERFECT_MS;
    const gain = action === "push" ? (perfect ? 0.16 : 0.09) : perfect ? 0.06 : 0.03;
    state.speed = Math.min(1, state.speed + gain);
    stats.lastJudgment = `${perfect ? "PERFECT" : "GOOD"} ${offsetMs > 0 ? "+" : ""}${offsetMs.toFixed(0)} ms`;
  } else {
    stats.misses += 1;
    stats.combo = 0;
    state.speed = Math.max(0.1, state.speed - 0.12);
    stats.lastJudgment = !contextOk
      ? action === "grind" ? "NO RAIL" : "NOT ON A RAIL"
      : doubleHit ? "DOUBLE" : `MISS ${offsetMs > 0 ? "+" : ""}${offsetMs.toFixed(0)} ms`;
  }
  stats.lastJudgmentAt = clock.now();
  state.pose = action;
  state.poseUntil = clock.now() + clock.beatLen * 0.8;
}

const KEYS = {
  Space: "push",
  ArrowUp: "push",
  KeyW: "push",
  ArrowDown: "grind",
  KeyS: "grind",
  ArrowLeft: "danceL",
  KeyA: "danceL",
  ArrowRight: "danceR",
  KeyD: "danceR",
};

class Proto extends Phaser.Scene {
  create() {
    this.g = this.add.graphics();
    this.hud = this.add.text(12, 10, "", { fontFamily: "monospace", fontSize: "15px", color: "#ffffff", lineSpacing: 4 });
    this.judgeText = this.add.text(W / 2, H * 0.42, "", { fontFamily: "system-ui", fontSize: "40px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
    this.startText = this.add
      .text(W / 2, H / 2, "Press any key or tap to start\n\nSpace/Up = push on the beat\nDown = grind on a rail\nLeft/Right = dance on flat road", {
        fontFamily: "system-ui",
        fontSize: "22px",
        color: "#ffffff",
        align: "center",
      })
      .setOrigin(0.5);

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const action = KEYS[e.code];
      if (!action && clock.running) return;
      e.preventDefault();
      act(action ?? "push", e.timeStamp);
    });
    window.addEventListener("pointerdown", (e) => {
      if (e.target.closest("#bar")) return;
      const btn = e.target.closest("[data-action]");
      act(btn ? btn.dataset.action : "push", e.timeStamp);
    });

    const offsetEl = document.getElementById("offset");
    const offsetVal = document.getElementById("offsetVal");
    offsetEl.addEventListener("input", () => {
      clock.userOffsetMs = Number(offsetEl.value);
      offsetVal.textContent = `${clock.userOffsetMs} ms`;
    });
    document.getElementById("bpm").addEventListener("change", (e) => clock.running && clock.setBpm(Number(e.target.value)));
    document.getElementById("reset").addEventListener("click", resetStats);
  }

  update(_, deltaMs) {
    const g = this.g;
    g.clear();
    if (!clock.running) return;
    this.startText.setVisible(false);

    const dt = deltaMs / 1000;
    state.speed = Math.max(0.1, state.speed - 0.05 * dt);
    state.z += state.speed * MAX_UNITS_PER_SEC * dt;
    const now = clock.now();
    if (now > state.poseUntil) state.pose = "idle";

    this.drawRoad(g);
    this.drawSkater(g, now);
    this.drawBeatBar(g, now);
    this.drawHistogram(g);
    this.drawHud(now);
  }

  drawRoad(g) {
    const camera = { height: 1000, depth: 1 / Math.tan((100 / 2) * (Math.PI / 180)) };
    const screen = { width: W, height: H };
    const cameraZ = state.z;
    const base = Math.floor(cameraZ / SEGMENT_LENGTH);

    g.fillStyle(0x1b1b2e, 1);
    g.fillRect(0, 0, W, H / 2);
    g.fillStyle(0x27213a, 1);
    g.fillRect(0, H / 2, W, H / 2);

    const pts = [];
    for (let n = 0; n <= DRAW_SEGMENTS; n += 1) {
      const idx = base + n;
      const seg = road[idx % road.length];
      const p = project(idx * SEGMENT_LENGTH, 0, cameraZ, camera, screen);
      pts.push({ ...p, seg, idx });
    }
    for (let n = pts.length - 2; n >= 0; n -= 1) {
      const near = pts[n];
      const far = pts[n + 1];
      if (near.y <= far.y || near.y < H / 2) continue;
      const dark = Math.floor(near.idx / 4) % 2 === 0;
      const onBeatStripe = near.idx % 8 === 0;
      g.fillStyle(dark ? 0x2b2340 : 0x30284a, 1);
      g.fillRect(0, far.y, W, near.y - far.y + 1);
      g.fillStyle(near.seg.kind === "rail" ? 0x3a2a3a : dark ? 0x111118 : 0x15151f, 1);
      g.fillPoints([
        { x: near.x - near.w, y: near.y },
        { x: near.x + near.w, y: near.y },
        { x: far.x + far.w, y: far.y },
        { x: far.x - far.w, y: far.y },
      ], true);
      g.fillStyle(onBeatStripe ? 0xff5fb2 : dark ? 0xf0f0f0 : 0xc0c0c0, 1);
      const rw = near.w * 0.06;
      g.fillPoints([
        { x: near.x - near.w - rw, y: near.y },
        { x: near.x - near.w, y: near.y },
        { x: far.x - far.w, y: far.y },
        { x: far.x - far.w - far.w * 0.06, y: far.y },
      ], true);
      g.fillPoints([
        { x: near.x + near.w, y: near.y },
        { x: near.x + near.w + rw, y: near.y },
        { x: far.x + far.w + far.w * 0.06, y: far.y },
        { x: far.x + far.w, y: far.y },
      ], true);
      if (near.seg.kind === "rail") {
        const h = 90;
        g.fillStyle(0x11f2f2, 1);
        g.fillPoints([
          { x: near.x + near.w * 0.55, y: near.y - h * near.scale * 40 },
          { x: near.x + near.w * 0.6, y: near.y - h * near.scale * 40 },
          { x: far.x + far.w * 0.6, y: far.y - h * far.scale * 40 },
          { x: far.x + far.w * 0.55, y: far.y - h * far.scale * 40 },
        ], true);
      }
    }
  }

  drawSkater(g, now) {
    const x = W / 2;
    const y = H - 40;
    const onRail = segmentAt(road, state.z).kind === "rail";
    const bob = Math.sin(clock.phase() * Math.PI * 2) * 4;
    const pose = state.pose;
    const lean = pose === "push" ? 14 : pose === "grind" ? 26 : 0;
    const armL = pose === "danceL" ? -40 : -14;
    const armR = pose === "danceR" ? 40 : 14;
    const crouch = pose === "grind" ? 22 : 0;
    const px = pose === "grind" && onRail ? x + 170 : x;

    g.fillStyle(0xff5fb2, 1);
    g.fillRect(px - 16 + lean, y - 110 + bob + crouch, 32, 70 - crouch);
    g.fillStyle(0xffd27a, 1);
    g.fillCircle(px + lean, y - 125 + bob + crouch, 16);
    g.lineStyle(8, 0xff5fb2, 1);
    g.lineBetween(px - 10 + lean, y - 95 + bob + crouch, px + armL + lean, y - 70 + bob + crouch);
    g.lineBetween(px + 10 + lean, y - 95 + bob + crouch, px + armR + lean, y - 70 + bob + crouch);
    g.lineStyle(8, 0x9ecbff, 1);
    g.lineBetween(px - 8 + lean, y - 40 + bob, px - 18, y - 6);
    g.lineBetween(px + 8 + lean, y - 40 + bob, px + 18, y - 6);
    g.fillStyle(0xffffff, 1);
    for (const dx of [-26, -10, 10, 26]) g.fillCircle(px + dx, y, 6);
    if (onRail) {
      g.fillStyle(0x11f2f2, 0.9);
      g.fillRect(0, y + 10, W, 4);
    }
  }

  drawBeatBar(g, now) {
    const cy = H - 118 + 100;
    const cx = W / 2;
    const pxPerSec = 320;
    g.fillStyle(0x000000, 0.45);
    g.fillRect(0, cy - 22, W, 44);
    g.fillStyle(0xffffff, 1);
    g.fillRect(cx - 2, cy - 22, 4, 44);
    const beatLen = clock.beatLen;
    const nextIndex = Math.ceil(now / beatLen);
    for (let i = -1; i < 6; i += 1) {
      const idx = nextIndex + i;
      const t = idx * beatLen;
      const dx = (t - now) * pxPerSec;
      if (Math.abs(dx) > W / 2) continue;
      const accent = idx % 4 === 0;
      g.fillStyle(accent ? 0xff5fb2 : 0x11f2f2, 1);
      g.fillCircle(cx + dx, cy, accent ? 10 : 7);
    }
    const ring = 18 + (1 - clock.phase()) * 22;
    g.lineStyle(3, 0xffffff, 0.8);
    g.strokeCircle(cx, cy, ring);
  }

  drawHistogram(g) {
    const x0 = W - 232;
    const y0 = 16;
    const w = 220;
    const h = 70;
    const bucketMs = 20;
    const buckets = new Array(Math.round((GOOD_MS * 2) / bucketMs) + 1).fill(0);
    for (const o of stats.offsets) {
      const b = Math.round((o + GOOD_MS) / bucketMs);
      if (b >= 0 && b < buckets.length) buckets[b] += 1;
    }
    const max = Math.max(1, ...buckets);
    g.fillStyle(0x000000, 0.5);
    g.fillRect(x0 - 6, y0 - 6, w + 12, h + 30);
    const bw = w / buckets.length;
    buckets.forEach((c, i) => {
      const ms = i * bucketMs - GOOD_MS;
      g.fillStyle(Math.abs(ms) <= 60 ? 0x11f2f2 : 0x8888aa, 1);
      g.fillRect(x0 + i * bw + 1, y0 + h - (c / max) * h, bw - 2, (c / max) * h);
    });
    g.fillStyle(0xffffff, 1);
    g.fillRect(x0 + w / 2 - 1, y0, 2, h);
  }

  drawHud(now) {
    const n = stats.offsets.length;
    const mean = n ? stats.offsets.reduce((a, b) => a + b, 0) / n : 0;
    const sd = n ? Math.sqrt(stats.offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
    const within = n ? stats.offsets.filter((o) => Math.abs(o) <= 60).length / n : 0;
    const seg = segmentAt(road, state.z);
    this.hud.setText(
      [
        `speed ${(state.speed * 100).toFixed(0)}%   ${seg.kind === "rail" ? "RAIL  (hold Down on the beat)" : "flat  (Left/Right to dance)"}`,
        `combo ${stats.combo}   max ${stats.maxCombo}   16-combo at ${stats.timeTo16 === null ? "--" : stats.timeTo16.toFixed(1) + "s"}`,
        `hits ${stats.hits}   misses ${stats.misses}   within ±60ms ${(within * 100).toFixed(0)}%`,
        `offset mean ${mean.toFixed(0)} ms   sd ${sd.toFixed(0)} ms   n ${n}`,
        `audio latency ${(clock.outputLatencySec * 1000).toFixed(0)} ms   cal ${clock.userOffsetMs} ms   bpm ${clock.bpm}`,
      ].join("\n")
    );
    const age = now - stats.lastJudgmentAt;
    this.judgeText.setText(age < 0.5 ? stats.lastJudgment : "");
    this.judgeText.setColor(stats.lastJudgment.startsWith("PERFECT") ? "#11f2f2" : stats.lastJudgment.startsWith("GOOD") ? "#ffffff" : "#ff5fb2");
    const latencyEl = document.getElementById("latency");
    latencyEl.textContent = `n=${n} within±60ms=${(within * 100).toFixed(0)}% mean=${mean.toFixed(0)}ms`;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0b0b12",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  scene: [Proto],
});
