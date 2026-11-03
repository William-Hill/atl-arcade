// Pure layout rules for the shell and the HUD (#73). The DOM and the
// renderer read these; Vitest tests them.

// A screen is compact when it is narrow or short, as on a phone.
export const COMPACT = { maxWidth: 600, maxHeight: 500 };

export function isCompact(width, height) {
  return width <= COMPACT.maxWidth || height <= COMPACT.maxHeight;
}

// The vertical field of view (degrees). A short landscape screen gets a
// narrower view, so the skater fills more of the height. 60 to 42 degrees
// makes the skater about 1.5 times as tall on the screen.
export const FOV = { base: 60, shortLandscape: 42, shortHeight: 500 };

export function fovFor(width, height, k = FOV) {
  return width > height && height <= k.shortHeight ? k.shortLandscape : k.base;
}

// The text that asks for a gesture to start the beat (browser audio rules).
export function startHint(touch) {
  return touch ? "Tap to start the beat" : "Press any key or click to start the beat";
}

// The short attribution for a compact screen. ODbL asks for a visible credit
// to OpenStreetMap; a tap on it shows the full text.
export function shortAttribution(full) {
  return /openstreetmap/i.test(String(full ?? "")) ? "© OpenStreetMap contributors" : String(full ?? "");
}

// WCAG relative luminance of an sRGB color [r, g, b] in 0..255.
export function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// WCAG contrast ratio of two colors.
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A color with alpha over a background: the color you see.
export function over([r, g, b, a = 1], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}
