import { describe, expect, it } from "vitest";
import {
  EFFECT_TIERS,
  FX,
  accentEmissive,
  addBurst,
  burstEnvelope,
  burstSpecs,
  clearRadius,
  createFx,
  edgeDistance,
  effectTriggers,
  effectsPolicy,
  impactFrameDone,
  impactSpikes,
  pulse,
  speedLineSegments,
  speedTarget,
  startImpact,
  stepFx,
} from "./fx.js";
import { DISTRICT_LOOKS, hexToLinear } from "../pbr-palette.js";
import { createSkateState, stepSkate } from "../../sim/skate/controller.js";

const skater = (over = {}) => ({ ...createSkateState(), ...over });

describe("effectsPolicy (tier and reduced-motion gates)", () => {
  it("turns every effect off on the low tier", () => {
    const p = effectsPolicy("low");
    expect(p).toMatchObject({ lines: 0, impact: 0, spikes: 0, burst: null, enabled: false });
  });

  it("keeps a reduced set on the phone tier: fewer lines, 2 impact frames, ring only, no core", () => {
    const p = effectsPolicy("phone");
    expect(p.enabled).toBe(true);
    expect(p.lines).toBeLessThan(effectsPolicy("high").lines);
    expect(p.impact).toBe(2);
    expect(p.burst).toEqual({ star: false, ring: true, core: false });
  });

  it("keeps the full set on the high tier: 3 impact frames, star with a hot core", () => {
    const p = effectsPolicy("high");
    expect(p.impact).toBe(3);
    expect(p.burst).toEqual({ star: true, ring: true, core: true });
  });

  it("impact frames are 2 or 3 on every tier that has them", () => {
    for (const n of Object.values(EFFECT_TIERS.impact)) if (n) expect([2, 3]).toContain(n);
  });

  it("prefers-reduced-motion turns every effect off on every tier", () => {
    for (const tier of ["low", "phone", "high"]) {
      expect(effectsPolicy(tier, { reducedMotion: true })).toMatchObject({ lines: 0, impact: 0, spikes: 0, burst: null, enabled: false });
    }
  });

  it("?fx=0 turns every effect off", () => {
    expect(effectsPolicy("high", { off: true }).enabled).toBe(false);
  });

  it("an unknown tier gets nothing", () => {
    expect(effectsPolicy("ultra").enabled).toBe(false);
  });

  it("takes extra rows, so a later effect (#221 claim) can add its own tier gate", () => {
    const table = { ...EFFECT_TIERS, claim: { low: { ring: true }, phone: { ring: true }, high: { ring: true, star: true } } };
    expect(effectsPolicy("low", {}, table).claim).toEqual({ ring: true });
    expect(effectsPolicy("low", {}, table).enabled).toBe(true);
    expect(effectsPolicy("low", { reducedMotion: true }, table).claim).toBe(null);
  });
});

