import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cornerSpots, shortName, streetIntersections } from "./signs.js";
import { levelProps } from "./props.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));

describe("street signs", () => {
  it("writes the names as a US street sign does", () => {
    expect(shortName("Ponce de Leon Avenue Northeast")).toBe("Ponce de Leon Ave NE");
    expect(shortName("Ralph McGill Boulevard Northeast")).toBe("Ralph McGill Blvd NE");
    expect(shortName("John Lewis Freedom Parkway Northeast")).toBe("John Lewis Freedom Pkwy NE");
    expect(shortName("Inman Lane")).toBe("Inman Ln");
  });

  it("finds an intersection where two named streets share a node, and skips service roads", () => {
    const level = {
      strips: [
        { id: "a", kind: "street", highway: "secondary", name: "North Avenue Northeast", width: 12, points: [[0, 0], [10, 0], [20, 0]] },
        { id: "b", kind: "street", highway: "residential", name: "Bonaventure Avenue Northeast", width: 8, points: [[10, -10], [10, 0], [10, 10]] },
        { id: "c", kind: "street", highway: "service", name: "Back Alley", width: 4, points: [[20, 0], [20, 10]] },
      ],
    };
    const ix = streetIntersections(level);
    expect(ix).toHaveLength(1);
    expect(ix[0]).toMatchObject({ x: 10, z: 0, names: ["North Avenue Northeast", "Bonaventure Avenue Northeast"], halfWidth: 6 });
    // Each corner spot is past the street edge.
    for (const [x, z] of cornerSpots(ix[0])) expect(Math.min(Math.abs(x - 10), Math.abs(z))).toBeGreaterThan(6);
  });

  it("puts one sign at each real intersection of the BeltLine level with confirmed names", () => {
    const ix = streetIntersections(LEVEL);
    const signs = levelProps(LEVEL).filter((p) => p.kind === "street_sign");
    expect(ix.length).toBeGreaterThan(80);
    // An intersection with an OSM fallback name gets no sign (issue #78).
    expect(signs.length).toBe(ix.filter((i) => i.confirmed).length);
    expect(ix.some((i) => !i.confirmed)).toBe(true);
    const all = signs.flatMap((s) => s.names);
    expect(all).toContain("Ponce de Leon Ave NE");
    expect(all).toContain("Ralph McGill Blvd NE");
    expect(all).toContain("North Ave NE");
    for (const s of signs) expect(s.yaws).toHaveLength(2);
  });
});
