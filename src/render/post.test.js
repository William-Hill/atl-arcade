import { describe, expect, it, vi } from "vitest";
import { creaseInk, disposeComposer, halftoneRadius, syncComposerSize } from "./post.js";

describe("syncComposerSize", () => {
  it("gives the composer the renderer pixel ratio before it sets the size", () => {
    const calls = [];
    const composer = {
      setPixelRatio: (pr) => calls.push(["pr", pr]),
      setSize: (w, h) => calls.push(["size", w, h]),
    };
    const renderer = { getPixelRatio: () => 1.25 };
    syncComposerSize(composer, renderer, { x: 1000, y: 500 });
    expect(calls).toEqual([
      ["pr", 1.25],
      ["size", 800, 400],
    ]);
  });
});

describe("disposeComposer", () => {
  it("disposes every pass that has a dispose method, then the composer", () => {
    const order = [];
    const pass = (name) => ({ dispose: vi.fn(() => order.push(name)) });
    const gtao = pass("gtao");
    const bloom = pass("bloom");
    const composer = { passes: [gtao, {}, bloom], dispose: vi.fn(() => order.push("composer")) };
    disposeComposer(composer);
    expect(gtao.dispose).toHaveBeenCalledOnce();
    expect(bloom.dispose).toHaveBeenCalledOnce();
    expect(order).toEqual(["gtao", "bloom", "composer"]);
  });
});

describe("halftoneRadius", () => {
  it("is 0.5 for black and 0 at the start luminance", () => {
    expect(halftoneRadius(0)).toBe(0.5);
    expect(halftoneRadius(0.16)).toBe(0);
  });
});

describe("creaseInk", () => {
  const up = [0, 1, 0];
  const front = [0, 0, 1];

  it("draws ink on both sides of a real crease", () => {
    // A wall corner: this side is up, the other side is front.
    expect(creaseInk(up, front, front, up)).toBeCloseTo(1);
    expect(creaseInk(front, up, up, front)).toBeCloseTo(1);
  });

  it("draws no ink next to a sliver one pixel wide", () => {
    // The neighbor is the top of a thin band; 2 pixels out is the wall again.
    expect(creaseInk(front, up, front, front)).toBe(0);
  });

  it("draws no ink on a sliver pixel between two neighbors that agree", () => {
    expect(creaseInk(up, front, front, front)).toBe(0);
  });

  it("draws no ink on a flat face", () => {
    expect(creaseInk(front, front, front, front)).toBe(0);
  });
});
