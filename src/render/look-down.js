// The step from pbr lite down to the toon look (#246). The governor
// (governor.js) asks for it when the frames stay slow on the phone tier. The
// look builds the scene (materials, people, trees), so the step is a reload
// into the toon look. Pure: main.js does the reload and shows the line.
//
// - The saved look goes from "pbr" to "toon", so the next visit starts in
//   toon and does not step down again. The player can pick pbr again in the
//   settings menu.
// - A ?look= flag in the address goes to toon too: a URL flag wins over the
//   saved choice.
// - ?lookdown=1 tells the next page to show the line once. The page removes
//   the flag from the address, so a refresh does not show it again.

export const LOOK_DOWN_FLAG = "lookdown";
// The HUD line, shown once after the step.
export const LOOK_DOWN_NOTICE = "Switched to the toon look to keep the game smooth.";
// How long the line stays (ms).
export const LOOK_DOWN_NOTICE_MS = 8000;

// Pure: true when a governor rung asks for another look than the one that runs.
export function isLookDown(rung, look) {
  return Boolean(rung?.look) && rung.look !== look;
}

// Pure: the reload of a look step: the next address and the next saved
// settings (null: nothing to save). `saved` is the settings object of
// src/ui/settings.js.
export function lookDownPlan(href, saved, to = "toon") {
  const url = new URL(href);
  if (url.searchParams.has("look")) url.searchParams.set("look", to);
  url.searchParams.set(LOOK_DOWN_FLAG, "1");
  const save = saved && saved.look !== "auto" && saved.look !== to ? { ...saved, look: to } : null;
  // With no saved choice and no flag, the look came from the tier default;
  // then the flag carries it.
  if (!save && !url.searchParams.has("look")) url.searchParams.set("look", to);
  return { href: url.toString(), saved: save };
}

// Pure: the line to show on this page (or null), and the address without
// the flag.
export function lookDownNotice(href) {
  const url = new URL(href);
  if (url.searchParams.get(LOOK_DOWN_FLAG) !== "1") return { text: null, href };
  url.searchParams.delete(LOOK_DOWN_FLAG);
  return { text: LOOK_DOWN_NOTICE, href: url.toString() };
}
