import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKING_COLORS, MARKING_SIZES, arrowShapes, edgeLineOffset, laneLayout, medianSide, laneLineOffsets, mergeMarkings, roadMarkings } from "./markings.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));

const count = (m, color) => {
  let n = 0;
  for (let i = 0; i < m.colors.length; i += 3) if (m.colors[i] === Math.fround(color[0]) && m.colors[i + 2] === Math.fround(color[2])) n += 1;
  return n / 4;
};

describe("road markings", () => {
  it("draws a double yellow line on a main street and stops it at the cross street", () => {
    const level = {
      surfaces: { street: 0.03 },
      strips: [
        { id: "a", kind: "street", highway: "secondary", name: "North Avenue Northeast", width: 12, points: [[-50, 0], [0, 0], [50, 0]] },
        { id: "b", kind: "street", highway: "residential", name: "Bonaventure Avenue Northeast", width: 8, points: [[0, -50], [0, 0], [0, 50]] },
        { id: "c", kind: "street", highway: "service", width: 4, points: [[25, 0], [25, 20]] },
      ],
    };
    const m = mergeMarkings(roadMarkings(level));
    // Two lines, each cut once at the cross street (the driveway does not cut it).
    expect(count(m, MARKING_COLORS.yellow)).toBe(4);
    for (let i = 0; i < m.positions.length; i += 3) {
      // The paint is 2 cm over the street, the curb band 1.2 cm, the iron
      // decals (manholes, drains) 1.6 cm, and the asphalt patches 0.7 cm.
      const is = (k) => m.colors[i] === Math.fround(MARKING_COLORS[k][0]) && m.colors[i + 1] === Math.fround(MARKING_COLORS[k][1]);
      const y = is("curb") ? 0.042 : is("iron") ? 0.046 : is("patchDark") || is("patchLight") ? 0.037 : 0.05;
      expect(m.positions[i + 1]).toBeCloseTo(y, 5);
      // No line within the cross street.
      if (m.colors[i] === Math.fround(MARKING_COLORS.yellow[0])) expect(Math.abs(m.positions[i]) >= 4 + 2 - 1e-4 || Math.abs(m.positions[i + 2]) > 1).toBe(true);
    }
    // Crosswalks on the four arms.
    expect(count(m, MARKING_COLORS.white)).toBeGreaterThan(20);
  });

  it("marks the BeltLine level streets", () => {
    const tiles = roadMarkings(LEVEL);
    expect(tiles.length).toBeGreaterThan(10);
    const m = mergeMarkings(tiles);
    expect(count(m, MARKING_COLORS.yellow)).toBeGreaterThan(50);
    expect(count(m, MARKING_COLORS.white)).toBeGreaterThan(500);
    expect(m.indices.length % 3).toBe(0);
  });
});

