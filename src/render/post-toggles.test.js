import { describe, expect, it } from "vitest";
import { setPostToggles } from "./post-toggles.js";

describe("setPostToggles", () => {
  it("turns the passes of the full chain off and on", () => {
    const post = { kind: "full", ink: { enabled: true }, bloom: { enabled: true } };
    setPostToggles(post, { ink: false, bloom: false });
    expect(post.ink.enabled).toBe(false);
    expect(post.bloom.enabled).toBe(false);
    setPostToggles(post, { ink: true, bloom: true });
    expect(post.ink.enabled).toBe(true);
    expect(post.bloom.enabled).toBe(true);
  });

  it("zeroes the lite ink and brings back its first values", () => {
    const u = { strength: { value: 0.85 }, halftone: { value: { x: 5, y: 0.16, z: 0.22 } } };
    const post = { kind: "lite", ink: { uniforms: u } };
    setPostToggles(post, { ink: false });
    expect(u.strength.value).toBe(0);
    expect(u.halftone.value.z).toBe(0);
    setPostToggles(post, { ink: true });
    expect(u.strength.value).toBe(0.85);
    expect(u.halftone.value.z).toBe(0.22);
  });

  it("does nothing with no chain or a pbr chain with no ink", () => {
    expect(() => setPostToggles(null, { ink: false })).not.toThrow();
    const post = { kind: "full", ink: null, bloom: { enabled: true } };
    setPostToggles(post, { ink: false, bloom: true });
    expect(post.bloom.enabled).toBe(true);
  });
});
