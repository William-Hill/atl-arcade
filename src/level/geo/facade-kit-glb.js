// The Blender facade kit (assets/facades/facade-kit.glb, docs/facade-kit.md)
// on the buildings of a level, for the pbr look. Pure: no Three.js.
//
// facadeKitPlacements() places the GLB modules with facadePlacements()
// (scripts/assets/facade-kit-placement.js) and groups them by depth tile, so
// they show and hide with the procedural depth tiles (geo-view.js). It also
// returns, per building, the procedural parts the modules replace (`covers`,
// read by buildingKit() in facade-kit.js) and the shop-name boards on the
// GLB sign boards (shop-names.js).
import { facadePlacements } from "../../../scripts/assets/facade-kit-placement.js";
import { orientRing } from "./extrude.js";
import { DEPTH_TILE } from "./facade-kit.js";
import { muralWalls } from "./geo-mesh.js";
import { claimedIds } from "./landmarks.js";
import { STYLES, STYLE_INDEX, chooseStyle, floorCount, hash32 } from "./styles.js";
import { buildingSpan } from "./terrain.js";

// Modules the game does not place, so the procedural part stays: the
// awnings (they match the street awnings of geo-mesh.js), and the runs at the
// roof line and the belt course. The procedural cornice, coping, and belt
// are in the building tiles, drawn at every distance; GLB runs in the depth
// tiles would leave the roof line bare past DEPTH_DISTANCE.
export const GLB_SKIP = new Set(["belt_course_segment", "belt_course_corner", "cornice_segment", "cornice_corner", "parapet_cap_segment", "parapet_cap_corner", "awning_fabric", "awning_metal"]);
// The face of trim_sign_board: 0.065 m deep, set 0.07 m out from the wall,
// with a 1.6 x 0.5 m panel inside its frame (the board is 1.88 x 0.58).
export const SIGN_BOARD = { out: 0.07, depth: 0.065, width: 1.6, height: 0.5, center: 0.29 };

function emptyCovers() {
  return { sill: new Set(), sign: new Set(), pier: new Set(), door: false };
}

// Pure: the procedural parts that the placements of one building replace.
// `sill`: "wall:floor:bay" keys of the windows that get a GLB frame (no
// procedural sill, lintel, or head there). `sign`: "wall:bay" keys of the
// shop bays that get GLB glass (no painted sign band there). `pier`:
// "wall:line" keys of the bay lines with a GLB pilaster. `door`: a GLB door.
export function kitCovers(list) {
  const c = emptyCovers();
  for (const it of list) {
    if (it.module.startsWith("window_")) c.sill.add(`${it.wallIndex}:${it.floor}:${it.bay}`);
    else if (it.module.startsWith("storefront_")) {
      c.sign.add(`${it.wallIndex}:${it.bay}`);
      if (it.module.startsWith("storefront_door")) c.door = true;
    } else if (it.module === "trim_pilaster") c.pier.add(`${it.wallIndex}:${it.line}`);
  }
  return c;
}

// Pure: true when a GLB sign board would poke through a shop sign of
// shop-signs.js (`sign`: { x, z, normal, maxWidth }) on the same wall.
export function underShopSign(it, sign) {
  const [nx, nz] = sign.normal;
  const dx = it.position[0] - sign.x;
  const dz = it.position[2] - sign.z;
  if (Math.abs(dx * nx + dz * nz) > 0.5) return false;
  return Math.abs(dx * nz - dz * nx) < sign.maxWidth / 2 + 0.94 + 0.1;
}

// Pure: the shop-name board (shop-names.js) on a GLB sign board.
export function boardOf(it) {
  const nx = Math.sin(it.rotationY);
  const nz = Math.cos(it.rotationY);
  const d = SIGN_BOARD.depth + 0.004;
  return { x: it.position[0] + nx * d, y: it.position[1] + SIGN_BOARD.center, z: it.position[2] + nz * d, w: SIGN_BOARD.width, h: SIGN_BOARD.height, nx, nz };
}

// Pure: the GLB kit of a level. `fronts` is frontEdges(); `signs` the shop
// signs (shopSigns()). Claimed landmark footprints get nothing (their model
// draws the building). Returns { tiles: Map(tile -> { center, list }),
// covers: Map(id -> kitCovers()), buildings, instances }; a tile's `boards`
// are the shop-name boards of its GLB sign boards (boardOf()). `buildings`
// has the same placements per building: { id, center: [x, z], radius, list,
// boards }, for distance culling by building (facade-kit-view.js).
export function facadeKitPlacements(level, fronts, { signs = [], claimed = claimedIds(level), murals = new Map(muralWalls(level).map((m) => [m.id, m])) } = {}) {
  const tiles = new Map();
  const covers = new Map();
  const buildings = [];
  const signsOf = new Map(signs.map((s) => [s.id, s]));
  let instances = 0;
  for (const b of level.buildings ?? []) {
    if (!(b.outer?.length >= 3) || !(b.height > 0) || claimed.has(b.id)) continue;
    const style = STYLES[STYLE_INDEX[chooseStyle(b, level)]];
    const span = buildingSpan(level, b);
    const sign = signsOf.get(b.id) ?? null;
    const list = facadePlacements({ ring: orientRing(b.outer, false), holes: b.holes ?? [], style, base: span.base, top: span.top, front: fronts.get(b.id) ?? null, mural: murals.get(b.id) ?? null, seed: hash32(String(b.id)), floors: floorCount(b, style, span.top - span.base) }).filter((it) => !GLB_SKIP.has(it.module) && !(it.module === "trim_sign_board" && sign && underShopSign(it, sign)));
    if (!list.length) continue;
    covers.set(b.id, kitCovers(list));
    // The depth tile of the building, as facadeKit() keys it.
    const [x, z] = b.outer[0];
    const i = Math.floor(x / DEPTH_TILE);
    const j = Math.floor(z / DEPTH_TILE);
    const key = `${i},${j}`;
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, (tile = { center: [(i + 0.5) * DEPTH_TILE, (j + 0.5) * DEPTH_TILE], list: [], boards: [] }));
    const trim = style.trim;
    const items = list.map((it) => ({ ...it, wall: undefined, color: it.tint === "trim" ? trim : null }));
    const boards = list.filter((it) => it.module === "trim_sign_board").map(boardOf);
    tile.list.push(...items);
    tile.boards.push(...boards);
    let cx = 0;
    let cz = 0;
    for (const p of b.outer) { cx += p[0]; cz += p[1]; }
    cx /= b.outer.length;
    cz /= b.outer.length;
    const radius = Math.max(...b.outer.map((p) => Math.hypot(p[0] - cx, p[1] - cz)));
    buildings.push({ id: b.id, center: [cx, cz], radius, list: items, boards });
    instances += list.length;
  }
  return { tiles, covers, buildings, instances };
}
