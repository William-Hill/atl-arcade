// The minimap (#86): a 2D canvas in a corner of the HUD. The level is drawn
// once to a base image (footprints, streets, the trail, parks). Each frame
// draws only the part of that image around the skater, moved and turned,
// then the landmark icons and the skater arrow. The 3D scene is not drawn
// a second time. The math is in src/ui/minimap-math.js.
//
// Keys: M shows or hides the map. N changes north up and heading up.

import { MINIMAP, cropRect, mapFrame, mapLandmarks, needsRedraw, projectToView, stripWidth, stripsInOrder, viewTransform, worldToMap } from "./minimap-math.js";

const COLORS = {
  ground: "#1d2033",
  park: "#2f6b45",
  sidewalk: "#3a3e55",
  street: "#565b78",
  path: "#9a8d63",
  trail: "#ff5fb2",
  building: "#c3c6dd",
  landmarkBuilding: "#ffd166",
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

// Draws the level to a new canvas, one time.
function drawBase(level, frame, landmarkNames) {
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
    const landmark = landmarkNames.has(b.name);
    ctx.fillStyle = landmark ? COLORS.landmarkBuilding : COLORS.building;
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

// A landmark: a gold disc with its initials. A park: a green tree mark.
// The two kinds have different shapes, so they do not differ by color only.
function drawIcon(ctx, icon, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = COLORS.ink;
  if (icon.kind === "landmark") {
    ctx.fillStyle = COLORS.landmarkBuilding;
    ctx.beginPath();
    ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${Math.round(8 * s)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon.label, 0, 0.5 * s);
  } else {
    ctx.fillStyle = "#7ef0a0";
    ctx.beginPath();
    ctx.moveTo(0, -8 * s);
    ctx.lineTo(7 * s, 5 * s);
    ctx.lineTo(-7 * s, 5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawArrow(ctx, x, y, angle, s) {
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
export function createMinimap(parent, level, { mode, hidden, viewMeters = MINIMAP.viewMeters } = {}) {
  const prefs = readPrefs();
  const state = {
    mode: mode ?? (prefs.mode === "heading" ? "heading" : "north"),
    hidden: hidden ?? Boolean(prefs.hidden),
    draws: 0,
  };
  const frame = mapFrame(level.bounds);
  const icons = mapLandmarks(level);
  const base = drawBase(level, frame, new Set(icons.filter((i) => i.kind === "landmark").map((i) => i.name)));

  const root = document.createElement("div");
  root.id = "minimap";
  const canvas = document.createElement("canvas");
  canvas.className = "minimap-canvas";
  canvas.setAttribute("role", "img");
  const modeBtn = button("minimap-mode", root);
  const hideBtn = button("minimap-toggle", root);
  root.prepend(canvas);
  parent.appendChild(root);
  const ctx = canvas.getContext("2d");

  let last = null;
  let size = 0;
  let dpr = 1;

  function label() {
    const names = icons.filter((i) => i.kind === "landmark").map((i) => i.name);
    canvas.setAttribute("aria-label", `Map of ${level.title ?? level.name}, ${state.mode === "heading" ? "heading up" : "north up"}. Arrow: you. Gold discs: ${names.join(", ")}. Triangles: parks. Wide pink line: the BeltLine trail.`);
  }

  function sync() {
    root.dataset.hidden = state.hidden ? "1" : "0";
    root.dataset.mode = state.mode;
    canvas.hidden = state.hidden;
    modeBtn.hidden = state.hidden;
    modeBtn.textContent = state.mode === "heading" ? "▲" : "N";
    modeBtn.setAttribute("aria-label", state.mode === "heading" ? "Map: heading up. Change to north up (N key)" : "Map: north up. Change to heading up (N key)");
    modeBtn.setAttribute("aria-pressed", String(state.mode === "heading"));
    hideBtn.textContent = state.hidden ? "Map" : "×";
    hideBtn.setAttribute("aria-label", state.hidden ? "Show the map (M key)" : "Hide the map (M key)");
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
  const onKey = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyM") setHidden(!state.hidden);
    else if (e.code === "KeyN" && !state.hidden) setMode(state.mode === "north" ? "heading" : "north");
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
    icons,
    frame,
    setMode,
    setHidden,
    // Called once per frame with the skater state.
    update(skater) {
      if (state.hidden) return;
      fit();
      const px = canvas.width;
      if (px < 2) return;
      const now = { x: skater.position[0], z: skater.position[2], yaw: skater.yaw, mode: state.mode };
      if (!needsRedraw(last, now, { pxPerMeter: px / viewMeters })) return;
      last = now;
      state.draws += 1;

      const view = viewTransform(frame, now, { mode: state.mode, size: px, viewMeters });
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
      for (const icon of icons) {
        const [ix, iy] = projectToView(frame, view, icon.x, icon.z);
        const r = Math.hypot(ix - px / 2, iy - px / 2);
        if (r > px / 2 - 8 * s) continue;
        drawIcon(ctx, icon, ix, iy, s);
      }

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
