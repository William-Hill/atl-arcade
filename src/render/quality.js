// Render quality tiers.
//
// - low: the old look. No shadow map, no post effects. The headless
//   playtest (SwiftShader, a software GPU) tests this tier at 55 FPS.
// - phone: for a touch device with a small screen (#72). The low-tier scene
//   (no shadow map, no sky dome, no facade kit) plus the lite post pass: ink
//   outlines and the halftone from the depth buffer only, with no GTAO, no
//   bloom, and no MSAA. The pixel ratio is 1.5 or less.
// - high: for a real GPU. A sun shadow map, ambient occlusion (GTAO), ink
//   outlines, bloom, MSAA, tone mapping, cloud sky, and a longer draw
//   distance.
//
// ?quality=low|phone|high sets it, then the settings menu (src/ui/settings.js).
// With neither, a software renderer gets low, a phone (a touch device with a
// small screen, or a phone user agent) or a CPU with 2 cores or less gets
// phone, and every other renderer gets high.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

// A screen whose short side is this many CSS px or less is a phone (or a
// small tablet).
export const PHONE_MAX_SIDE = 900;

// A phone user agent: "Mobile" is in the phone builds of Chrome, Safari and
// Firefox, and not in the tablet builds.
const MOBILE_UA = /Mobi|iPhone|iPod|Windows Phone/i;

// Pure: true for a phone user agent.
export function isMobileAgent(userAgent) {
  return MOBILE_UA.test(String(userAgent ?? ""));
}

// Pure: true for a touch device with a small screen, or a phone user agent
// (`mobile`).
export function isPhone({ touch = false, width = 0, height = 0, mobile = false } = {}) {
  if (mobile) return true;
  const side = Math.min(width, height);
  return Boolean(touch) && side > 0 && side <= PHONE_MAX_SIDE;
}

// A CPU with this many cores or less gets the phone tier.
export const LOW_CORES = 2;

// Pure: the tier for a URL value, a WebGL renderer name, and the device.
// `device` is { touch, width, height, mobile, cores } (the screen size in CSS
// px, a phone user agent, navigator.hardwareConcurrency).
export function qualityFor(param, rendererName, device = {}) {
  if (param === "low" || param === "high" || param === "phone") return param;
  if (SOFTWARE.test(String(rendererName ?? ""))) return "low";
  if (isPhone(device)) return "phone";
  return device.cores > 0 && device.cores <= LOW_CORES ? "phone" : "high";
}

// The device facts for qualityFor, from the browser.
export function readDevice(nav = globalThis.navigator, win = globalThis.window) {
  return {
    touch: (nav?.maxTouchPoints ?? 0) > 0 || (win?.matchMedia?.("(pointer: coarse)").matches ?? false),
    width: win?.screen?.width ?? win?.innerWidth ?? 0,
    height: win?.screen?.height ?? win?.innerHeight ?? 0,
    mobile: isMobileAgent(nav?.userAgent),
    cores: nav?.hardwareConcurrency ?? 0,
  };
}

// The unmasked WebGL renderer name, for example "ANGLE (Apple, Apple M3, ...)".
export function rendererName(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

// Settings for each tier. far and fogNear are in meters. post is "full"
// (GTAO, ink, bloom, MSAA), "lite" (depth ink only), or null. pixelRatio is
// the cap on the device pixel ratio. detail turns on the ground scans, the
// road markings, the facade kit, and the interiors.
export const QUALITY = {
  low: { shadows: false, post: null, clouds: false, far: 320, fogNear: 150, pixelRatio: 2, detail: false },
  phone: { shadows: false, post: "lite", clouds: false, far: 320, fogNear: 150, pixelRatio: 1.5, detail: false },
  high: { shadows: true, post: "full", clouds: true, far: 650, fogNear: 260, pixelRatio: 2, detail: true },
};

// Pure: the pixel ratio for a device pixel ratio and a cap.
export function pixelRatioFor(devicePixelRatio, cap) {
  return Math.min(Math.max(1, devicePixelRatio || 1), cap);
}
