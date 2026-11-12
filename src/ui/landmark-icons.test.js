import { describe, expect, it } from "vitest";
import {
  CHECK,
  GLYPH_KINDS,
  ICON_SIZE,
  ICON_STYLES,
  PANEL_TEXT,
  countLines,
  createIconSource,
  edgeDirection,
  glyphStrokes,
  guideModel,
  iconLook,
  looksOf,
  mapIcons,
  mapSummary,
  minimapIconSize,
  namePlace,
  newlyClaimed,
  parkIcons,
  pulseAt,
  safeSourceUrl,
  spotIcons,
  spotPanel,
} from "./landmark-icons.js";
import { createLandmarkTracker } from "../sim/landmarks.js";
import { withSkatepark } from "../level/skatepark.js";
import { pointInRings } from "../level/geo/geo-ground.js";
import BELTLINE_FILE from "../../levels/beltline-eastside/level.json";
import BELTLINE_SKATEPARK from "../../levels/beltline-eastside/skatepark.json";
import SKATE_FEATURES from "../../assets/skate-features/features.json";
import BELTLINE_SPOTS from "../../levels/beltline-eastside/landmarks.json";

// The level as the game loads it (src/level/levels.js).
const BELTLINE = withSkatepark(BELTLINE_FILE, BELTLINE_SKATEPARK, SKATE_FEATURES);

