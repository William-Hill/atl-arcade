import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLandmarksView } from "./landmarks-view.js";

// The sign cards draw on a canvas. Node has none, so a stub 2D context
// takes the calls and does nothing.
function stubCanvas() {
  const ctx = new Proxy({}, { get: (_, k) => (k === "measureText" ? () => ({ width: 10 }) : () => {}), set: () => true });
  return { width: 0, height: 0, style: {}, getContext: () => ctx };
}
beforeAll(() => vi.stubGlobal("document", { createElement: stubCanvas }));
afterAll(() => vi.unstubAllGlobals());

const LEVEL = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const tick = () => new Promise((r) => setTimeout(r, 50));

describe("createLandmarksView `after` (#413)", () => {
  it("loads no landmark model before `after` resolves", async () => {
    let release;
    const after = new Promise((r) => (release = r));
    const view = createLandmarksView(LEVEL, { after });
    await tick();
    expect(view.info.towers).toBe(0);
    release();
    await view.ready;
    expect(view.info.towers).toBeGreaterThan(0);
  });

  it("loads the models at once with no `after`", async () => {
    const view = createLandmarksView(LEVEL);
    await view.ready;
    expect(view.info.towers).toBeGreaterThan(0);
  });
});
