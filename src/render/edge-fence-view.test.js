import { describe, expect, it } from "vitest";
import { FENCE_LOOK, postHeights, scrimArrays } from "./edge-fence-view.js";

describe("edge fence view", () => {
  it("stands on the ground, and on the terrain under a building or a prop", () => {
    const posts = [[0, 0], [1, 0], [2, 0], [3, 0]];
    const ids = ["street", "b1", "prop:lamp", null];
    const sample = (x) => (ids[x] ? { height: 5 + x, id: ids[x] } : null);
    const h = postHeights(posts, sample, () => 0.5, (id) => id === "b1" || id.startsWith("prop:"));
    expect(h).toEqual([5, 0.5, 0.5, 0.5]);
  });

  it("makes one scrim quad for each panel, on the post heights", () => {
    const posts = [[0, 0], [3, 0], [3, 3]];
    const { position, uv } = scrimArrays(posts, [0, 1, 2]);
    expect(position.length).toBe(2 * 6 * 3);
    expect(uv.length).toBe(2 * 6 * 2);
    // The first vertex: post 0 at the scrim bottom. The third: post 1 at the top.
    expect(position[0]).toBe(0);
    expect(position[1]).toBeCloseTo(FENCE_LOOK.scrimBottom);
    expect(position[2]).toBe(0);
    expect(position[7]).toBeCloseTo(1 + FENCE_LOOK.scrimTop);
    expect([...uv.slice(0, 6)]).toEqual([0, 0, 1, 0, 1, 1]);
  });
});
