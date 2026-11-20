import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { expect, test } from "@playwright/test";
import { measureTaps } from "./beat-taps.js";

// Music tracks drive the beat clock (#110, #20). These tests decode the real
// files in Chromium and check, sample by sample, that the music plays where
// the beat clock's grid says it does.

const META = JSON.parse(readFileSync(new URL("../assets/music/tracks.json", import.meta.url), "utf8"));
const TRACK = META.tracks[0];

async function ready(page, query = "") {
  await page.goto(`/?level=greybox&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
}

// In the page: the lag (samples, within +-`search`) at which `got` best
// matches `ref` from sample `at`, by the smallest residual
// |got - ref| / |ref|. Identical audio gives lag 0 and a residual near 0.
const LAG_FN = `(ref, at, got, search) => {
  let bestK = 0, best = Infinity;
  for (let k = -search; k <= search; k += 1) {
    let d = 0, e = 0;
    for (let i = 0; i < got.length; i += 1) {
      const r = ref[at + k + i] ?? 0;
      d += (got[i] - r) ** 2;
      e += r * r;
    }
    const res = Math.sqrt(d / Math.max(1e-12, e));
    if (res < best) { best = res; bestK = k; }
  }
  return { lag: bestK, residual: best };
}`;

test("every track decodes in Chromium to a whole number of bars, sample exact", async ({ page }) => {
  await ready(page, "mute=1");
  const out = await page.evaluate(async (tracks) => {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const res = [];
    for (const t of tracks) {
      for (const f of [t.file, t.fallback]) {
        const bytes = await (await fetch(`/assets/music/${f}`)).arrayBuffer();
        const kb = Math.round(bytes.byteLength / 1024); // decodeAudioData detaches the bytes
        const buf = await ctx.decodeAudioData(bytes);
        res.push({ file: f, sampleRate: buf.sampleRate, length: buf.length, want: Math.round((t.loopEnd - t.loopStart) * 48000), kb });
      }
    }
    return res;
  }, META.tracks);
  console.log(JSON.stringify(out));
  for (const r of out) {
    expect(r.sampleRate).toBe(48000);
    if (r.file.endsWith(".ogg")) expect(r.length).toBe(r.want);
    else expect(Math.abs(r.length - r.want)).toBeLessThanOrEqual(1024); // AAC frames pad the end
    expect(r.kb).toBeLessThan(1024);
  }
});

for (const TRACK of META.tracks) test(`three loops of ${TRACK.id} from the beat clock's own music source keep every bar line on the grid (zero drift)`, async ({ page }) => {
  await ready(page, `mute=1&music=${TRACK.id}`);
  const out = await page.evaluate(
    async ({ track, lagSrc }) => {
      const lagOf = eval(lagSrc);
      const clock = window.__atl.beat;
      const sr = 48000;
      const bytes = await (await fetch(`/assets/music/${track.file}`)).arrayBuffer();
      const loops = 3;
      const len = track.loopEnd - track.loopStart;
      const offline = new OfflineAudioContext(1, Math.ceil((loops * len + 1) * sr), sr);
      const buf = await offline.decodeAudioData(bytes);
      // The same code path the game uses, on an offline context starting at beat 0.
      const saved = { ctx: clock.ctx, music: clock.music, state: clock.musicState, gain: clock.musicGainValue };
      clock.ctx = offline;
      clock.musicGainValue = 1;
      clock.startSource(buf, track, 0, 0);
      const rendered = (await offline.startRendering()).getChannelData(0);
      Object.assign(clock, { ctx: saved.ctx, music: saved.music, musicState: saved.state, musicGainValue: saved.gain });
      // The one-channel render is the mix (L + R) / 2 of the stereo buffer.
      const [l, r] = [buf.getChannelData(0), buf.getChannelData(1)];
      const ref = l.map((x, i) => (x + r[i]) / 2);
      const barSec = 240 / track.bpm;
      const bars = [];
      const win = 2048;
      for (let b = 0; b < loops * track.bars; b += 1) {
        const at = Math.round(b * barSec * sr);
        // A window just before and just after each bar line, so the wraps are covered.
        for (const from of [at - win, at]) {
          if (from < 0) continue;
          const want = Math.round((from / sr) % len * sr);
          if (want + win > ref.length) continue;
          const { lag, residual } = lagOf(ref, want, rendered.subarray(from, from + win), 8);
          bars.push({ bar: b, from, lag, residual });
        }
      }
      return { length: buf.length, bars };
    },
    { track: TRACK, lagSrc: LAG_FN },
  );
  const bad = out.bars.filter((b) => b.lag !== 0 || b.residual > 1e-3);
  console.log(`three loops of ${TRACK.id}: ${out.bars.length} windows, ${bad.length} off the grid`);
  expect(out.bars.length).toBeGreaterThan(3 * TRACK.bars);
  expect(bad).toEqual([]);
});

