import { describe, expect, it } from "vitest";
import { bytesKey, LANDMARK_MODEL_KEYS } from "./landmark-models.js";

describe("landmark models", () => {
  it("keys equal image bytes alike and different bytes apart", () => {
    const a = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(bytesKey(a)).toBe(bytesKey(new Uint8Array([1, 2, 3, 4]).buffer));
    expect(bytesKey(a)).not.toBe(bytesKey(new Uint8Array([1, 2, 3, 5]).buffer));
    expect(bytesKey(a)).not.toBe(
      bytesKey(new Uint8Array([1, 2, 3, 4, 0]).buffer),
    );
  });

  it("loads the four buildings and the four bridges", () => {
    expect(LANDMARK_MODEL_KEYS).toHaveLength(8);
  });
});
