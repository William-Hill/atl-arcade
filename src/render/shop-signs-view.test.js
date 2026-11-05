import { describe, expect, it } from "vitest";
import { boardWidth } from "./shop-signs-view.js";

describe("the shop board width", () => {
  it("fits the text and stays in its limits", () => {
    const short = boardWidth(100, 0.55, 5);
    const long = boardWidth(600, 0.55, 5);
    expect(long).toBeGreaterThan(short);
    expect(boardWidth(5000, 0.55, 5)).toBe(5);
    expect(boardWidth(0, 0.55, 5)).toBeGreaterThanOrEqual(1.2);
  });
});
