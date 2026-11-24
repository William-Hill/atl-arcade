import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_ART, CARD_CAMERAS, KIND_CAMERA, cardArtUrl, cardCamera } from "./card-art.js";

const FILE = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
const LEVEL = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const DIR = new URL(`../../public/${CARD_ART.dir}/`, import.meta.url);

describe("when a card camera is made", () => {
  it("stands on the line from the spot to its find point (the trail side)", () => {
    const cam = cardCamera({ id: "x", kind: "building", at: [0, 0], find: { at: [10, 0] } }, {});
    expect(cam).toEqual({ from: [KIND_CAMERA.building.dist, KIND_CAMERA.building.up, 0], at: [0, KIND_CAMERA.building.look, 0] });
  });

  it("uses the compass angle, the distance and the heights of an override", () => {
    const cam = cardCamera({ id: "x", kind: "bridge", at: [100, 50] }, { x: { az: 270, dist: 40, up: 3, look: 6 } });
    expect(cam).toEqual({ from: [60, 3, 50], at: [100, 6, 50] });
  });

  it("uses the default angle when the find point is at the spot", () => {
    const cam = cardCamera({ id: "x", kind: "skate", at: [0, 0], find: { r: 20 } }, {});
    const d = Math.hypot(cam.from[0], cam.from[2]);
    expect(d).toBeCloseTo(KIND_CAMERA.skate.dist, 0);
    expect(cam.from[0]).toBeLessThan(0);
    expect(cam.from[2]).toBeLessThan(0);
  });

  it("names only spots of the shipped level in the overrides", () => {
    const ids = new Set(FILE.spots.map((s) => s.id));
    for (const id of Object.keys(CARD_CAMERAS)) expect(ids.has(id), id).toBe(true);
  });

  it("looks at a point inside the level, from a camera over the ground near it", () => {
    const b = LEVEL.bounds;
    const inside = ([x, , z], pad) => x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
    for (const spot of FILE.spots) {
      const { from, at } = cardCamera(spot);
      expect([...from, ...at].every(Number.isFinite), spot.id).toBe(true);
      expect(inside(at, 0), spot.id).toBe(true);
      // The terrain goes on past the edge, so a camera can stand a little past it.
      expect(inside(from, 50), spot.id).toBe(true);
      expect(from[1], spot.id).toBeGreaterThan(0);
      expect(at[1], spot.id).toBeGreaterThan(0);
    }
  });

  it("gives the URL of a render under the site base", () => {
    expect(cardArtUrl("freedom-park")).toBe("/landmark-cards/freedom-park.jpg");
    expect(cardArtUrl("freedom-park", "/atl/")).toBe("/atl/landmark-cards/freedom-park.jpg");
    expect(cardArtUrl("freedom-park", "/atl")).toBe("/atl/landmark-cards/freedom-park.jpg");
  });
});

describe("when the card art ships", () => {
  const prov = JSON.parse(readFileSync(new URL("provenance.json", DIR), "utf8"));

  it("has one render for each spot of the shipped level", () => {
    for (const spot of FILE.spots) expect(existsSync(new URL(`${spot.id}.${CARD_ART.ext}`, DIR)), spot.id).toBe(true);
  });

  it("has a provenance with the tool, the commit, the date and the camera of each render", () => {
    expect(prov.tool).toMatch(/scripts\/card-art\.mjs/);
    expect(prov.commit).toMatch(/^[0-9a-f]{40}/);
    expect(prov.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prov.query).toContain(CARD_ART.query);
  });

  it("was made from the cameras of this module: the script makes the same renders again", () => {
    for (const spot of FILE.spots) expect(prov.cameras[spot.id], spot.id).toEqual(cardCamera(spot));
  });
});
