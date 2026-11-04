import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { landmarkPlacements } from "../src/level/geo/landmarks.js";
import { terrainOf } from "../src/level/geo/terrain.js";

// Issue #79: the two landmark signs. Fixed cameras save the evidence, and a
// pixel check on each screenshot proves that the sign shows:
// - "MARKET" of Krog Street Market is not under a wall: the screen area of
//   each end of the card has the card colors (near black or near white),
//   not the brick of a wall.
// - The Ponce City Market sign faces south: from Historic Fourth Ward Park
//   (south of the market) the screen shows many pixels of the sign yellow.

const LEVEL = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const KROG = JSON.parse(readFileSync(new URL("../assets/landmarks/krog-street-market-front.json", import.meta.url), "utf8"));
const PLACES = Object.fromEntries(landmarkPlacements(LEVEL).map((p) => [p.id, p]));
const VIEW = { width: 1280, height: 720 };

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// `cam` is in world meters. The ?cam heights are over the terrain (src/main.js).
async function open(page, cam) {
  const h = terrainOf(LEVEL).height;
  const q = [cam[0], cam[1] - h(cam[0], cam[2]), cam[2], cam[3], cam[4] - h(cam[3], cam[5]), cam[5]];
  await page.goto(`/?level=beltline-eastside&mute=1&view=fixed&skater=capsule&cam=${q.map((v) => v.toFixed(2)).join(",")}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__atl.level.landmarks && window.__atl.level.landmarks.towers >= 2, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 60000 });
  await page.waitForTimeout(300);
}

// The screen point [x, y] in px of a world point, for the camera of `cam`
// (the same camera as src/main.js: 60 degrees, the page aspect).
function project(cam, p) {
  const c = new THREE.PerspectiveCamera(60, VIEW.width / VIEW.height, 0.1, 4000);
  c.position.set(cam[0], cam[1], cam[2]);
  c.lookAt(cam[3], cam[4], cam[5]);
  c.updateMatrixWorld();
  const v = new THREE.Vector3(...p).project(c);
  return [((v.x + 1) / 2) * VIEW.width, ((1 - v.y) / 2) * VIEW.height];
}

// Pixel counts in a screen box of a PNG screenshot, decoded in the page.
async function pixelStats(page, png, box) {
  return page.evaluate(
    async ({ src, box }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const x0 = Math.max(0, Math.round(box[0]));
      const y0 = Math.max(0, Math.round(box[1]));
      const x1 = Math.min(img.width, Math.round(box[2]));
      const y1 = Math.min(img.height, Math.round(box[3]));
      const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let total = 0;
      let gray = 0;
      let yellow = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
        total += 1;
        // The card colors: near black (#1E2023) or near white (#F4F4F2).
        if (Math.max(r, gg, b) - Math.min(r, gg, b) < 28 && (r < 90 || r > 170)) gray += 1;
        // The sign yellow (#f2c230), lit or in shade.
        if (r > 150 && gg > 110 && b < 110 && r - b > 90 && gg - b > 60) yellow += 1;
      }
      return { total, gray, yellow };
    },
    { src: `data:image/png;base64,${png.toString("base64")}`, box },
  );
}

test("Krog Street Market: the letters read in full, with no wall over MARKET", async ({ page }) => {
  const errors = collectErrors(page);
  const m = PLACES["krog-street-market"].model;
  const out = [Math.sin(m.yaw), Math.cos(m.yaw)];
  // From the parking drive, 32 m out from the front and a little to the
  // south, at eye height.
  const cam = [m.x + out[0] * 32 - out[1] * 6, m.y + 3, m.z + out[1] * 32 + out[0] * 6, m.x, m.y + 6.5, m.z];
  await open(page, cam);
  const png = await page.screenshot({ path: "e2e/__screenshots__/landmark-krog-street-market.png" });
  const card = KROG.cards.find((c) => c.text === "MARKET");
  const c = Math.cos(m.yaw);
  const s = Math.sin(m.yaw);
  // Each end of the card, 0.4 m in from the edge.
  for (const lx of [card.position[0] - card.width / 2 + 0.4, card.position[0] + card.width / 2 - 0.4]) {
    const lz = card.position[2] + 0.02;
    const p = [m.x + lx * c + lz * s, m.y + card.position[1], m.z - lx * s + lz * c];
    const [x, y] = project(cam, p);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(VIEW.width);
    const stats = await pixelStats(page, png, [x - 4, y - 3, x + 4, y + 3]);
    expect(stats.gray / stats.total, `card colors at the MARKET end x=${lx.toFixed(1)}`).toBeGreaterThan(0.6);
  }
  expect(errors).toEqual([]);
});

test("Ponce City Market: the rooftop sign stands west of the tower and faces south", async ({ page }) => {
  const errors = collectErrors(page);
  const { model, sign } = PLACES["ponce-city-market"];
  // From the north edge of Historic Fourth Ward Park, south of the market.
  const cam = [sign.x + 20, sign.y + 4, sign.z + 150, (sign.x + model.x) / 2, sign.y + 6, sign.z];
  await open(page, cam);
  const png = await page.screenshot({ path: "e2e/__screenshots__/landmark-ponce-city-market.png" });
  // The screen box around the sign face.
  const corners = [-1, 1].flatMap((sx) => [0.8, 0.8 + sign.height].map((dy) => project(cam, [sign.x + (sx * sign.width) / 2, sign.y + dy, sign.z + 0.25])));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  // The tower is east of the sign on the screen.
  expect(project(cam, [model.x, model.y + 10, model.z])[0]).toBeGreaterThan(box[2]);
  const stats = await pixelStats(page, png, box);
  expect(stats.yellow, `sign yellow pixels in ${box.map(Math.round)}`).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});
