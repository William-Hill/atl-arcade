import { describe, expect, it } from "vitest";
import { bboxCenter, createProjection, haversine, parseBbox } from "./projection.js";

const BBOX = { south: 33.756, west: -84.3685, north: 33.7735, east: -84.358 };
const PCM = { lat: 33.7726, lon: -84.3657 }; // Ponce City Market.
const KROG = { lat: 33.757, lon: -84.364 }; // Krog Street Market.

describe("projection", () => {
  const origin = bboxCenter(BBOX);
  const p = createProjection(origin);

  it("puts the origin at [0, 0]", () => {
    const [x, z] = p.toLocal(origin.lat, origin.lon);
    expect(x).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
  });

  it("maps north to -z and east to +x", () => {
    const [, zN] = p.toLocal(origin.lat + 0.001, origin.lon);
    const [xE] = p.toLocal(origin.lat, origin.lon + 0.001);
    expect(zN).toBeLessThan(0);
    expect(xE).toBeGreaterThan(0);
    // One thousandth of a degree of latitude is about 111 m.
    expect(-zN).toBeCloseTo(111.19, 1);
  });

  it("round-trips lat/lon through local meters", () => {
    for (const q of [PCM, KROG, { lat: BBOX.south, lon: BBOX.east }]) {
      const [x, z] = p.toLocal(q.lat, q.lon);
      const back = p.toLatLon(x, z);
      expect(back.lat).toBeCloseTo(q.lat, 10);
      expect(back.lon).toBeCloseTo(q.lon, 10);
    }
  });

  it("keeps distances within 0.1 % of the great-circle distance over the block", () => {
    const a = p.toLocal(PCM.lat, PCM.lon);
    const b = p.toLocal(KROG.lat, KROG.lon);
    const local = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const real = haversine(PCM, KROG);
    expect(real).toBeGreaterThan(1700);
    expect(Math.abs(local - real) / real).toBeLessThan(0.001);
  });

  it("parses a bbox in the Overpass order and rejects bad input", () => {
    expect(parseBbox("33.756,-84.3685,33.7735,-84.358")).toEqual(BBOX);
    expect(() => parseBbox("1,2,3")).toThrow();
    expect(() => parseBbox("33.8,-84.3,33.7,-84.2")).toThrow();
    expect(() => parseBbox("a,b,c,d")).toThrow();
  });
});