describe("effectTriggers (controller flags to effects)", () => {
  it("a bonk at speed starts an impact", () => {
    expect(effectTriggers(skater({ speed: 8 }), skater({ bonked: true }))).toEqual([{ kind: "impact", reason: "bonk" }]);
  });

  it("a bonk from near rest does not (pushing into a wall)", () => {
    expect(effectTriggers(skater({ speed: 1 }), skater({ bonked: true }))).toEqual([]);
  });

  it("a hard landing starts an impact: long air time or a fast fall", () => {
    const land = skater({ justLanded: true });
    expect(effectTriggers(skater({ state: "air", airTime: 1.0, velocity: [0, -2, 0] }), land)).toEqual([{ kind: "impact", reason: "land" }]);
    expect(effectTriggers(skater({ state: "air", airTime: 0.5, velocity: [0, -8, 0] }), land)).toEqual([{ kind: "impact", reason: "land" }]);
  });

  it("a soft landing (a small hop) does not", () => {
    expect(effectTriggers(skater({ state: "air", airTime: 0.5, velocity: [0, -4, 0] }), skater({ justLanded: true }))).toEqual([]);
  });

  it("a grind start and an on-beat move start bursts; an off-beat move does not", () => {
    expect(effectTriggers(skater(), skater({ justSnapped: true }))).toEqual([{ kind: "burst", reason: "grind" }]);
    expect(effectTriggers(skater(), skater(), [{ onBeat: true }])).toEqual([{ kind: "burst", reason: "beat" }]);
    expect(effectTriggers(skater(), skater(), [{ onBeat: false }])).toEqual([]);
  });

  it("reads the real controller: a roll off a 4 m block lands hard", () => {
    // Flat ground at 0, with a 4 m block for x < 1.
    const env = { sampleGround: (x) => ({ height: x < 1 ? 4 : 0, normal: [0, 1, 0], id: x < 1 ? "block" : "flat" }) };
    let s = createSkateState({ position: [0, 4, 0], yaw: 0 });
    s = { ...s, speed: 6 };
    let found = null;
    for (let i = 0; i < 240 && !found; i += 1) {
      const next = stepSkate(s, { push: false }, 1 / 60, env);
      const t = effectTriggers(s, next);
      if (next.justLanded) found = t;
      s = next;
    }
    expect(found).toEqual([{ kind: "impact", reason: "land" }]);
  });

  it("does not change the skater it reads", () => {
    const prev = skater({ speed: 8 });
    const next = skater({ bonked: true });
    const before = JSON.stringify([prev, next]);
    effectTriggers(prev, next, [{ onBeat: true }]);
    expect(JSON.stringify([prev, next])).toBe(before);
  });
});

describe("timers", () => {
  it("the speed lines rise over the attack time and fall over the release time", () => {
    let fx = createFx();
    fx = stepFx(fx, FX.speed.attack / 2, { speed: 20 });
    expect(fx.speed).toBeCloseTo(0.5, 5);
    fx = stepFx(fx, FX.speed.attack, { speed: 20 });
    expect(fx.speed).toBe(1);
    fx = stepFx(fx, FX.speed.release / 2, { speed: 0 });
    expect(fx.speed).toBeCloseTo(0.5, 5);
  });

  it("the speed target is 0 at a normal push speed and 1 at top speed", () => {
    expect(speedTarget(8)).toBe(0);
    expect(speedTarget(FX.speed.full)).toBe(1);
    expect(speedTarget(-FX.speed.full)).toBe(1);
  });

  it("an inactive game (photo mode) fades the lines out", () => {
    let fx = { ...createFx(), speed: 1 };
    fx = stepFx(fx, 1, { speed: 20, active: false });
    expect(fx.speed).toBe(0);
  });

  it("an impact lasts the policy's frame count, counted in rendered frames", () => {
    const policy = effectsPolicy("high");
    let fx = startImpact(createFx(), "bonk", policy);
    const seen = [];
    while (fx.impact.frames > 0) {
      seen.push(fx.impact.frames);
      fx = impactFrameDone(fx);
    }
    expect(seen).toEqual([3, 2, 1]);
    expect(impactFrameDone(fx)).toBe(fx);
  });

  it("a second impact inside the cooldown is dropped; after it a new one starts", () => {
    const policy = effectsPolicy("high");
    let fx = startImpact(createFx(), "bonk", policy);
    const seq = fx.impact.seq;
    expect(startImpact(fx, "land", policy).impact.seq).toBe(seq);
    fx = stepFx(fx, FX.impact.cooldown + 0.01);
    expect(startImpact(fx, "land", policy).impact.seq).toBe(seq + 1);
  });

  it("no impact without the policy", () => {
    const fx = createFx();
    expect(startImpact(fx, "bonk", effectsPolicy("low"))).toBe(fx);
  });

  it("a burst lives for its life and is removed after", () => {
    let fx = addBurst(createFx(), { position: [1, 2, 3], color: [1, 1, 1] });
    fx = stepFx(fx, FX.burst.life * 0.9);
    expect(fx.bursts).toHaveLength(1);
    fx = stepFx(fx, FX.burst.life * 0.2);
    expect(fx.bursts).toHaveLength(0);
  });

  it("a burst with a velocity and gravity moves (petals, #221)", () => {
    let fx = addBurst(createFx(), { position: [0, 3, 0], velocity: [1, 0, 0], gravity: 2, life: 2, shape: "petal" });
    fx = stepFx(fx, 0.5);
    const [b] = fx.bursts;
    expect(b.position[0]).toBeCloseTo(0.5, 5);
    expect(b.position[1]).toBeLessThan(3);
  });

  it("a flat particle keeps its flag (a ground decal); the default faces the camera", () => {
    expect(addBurst(createFx(), { position: [0, 0, 0], shape: "ring", flat: true }).bursts[0].flat).toBe(true);
    expect(addBurst(createFx(), { position: [0, 0, 0] }).bursts[0].flat).toBe(false);
  });

  it("the pool keeps the newest bursts", () => {
    let fx = createFx();
    for (let i = 0; i < FX.burst.max + 5; i += 1) fx = addBurst(fx, { position: [i, 0, 0] });
    expect(fx.bursts).toHaveLength(FX.burst.max);
    expect(fx.bursts[0].position[0]).toBe(5);
  });

  it("the burst envelope grows, holds, and fades to 0", () => {
    expect(burstEnvelope(0).alpha).toBe(1);
    expect(burstEnvelope(0).scale).toBeCloseTo(0.35, 5);
    expect(burstEnvelope(1)).toEqual({ scale: 1, alpha: 0 });
    expect(burstEnvelope(0.5).scale).toBeGreaterThan(burstEnvelope(0.2).scale);
  });

  it("pulse goes 0 to 1 to 0", () => {
    expect(pulse(0, 1)).toBe(0);
    expect(pulse(0.5, 1)).toBeCloseTo(1, 5);
    expect(pulse(1, 1)).toBe(0);
  });
});