test("the track plays on the beat clock's AudioContext with its first downbeat on beat 0 @beat-timing", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await ready(page, `music=${TRACK.id}`);
  const loadBefore = loadavg();
  await page.keyboard.press("KeyL"); // a gesture starts the clock
  await page.waitForFunction(() => window.__atl.beat.musicState === "playing", null, { timeout: 20000 });
  const out = await page.evaluate(
    async ({ lagSrc }) => {
      const lagOf = eval(lagSrc);
      const clock = window.__atl.beat;
      const c = clock.ctx;
      const sr = c.sampleRate;
      const { source, gain, track, at, offset } = clock.music;
      // An AudioWorklet taps the music gain: currentFrame dates each 128-sample block exactly.
      const code = `class Tap extends AudioWorkletProcessor { process(inputs) { const i = inputs[0]; if (i && i[0]) this.port.postMessage({ frame: currentFrame, data: i[0].slice() }); return true; } } registerProcessor("tap", Tap);`;
      await c.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
      const tap = new AudioWorkletNode(c, "tap");
      const mute = c.createGain();
      mute.gain.value = 0;
      gain.connect(tap).connect(mute).connect(c.destination);
      const blocks = [];
      tap.port.onmessage = (e) => blocks.push(e.data);
      await new Promise((r) => setTimeout(r, 6000));
      tap.port.onmessage = null;
      gain.disconnect(tap);
      const ref = source.buffer.getChannelData(0);
      const scale = clock.musicGainValue;
      const checks = [];
      const win = 1024;
      // Contiguous runs of 8 blocks, every half second.
      for (let i = 0; i + 8 < blocks.length; i += 190) {
        const f0 = blocks[i].frame;
        if (blocks[i + 7].frame !== f0 + 7 * 128) continue;
        const got = new Float32Array(win);
        for (let j = 0; j < 8; j += 1) got.set(blocks[i + j].data.map((x) => x / scale), j * 128);
        const tBeat = f0 / sr - clock.startTime;
        if (tBeat < 0) continue;
        const len = track.loopEnd - track.loopStart;
        let pos = track.firstDownbeat + tBeat;
        if (pos >= track.loopEnd) pos = track.loopStart + ((pos - track.loopStart) % len);
        const want = Math.round(pos * sr);
        const { lag, residual } = lagOf(ref, want, got, 480);
        checks.push({ beatTime: Number(tBeat.toFixed(4)), lagSamples: lag, lagMs: Number(((lag / sr) * 1000).toFixed(3)), residual: Number(residual.toExponential(2)) });
      }
      return {
        track: track.id,
        bpm: clock.bpm,
        sampleRate: sr,
        bufferSampleRate: source.buffer.sampleRate,
        startTime: clock.startTime,
        musicAt: at,
        musicOffset: offset,
        startedOnBar: Math.abs(((at - clock.startTime) / (240 / clock.bpm)) % 1) < 1e-6,
        outputLatencyMs: Number((clock.outputLatencySec * 1000).toFixed(2)),
        checks,
      };
    },
    { lagSrc: LAG_FN },
  );
  const loadAfter = loadavg();
  const round = (a) => a.map((x) => Number(x.toFixed(2)));
  const lags = out.checks.map((c) => c.lagSamples);
  const report = {
    date: new Date().toISOString(),
    attempt: testInfo.retry + 1,
    loadAverage: { before: round(loadBefore), after: round(loadAfter) },
    track: out.track,
    bpm: out.bpm,
    sampleRate: out.sampleRate,
    bufferSampleRate: out.bufferSampleRate,
    outputLatencyMs: out.outputLatencyMs,
    // Beat 0 on the audio clock, and where the music source was started.
    beat0AudioTime: Number(out.startTime.toFixed(6)),
    musicStartAudioTime: Number(out.musicAt.toFixed(6)),
    musicStartOffsetSec: Number(out.musicOffset.toFixed(6)),
    musicStartedOnBarLine: out.startedOnBar,
    // Each check: 1024 samples tapped from the music output, matched to the
    // file at the position the beat grid predicts. lag 0 with a residual
    // near 0 = the audio plays exactly on the grid.
    windows: out.checks.length,
    maxAbsLagSamples: Math.max(...lags.map(Math.abs)),
    checks: out.checks,
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync(`reports/m2-music-alignment-${out.track}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach(`music-alignment-attempt-${report.attempt}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(`music alignment ${out.track}: ${out.checks.length} windows, max |lag| ${report.maxAbsLagSamples} samples, started on bar line ${out.startedOnBar}`);
  expect(out.sampleRate).toBe(48000);
  expect(out.startedOnBar).toBe(true);
  expect(out.checks.length).toBeGreaterThanOrEqual(8);
  for (const c of out.checks) {
    expect(c.lagSamples).toBe(0);
    expect(c.residual).toBeLessThan(1e-3);
  }
  expect(errors).toEqual([]);
});

test("?music=0 keeps the synthesized click", async ({ page }) => {
  await ready(page, "music=0");
  await page.keyboard.press("KeyL");
  await expect.poll(() => page.evaluate(() => window.__atl.beat.running), { timeout: 5000 }).toBe(true);
  const s = await page.evaluate(() => ({ state: window.__atl.beat.musicState, click: window.__atl.beat.sched.click, bpm: window.__atl.beat.bpm, tracks: window.__atl.beat.tracks.length }));
  expect(s).toEqual({ state: "off", click: true, bpm: 100, tracks: 0 });
  expect(await page.locator("#results-track").count()).toBe(0);
});

test("the results screen picks the track, localStorage keeps it, and the clock takes its BPM", async ({ page }) => {
  await ready(page, "mute=1");
  await page.evaluate(() => localStorage.removeItem("skate-atl.music"));
  await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
  await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 10000 });
  const select = page.locator("#results-track");
  await expect(select).toBeVisible();
  const options = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
  expect(options).toEqual([...META.tracks.map((t) => t.id), "click"]);
  await expect(select).toHaveValue(META.tracks[0].id);
  const pick = META.tracks[1];
  await select.selectOption(pick.id);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("skate-atl.music"))).toBe(pick.id);
  await expect.poll(() => page.evaluate(() => window.__atl.beat.bpm)).toBe(pick.bpm);
  await page.screenshot({ path: "e2e/__screenshots__/results-music.png" });

  await ready(page, "mute=1");
  const after = await page.evaluate(() => ({ id: window.__atl.beat.track && window.__atl.beat.track.id, bpm: window.__atl.beat.bpm }));
  expect(after).toEqual({ id: pick.id, bpm: pick.bpm });
  await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
  await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 10000 });
  await expect(page.locator("#results-track")).toHaveValue(pick.id);
  await page.locator("#results-track").selectOption("click");
  await expect.poll(() => page.evaluate(() => ({ track: window.__atl.beat.track, bpm: window.__atl.beat.bpm }))).toEqual({ track: null, bpm: 100 });
  await page.evaluate(() => localStorage.removeItem("skate-atl.music"));
});

