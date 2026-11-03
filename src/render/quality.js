// Render quality tiers.
//
// - low: the old look. No shadow map, no post effects. The headless
//   playtest (SwiftShader, a software GPU) tests this tier at 55 FPS.
// - high: for a real GPU. A sun shadow map, ambient occlusion (GTAO), ink
//   outlines, bloom, MSAA, tone mapping, cloud sky, and a longer draw
//   distance.
//
// ?quality=low or ?quality=high sets the tier. With no parameter, a
// software renderer gets low and every other renderer gets high.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

// Pure: the tier for a URL value and a WebGL renderer name.
export function qualityFor(param, rendererName) {
  if (param === "low" || param === "high") return param;
  return SOFTWARE.test(String(rendererName ?? "")) ? "low" : "high";
}

// The unmasked WebGL renderer name, for example "ANGLE (Apple, Apple M3, ...)".
export function rendererName(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

// Settings for each tier. far and fogNear are in meters.
export const QUALITY = {
  low: { shadows: false, post: false, clouds: false, far: 320, fogNear: 150 },
  high: { shadows: true, post: true, clouds: true, far: 650, fogNear: 260 },
};
