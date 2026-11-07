import { describe, expect, it, vi } from "vitest";
import { PBR_GRADE_GLSL, createLitePost, creaseInk, disposeComposer, halftoneRadius, syncComposerSize } from "./post.js";
import { setPostToggles } from "./post-toggles.js";
import { GRADE_PIVOT } from "./pbr-palette.js";

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

describe("createLitePost with the pbr look (#195)", () => {
  const renderer = (calls) => ({
    render: (s, c) => calls.push(["render", s, c]),
    setRenderTarget: (t) => calls.push(["target", t]),
    getDrawingBufferSize: (v) => v.set(640, 360),
    getPixelRatio: () => 1.5,
  });

  it("draws no ink and no halftone, and gives the grade uniforms", () => {
    const post = createLitePost(renderer([]), {}, {}, { fadeNear: 1, fadeFar: 2, halftone: false, look: "pbr" });
    expect(post.kind).toBe("lite");
    expect(post.ink).toBeNull();
    const u = post.grade.uniforms;
    for (const k of ["uContrast", "uSat", "uWarm", "uLift", "uTint"]) expect(u[k]).toBeDefined();
    expect(u.tDepth).toBeUndefined();
    expect(u.halftone).toBeUndefined();
    // The settings menu switches do nothing and do not fail.
    setPostToggles(post, { ink: false, bloom: false });
    post.setSize();
    post.dispose();
  });

  it("draws the scene into a target with no depth texture, then one pass to the canvas", () => {
    const calls = [];
    const scene = {};
    const camera = {};
    const post = createLitePost(renderer(calls), scene, camera, { fadeNear: 1, fadeFar: 2, look: "pbr" });
    post.render();
    expect(calls.map((c) => c[0])).toEqual(["target", "render", "target", "render"]);
    const target = calls[0][1];
    expect(target.depthTexture).toBeNull();
    expect(target.samples).toBe(0);
    expect(calls[1].slice(1)).toEqual([scene, camera]);
    expect(calls[2][1]).toBeNull();
    post.dispose();
  });

  it("keeps the ink pass for the toon look", () => {
    const post = createLitePost(renderer([]), {}, {}, { fadeNear: 1, fadeFar: 2 });
    expect(post.grade).toBeNull();
    expect(post.ink.uniforms.strength.value).toBe(0.85);
    expect(post.ink.uniforms.halftone.value.x).toBeGreaterThan(0);
    post.dispose();
  });
});

describe("PBR_GRADE_GLSL", () => {
  it("uses the pivot of the palette grade", () => {
    expect(PBR_GRADE_GLSL).toContain(GRADE_PIVOT.toFixed(4));
    expect(PBR_GRADE_GLSL).toContain("vec3 pbrGrade(vec3 col, float contrast, float sat, float warm, float lift, vec3 tint)");
    // An include guard: the phone pass and the material grade chunk can
    // both be in one shader with no second definition.
    const lines = PBR_GRADE_GLSL.trim().split("\n").map((l) => l.trim());
    expect(lines[0]).toBe("#ifndef PBR_GRADE_FN");
    expect(lines[1]).toBe("#define PBR_GRADE_FN");
    expect(lines.at(-1)).toBe("#endif");
  });
});
