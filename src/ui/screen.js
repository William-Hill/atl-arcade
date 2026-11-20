// The screen rules for a phone (#97, MOB-9): the fullscreen API and the
// orientation hint. Pure: the DOM part is in src/ui/screen-controls.js.

// The orientation that plays better on a phone. The measure of 2026-11-10
// (iPhone 15 and Pixel 7 sizes, 390x844 and 844x390, the current HUD and
// touch overlay): in landscape the skater is 31% of the screen height (the
// 42 degree view of layout.js), in portrait 21%. In landscape the player
// sees more of the trail to the sides, and the top buttons do not touch.
export const BETTER_ORIENTATION = "landscape";

// The hint text, and how long it stays (ms) when the player does nothing.
export const TURN_HINT = "Turn your phone sideways for a bigger view.";
export const TURN_HINT_MS = 8000;

export function orientationOf(width, height) {
  return width > height ? "landscape" : "portrait";
}

// Pure: show the "turn your phone" hint? Only with the touch controls,
// and only in the orientation that plays worse.
export function wantsTurnHint({ touch, width, height, better = BETTER_ORIENTATION }) {
  return Boolean(touch) && orientationOf(width, height) !== better;
}

// Pure: the fullscreen API of a document, or null when the page cannot go
// fullscreen. iOS Safari on an iPhone has no fullscreen for a page element,
// so the button does not show there. Older Safari (iPad) has only the
// webkit names.
export function fullscreenApi(doc = globalThis.document) {
  const el = doc?.documentElement;
  if (!el) return null;
  if (typeof el.requestFullscreen === "function" && doc.fullscreenEnabled !== false) {
    return {
      active: () => Boolean(doc.fullscreenElement),
      enter: () => el.requestFullscreen({ navigationUI: "hide" }),
      exit: () => doc.exitFullscreen(),
      event: "fullscreenchange",
    };
  }
  if (typeof el.webkitRequestFullscreen === "function" && doc.webkitFullscreenEnabled !== false) {
    return {
      active: () => Boolean(doc.webkitFullscreenElement),
      enter: () => el.webkitRequestFullscreen(),
      exit: () => doc.webkitExitFullscreen(),
      event: "webkitfullscreenchange",
    };
  }
  return null;
}

// Pure: the button text and name for the fullscreen state.
export function fullscreenLabel(active) {
  return active ? { text: "EXIT FULL", name: "Exit full screen" } : { text: "FULL SCREEN", name: "Full screen" };
}
