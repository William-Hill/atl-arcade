// The minimap (#86): a 2D canvas in a corner of the HUD. The level is drawn
// once to a base image (footprints, streets, the trail, parks). Each frame
// draws only the part of that image around the skater, moved and turned,
// then the landmark spot icons (#218: one look per state, from the landmark
// module through src/ui/landmark-icons.js) and the skater arrow. The 3D scene is not drawn
// a second time. The math is in src/ui/minimap-math.js.
//
// Keys: N changes north up and heading up. M opens the full map
// (src/ui/fullmap.js); the expand button and a click on the map open it too.
// The × button hides the minimap.

import { createIconSource, looksOf, mapSummary, minimapIconSize, newlyClaimed, pulseAt } from "./landmark-icons.js";
import { drawSpotIcon } from "./spot-icon.js";
import { MINIMAP, cropRect, mapFrame, needsRedraw, projectToView, stripWidth, stripsInOrder, viewTransform, worldToMap } from "./minimap-math.js";

export const COLORS = {
  ground: "#1d2033",
  park: "#2f6b45",
  sidewalk: "#3a3e55",
  street: "#565b78",
  path: "#9a8d63",
  trail: "#ff5fb2",
  building: "#c3c6dd",
  ink: "#0b0b12",
  paper: "#f3f3f7",
};

const STORE_KEY = "atl.minimap";

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    // No storage (a private window): the choice lasts for this page only.
  }
}