// The m0-07 tap test (beat.spec.js) with a track playing instead of the
// click: a track whose BPM is not the click's 100, so the judge must take
// the BPM from tracks.json.
test("32 taps judge within 5 ms mean and under 5 ms sd with a track playing @beat-timing", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const track = META.tracks.find((t) => t.bpm !== 100) ?? TRACK;
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await ready(page, `music=${track.id}`);
  await page.evaluate(() => window.__atl.beat.start());
  await expect.poll(() => page.evaluate(() => window.__atl.beat.musicState), { timeout: 20000 }).toBe("playing");
  const loadBefore = loadavg();
  const paused = await measureTaps(page, 32, true);
  expect(paused.error).toBeUndefined();
  const loadAfter = loadavg();
  const state = await page.evaluate(() => ({ musicState: window.__atl.beat.musicState, click: window.__atl.beat.sched.click, track: window.__atl.beat.track.id }));
  const round = (a) => a.map((x) => Number(x.toFixed(2)));
  const report = {
    date: new Date().toISOString(),
    attempt: testInfo.retry + 1,
    loadAverage: { before: round(loadBefore), after: round(loadAfter) },
    track: state.track,
    musicState: state.musicState,
    clickScheduled: state.click,
    taps: 32,
    bpm: paused.bpm,
    outputLatencyMs: Number(paused.latencyMs.toFixed(2)),
    renderPaused: { meanMs: Number(paused.mean.toFixed(2)), sdMs: Number(paused.sd.toFixed(2)), within60ms: paused.within60, samples: paused.taps },
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync(`reports/m2-beat-alignment-${track.id}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach(`beat-alignment-${track.id}-attempt-${report.attempt}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(`beat alignment ${track.id} (${paused.bpm} BPM, render paused): mean ${report.renderPaused.meanMs} ms, sd ${report.renderPaused.sdMs} ms, ${paused.within60}/32 within 60 ms`);
  expect(state).toEqual({ musicState: "playing", click: false, track: track.id });
  expect(paused.bpm).toBe(track.bpm);
  expect(Math.abs(paused.mean)).toBeLessThanOrEqual(5);
  expect(paused.sd).toBeLessThan(5);
  expect(paused.within60).toBe(32);
  expect(errors).toEqual([]);
});
