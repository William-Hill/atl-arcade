import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ALL_DONE, GUIDE, NEARBY_DONE, NEW_SPOT, REACH, TOO_FAR, directionText, distanceText, guideLine, isToDo, reachSeconds, reachable } from "./guide.js";
import { CLAIM_PREFIX, FREE_RUN_HINT } from "./play.js";
import { withSkatepark } from "../level/skatepark.js";
import { createLandmarks, landmarkView, markSpot, prepareLandmarks, stepLandmarks } from "../sim/landmarks.js";

const DATA = {
  v: 1,
  level: "test-level",
  spots: [
    { id: "bridge", kind: "bridge", name: "Trail Bridge", at: [300, 0], find: { r: 20 }, short: "A bridge.", challenge: { type: "gap", tier: "typical", hint: "Hop the bridge", zone: { x: 300, z: 0, r: 8 } } },
    { id: "art", kind: "art", name: "Trail Art", at: [600, 0], find: { r: 14 }, short: "Art.", challenge: { type: "line", tier: "typical", hint: "Ride the 3 rings in order in 14 s", checkpoints: [[600, 0], [630, 0], [660, 0]], seconds: 14 } },
    { id: "district", kind: "edge", name: "Old District", at: [900, 0], find: { r: 20 }, short: "A district." },
  ],
};
const fresh = () => createLandmarks(prepareLandmarks(DATA), { level: DATA.level });
const at = (x, z = 0) => [x, 0, z];
// Yaw 0 faces +x (heading(0) = [1, 0, 0]); a positive yaw turns left, toward -z.
const EAST = 0;

describe("distance and direction words", () => {
  it("rounds the distance to 10 m, and shows km from 1 km", () => {
    expect(distanceText(3)).toBe("10 m");
    expect(distanceText(424)).toBe("420 m");
    expect(distanceText(996)).toBe("1.0 km");
    expect(distanceText(1249)).toBe("1.2 km");
  });

  it("names the side of a point from the skater's heading", () => {
    expect(directionText(EAST, 100, 0)).toBe("ahead");
    expect(directionText(EAST, -100, 0)).toBe("behind");
    expect(directionText(EAST, 0, -100)).toBe("to the left");
    expect(directionText(EAST, 0, 100)).toBe("to the right");
    expect(directionText(EAST, 100, -100)).toBe("ahead left");
    expect(directionText(EAST, -100, 100)).toBe("behind right");
    // Facing north (-z): the east is to the right.
    expect(directionText(Math.PI / 2, 100, 0)).toBe("to the right");
  });
});

describe("the reach estimate", () => {
  it("adds the challenge time of a Found spot to the ride", () => {
    const view = landmarkView(markSpot(markSpot(fresh(), "bridge", "found"), "art", "found"));
    const bridge = view.spots.find((s) => s.id === "bridge");
    const art = view.spots.find((s) => s.id === "art");
    expect(reachSeconds(130, bridge)).toBeCloseTo((130 * REACH.detour) / REACH.speed + REACH.claimSeconds, 6);
    expect(reachSeconds(130, art)).toBeCloseTo((130 * REACH.detour) / REACH.speed + 14, 6);
    expect(reachSeconds(130, { state: "unknown" })).toBeCloseTo((130 * REACH.detour) / REACH.speed, 6);
  });

  it("puts spots 500 m and more out of reach in the last minute, and keeps near spots in reach", () => {
    const spot = landmarkView(markSpot(fresh(), "bridge", "found")).spots[0];
    expect(reachable(500, spot, 60)).toBe(false);
    expect(reachable(100, spot, 60)).toBe(true);
    // A full round of 150 s reaches about 700 m (audit B3: 500 to 1,000 m were out of reach late in a round).
    expect(reachable(700, spot, 150)).toBe(true);
    expect(reachable(800, spot, 150)).toBe(false);
  });
});