function ringPath(ctx, frame, ring) {
  ring.forEach(([x, z], i) => {
    const [px, py] = worldToMap(frame, x, z);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

// Draws the level to a new canvas, one time. The full map uses it too. No
// building has a color of its own: gold means Claimed on the maps (#218),
// and a gold footprint would also mark a spot that is still Unknown.
export function drawMapBase(level, frame) {
  const base = document.createElement("canvas");
  base.width = frame.width;
  base.height = frame.height;
  const ctx = base.getContext("2d");
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, frame.width, frame.height);

  ctx.fillStyle = COLORS.park;
  for (const a of level.areas ?? []) {
    if (a.kind !== "park") continue;
    ctx.beginPath();
    ringPath(ctx, frame, a.outer);
    for (const h of a.holes ?? []) ringPath(ctx, frame, h);
    ctx.fill("evenodd");
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of stripsInOrder(level.strips)) {
    if (!s.points || s.points.length < 2) continue;
    ctx.strokeStyle = COLORS[s.kind];
    ctx.lineWidth = stripWidth(frame, s);
    ctx.beginPath();
    s.points.forEach(([x, z], i) => {
      const [px, py] = worldToMap(frame, x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  for (const b of level.buildings ?? []) {
    ctx.fillStyle = COLORS.building;
    ctx.beginPath();
    ringPath(ctx, frame, b.outer);
    for (const h of b.holes ?? []) ringPath(ctx, frame, h);
    ctx.fill("evenodd");
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return base;
}

// A park with no landmark spot: a green tree mark. The spots have their own
// icons (src/ui/spot-icon.js).
export function drawIcon(ctx, icon, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = COLORS.ink;
  ctx.fillStyle = "#7ef0a0";
  ctx.beginPath();
  ctx.moveTo(0, -8 * s);
  ctx.lineTo(7 * s, 5 * s);
  ctx.lineTo(-7 * s, 5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawArrow(ctx, x, y, angle, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -10 * s);
  ctx.lineTo(7 * s, 8 * s);
  ctx.lineTo(0, 4 * s);
  ctx.lineTo(-7 * s, 8 * s);
  ctx.closePath();
  ctx.fillStyle = COLORS.paper;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 2.5 * s;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function button(className, parent) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  parent.appendChild(b);
  return b;
}

// `parent` gets the map. `mode` ("north" | "heading") and `hidden` override
// the saved choice (for tests and links).
// `onExpand` opens the full map (the expand button, a click on the map).
// `source` gives the icons (landmark-icons.js createIconSource()); with none
// the map shows the parks only. `reducedMotion()` is true when a newly
// claimed icon must not pulse.
export function createMinimap(parent, level, { mode, hidden, viewMeters = MINIMAP.viewMeters, onExpand = null, source = createIconSource({ level }), reducedMotion = () => false } = {}) {
  const prefs = readPrefs();
  const state = {
    mode: mode ?? (prefs.mode === "heading" ? "heading" : "north"),
    hidden: hidden ?? Boolean(prefs.hidden),
    draws: 0,
    iconPx: 0, // the size of a spot icon, in CSS pixels
    pulses: 0, // the count of claim pulses that started
  };
  const frame = mapFrame(level.bounds);
  const base = drawMapBase(level, frame);
  let version = -1;
  let looks = null;
  // The start time (ms) of the pulse of each newly claimed icon.
  const pulses = new Map();

  const root = document.createElement("div");
  root.id = "minimap";
  const canvas = document.createElement("canvas");
  canvas.className = "minimap-canvas";
  canvas.setAttribute("role", "img");
  const modeBtn = button("minimap-mode", root);
  const hideBtn = button("minimap-toggle", root);
  const expandBtn = onExpand ? button("minimap-expand", root) : null;
  if (expandBtn) {
    expandBtn.textContent = "⤢";
    expandBtn.setAttribute("aria-label", "Open the full map (M key)");
  }
  root.prepend(canvas);
  parent.appendChild(root);
  const ctx = canvas.getContext("2d");

  let last = null;
  let lastView = null;
  let size = 0;
  let dpr = 1;

  function label() {
    const spots = mapSummary(source.view);
    canvas.setAttribute("aria-label", `Map of ${level.title ?? level.name}, ${state.mode === "heading" ? "heading up" : "north up"}. Arrow: you. ${spots ? `${spots} ` : ""}Triangles: parks. Wide pink line: the BeltLine trail.`);
  }

  function sync() {
    root.dataset.hidden = state.hidden ? "1" : "0";
    root.dataset.mode = state.mode;
    canvas.hidden = state.hidden;
    modeBtn.hidden = state.hidden;
    modeBtn.textContent = state.mode === "heading" ? "▲" : "N";
    modeBtn.setAttribute("aria-label", state.mode === "heading" ? "Map: heading up. Change to north up (N key)" : "Map: north up. Change to heading up (N key)");
    modeBtn.setAttribute("aria-pressed", String(state.mode === "heading"));
    if (expandBtn) expandBtn.hidden = state.hidden;
    hideBtn.textContent = state.hidden ? "Map" : "×";
    hideBtn.setAttribute("aria-label", state.hidden ? "Show the minimap" : "Hide the minimap");
    hideBtn.setAttribute("aria-expanded", String(!state.hidden));
    label();
    last = null;
    writePrefs({ mode: state.mode, hidden: state.hidden });
  }

  function setMode(m) {
    state.mode = m === "heading" ? "heading" : "north";
    sync();
  }
  function setHidden(h) {
    state.hidden = Boolean(h);
    sync();
  }

  // A tap or a click removes the focus, so the Space key jumps and does not
  // press the button again. A keyboard user keeps the focus.
  const tap = (fn) => (e) => {
    e.stopPropagation();
    fn();
    if (e.detail > 0) e.currentTarget.blur();
  };
  modeBtn.addEventListener("click", tap(() => setMode(state.mode === "north" ? "heading" : "north")));
  hideBtn.addEventListener("click", tap(() => setHidden(!state.hidden)));
  if (expandBtn) {
    expandBtn.addEventListener("click", tap(() => onExpand()));
    canvas.addEventListener("click", (e) => {
      e.stopPropagation();
      onExpand();
    });
  }
  const onKey = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyN" && !state.hidden) setMode(state.mode === "north" ? "heading" : "north");
  };
  window.addEventListener("keydown", onKey);

  function fit() {
    const css = canvas.clientWidth;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (css === size && ratio === dpr) return;
    size = css;
    dpr = ratio;
    canvas.width = Math.max(1, Math.round(css * ratio));
    canvas.height = canvas.width;
    last = null;
  }

  sync();

  return {
    root,
    canvas,
    state,
    get icons() {
      return source.icons;
    },
    frame,
    setMode,
    setHidden,
    // The spot icons of the last draw, in CSS pixels of the page (for the
    // tests). `shown` is false for an icon outside the round map.
    iconsOnScreen() {
      if (!lastView || state.hidden) return [];
      const r = canvas.getBoundingClientRect();
      const px = canvas.width;
      return source.icons
        .filter((i) => i.spot)
        .map((i) => {
          const [ix, iy] = projectToView(frame, lastView, i.x, i.z);
          const shown = Math.hypot(ix - px / 2, iy - px / 2) <= px / 2 - (8 * px) / 140;
          // The canvas has a border: its picture starts at clientLeft, clientTop.
          return { id: i.id, look: i.look, kind: i.kind, x: r.left + canvas.clientLeft + ix / dpr, y: r.top + canvas.clientTop + iy / dpr, size: state.iconPx, shown };
        });
    },
    // Called once per frame with the skater state.
    update(skater) {
      if (state.hidden) return;
      fit();
      const px = canvas.width;
      if (px < 2) return;
      const now = { x: skater.position[0], z: skater.position[2], yaw: skater.yaw, mode: state.mode };
      const icons = source.icons;
      const time = performance.now();
      if (source.version !== version) {
        // A spot changed: new icons, a new label, and a pulse for a claim.
        version = source.version;
        if (!reducedMotion()) {
          for (const id of newlyClaimed(looks, icons)) {
            pulses.set(id, time);
            state.pulses += 1;
          }
        }
        looks = looksOf(icons);
        label();
        last = null;
      }
      if (!needsRedraw(last, now, { pxPerMeter: px / viewMeters }) && pulses.size === 0) return;
      last = now;
      state.draws += 1;

      const view = viewTransform(frame, now, { mode: state.mode, size: px, viewMeters });
      lastView = view;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = COLORS.ground;
      ctx.fillRect(0, 0, px, px);
      // Only the base image part inside the circle (radius: half the view
      // diagonal, in base pixels).
      const [mx, my] = worldToMap(frame, now.x, now.z);
      const crop = cropRect(frame, mx, my, (viewMeters * frame.scale) / Math.SQRT2 + 2);
      ctx.setTransform(...view.matrix);
      ctx.imageSmoothingEnabled = true;
      if (crop) ctx.drawImage(base, crop.x, crop.y, crop.w, crop.h, crop.x, crop.y, crop.w, crop.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const s = px / 140;
      state.iconPx = minimapIconSize(size);
      const iconSize = state.iconPx * dpr;
      for (const icon of icons) {
        const [ix, iy] = projectToView(frame, view, icon.x, icon.z);
        const r = Math.hypot(ix - px / 2, iy - px / 2);
        if (r > px / 2 - 8 * s) continue;
        if (!icon.spot) {
          drawIcon(ctx, icon, ix, iy, s);
          continue;
        }
        let pulse = null;
        if (pulses.has(icon.id)) {
          pulse = pulseAt((time - pulses.get(icon.id)) / 1000, { reducedMotion: reducedMotion() });
          if (!pulse) pulses.delete(icon.id);
        }
        // The arrow of an edge marker points out of the map, on the screen.
        let angle = 0;
        if (icon.out) {
          const [ox, oy] = projectToView(frame, view, icon.x + icon.out[0] * 10, icon.z + icon.out[1] * 10);
          angle = Math.atan2(oy - iy, ox - ix);
        }
        drawSpotIcon(ctx, icon, ix, iy, iconSize, { angle, pulse });
      }
      // A pulse of an icon that is off the map ends by its time.
      for (const [id, t0] of pulses) if (time - t0 > 2000) pulses.delete(id);

      // The "N" mark on the edge, in heading up mode.
      if (state.mode === "heading") {
        const r = px / 2 - 10 * s;
        const nx = px / 2 + Math.sin(view.north) * r;
        const ny = px / 2 - Math.cos(view.north) * r;
        ctx.fillStyle = COLORS.ink;
        ctx.beginPath();
        ctx.arc(nx, ny, 8 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.paper;
        ctx.font = `700 ${Math.round(10 * s)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("N", nx, ny + 0.5 * s);
      }
      drawArrow(ctx, px / 2, px / 2, view.arrow, s);
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}