describe("burstSpecs", () => {
  it("high: a ring and a star with a hot core", () => {
    const specs = burstSpecs("grind", [0, 0, 0], [1, 1, 1], effectsPolicy("high"));
    expect(specs.map((s) => s.shape)).toEqual(["ring", "star"]);
    expect(specs.find((s) => s.shape === "star").core).toBe(true);
    expect(specs.find((s) => s.shape === "ring").core).toBe(false);
  });

  it("phone: a ring only, no core", () => {
    const specs = burstSpecs("beat", [0, 0, 0], [1, 1, 1], effectsPolicy("phone"));
    expect(specs.map((s) => s.shape)).toEqual(["ring"]);
    expect(specs.every((s) => !s.core)).toBe(true);
  });

  it("an on-beat burst is bigger than a grind burst", () => {
    const p = effectsPolicy("high");
    expect(burstSpecs("beat", [0, 0, 0], null, p)[1].size).toBeGreaterThan(burstSpecs("grind", [0, 0, 0], null, p)[1].size);
  });

  it("low and reduced motion: none", () => {
    expect(burstSpecs("grind", [0, 0, 0], null, effectsPolicy("low"))).toEqual([]);
    expect(burstSpecs("grind", [0, 0, 0], null, effectsPolicy("high", { reducedMotion: true }))).toEqual([]);
  });
});

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

