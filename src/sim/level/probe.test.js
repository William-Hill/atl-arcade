import { describe, expect, it } from "vitest";
import { GREYBOX_BLOCK } from "../../levels/greybox-block.js";
import { createSurfaceProbe, surfaceNormal, VOID } from "./probe.js";
import { quarterPipeHeightAt } from "./quarter-pipe.js";
import { findObject } from "./level.js";

const probe = createSurfaceProbe(GREYBOX_BLOCK);

describe("surface probe", () => {
  it("finds the street at the spawn", () => {
    const hit = probe(GREYBOX_BLOCK.spawn.position.x, GREYBOX_BLOCK.spawn.position.z);
    expect(hit.height).toBeCloseTo(0, 10);
    expect(hit.kind).toBe("ground");
  });

  it("finds open air past the edge of the block", () => {
    expect(probe(500, 500)).toEqual(VOID);
  });

  it("stands on the sidewalk, not the street under it", () => {
    const hit = probe(0, 8.5);
    expect(hit.kind).toBe("sidewalk");
    expect(hit.height).toBeCloseTo(0.18, 10);
  });

  it("stands on a ledge, not the sidewalk under it", () => {
    const ledge = findObject(GREYBOX_BLOCK, "ledge-west");
    const hit = probe(ledge.shape.position.x, ledge.shape.position.z);
    expect(hit.objectId).toBe("ledge-west");
    expect(hit.height).toBeCloseTo(ledge.shape.position.y + ledge.shape.size.y / 2, 10);
  });

  it("climbs the stair treads one at a time", () => {
    const stairs = findObject(GREYBOX_BLOCK, "stairs-west").shape;
    const heights = [];
    for (let i = 0; i < stairs.steps; i += 1) {
      heights.push(probe(stairs.position.x + stairs.run * (i + 0.5), stairs.position.z).height);
    }
    expect(heights).toEqual([0.2, 0.4, 0.6000000000000001, 0.8, 1]);
  });

  it("follows the quarter-pipe transition", () => {
    const ramp = findObject(GREYBOX_BLOCK, "ramp-east").shape;
    for (const along of [0, 0.5, 1.3, 2.0, 2.6]) {
      const hit = probe(ramp.position.x + along, ramp.position.z);
      expect(hit.kind).toBe("ramp");
      expect(hit.height).toBeCloseTo(quarterPipeHeightAt(ramp.radius, along), 10);
    }
    // Just before the roll-in it is still street.
    expect(probe(ramp.position.x - 0.2, ramp.position.z).kind).toBe("ground");
  });

  it("ignores rails, which are grind targets and not floors", () => {
    const rail = findObject(GREYBOX_BLOCK, "rail-straight");
    const mid = rail.spline[0];
    expect(probe(mid.x + 1, mid.z).kind).toBe("ground");
  });
});

describe("surface normal", () => {
  it("is straight up on flat ground", () => {
    const n = surfaceNormal(probe, 0, 0);
    expect(n.y).toBeCloseTo(1, 6);
    expect(Math.hypot(n.x, n.z)).toBeCloseTo(0, 6);
  });

  it("tilts back against the transition on the ramp", () => {
    const ramp = GREYBOX_BLOCK.objects.find((o) => o.id === "ramp-east").shape;
    const n = surfaceNormal(probe, ramp.position.x + 1.5, ramp.position.z);
    expect(n.y).toBeLessThan(1);
    // The surface rises toward +X, so the normal leans toward -X.
    expect(n.x).toBeLessThan(-0.1);
  });
});