describe("the guide line (#260)", () => {
  it("is the claim line of a Found spot nearby, as before", () => {
    const view = landmarkView(markSpot(fresh(), "bridge", "found"));
    expect(guideLine(view, at(310), EAST)).toEqual({ id: "bridge", kind: "claim", text: `${CLAIM_PREFIX}hop the bridge`, warn: false });
    expect(guideLine(view, at(310), EAST, { claims: false }).text).toBe(FREE_RUN_HINT);
  });

  it("is empty when an Unknown spot is nearby: the player finds it by riding on", () => {
    expect(guideLine(landmarkView(fresh()), at(200), EAST)).toBeNull();
    expect(guideLine(landmarkView(fresh()), at(300 - GUIDE.near), EAST)).toBeNull();
  });

  it("says when the nearby spots are done, and points to the next one", () => {
    let s = markSpot(fresh(), "bridge", "claimed");
    // The art spot is Unknown: no name.
    expect(guideLine(landmarkView(s), at(300), EAST)).toEqual({ id: "art", kind: "next", text: `${NEARBY_DONE}\nNext: ${NEW_SPOT}, 300 m ahead`, warn: false });
    // Found: its name, and the point is its first ring. Facing west, it is behind.
    s = markSpot(s, "art", "found");
    expect(guideLine(landmarkView(s), at(300), Math.PI).text).toBe(`${NEARBY_DONE}\nNext: Trail Art, 300 m behind`);
  });

  it("points past a Found spot that is far, to a nearer spot to do", () => {
    // The art spot is Found and 300 m away; the edge marker is Unknown and 290 m away on the other side.
    const s = markSpot(markSpot(fresh(), "bridge", "claimed"), "art", "found");
    const line = guideLine(landmarkView(s), at(610), EAST);
    expect(line.kind).toBe("claim");
    const far = guideLine(landmarkView(s), at(1190), EAST);
    expect(far.text).toBe(`${NEARBY_DONE}\nNext: ${NEW_SPOT}, 290 m behind`);
  });

  it("keeps the line of a ring attempt, at any distance", () => {
    let s = markSpot(fresh(), "art", "found");
    // Ring 1, then ride on toward ring 2.
    s = stepLandmarks(s, { position: at(600), airborne: false, landed: false, bailed: false, teleported: false, grind: null, linked: false, banked: 0 }, 1 / 60);
    const line = guideLine(landmarkView(s), at(610), EAST, { timeLeft: 5 });
    expect(line.kind).toBe("claim");
    expect(line.text).toMatch(/^Ring 2 of 3: \d+ s left$/);
    // A ring attempt has its own timer: no reach warning.
    expect(line.warn).toBe(false);
  });

  it("warns in a timed round when the target is too far for the time left", () => {
    const s = markSpot(fresh(), "bridge", "found");
    const near = guideLine(landmarkView(s), at(200), EAST, { timeLeft: 60 });
    expect(near.warn).toBe(false);
    const late = guideLine(landmarkView(s), at(200), EAST, { timeLeft: 10 });
    expect(late).toEqual({ id: "bridge", kind: "claim", text: `${CLAIM_PREFIX}hop the bridge\n${TOO_FAR}`, warn: true });
    // The pointer: the warning takes the place of the "Nearby spots done" line.
    const done = markSpot(fresh(), "bridge", "claimed");
    const next = guideLine(landmarkView(done), at(300), EAST, { timeLeft: 30 });
    expect(next).toEqual({ id: "art", kind: "next", text: `Next: ${NEW_SPOT}, 300 m ahead\n${TOO_FAR}`, warn: true });
    expect(guideLine(landmarkView(done), at(300), EAST, { timeLeft: 120 }).warn).toBe(false);
  });

  it("gives no warning with no timer (a tour) or with no claims (a free run)", () => {
    const s = markSpot(fresh(), "bridge", "claimed");
    expect(guideLine(landmarkView(s), at(300), EAST).warn).toBe(false);
    expect(guideLine(landmarkView(s), at(300), EAST, { claims: false, timeLeft: 1 }).warn).toBe(false);
  });

  it("says when every spot is done", () => {
    let s = fresh();
    for (const id of ["bridge", "art"]) s = markSpot(s, id, "claimed");
    s = markSpot(s, "district", "found");
    expect(guideLine(landmarkView(s), at(0), EAST)).toEqual({ id: null, kind: "done", text: ALL_DONE, warn: false });
  });

  it("in a free run, counts only the Unknown spots as to do", () => {
    const view = landmarkView(markSpot(fresh(), "bridge", "found"));
    const bridge = view.spots[0];
    expect(isToDo(bridge, { claims: true })).toBe(true);
    expect(isToDo(bridge, { claims: false })).toBe(false);
    // Far from the bridge, the free run points to the next Unknown spot.
    expect(guideLine(view, at(1200), EAST, { claims: false }).text).toBe(`${NEARBY_DONE}\nNext: ${NEW_SPOT}, 300 m behind`);
  });
});

describe("the guide on the Beltline (the audit case, B2)", () => {
  const data = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  // The level as the game loads it: the skatepark adds its pad to the areas.
  const level = withSkatepark(read("../../levels/beltline-eastside/level.json"), read("../../levels/beltline-eastside/skatepark.json"), read("../../assets/skate-features/features.json"));
  const spots = prepareLandmarks(data, level);
  const spawn = level.spawn;

  it("points from the spawn to a far spot when the 2 spots near the spawn are claimed", () => {
    let s = createLandmarks(spots, { level: data.level });
    for (const id of ["freedom-parkway-bridge", "historic-fourth-ward-skatepark"]) s = markSpot(s, id, "claimed");
    const line = guideLine(landmarkView(s), spawn.position, spawn.yaw, { timeLeft: 150 });
    expect(line.kind).toBe("next");
    expect(line.text.split("\n")[0]).toBe(NEARBY_DONE);
    expect(line.text).toMatch(/^Next: a new spot, \d+ m (ahead|behind|to the left|to the right|ahead left|ahead right|behind left|behind right)$/m);
    // The same state late in the round: the warning replaces the first line.
    const late = guideLine(landmarkView(s), spawn.position, spawn.yaw, { timeLeft: 20 });
    expect(late.warn).toBe(true);
    expect(late.text.split("\n")[1]).toBe(TOO_FAR);
  });

  it("shows nothing at the spawn of a new save: the 2 near spots are Unknown", () => {
    const s = createLandmarks(spots, { level: data.level });
    expect(guideLine(landmarkView(s), spawn.position, spawn.yaw, { timeLeft: 150 })).toBeNull();
  });
});