describe("road markings on the real level with city sign names (#78)", () => {
  it("gives finite positions and a finite tile for each marking", () => {
    const tiles = roadMarkings(LEVEL);
    let tris = 0;
    for (const t of tiles) {
      expect(t.tile).toMatch(/^-?\d+,-?\d+$/);
      for (const v of t.mesh.positions) expect(Number.isFinite(v)).toBe(true);
      tris += t.mesh.indices.length / 3;
    }
    // Before the fix, crosswalks at a renamed street went to infinity and
    // most markings were lost (3192 triangles instead of about 8500).
    expect(tris).toBeGreaterThan(8000);
  });

  it("finds the street width by the sign name, not only the OSM name", () => {
    const strip = (id, name, signName, points, width) => ({ id, kind: "street", highway: "residential", name, signName, nameSource: "city", points, width });
    const level = {
      ...LEVEL,
      strips: [
        strip("a", "Osm Ave", "City Ave NE", [[-40, 0], [0, 0], [40, 0]], 10),
        strip("b", "Osm St", "City St NE", [[0, -40], [0, 0], [0, 40]], 12),
      ],
    };
    for (const t of roadMarkings(level)) for (const v of t.mesh.positions) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("crosswalk width at the intersection node", () => {
  it("uses the width of the strip through the node, not a wider part far away", () => {
    const strip = (id, name, points, width) => ({ id, kind: "street", highway: "residential", name, signName: name, nameSource: "city", points, width });
    const base = [strip("a", "Main St NE", [[-40, 0], [0, 0], [40, 0]], 10), strip("b", "Cross St NE", [[0, -40], [0, 0], [0, 40]], 10)];
    const far = strip("c", "Main St NE", [[400, 0], [500, 0]], 20);
    const zs = (level) => roadMarkings(level).flatMap((t) => Array.from(t.mesh.positions).filter((_, i) => i % 3 === 2));
    const near = zs({ ...LEVEL, strips: base });
    const withFar = zs({ ...LEVEL, strips: [...base, far] }).filter((z) => Math.abs(z) < 60);
    expect(Math.max(...withFar.map(Math.abs))).toBeCloseTo(Math.max(...near.map(Math.abs)), 5);
  });
});

// The quads of a merged mesh: { color, xs, zs, y } for each 4 vertices.
const quads = (m) => {
  const out = [];
  for (let q = 0; q < m.positions.length / 12; q += 1) {
    const xs = [];
    const zs = [];
    for (let k = 0; k < 4; k += 1) {
      xs.push(m.positions[q * 12 + k * 3]);
      zs.push(m.positions[q * 12 + k * 3 + 2]);
    }
    const c = m.colors.slice(q * 12, q * 12 + 3);
    const color = Object.keys(MARKING_COLORS).find((k) => MARKING_COLORS[k].every((v, i) => Math.fround(v) === c[i]));
    out.push({ color, xs, zs, y: m.positions[q * 12 + 1] });
  }
  return out;
};
const street = (id, highway, width, points, extra = {}) => ({ id, kind: "street", highway, width, points, ...extra });
const marks = (strips) => quads(mergeMarkings(roadMarkings({ surfaces: { street: 0.03 }, strips })));

describe("lane lines", () => {
  it("follow the street width (3.4 m lanes, two directions)", () => {
    expect(laneLineOffsets({ width: 8 })).toEqual([]);
    expect(laneLineOffsets({ width: 12 })).toEqual([]);
    expect(laneLineOffsets({ width: 14 }).sort((a, b) => a - b)).toEqual([-3.5, 3.5]);
    expect(laneLineOffsets({ width: 19.8 }).map(Math.abs)).toEqual([4.95, 4.95]);
    // 24 m: 7 lanes, 3 in each direction, 2 lines in each half.
    expect(laneLineOffsets({ width: 24 }).map(Math.abs).sort((a, b) => a - b)).toEqual([4, 4, 8, 8]);
    // One way: 3 lanes, 2 lines.
    expect(laneLineOffsets({ width: 10.2, oneway: true }).map((v) => +v.toFixed(3))).toEqual([-1.7, 1.7]);
  });

  it("are dashed 3 m on, 9 m off on a 4-lane main street", () => {
    const q = marks([street("a", "secondary", 14, [[0, 0], [120, 0]])]);
    const dashes = q.filter((x) => x.color === "white" && Math.abs(Math.abs(x.zs[0]) - 3.5) < 0.1);
    expect(dashes.length).toBe(20);
    for (const d of dashes) expect(Math.max(...d.xs) - Math.min(...d.xs)).toBeCloseTo(MARKING_SIZES.dash, 4);
  });

  it("give a one-way street no yellow line", () => {
    const q = marks([street("a", "secondary", 14, [[0, 0], [120, 0]], { oneway: true })]);
    expect(q.filter((x) => x.color === "yellow").length).toBe(0);
    // 4 lanes, 3 dashed lines.
    const offsets = new Set(q.filter((x) => x.color === "white" && Math.max(...x.xs) - Math.min(...x.xs) < 3.1).map((x) => Math.round(x.zs[0])));
    expect(offsets.size).toBe(3);
  });
});

describe("divided roads", () => {
  it("treat the two halves as one way, with a yellow edge line on the median side", () => {
    const name = "John Lewis Freedom Parkway Northeast";
    // Two 14 m carriageways with a 4 m median. The north half (z < 0) runs west (traffic on the right).
    const east = street("e", "trunk", 14, [[0, 9], [150, 9]], { name });
    const west = street("w", "trunk", 14, [[150, -9], [0, -9]], { name });
    // The normal of the east half (-dz, dx) is (0, 1): +z, away from the median.
    expect(medianSide(east, [east, west])).toBe(-1);
    expect(medianSide(west, [east, west])).toBe(-1);
    expect(medianSide(east, [east])).toBe(0);
    // A continuation of the same street (end to end) is not a twin.
    expect(medianSide(east, [east, street("n", "trunk", 14, [[150, 9], [300, 9]], { name })])).toBe(0);
    const q = marks([east, west]);
    const yellow = q.filter((x) => x.color === "yellow");
    // One yellow edge line on each half, on the median side, and no center line.
    expect(yellow.length).toBe(2);
    for (const y of yellow) for (const z of y.zs) expect(Math.abs(z)).toBeLessThan(9 - 3);
  });
});

describe("edge lines and curb bands", () => {
  it("put two edge lines and two curb bands inside a residential street", () => {
    const q = marks([street("a", "residential", 8, [[0, 0], [60, 0]])]);
    const edge = q.filter((x) => x.color === "white");
    const curb = q.filter((x) => x.color === "curb");
    expect(edge.length).toBe(2);
    expect(curb.length).toBe(2);
    for (const e of edge) {
      for (const z of e.zs) expect(Math.abs(z)).toBeLessThanOrEqual(4 - MARKING_SIZES.curb - MARKING_SIZES.edgeInset + 1e-4);
      expect(Math.abs(e.zs[0] - e.zs[3])).toBeCloseTo(MARKING_SIZES.edgeLine, 4);
    }
    for (const c of curb) {
      for (const z of c.zs) expect(Math.abs(z)).toBeGreaterThanOrEqual(4 - MARKING_SIZES.curb - 1e-4);
      for (const z of c.zs) expect(Math.abs(z)).toBeLessThanOrEqual(4 + 1e-4);
      expect(c.y).toBeCloseTo(0.042, 5);
    }
    expect(edgeLineOffset(8)).toBeCloseTo(3.34, 5);
  });

  it("put nothing on a service road and only the curb band on a living street", () => {
    expect(marks([street("a", "service", 5, [[0, 0], [60, 0]])]).length).toBe(0);
    const q = marks([street("a", "living_street", 6, [[0, 0], [60, 0]])]);
    expect(q.map((x) => x.color)).toEqual(["curb", "curb"]);
  });

  it("follow a bend with no gap (the quads share a miter edge)", () => {
    const q = marks([street("a", "residential", 8, [[0, 0], [40, 0], [70, 30]])]);
    for (const color of ["white", "curb"]) {
      const list = q.filter((x) => x.color === color);
      expect(list.length).toBe(4);
      // Each line has 2 quads; the end edge of the first is the start edge of the second.
      for (const [a, b] of [[list[0], list[1]], [list[2], list[3]]]) {
        expect(b.xs[0]).toBeCloseTo(a.xs[1], 4);
        expect(b.zs[0]).toBeCloseTo(a.zs[1], 4);
        expect(b.xs[3]).toBeCloseTo(a.xs[2], 4);
        expect(b.zs[3]).toBeCloseTo(a.zs[2], 4);
      }
    }
  });

  it("join the next strip of the same street with no gap", () => {
    const q = marks([street("a", "residential", 8, [[0, 0], [40, 0]], { name: "Elm St" }), street("b", "residential", 8, [[40, 0], [70, 30]], { name: "Elm St" })]);
    const curb = q.filter((x) => x.color === "curb");
    expect(curb.length).toBe(4);
    const ends = curb.flatMap((c) => [[c.xs[1], c.zs[1]], [c.xs[2], c.zs[2]]]);
    // Each start corner of the second strip is an end corner of the first.
    const second = curb.filter((c) => Math.min(...c.xs) > 30);
    expect(second.length).toBe(2);
    for (const c of second) for (const k of [0, 3]) expect(ends.some(([x, z]) => Math.hypot(x - c.xs[k], z - c.zs[k]) < 1e-4)).toBe(true);
  });

  it("stop short of an intersection and of the crosswalks, and add stop bars", () => {
    const q = marks([
      street("a", "secondary", 12, [[-60, 0], [0, 0], [60, 0]], { name: "North Avenue Northeast" }),
      street("b", "residential", 8, [[0, -60], [0, 0], [0, 60]], { name: "Bonaventure Avenue Northeast" }),
      street("c", "service", 4, [[30, 6], [30, 20]]),
    ]);
    // No edge line or curb band of a street inside the other street, or on a crosswalk.
    for (const x of q.filter((v) => v.color !== "yellow")) {
      const alongA = x.zs.every((z) => Math.abs(z) <= 6 + 1e-4) && x.xs.every((v) => Math.abs(v) > 4);
      const alongB = x.xs.every((v) => Math.abs(v) <= 4 + 1e-4) && x.zs.every((z) => Math.abs(z) > 6);
      expect(alongA || alongB).toBe(true);
    }
    const curbA = q.filter((x) => x.color === "curb" && x.xs.every((v) => Math.abs(v) > 4));
    // A crosswalk on North Ave is 4 + 1.8 m from the node, 2.4 m deep.
    for (const c of curbA) for (const v of c.xs) expect(Math.abs(v)).toBeGreaterThanOrEqual(4 + 1.8 + 1.2 - 1e-4);
    // The driveway (service) does not cut the curb band.
    expect(curbA.length).toBe(4);
    // One stop bar on each of the four arms, 0.45 m deep, on the inbound half.
    const stops = q.filter((x) => x.color === "white" && Math.abs(Math.max(...x.xs) - Math.min(...x.xs) - 0.45) < 1e-3 && Math.max(...x.zs) - Math.min(...x.zs) > 3);
    const stopsB = q.filter((x) => x.color === "white" && Math.abs(Math.max(...x.zs) - Math.min(...x.zs) - 0.45) < 1e-3 && Math.max(...x.xs) - Math.min(...x.xs) > 3);
    expect(stops.length).toBe(2);
    expect(stopsB.length).toBe(2);
    // East arm of North Ave: the traffic goes west (-x); its right is north (-z).
    const east = stops.find((x) => x.xs[0] > 0);
    expect(Math.max(...east.zs)).toBeLessThan(0);
    expect(Math.min(...east.zs)).toBeCloseTo(-6 + MARKING_SIZES.curb, 4);
    // The yellow line and the edge lines end at the stop bar.
    const stopFar = Math.max(...east.xs);
    for (const x of q.filter((v) => v.color === "yellow" || (v.color === "white" && Math.max(...v.xs) - Math.min(...v.xs) > 10))) {
      if (x.xs.every((v) => Math.abs(v) > 4)) for (const v of x.xs) expect(Math.abs(v)).toBeGreaterThanOrEqual(stopFar - 1e-3);
    }
  });
});

describe("marking cost on the BeltLine level", () => {
  it("keeps the triangle count in a budget and the meshes whole", () => {
    let tris = 0;
    for (const t of roadMarkings(LEVEL)) {
      expect(t.mesh.colors.length).toBe(t.mesh.positions.length);
      expect(t.mesh.indices.length).toBe((t.mesh.positions.length / 3) * 1.5);
      tris += t.mesh.indices.length / 3;
    }
    // 8,416 triangles before the edge lines, lane lines, stop bars, and curb bands.
    expect(tris).toBeGreaterThan(12000);
    expect(tris).toBeLessThan(25000);
  });
});

describe("lanes from the OSM tags (#138)", () => {
  it("gives the Freedom Parkway carriageway 2 lanes, not 4", () => {
    const L = laneLayout({ width: 14, lanes: 2, oneway: true }, true);
    expect(L.forward).toBe(2);
    expect(L.backward).toBe(0);
    expect(L.lane).toBeCloseTo(MARKING_SIZES.laneMax, 6);
    expect(L.lines).toHaveLength(1);
    expect(L.center).toBeNull();
    // The edge lines bound the 2 lanes, with a shoulder outside each.
    expect(L.edges[1] - L.edges[0]).toBeCloseTo(2 * MARKING_SIZES.laneMax - MARKING_SIZES.edgeLine, 6);
  });

  it("splits a two-way street by lanes:forward and lanes:backward", () => {
    const L = laneLayout({ width: 16.5, lanes: 5, lanesForward: 3, lanesBackward: 2 }, false);
    expect(L.forward).toBe(3);
    expect(L.backward).toBe(2);
    expect(L.lines).toHaveLength(3);
    // The center line is between the 2 backward lanes and the 3 forward lanes.
    expect(L.center).toBeCloseTo(L.edges[0] - MARKING_SIZES.edgeLine / 2 + 2 * L.lane, 6);
  });

  it("puts a green bike lane inside the curb band on each tagged side", () => {
    const L = laneLayout({ width: 14, lanes: 2, oneway: true, cycleway: "right" }, true);
    expect(L.bikes).toEqual([{ offset: 7 - MARKING_SIZES.curb - MARKING_SIZES.bike / 2, width: MARKING_SIZES.bike }]);
    expect(L.edges[1]).toBeLessThan(7 - MARKING_SIZES.curb - MARKING_SIZES.bike);
    const q = marks([street("a", "trunk", 14, [[0, 0], [120, 0]], { lanes: 2, oneway: true, cycleway: "right" })]);
    const bike = q.filter((x) => x.color === "bike");
    expect(bike.length).toBe(1);
    // The right of the +x direction is +z.
    for (const z of bike[0].zs) expect(z).toBeGreaterThan(0);
  });

  it("keeps the old lane lines on a street with no lane tag", () => {
    expect(laneLayout({ width: 14 }, false).lines.sort((a, b) => a - b)).toEqual([-3.5, 3.5]);
  });
});

describe("turn arrows (#138)", () => {
  it("make a straight, a left, and a right arrow", () => {
    expect(arrowShapes("through")).toHaveLength(2);
    expect(arrowShapes("left")).toHaveLength(3);
    expect(arrowShapes("through;right")).toHaveLength(4);
    expect(arrowShapes("none")).toHaveLength(0);
    expect(arrowShapes("")).toHaveLength(0);
    // A left arrow points to the left (+b).
    expect(Math.max(...arrowShapes("left").flat().map(([, b]) => b))).toBeGreaterThan(1);
  });

  it("puts one arrow in each lane before the stop bar, pointing to the node", () => {
    const q = marks([
      street("a", "secondary", 14, [[-80, 0], [0, 0]], { name: "Main St NE", lanes: 2, oneway: true, turnLanes: "left|through;right" }),
      street("b", "secondary", 12, [[0, -60], [0, 0], [0, 60]], { name: "Cross St NE" }),
    ]);
    // The arrow quads: white, short, and on street a (x < 0, |z| < 7).
    // The crosswalk and the stop bar end 10.45 m from the node.
    // A lane dash is 3 m long and 0.11 m wide; an arrow part is shorter or wider.
    const span = (v) => Math.max(...v) - Math.min(...v);
    const arrows = q.filter((x) => x.color === "white" && x.xs.every((v) => v < -10.6 && v > -40) && span(x.zs) < 1.5 && !(span(x.zs) < 0.12 && span(x.xs) > 2.9));
    expect(arrows.length).toBeGreaterThan(4);
    // The heads are before the crosswalk and the stop bar, near the node.
    const xs = arrows.flatMap((x) => x.xs);
    expect(Math.max(...xs)).toBeLessThan(-10.55 - MARKING_SIZES.arrowBack + 1e-3);
    expect(Math.min(...xs)).toBeGreaterThan(-10.55 - MARKING_SIZES.arrowBack - 3.4 - 1e-3);
    // Two lanes: the left lane (north, -z, for traffic to +x) and the right lane (+z).
    expect(arrows.some((x) => x.zs.every((z) => z < 0))).toBe(true);
    expect(arrows.some((x) => x.zs.every((z) => z > 0))).toBe(true);
  });
});

describe("decals (#138)", () => {
  it("put manholes and drains on a long street, at finite places, the same on each run", () => {
    const strips = [
      street("a", "secondary", 12, [[-200, 0], [0, 0], [200, 0]], { name: "Main St NE" }),
      street("b", "residential", 8, [[0, -100], [0, 0], [0, 100]], { name: "Cross St NE" }),
    ];
    const q = marks(strips);
    const iron = q.filter((x) => x.color === "iron");
    expect(iron.length).toBeGreaterThan(8);
    for (const x of iron) for (const v of [...x.xs, ...x.zs]) expect(Number.isFinite(v)).toBe(true);
    expect(marks(strips)).toEqual(q);
  });
});
