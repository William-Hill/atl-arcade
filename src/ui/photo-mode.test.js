import { describe, expect, it } from "vitest";
import { BAND_LIMITS, FREE_CAM, closePhoto, createPhotoState, lookAngles, lookDirection, nudgeBand, nudgeStrength, openPhoto, photoFileName, setBand, setStrength, stepFreeCam } from "./photo-mode.js";

const open = () => openPhoto(createPhotoState(), [0, 10, 0], [0, 0, -1]);

describe("photo mode state", () => {
  it("opens and closes", () => {
    const s = createPhotoState();
    expect(s.open).toBe(false);
    const o = openPhoto(s, [1, 2, 3], [0, 0, -1]);
    expect(o.open).toBe(true);
    expect(o.camera.position).toEqual([1, 2, 3]);
    expect(o.anchor).toEqual([1, 2, 3]);
    expect(openPhoto(o, [9, 9, 9], [1, 0, 0])).toBe(o);
    const c = closePhoto(o);
    expect(c.open).toBe(false);
    expect(c.camera).toBe(null);
    expect(closePhoto(c)).toBe(c);
  });

  it("keeps the band and the strength across open and close", () => {
    const s = setStrength(setBand(createPhotoState(), 0.3), 0.9);
    const back = closePhoto(openPhoto(s, [0, 0, 0], [0, 0, -1]));
    expect(back.center).toBe(0.3);
    expect(back.strength).toBe(0.9);
  });

  it("moves the band and the strength in steps, inside the limits", () => {
    let s = setBand(createPhotoState(), 0.5);
    s = nudgeBand(s, 2);
    expect(s.center).toBeCloseTo(0.54, 10);
    s = nudgeBand(s, 100);
    expect(s.center).toBe(BAND_LIMITS.max);
    s = setStrength(s, 0.5);
    s = nudgeStrength(s, -1);
    expect(s.strength).toBeCloseTo(0.45, 10);
    s = nudgeStrength(s, -100);
    expect(s.strength).toBe(0);
  });

  it("turns a direction into angles and back", () => {
    for (const dir of [[0, 0, -1], [1, 0, 0], [0.3, -0.5, 0.8]]) {
      const { yaw, pitch } = lookAngles(dir);
      const len = Math.hypot(...dir);
      const back = lookDirection(yaw, pitch);
      for (let i = 0; i < 3; i += 1) expect(back[i]).toBeCloseTo(dir[i] / len, 10);
    }
  });
});

describe("free camera", () => {
  it("does nothing while photo mode is closed", () => {
    const s = createPhotoState();
    expect(stepFreeCam(s, { forward: 1 }, 1)).toBe(s);
  });

  it("flies forward along the look direction", () => {
    const s = stepFreeCam(open(), { forward: 1 }, 0.5);
    expect(s.camera.position[2]).toBeCloseTo(-FREE_CAM.speed * 0.5, 10);
    expect(s.camera.position[0]).toBeCloseTo(0, 10);
    expect(s.camera.position[1]).toBeCloseTo(10, 10);
  });

  it("strafes right, rises, and goes faster with fast", () => {
    const s = stepFreeCam(open(), { right: 1, up: 1, fast: true }, 0.1);
    const v = FREE_CAM.speed * FREE_CAM.fast * 0.1;
    expect(s.camera.position[0]).toBeCloseTo(v, 10);
    expect(s.camera.position[1]).toBeCloseTo(10 + v, 10);
  });

  it("turns with the look input and clamps the pitch", () => {
    const s = stepFreeCam(open(), { look: { yaw: 0.5, pitch: 5 } }, 0.016);
    expect(s.camera.yaw).toBeCloseTo(0.5, 10);
    expect(s.camera.pitch).toBe(FREE_CAM.pitchLimit);
  });

  it("stays near the anchor", () => {
    let s = open();
    for (let i = 0; i < 200; i += 1) s = stepFreeCam(s, { forward: 1, fast: true }, 0.1);
    const [x, y, z] = s.camera.position;
    expect(Math.hypot(x, y - 10, z)).toBeCloseTo(FREE_CAM.maxDistance, 6);
  });

  it("stays over the floor", () => {
    let s = open();
    for (let i = 0; i < 50; i += 1) s = stepFreeCam(s, { up: -1 }, 0.1, () => 2);
    expect(s.camera.position[1]).toBeCloseTo(2 + FREE_CAM.minHeight, 10);
  });
});

describe("photo file name", () => {
  it("holds the game name and the date only", () => {
    const name = photoFileName(new Date(2026, 10, 3, 9, 5, 7));
    expect(name).toBe("skate-atl-20261103-090507.png");
    expect(name).toMatch(/^skate-atl-\d{8}-\d{6}\.png$/);
  });
});