describe("speed lines layout", () => {
  const aspect = 16 / 9;

  it("no streak comes over the skater, at any time and anchor", () => {
    for (const anchor of [{ x: 0, y: 0, r: 0.2 }, { x: 0, y: -0.2, r: 0.35 }, { x: 0.5, y: 0.3, r: 0.1 }]) {
      const clear = clearRadius(anchor, FX.lines.clear);
      for (let t = 0; t < 3; t += 0.05) {
        for (const s of speedLineSegments(18, t, anchor, aspect, 1)) {
          // In the aspect space the streak is on a ray from the anchor, so
          // its inner end is its nearest point.
          const a = dist(s.ax * aspect, s.ay, anchor.x * aspect, anchor.y);
          const b = dist(s.bx * aspect, s.by, anchor.x * aspect, anchor.y);
          expect(Math.min(a, b)).toBeGreaterThanOrEqual(clear - 1e-9);
        }
      }
    }
  });

  it("the streaks sit at the frame edge: each outer end is past 70% of the way to the edge", () => {
    const anchor = { x: 0, y: -0.1, r: 0.2 };
    for (let t = 0; t < 2; t += 0.1) {
      for (const s of speedLineSegments(18, t, anchor, aspect, 1)) {
        const dx = s.bx * aspect - anchor.x * aspect;
        const dy = s.by - anchor.y;
        const d = Math.hypot(dx, dy);
        const edge = edgeDistance(anchor.x * aspect, anchor.y, dx / d, dy / d, aspect);
        expect(d / edge).toBeGreaterThan(0.7);
        expect(Math.abs(s.bx)).toBeLessThanOrEqual(1.03);
        expect(Math.abs(s.by)).toBeLessThanOrEqual(1.03);
      }
    }
  });

  it("is stable for a time (a screenshot repeats) and moves over time", () => {
    const anchor = { x: 0, y: 0, r: 0.2 };
    expect(speedLineSegments(18, 1.234, anchor, aspect, 1)).toEqual(speedLineSegments(18, 1.234, anchor, aspect, 1));
    expect(speedLineSegments(18, 1.234, anchor, aspect, 1)).not.toEqual(speedLineSegments(18, 1.4, anchor, aspect, 1));
  });

  it("none with no strength or no count", () => {
    expect(speedLineSegments(18, 1, { x: 0, y: 0 }, aspect, 0)).toEqual([]);
    expect(speedLineSegments(0, 1, { x: 0, y: 0 }, aspect, 1)).toEqual([]);
  });

  it("a weaker strength gives fainter streaks", () => {
    const a = speedLineSegments(18, 1, { x: 0, y: 0 }, aspect, 1);
    const b = speedLineSegments(18, 1, { x: 0, y: 0 }, aspect, 0.3);
    const sum = (l) => l.reduce((s, x) => s + x.alpha, 0);
    expect(sum(b)).toBeLessThan(sum(a));
  });
});

describe("impact spikes layout", () => {
  const aspect = 16 / 9;

  it("starts outside the skater and stays in the frame", () => {
    const anchor = { x: 0, y: -0.1, r: 0.25 };
    for (let f = 0; f < 3; f += 1) {
      const spikes = impactSpikes(16, 4, f, anchor, aspect);
      expect(spikes.length).toBeGreaterThan(10);
      for (const s of spikes) {
        expect(dist(s.ax * aspect, s.ay, anchor.x * aspect, anchor.y)).toBeGreaterThanOrEqual(clearRadius(anchor, FX.spikes.inner) - 1e-9);
        expect(Math.abs(s.bx)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(s.by)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("is a burst, not a full-screen flash: the spikes cover a small part of the frame", () => {
    const spikes = impactSpikes(16, 1, 0, { x: 0, y: 0, r: 0.2 }, aspect);
    // Each spike is a thin triangle; take a generous 24 px base on a 720 px
    // frame (0.067 NDC units) and sum the triangle areas.
    const base = 0.067;
    const area = spikes.reduce((s, x) => s + 0.5 * base * dist(x.ax * aspect, x.ay, x.bx * aspect, x.by), 0);
    expect(area / (4 * aspect)).toBeLessThan(0.06);
  });

  it("each frame of the impact turns the burst", () => {
    const anchor = { x: 0, y: 0, r: 0.2 };
    expect(impactSpikes(16, 2, 0, anchor, aspect)).not.toEqual(impactSpikes(16, 2, 1, anchor, aspect));
  });
});

describe("accent color", () => {
  it("picks the brightest accent of a district and scales it to the body emissive", () => {
    for (const d of Object.values(DISTRICT_LOOKS)) {
      const c = accentEmissive(d.accent.map(hexToLinear));
      expect(Math.max(...c)).toBeCloseTo(FX.emissive.body, 6);
    }
    // The trail: mustard, not the dark oxblood or navy.
    const trail = accentEmissive(DISTRICT_LOOKS.trail.accent.map(hexToLinear));
    expect(trail[0]).toBeGreaterThan(trail[2]);
    expect(trail[1]).toBeGreaterThan(trail[2]);
  });

  it("the body of every effect stays under the night bloom threshold and the star core passes the day one", () => {
    expect(FX.emissive.body).toBeLessThan(0.92);
    expect(FX.emissive.line).toBeLessThan(0.92);
    expect(FX.emissive.core).toBeGreaterThan(2.4);
  });
});