// A small level: 1 building, 2 named parks (one of them is a spot).
const LEVEL = {
  bounds: { minX: -100, maxX: 1000, minZ: -100, maxZ: 100 },
  buildings: [{ id: "b1", outer: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
  areas: [
    { id: "a1", kind: "park", name: "Pond Park", outer: [[100, 0], [140, 0], [140, 40], [100, 40]] },
    { id: "a2", kind: "park", name: "Pond Park", outer: [[150, 0], [160, 0], [160, 10], [150, 10]] },
    { id: "a3", kind: "park", name: "Oak Park", outer: [[200, 0], [240, 0], [240, 40], [200, 40]] },
  ],
};
const fact = (text, url = "https://www.nps.gov/x") => ({ text, source: { name: "National Park Service", url } });
const SPOTS = {
  v: 1,
  level: "test-level",
  spots: [
    { id: "warehouse", kind: "building", name: "Old Warehouse", at: [5, 5], footprint: { building: "b1" }, find: { edge: 8 }, short: "A 1911 warehouse.", card: [fact("Built in 1911."), fact("It held cotton."), fact("It is lofts now.")], challenge: { type: "combo", tier: "typical", hint: "Land a 1,000 point combo", zone: { x: 5, z: 20, r: 10 } } },
    { id: "bridge", kind: "bridge", name: "Trail Bridge", at: [300, 0], find: { r: 20 }, short: "A bridge of 1910.", card: [fact("Built in 1910.")], challenge: { type: "gap", tier: "typical", hint: "Hop the bridge", zone: { x: 300, z: 0, r: 8 } } },
    { id: "park", kind: "park", name: "The Pond", at: [120, 20], footprint: { areas: ["a2"] }, find: { edge: 8 }, short: "A park with a pond.", card: [fact("It has a pond.")], challenge: { type: "combo", tier: "easy", hint: "Land a 500 point combo", zone: { x: 120, z: 20, r: 10 } } },
    { id: "district", kind: "edge", name: "Old District", at: [900, 0], find: { r: 20 }, short: "A district east of here.", card: [fact("It is from 1889."), fact("Bad link.", "http://example.com/x")] },
  ],
};
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const tracker = (data = SPOTS, level = LEVEL) => createLandmarkTracker({ data, level, storage: memory() });

describe("icon looks and sizes", () => {
  it("gives the 4 looks of the GDD icon table", () => {
    expect(iconLook("building", "unknown")).toBe("unknown");
    expect(iconLook("building", "found")).toBe("found");
    expect(iconLook("building", "claimed")).toBe("claimed");
    expect(iconLook("edge", "found")).toBe("edge");
    expect(iconLook("edge", "unknown")).toBe("unknown");
  });

  it("tells the 4 looks apart by shape and mark, not by color only (M-3)", () => {
    const key = (s) => `${s.shape}|${s.dashed}|${s.mark}|${s.check}`;
    const keys = Object.values(ICON_STYLES).map(key);
    expect(new Set(keys).size).toBe(4);
    expect(ICON_STYLES.unknown).toMatchObject({ shape: "circle", dashed: true, mark: "?" });
    expect(ICON_STYLES.found).toMatchObject({ shape: "circle", dashed: false, mark: "glyph", check: false });
    expect(ICON_STYLES.claimed).toMatchObject({ shape: "circle", mark: "glyph", check: true });
    expect(ICON_STYLES.edge).toMatchObject({ shape: "square", mark: "arrow" });
    // Found has the thick outline.
    expect(ICON_STYLES.found.line).toBeGreaterThan(ICON_STYLES.claimed.line);
  });

  it("keeps a minimap icon at 14 px or more, and the full map icon at 24 px", () => {
    for (const css of [72, 100, 120, 160, 180, 240]) expect(minimapIconSize(css)).toBeGreaterThanOrEqual(14);
    expect(minimapIconSize(72)).toBe(14);
    expect(minimapIconSize(180)).toBe(22);
    expect(ICON_SIZE.fullmap).toBe(24);
  });

  it("has a glyph for each of the 6 kinds, inside the 16 px grid", () => {
    expect(GLYPH_KINDS.sort()).toEqual(["art", "bridge", "building", "edge", "park", "skate"]);
    const shapes = new Set();
    for (const kind of GLYPH_KINDS) {
      const strokes = glyphStrokes(kind);
      expect(strokes.length).toBeGreaterThan(0);
      for (const line of strokes) {
        expect(line.length).toBeGreaterThanOrEqual(2);
        for (const [x, y] of line) {
          expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
        }
      }
      shapes.add(JSON.stringify(strokes));
    }
    expect(shapes.size).toBe(6);
    // The kinds of the data file all have a glyph of their own.
    for (const s of BELTLINE_SPOTS.spots) expect(GLYPH_KINDS).toContain(s.kind);
  });

  it("puts the check mark at the lower right", () => {
    expect(CHECK.at[0]).toBeGreaterThan(0);
    expect(CHECK.at[1]).toBeGreaterThan(0);
  });

  it("points the edge arrow to the nearest side of the level", () => {
    expect(edgeDirection([900, 0], LEVEL.bounds)).toEqual([1, 0]);
    expect(edgeDirection([-90, 0], LEVEL.bounds)).toEqual([-1, 0]);
    expect(edgeDirection([400, 95], LEVEL.bounds)).toEqual([0, 1]);
    expect(edgeDirection([400, -95], LEVEL.bounds)).toEqual([0, -1]);
  });
});

describe("the icon list", () => {
  it("has one icon per spot at its map point, with no name while Unknown", () => {
    const t = tracker();
    const icons = spotIcons(t.view(), LEVEL.bounds);
    expect(icons.map((i) => i.id)).toEqual(["warehouse", "bridge", "park", "district"]);
    expect(icons.every((i) => i.spot && i.look === "unknown" && i.name === null)).toBe(true);
    expect(icons[0]).toMatchObject({ x: 5, z: 5, kind: "building" });
    expect(JSON.stringify(icons)).not.toContain("Old Warehouse");
  });

  it("follows the states of the landmark module", () => {
    const t = tracker();
    t.mark("warehouse", "found");
    t.mark("bridge", "claimed");
    t.mark("district", "found");
    const icons = spotIcons(t.view(), LEVEL.bounds);
    expect(looksOf(icons)).toEqual({ warehouse: "found", bridge: "claimed", park: "unknown", district: "edge" });
    expect(icons.find((i) => i.id === "warehouse").name).toBe("Old Warehouse");
    expect(icons.find((i) => i.id === "district").out).toEqual([1, 0]);
    expect(icons.find((i) => i.id === "bridge").out).toBeNull();
  });

  it("keeps the icon of a park with no spot, and drops a park that is a spot", () => {
    // "Pond Park" is the footprint of the spot "The Pond" (by area id).
    expect(parkIcons(LEVEL, SPOTS).map((p) => p.name)).toEqual(["Oak Park"]);
    expect(parkIcons(LEVEL, null).map((p) => p.name)).toEqual(["Pond Park", "Oak Park"]);
    // A spot with the name of a park also stands for it.
    const named = { spots: [{ id: "x", kind: "park", name: "Oak Park", at: [0, 0] }] };
    expect(parkIcons(LEVEL, named).map((p) => p.name)).toEqual(["Pond Park"]);
    const all = mapIcons(LEVEL, SPOTS, tracker().view());
    expect(all.filter((i) => !i.spot).map((i) => i.name)).toEqual(["Oak Park"]);
  });

  it("makes the icons again only when a spot changes", () => {
    const t = tracker();
    const source = createIconSource({ tracker: t, level: LEVEL, data: SPOTS });
    const first = source.icons;
    const v = source.version;
    t.startRun(); // a new state object, the same spots
    expect(source.icons).toBe(first);
    expect(source.version).toBe(v);
    t.mark("warehouse", "found");
    expect(source.version).toBe(v + 1);
    expect(source.icons.find((i) => i.id === "warehouse").look).toBe("found");
    expect(source.card("warehouse")).toHaveLength(3);
    expect(source.card("nothing")).toEqual([]);
  });

  it("shows the parks only when the level has no spots", () => {
    const source = createIconSource({ level: LEVEL });
    expect(source.icons.map((i) => i.name)).toEqual(["Pond Park", "Oak Park"]);
    expect(source.view).toBeNull();
    expect(mapSummary(source.view)).toBe("");
  });
});

describe("the name beside an icon", () => {
  it("goes to the right, or to the left when the right is off the screen or taken", () => {
    expect(namePlace(100, 50, 80, 400)).toMatchObject({ x: 117, align: "left" });
    expect(namePlace(380, 50, 80, 400)).toMatchObject({ x: 363, align: "right" });
    const first = namePlace(100, 50, 80, 400);
    // The right side is taken: the name goes to the left.
    expect(namePlace(110, 55, 80, 400, [first.rect])).toMatchObject({ x: 93, align: "right" });
    // Both sides are taken: no name, but the chosen icon still gets one.
    const left = namePlace(110, 55, 80, 400, [first.rect]);
    expect(namePlace(110, 52, 80, 400, [first.rect, left.rect])).toBeNull();
    expect(namePlace(110, 52, 80, 400, [first.rect, left.rect], { force: true })).toMatchObject({ align: "left" });
  });
});

describe("the Guide tab", () => {
  it("counts from the file, never from a fixed number", () => {
    const t = tracker();
    expect(countLines(t.view())).toEqual({ claimed: "0 of 3 claimed", found: "0 of 4 found" });
    t.mark("bridge", "claimed");
    t.mark("district", "found");
    expect(countLines(t.view())).toEqual({ claimed: "1 of 3 claimed", found: "2 of 4 found" });
  });

  it("lists the spots by kind, with no name for an Unknown spot", () => {
    const t = tracker();
    t.mark("bridge", "claimed");
    t.mark("district", "found");
    const g = guideModel(t.view());
    expect(g.groups.map((x) => x.title)).toEqual(["Buildings", "Bridges", "Parks", "Past the map edge"]);
    expect(g.groups[0].rows).toEqual([{ id: "warehouse", kind: "building", look: "unknown", title: "?", status: "Not found yet" }]);
    expect(g.groups[1].rows[0]).toMatchObject({ title: "Trail Bridge", look: "claimed", status: "Claimed" });
    expect(g.groups[3].rows[0]).toMatchObject({ title: "Old District", look: "edge", status: "Found" });
    expect(JSON.stringify(g)).not.toContain("Old Warehouse");
  });

  it("names only the found spots for a screen reader", () => {
    const t = tracker();
    t.mark("bridge", "found");
    const text = mapSummary(t.view());
    expect(text).toBe("Landmark spots: 1 of 4 found, 0 of 3 claimed. Found: Trail Bridge.");
  });
});

describe("the spot panel", () => {
  const panelOf = (t, id, opts) => spotPanel(t.view().spots.find((s) => s.id === id), SPOTS.spots.find((s) => s.id === id).card, opts);

  it("Unknown: a '?' and 'Not found yet', with no name and no fact", () => {
    const p = panelOf(tracker(), "warehouse");
    expect(p).toMatchObject({ look: "unknown", title: "?", prompt: "Not found yet", short: null, hint: null, kindLabel: null, kind: null, facts: [] });
    expect(JSON.stringify(p)).not.toMatch(/Warehouse|1911|cotton/);
  });

  it("Found: the name, the short line, the challenge and 'Claim it to unlock'", () => {
    const t = tracker();
    t.mark("warehouse", "found");
    const p = panelOf(t, "warehouse");
    expect(p).toMatchObject({ look: "found", title: "Old Warehouse", kindLabel: "Building", short: "A 1911 warehouse.", hint: "Land a 1,000 point combo", prompt: PANEL_TEXT.claim, facts: [] });
    expect(p.prompt).toBe("Claim it to unlock");
  });

  it("Found in a free run: 'Start a timed run to claim it'", () => {
    const t = tracker();
    t.mark("warehouse", "found");
    expect(panelOf(t, "warehouse", { freeRun: true })).toMatchObject({ hint: null, prompt: "Start a timed run to claim it", facts: [] });
  });

  it("Claimed: the facts with their sources", () => {
    const t = tracker();
    t.mark("warehouse", "claimed");
    const p = panelOf(t, "warehouse");
    expect(p.look).toBe("claimed");
    expect(p.prompt).toBeNull();
    expect(p.facts.map((f) => f.text)).toEqual(["Built in 1911.", "It held cotton.", "It is lofts now."]);
    expect(p.facts[0].source).toEqual({ name: "National Park Service", url: "https://www.nps.gov/x" });
  });

  it("an edge marker that is Found: the facts, with no prompt, in a free run too", () => {
    const t = tracker();
    t.mark("district", "found");
    for (const freeRun of [false, true]) {
      const p = panelOf(t, "district", { freeRun });
      expect(p).toMatchObject({ look: "edge", title: "Old District", prompt: null });
      expect(p.facts).toHaveLength(2);
      // A link that is not https shows as text only.
      expect(p.facts[1].source).toEqual({ name: "National Park Service", url: null });
    }
  });

  it("takes only https links", () => {
    expect(safeSourceUrl("https://www.nps.gov/a?b=1")).toBe("https://www.nps.gov/a?b=1");
    for (const bad of ["http://www.nps.gov/", "javascript:alert(1)", "data:text/html,x", "//nps.gov/x", "/local", "", null, 4, "https://"]) expect(safeSourceUrl(bad)).toBeNull();
  });
});

describe("the claim pulse (R-1)", () => {
  it("swells once and ends", () => {
    expect(pulseAt(0).scale).toBe(1);
    expect(pulseAt(0.35).scale).toBeGreaterThan(1.3);
    expect(pulseAt(0.35).ring.alpha).toBeCloseTo(0.5);
    expect(pulseAt(0.7)).toBeNull();
    expect(pulseAt(5)).toBeNull();
  });

  it("is off with reduced motion", () => {
    expect(pulseAt(0.2, { reducedMotion: true })).toBeNull();
  });

  it("starts for an icon that became Claimed, not for a saved claim", () => {
    const t = tracker();
    t.mark("bridge", "found");
    const before = spotIcons(t.view());
    expect(newlyClaimed(null, before)).toEqual([]);
    t.mark("bridge", "claimed");
    t.mark("warehouse", "found");
    t.mark("district", "found");
    const after = spotIcons(t.view());
    expect(newlyClaimed(looksOf(before), after)).toEqual(["bridge"]);
    expect(newlyClaimed(looksOf(after), after)).toEqual([]);
  });
});

describe("levels/beltline-eastside/landmarks.json on the maps", () => {
  const t = createLandmarkTracker({ data: BELTLINE_SPOTS, level: BELTLINE, storage: memory() });
  const source = createIconSource({ tracker: t, level: BELTLINE, data: BELTLINE_SPOTS });

  it("has one icon for each spot of the file, inside the level (AC-1)", () => {
    const spots = source.icons.filter((i) => i.spot);
    expect(spots.map((i) => i.id)).toEqual(BELTLINE_SPOTS.spots.map((s) => s.id));
    const b = BELTLINE.bounds;
    for (const i of spots) {
      expect(i.x).toBeGreaterThan(b.minX);
      expect(i.x).toBeLessThan(b.maxX);
      expect(i.z).toBeGreaterThan(b.minZ);
      expect(i.z).toBeLessThan(b.maxZ);
    }
  });

  it("puts the icon of a building spot inside its footprint", () => {
    for (const s of BELTLINE_SPOTS.spots.filter((x) => x.footprint?.building)) {
      const b = BELTLINE.buildings.find((x) => x.id === s.footprint.building);
      expect(pointInRings(s.at[0], s.at[1], [b.outer, ...(b.holes ?? [])]), s.id).toBe(true);
    }
  });

  it("counts the spots of the file", () => {
    const claim = BELTLINE_SPOTS.spots.filter((s) => s.kind !== "edge").length;
    const lines = countLines(source.view);
    expect(lines).toEqual({ claimed: `0 of ${claim} claimed`, found: `0 of ${BELTLINE_SPOTS.spots.length} found` });
  });

  it("keeps the parks that are not spots, and drops the 2 park spots", () => {
    const parks = source.icons.filter((i) => !i.spot).map((i) => i.name);
    expect(parks).not.toContain("Freedom Park");
    expect(parks).not.toContain("Historic Fourth Ward Park");
    expect(parks.length).toBeGreaterThan(0);
  });
});
