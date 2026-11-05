// Shop name signs from OpenStreetMap (issue #135). Pure.
//
// A building with an OSM `shop` or `amenity` tag and a name (`b.use`,
// scripts/build-block.mjs buildingTags()) gets one name board on its front
// wall, over the door bay, on the line of the sign band. Only the uses in
// SHOP_USES get a board, and a name that matches NAME_DENY gets none, so
// every board is a positive or a neutral name.
//
// The render (src/render/shop-signs-view.js) draws the name on the board.

import { orientRing } from "./extrude.js";
import { createGeoGroundSampler } from "./geo-ground.js";
import { BELT, STYLES, STYLE_INDEX, chooseStyle, floorCount } from "./styles.js";
import { buildingTest, muralWalls, streetTest } from "./geo-mesh.js";
import { buildingSpan } from "./terrain.js";
import { doorBay, frontEdge, frontWalk } from "./facade-kit.js";

// The OSM uses that get a board, and the board color of each group.
export const SIGN_GROUPS = {
  food: "#7b2b20",
  market: "#1f5a3a",
  culture: "#1d3a6b",
  shop: "#5a3a6e",
};
export const SHOP_USES = {
  amenity: {
    restaurant: "food",
    cafe: "food",
    fast_food: "food",
    ice_cream: "food",
    food_court: "food",
    marketplace: "market",
    library: "culture",
    theatre: "culture",
    arts_centre: "culture",
    cinema: "culture",
    community_centre: "culture",
    studio: "culture",
    bicycle_rental: "shop",
    car_wash: "shop",
  },
  shop: {
    supermarket: "market",
    greengrocer: "market",
    bakery: "food",
    deli: "food",
    coffee: "food",
    confectionery: "food",
    gift: "shop",
    books: "culture",
    art: "culture",
    music: "culture",
    clothes: "shop",
    shoes: "shop",
    florist: "shop",
    bicycle: "shop",
    sports: "shop",
    hardware: "shop",
    furniture: "shop",
    toys: "shop",
    stationery: "shop",
    jewelry: "shop",
    hairdresser: "shop",
    beauty: "shop",
    optician: "shop",
    pet: "shop",
    variety_store: "shop",
    convenience: "market",
  },
};
// Names that do not show the city at its best. A name that matches gets
// no board, also when its use is in SHOP_USES.
export const NAME_DENY = /\b(pawn|bail|bonds?|liquor|tobacco|vape|smoke|cash|loans?|title|guns?|firearms?|ammo|check ?cashing|adult|lounge|night ?club|strip)\b/i;

// The board: `height` m high, `out` m in front of the wall (over the sign
// band and its blank board), at most `maxWidth` m wide and 2 bays less
// `pierGap` m. The board center is `y` of the ground floor, under the belt
// course, and at most `maxY` m over the base.
export const BOARD = { height: 0.55, out: 0.12, maxWidth: 5.5, minWidth: 1.6, pierGap: 0.5, y: 0.9, maxY: 4.2, minY: 2.9, beltGap: 0.08 };

// Pure: the board text of a building, or null. `use` is { key, value,
// name } (buildingTags()).
export function shopSignName(use) {
  if (!use?.name || typeof use.name !== "string") return null;
  const group = SHOP_USES[use.key]?.[use.value];
  if (!group) return null;
  const name = use.name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 32 || NAME_DENY.test(name)) return null;
  return name;
}

// Pure: the board group of a use ("food", "market", "culture", "shop"),
// or null.
export function shopSignGroup(use) {
  return SHOP_USES[use?.key]?.[use?.value] ?? null;
}

