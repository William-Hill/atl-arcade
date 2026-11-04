// The load screen (#74). The markup is in index.html, so it shows at the
// first paint, before any JS. This module moves the bar as the parts arrive
// and hides the screen after the first game frame. The skater can arrive
// after the first frame; the game shows the capsule until then.

// The parts and their share of the bar. The skater GLB is the biggest file.
export const LOAD_PARTS = { level: 0.3, physics: 0.3, skater: 0.4 };

// Pure: the bar fraction (0..1) for the parts done and the skater bytes.
// `state` is { done: Set of part names, skater: { loaded, total } }.
export function loadFraction(state, parts = LOAD_PARTS) {
  let f = 0;
  for (const [name, w] of Object.entries(parts)) {
    if (state.done.has(name)) f += w;
    else if (name === "skater" && state.skater && state.skater.total > 0) f += w * Math.min(1, state.skater.loaded / state.skater.total);
  }
  return Math.min(1, f);
}

export function createLoader(root, { skater = true } = {}) {
  const parts = skater ? LOAD_PARTS : { level: 0.5, physics: 0.5 };
  const state = { done: new Set(), skater: { loaded: 0, total: 0 } };
  const fill = root?.querySelector(".loader-fill") ?? null;
  const bar = root?.querySelector("[role=progressbar]") ?? null;
  function draw() {
    const f = loadFraction(state, parts);
    if (fill) fill.style.width = `${Math.round(f * 100)}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(f * 100)));
  }
  return {
    step(name) {
      state.done.add(name);
      draw();
    },
    progress(name, loaded, total) {
      if (name === "skater") state.skater = { loaded, total };
      draw();
    },
    // Called after the first game frame. The screen fades out.
    hide() {
      if (!root || root.dataset.hidden === "1") return;
      root.dataset.hidden = "1";
      setTimeout(() => root.remove(), 400);
    },
    get fraction() {
      return loadFraction(state, parts);
    },
  };
}
