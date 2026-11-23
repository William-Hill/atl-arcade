import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createCardState } from "../../../src/sim/fact-cards.js";
import { createCombo } from "../../../src/sim/skate/combo.js";
import { stepRun } from "../../../src/sim/skate/run.js";
import { createSkater } from "../../../src/sim/skate/skater.js";
import { park, rides262, simulate, startAt } from "../../../e2e/skatepark-ride.js";

// Issue #262, last acceptance item: combo links from the park ramps.
// This is a scripted ride, NOT an Autopilot run. It is extra evidence only.
// Each ride is planned in the pure simulation (closed loop) and the page
// replays the input script tick for tick on the dev server.

const DIR = "reports/playtest/2026-11-23-262-park-combo";
const ID = "skatepark:h4w-skatepark";

// Closed loop plan: push for `pushT` ticks, then hop `hopAfter` ticks after
// the first landing. Stops 30 ticks after the first bank.
function plan(start, pushT, hopAfter) {
  const { level, env, skaterEnv } = park();
  let run = { skater: createSkater(level, start), combo: createCombo(), tick: 0, time: 0, moves: [], lastMove: null, moveSeq: 0, banked: 0, cards: createCardState() };
  const inputs = [];
  let prev = "rolling";
  let landed = false;
  let wait = 0;
  let hopped = false;
  for (let t = 0; t < 900; t += 1) {
    const s = run.skater;
    if (prev === "air" && s.state === "rolling") landed = true;
    prev = s.state;
    let input = {};
    if (t < pushT) input = { push: true };
    else if (landed && !hopped && s.state === "rolling" && (wait += 1) > hopAfter) {
      hopped = true;
      input = { jump: true };
    }
    run = stepRun(run, input, 1 / 60, env, skaterEnv);
    inputs.push(input);
    if (run.banked) {
      for (let k = 0; k < 30; k += 1) inputs.push({});
      break;
    }
  }
  const script = [];
  for (const input of inputs) {
    const key = JSON.stringify(input);
    if (script.length && JSON.stringify(script[script.length - 1].input) === key) script[script.length - 1].frames += 1;
    else script.push({ frames: 1, input });
  }
  return { script, start };
}

async function open(page) {
  await page.goto(`/?level=beltline-eastside&mute=1&governor=0&weather=clear&time=14&quality=high&look=toon`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__atl.level.skatepark?.view && (window.__atl.level.skatepark.view.loaded || window.__atl.level.skatepark.view.error), null, { timeout: 180000 });
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 180000 });
}