// Pure: the board of one building on its front wall, or null.
// `front` is { edge, door } (frontEdges() in facade-kit.js), `span` is
// buildingSpan(), and `mural` the mural of the building (muralWalls()).
// Returns { id, name, group, color, x, y, z, yaw, maxWidth, height, normal }.
// The board faces out along `normal` ([x, z]); `yaw` turns +z to it.
export function signBoard(b, front, span, mural = null) {
  const name = shopSignName(b.use);
  if (!name || !front) return null;
  const style = STYLES[STYLE_INDEX[chooseStyle(b)]];
  const ring = orientRing(b.outer, false);
  if (!(front.edge >= 0 && front.edge < ring.length)) return null;
  const [px, pz] = ring[front.edge];
  const [qx, qz] = ring[(front.edge + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz);
  if (!(len > BOARD.minWidth + 0.4)) return null;
  const t = [(qx - px) / len, (qz - pz) / len];
  const n = [-t[1], t[0]];
  const bays = Math.max(1, Math.round(len / style.bay));
  const bl = len / bays;
  const k = doorBay(front, bays);
  const wall = span.top - span.base;
  const floors = floorCount(b, style, wall);
  const floorH = wall / floors;
  // On the sign band of a storefront with two floors or more: under the
  // belt course. Else near the top of the ground floor.
  const under = floors >= 2 ? span.base + floorH - BELT.height / 2 - BOARD.beltGap - BOARD.height / 2 : span.top - 0.6 - BOARD.height / 2;
  const y = Math.min(span.base + Math.min(Math.max(BOARD.y * floorH, BOARD.minY), BOARD.maxY), under);
  if (y - BOARD.height / 2 < span.base + 2.2) return null;
  const maxWidth = Math.min(BOARD.maxWidth, 2 * bl - BOARD.pierGap, len - 0.4);
  if (maxWidth < BOARD.minWidth) return null;
  // The board center: on the door bay, kept on the wall.
  const a = Math.min(Math.max((k + 0.5) * bl, maxWidth / 2 + 0.2), len - maxWidth / 2 - 0.2);
  if (mural && mural.edge === front.edge) {
    const hit = a + maxWidth / 2 > mural.t0 - 0.3 && a - maxWidth / 2 < mural.t1 + 0.3 && y + BOARD.height / 2 > mural.y0 - 0.3 && y - BOARD.height / 2 < mural.y1 + 0.3;
    if (hit) return null;
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  const group = shopSignGroup(b.use);
  return {
    id: b.id,
    name,
    group,
    color: SIGN_GROUPS[group],
    x: r(px + t[0] * a + n[0] * BOARD.out),
    y: r(y),
    z: r(pz + t[1] * a + n[1] * BOARD.out),
    yaw: r(Math.atan2(n[0], n[1])),
    normal: [r(n[0]), r(n[1])],
    maxWidth: r(maxWidth),
    height: BOARD.height,
  };
}

// Pure: the boards of a level, sorted by building id. `fronts` is the Map
// of frontEdges(); a building with no entry in it (a style with no
// storefront) gets its front wall from frontEdge() and frontWalk().
export function shopSigns(level, fronts = new Map()) {
  const list = (level.buildings ?? []).filter((b) => shopSignName(b.use) && b.outer?.length >= 3);
  if (!list.length) return [];
  const murals = new Map(muralWalls(level).map((m) => [m.id, m]));
  let tests = null;
  const out = [];
  for (const b of list.sort((p, q) => (p.id < q.id ? -1 : 1))) {
    let front = fronts.get(b.id) ?? null;
    if (!front) {
      if (!tests) {
        const sample = createGeoGroundSampler(level);
        tests = { isStreet: streetTest(level, sample), blockedFor: buildingTest(level, sample) };
      }
      const style = STYLES[STYLE_INDEX[chooseStyle(b)]];
      const ring = orientRing(b.outer, false);
      const blocked = tests.blockedFor(b.id);
      const f = frontEdge(ring, tests.isStreet, blocked);
      front = { ...f, ...frontWalk(ring, f.edge, style.bay, tests.isStreet, blocked) };
    }
    const board = signBoard(b, front, buildingSpan(level, b), murals.get(b.id) ?? null);
    if (board) out.push(board);
  }
  return out;
}
