// The look of a walker (src/sim/peds.js), made from its seeded `look`
// number: the height, the build, the skin tone, the hair, the clothes, the
// colors and the accessories. Pure: no Three.js here. peds-view.js draws
// the look with one part-packed figure: each optional part (a hair style,
// long sleeves, a skirt, a backpack) has a feature bit, and the vertex
// shader hides a part when its bit is off. So every walker can look
// different and all the walkers still take one draw call.

import { seededRandom } from "../sim/npc/crowd.js";

// The feature bits of the figure.
export const F = {
  hairShort: 0,
  afro: 1,
  bun: 2,
  hairLong: 3,
  locs: 4,
  cap: 5,
  beanie: 6,
  sleeve: 7, // a short sleeve (a tank top has none)
  longSleeve: 8,
  longPants: 9, // off: shorts or a skirt
  skirt: 10,
  backpack: 11,
  tote: 12,
  crossbody: 13,
  headphones: 14,
  glasses: 15,
  beard: 16,
  shoeWhite: 17,
  shoeAccent: 18,
  jacket: 19,
};

// The colors (sRGB hex). The shirts are bright and friendly, the way the
// BeltLine looks on a good day.
export const SHIRTS = [
  0xe03a3e, 0xffd23f, 0x2ec4b6, 0xff8c42, 0x9b5de5, 0x8ac926, 0x3a86ff, 0xf15bb5, 0x00bbf9, 0xffffff, 0xc8102e, 0x1d428a, 0xf4a7b9, 0xb8e0d2, 0xfff1a8, 0x2b2d42, 0x9a9a9a, 0x7a3e9d,
  0xe76f51, 0x40916c,
];
export const PANTS = [0x2b2d42, 0x3d405b, 0x4a6fa5, 0x6b8cbf, 0x1d2b4f, 0x6b705c, 0xe9d8a6, 0x22223b, 0x8d6346, 0x5c5c5c, 0xf2efe6, 0x556b2f, 0x7f1d1d];
export const SKINS = [0x3b2219, 0x4a2c1d, 0x5a3825, 0x6e4430, 0x7a4b2a, 0x8d5a3b, 0x9c6b43, 0xb07a52, 0xc68e5e, 0xd8a679, 0xe0b48a, 0xf1cfa8];
export const HAIRS = [0x111111, 0x1b1b1b, 0x2e1f14, 0x3b2a1a, 0x4b3621, 0x6d4c33, 0x8a8a8a, 0xc9c9c9, 0x8c3b1e, 0xc8a165, 0xd63c8a, 0x2aa198];
// Bags, hats, jackets, headphones.
export const ACCENTS = [0x264653, 0xe9c46a, 0xf4a261, 0x2a9d8f, 0xe63946, 0x1d3557, 0x6d597a, 0x8d6346, 0x111111, 0xf1faee, 0x588157, 0xff006e];

// [value, weight] lists.
const HAIR_COLOR = [
  [0, 18],
  [1, 18],
  [2, 14],
  [3, 10],
  [4, 8],
  [5, 6],
  [6, 6],
  [7, 3],
  [8, 4],
  [9, 6],
  [10, 3],
  [11, 3],
];
const HAIR_STYLE = [
  ["short", 24],
  ["afro", 10],
  ["bun", 10],
  ["long", 13],
  ["locs", 12],
  ["bald", 7],
  ["cap", 13],
  ["beanie", 5],
];
const TOP = [
  ["tee", 42],
  ["long", 18],
  ["tank", 14],
  ["jacket", 14],
  ["dress", 8],
];
const BOTTOM = [
  ["pants", 50],
  ["shorts", 32],
  ["skirt", 18],
];
const BAG = [
  ["none", 42],
  ["backpack", 24],
  ["tote", 16],
  ["crossbody", 18],
];

// The adult height range (m, the top of the head) and the build range (the
// width scale).
export const HEIGHT = [1.52, 1.94];
export const WIDTH = [0.88, 1.16];

function pick(rand, list) {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [v, w] of list) {
    r -= w;
    if (r < 0) return v;
  }
  return list[list.length - 1][0];
}
const any = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

// Pure: the look for the seeded number `n`. The same `n` gives the same look.
export function pedLook(n) {
  const rand = seededRandom((n ^ 0x5bd1e995) >>> 0);
  rand();
  // The height: the mean of two draws, so most people are near the middle.
  const height = HEIGHT[0] + ((rand() + rand()) / 2) * (HEIGHT[1] - HEIGHT[0]);
  const width = WIDTH[0] + rand() * (WIDTH[1] - WIDTH[0]);
  const skin = any(rand, SKINS);
  const hairColor = HAIRS[pick(rand, HAIR_COLOR)];
  const style = pick(rand, HAIR_STYLE);
  const top = pick(rand, TOP);
  const bottom = top === "dress" ? "skirt" : pick(rand, BOTTOM);
  const bag = pick(rand, BAG);
  const shirt = any(rand, SHIRTS);
  let pants = any(rand, PANTS);
  if (top === "dress") pants = shirt;
  const accent = any(rand, ACCENTS);
  const shoe = rand();
  const extra = rand();
  const bits = new Set();
  if (style === "short" || style === "bun" || style === "long" || style === "locs") bits.add(F.hairShort);
  if (style === "afro") bits.add(F.afro);
  if (style === "bun") bits.add(F.bun);
  if (style === "long") bits.add(F.hairLong);
  if (style === "locs") bits.add(F.locs);
  if (style === "cap") {
    bits.add(F.cap);
    // Some long hair or locs under the cap.
    if (extra < 0.3) bits.add(F.hairLong);
    else if (extra < 0.55) bits.add(F.locs);
  }
  if (style === "beanie") bits.add(F.beanie);
  if (top !== "tank" && top !== "dress") bits.add(F.sleeve);
  if (top === "long" || top === "jacket") bits.add(F.longSleeve);
  if (top === "jacket") bits.add(F.jacket);
  if (bottom === "pants") bits.add(F.longPants);
  if (bottom === "skirt") bits.add(F.skirt);
  if (bag !== "none") bits.add(F[bag]);
  if (rand() < 0.12) bits.add(F.headphones);
  if (rand() < 0.18) bits.add(F.glasses);
  if (top !== "dress" && bottom !== "skirt" && rand() < 0.2) bits.add(F.beard);
  if (shoe < 0.4) bits.add(F.shoeWhite);
  else if (shoe < 0.55) bits.add(F.shoeAccent);
  let genes = 0;
  for (const b of bits) genes |= 1 << b;
  return { height, width, depth: 0.55 + 0.45 * width, skin, hair: hairColor, style, top, bottom, bag, shirt, pants, accent, genes };
}

// Pure: a key that names the look. Two walkers with the same key look the
// same (the height and the build are rounded to what the eye can tell).
export function lookKey(l) {
  return [Math.round(l.height * 20), Math.round(l.width * 10), l.skin, l.hair, l.shirt, l.pants, l.accent, l.genes].join("|");
}
