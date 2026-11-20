import { describe, expect, it } from "vitest";
import { READOUT, createFrameReadout, readoutDue, readoutPush, readoutStats, readoutText } from "./frame-readout.js";

function feed(r, ms, n) {
  for (let i = 0; i < n; i += 1) readoutPush(r, ms);
  return r;
}

describe("frame readout", () => {
  it("has no numbers before the first frame", () => {
    const s = readoutStats(createFrameReadout());
    expect(s.medianMs).toBe(null);
    expect(readoutText(s, { look: "pbr", lite: true, quality: "phone", pixelRatio: 1.5, rung: 0 })).toEqual(["frame: wait", "pbr lite · phone · x1.5 · rung 0"]);
  });
  it("gives the median, the p95 and the FPS", () => {
    const r = createFrameReadout();
    feed(r, 16, 90);
    feed(r, 40, 10);
    const s = readoutStats(r);
    expect(s.medianMs).toBe(16);
    expect(s.p95Ms).toBe(40);
    expect(Math.round(s.fps)).toBe(63);
    expect(s.full).toBe(false);
    expect(readoutText(s, { look: "toon", quality: "phone", pixelRatio: 1.5 })).toEqual(["median 16.0 ms · 63 fps", "p95 40.0 ms · 1 s of 120", "toon · phone · x1.5"]);
    // Each line fits a 360 px wide phone (about 34 characters at 14 px).
    for (const line of readoutText(s, { look: "pbr", lite: true, quality: "phone", pixelRatio: 1.25, rung: 1 })) expect(line.length).toBeLessThanOrEqual(34);
  });
  it("keeps only the last 2 minutes", () => {
    const r = createFrameReadout();
    feed(r, 50, 2400); // 120 s of slow frames
    expect(readoutStats(r).full).toBe(true);
    expect(readoutStats(r).medianMs).toBe(50);
    feed(r, 20, 6000); // then 120 s of fast frames
    const s = readoutStats(r);
    expect(s.medianMs).toBe(20);
    expect(s.seconds).toBeLessThanOrEqual(READOUT.windowMs / 1000);
    expect(readoutText(s)[1]).toContain("2 min");
  });
  it("leaves out a pause and counts it", () => {
    const r = createFrameReadout();
    feed(r, 16, 10);
    readoutPush(r, 30000);
    readoutPush(r, 0);
    const s = readoutStats(r);
    expect(s.frames).toBe(10);
    expect(s.dropped).toBe(1);
  });
  it("is due twice per second", () => {
    const r = createFrameReadout();
    expect(readoutDue(r)).toBe(true);
    feed(r, 16, 10);
    expect(readoutDue(r)).toBe(false);
    feed(r, 16, 30);
    expect(readoutDue(r)).toBe(true);
  });
});