// Replays a ride. The page freezes at the first frame where the skater is in
// the air after `airAfter` ticks, and again at the first bank, for pictures.
async function ride(page, name, { script, start }) {
  await page.evaluate(({ script, start }) => {
    const atl = window.__atl;
    const r = { stops: ["air", "bank"], stopped: null, running: true, bonks: 0 };
    // runScript resets the skater, and the reset clears atl.events.
    const n0 = 0;
    const watch = () => {
      const s = atl.skater;
      if (s.bonked) r.bonks += 1;
      const want = r.stops[0];
      const fresh = atl.events.slice(n0);
      if (!r.stopped && want === "air" && s.state === "air" && fresh.some((e) => e.type === "move")) {
        r.stopped = r.stops.shift();
        atl.renderPaused = true;
      } else if (!r.stopped && want === "bank" && fresh.some((e) => e.type === "bank")) {
        r.stopped = r.stops.shift();
        atl.renderPaused = true;
      }
      if (r.running) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    r.done = atl.runScript(script, start).then((end) => {
      r.running = false;
      return { end: { state: end.state, position: end.position, stats: end.stats }, events: atl.events.slice(n0).map((e) => ({ ...e })) };
    });
    window.__ride = r;
  }, { script, start });
  const shots = [];
  for (const stop of ["air", "bank"]) {
    const ok = await page.waitForFunction((w) => window.__ride.stopped === w || !window.__ride.running, stop, { timeout: 900000 }).then(() => page.evaluate((w) => window.__ride.stopped === w, stop));
    if (!ok) continue;
    const path = `${DIR}/${name}-${stop}.jpg`;
    await page.screenshot({ path, quality: 85 });
    shots.push(path);
    await page.evaluate(() => {
      window.__ride.stopped = null;
      window.__atl.renderPaused = false;
    });
  }
  const got = await page.evaluate(() => window.__ride.done);
  return { ...got, shots };
}

test("#262: the park ramps score combo links, and the ledge has no bonk then tip over", async ({ page }) => {
  test.setTimeout(3600000);
  await page.setViewportSize({ width: 960, height: 540 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await open(page);

  const rides = {
    kicker: plan(startAt(-14, 0, 1, 0), 70, 6),
    quarter: plan(startAt(-11, 3, 1, 0), 150, 6),
  };
  const out = { date: new Date().toISOString(), kind: "scripted Playwright ride (not Autopilot)", commit: process.env.GIT_SHA ?? null, rides: {} };
  for (const [name, r] of Object.entries(rides)) {
    const want = simulate(r.script, r.start);
    const got = await ride(page, name, r);
    const moves = got.events.filter((e) => e.type === "move").map((e) => `${e.name}:${e.points}`);
    const banks = got.events.filter((e) => e.type === "bank").map((e) => e.points);
    const bad = got.events.filter((e) => ["fall", "bail", "respawn"].includes(e.type));
    const grounds = got.events.filter((e) => e.type === "land").map((e) => e.groundId);
    out.rides[name] = { start: r.start, ticks: r.script.reduce((a, e) => a + e.frames, 0), page: { moves, banks, grounds, falls: bad.length }, sim: { moves: want.moves.map((m) => `${m.name}:${m.points}`), banks: want.banks.map((b) => b.points), grounds: want.grounds, bonks: want.bonks }, shots: got.shots };
    expect(moves, name).toEqual(out.rides[name].sim.moves);
    expect(banks, name).toEqual(out.rides[name].sim.banks);
    expect(banks.length, name).toBe(1);
    expect(bad, name).toEqual([]);
  }
  // A ramp move is a link of each banked combo.
  expect(out.rides.kicker.page.moves[0]).toBe("Ramp Air:100");
  expect(out.rides.kicker.sim.grounds).toContain(`${ID}:kicker:face`);
  expect(out.rides.quarter.page.moves[0]).toBe("Vert Air:200");
  expect(out.rides.quarter.sim.grounds).toContain(`${ID}:quarter:face`);

  // The ledge: the 70 degree approach of #262 snaps at speed and rides off the end, with no bonk and no fall.
  const ledge = rides262().ledgeCatch;
  const lsim = simulate(ledge.script, ledge.start);
  const lgot = await ride(page, "ledge", ledge);
  const lbad = lgot.events.filter((e) => ["fall", "bail", "respawn"].includes(e.type));
  out.rides.ledge = {
    start: ledge.start,
    page: { snaps: lgot.events.filter((e) => e.type === "snap").map((e) => e.id), exits: lgot.events.filter((e) => e.type === "exit").map((e) => e.reason), moves: lgot.events.filter((e) => e.type === "move").map((e) => `${e.name}:${e.points}`), banks: lgot.events.filter((e) => e.type === "bank").map((e) => e.points), falls: lbad.length },
    sim: { bonks: lsim.bonks, falls: lsim.falls, snapSpeed: ledge.states.find((s) => s.skater.justSnapped).skater.speed },
    shots: lgot.shots,
  };
  expect(lsim.bonks).toBe(0);
  expect(lbad).toEqual([]);
  expect(out.rides.ledge.page.exits).toEqual(["end"]);
  out.consoleErrors = errors;
  writeFileSync(`${DIR}/result.json`, `${JSON.stringify(out, null, 2)}\n`);
  expect(errors).toEqual([]);
});
