// The Found and Claimed banners (#219). Plain DOM; shell.css sets the place
// (center, 30 vh from the top) and the 2 styles. The banner state comes from
// the landmark module (src/sim/landmarks.js, state.banner.current): this
// file only draws it. It takes no pointer input and never pauses play.
//
// Design: design/gdd/landmark-discovery.md, "The Found and Claimed moments".
// - Found: a dark pill with a gold border, the name and the `short` line.
// - Claimed: the pill fills with the district accent, with dark ink text:
//   "SPOT CLAIMED", the name, and the claim points.
// The full story card never shows here (GDD rule 7).
//
// Every text of the data file goes in with textContent, never as HTML.

import { DISTRICT_LOOKS, districtWeights } from "../render/pbr-palette.js";

export const BANNER = {
  fade: 0.3, // s, at the start and at the end (part of the banner time)
  slide: 18, // px, the slide in from above; none with reduced motion
  ink: "#0b0b12",
  minContrast: 4.5,
};

const clamp01 = (t) => Math.min(1, Math.max(0, t));

// The opacity and the slide of a banner on show. `current` is
// { time, left } (s). With reduced motion the banner fades and does not move.
export function bannerLook(current, reducedMotion = false, k = BANNER) {
  if (!current) return { opacity: 0, y: 0 };
  const age = current.time - current.left;
  const fadeIn = clamp01(age / k.fade);
  const opacity = Math.min(fadeIn, clamp01(current.left / k.fade));
  return { opacity, y: reducedMotion ? 0 : -k.slide * (1 - fadeIn) * (1 - fadeIn) };
}

// The 2 or 3 lines of a banner: { title, text, points }.
export function bannerLines(current) {
  if (!current) return { title: "", text: "", points: "" };
  const points = current.type === "claimed" && current.points > 0 ? `+${current.points.toLocaleString("en-US")}` : "";
  return { title: current.title ?? "", text: current.text ?? "", points };
}

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

export function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The WCAG contrast of 2 colors (1 to 21).
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The district accent for the Claimed fill at (x, z): the brightest accent
// of the district with the most weight there (the comic effects use the
// same accent). `anchors` are the district anchors of the level.
export function districtAccent(x, z, anchors = []) {
  const w = districtWeights(x, z, anchors);
  const id = Object.keys(w).sort((a, b) => w[b] - w[a])[0] ?? "trail";
  const accents = (DISTRICT_LOOKS[id] ?? DISTRICT_LOOKS.trail).accent;
  return [...accents].sort((a, b) => luminance(b) - luminance(a))[0];
}

// The fill of the Claimed banner for an accent: the accent, made lighter
// (toward white, in steps) until the dark ink reads on it at 4.5:1 or more.
export function claimedFill(accent, k = BANNER) {
  let rgb = rgbOf(accent);
  for (let i = 0; i < 20 && contrast(hexOf(rgb), k.ink) < k.minContrast; i += 1) rgb = rgb.map((v) => v + (255 - v) * 0.12);
  return hexOf(rgb);
}

// `reducedMotion()` is true when the banner must not slide (#97: the
// player's choice, or prefers-reduced-motion).
export function createLandmarkBanner(parent, { reducedMotion = () => false } = {}) {
  const root = document.createElement("div");
  root.id = "landmark-banner";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.hidden = true;
  const title = document.createElement("div");
  title.className = "lb-title";
  const text = document.createElement("div");
  text.className = "lb-text";
  const points = document.createElement("div");
  points.className = "lb-points";
  root.append(title, text, points);
  parent.appendChild(root);

  let shownKey = null;
  const state = { shown: 0, found: 0, claimed: 0 };
  return {
    // `current` is the banner on show (state.banner.current) or null.
    // `held` is true while the fact pop-up shows: the banner waits.
    // `accent` is the district accent (a hex color) for a Claimed banner.
    update(current, { held = false, accent = "#c9962e" } = {}) {
      if (!current || held) {
        if (!root.hidden) root.hidden = true;
        if (!current) shownKey = null;
        return;
      }
      const key = `${current.type}:${current.id}`;
      if (key !== shownKey) {
        shownKey = key;
        const lines = bannerLines(current);
        title.textContent = lines.title;
        text.textContent = lines.text;
        points.textContent = lines.points;
        points.hidden = !lines.points;
        root.dataset.type = current.type;
        root.dataset.spot = current.id;
        if (current.type === "claimed") root.style.setProperty("--lb-fill", claimedFill(accent));
        else root.style.removeProperty("--lb-fill");
        state.shown += 1;
        state[current.type] += 1;
      }
      const reduced = reducedMotion();
      const look = bannerLook(current, reduced);
      root.dataset.motion = reduced ? "reduced" : "full";
      root.style.opacity = look.opacity.toFixed(3);
      root.style.transform = `translate(-50%, ${look.y.toFixed(1)}px)`;
      if (root.hidden) root.hidden = false;
    },
    get state() {
      return { visible: !root.hidden, type: root.hidden ? null : root.dataset.type, id: root.hidden ? null : root.dataset.spot, title: root.hidden ? null : title.textContent, text: root.hidden ? null : text.textContent, points: root.hidden ? null : points.textContent, opacity: Number(root.style.opacity || 0), transform: root.style.transform, motion: root.dataset.motion ?? null, ...state };
    },
    element: root,
  };
}
