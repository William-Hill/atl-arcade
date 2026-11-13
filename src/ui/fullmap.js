// The full map: a large map of the whole level over the game, as in an
// open-world game. It opens at the overview of the level. The player drags
// to pan and uses the wheel, a pinch, or the buttons to zoom. It shows the
// footprints, the streets and their names, the trail, the parks, the
// landmark spots, and the skater. The game stops while the map is open
// (src/main.js).
//
// Landmark spots (#218, design/gdd/landmark-discovery.md): each spot has an
// icon for its state (src/ui/spot-icon.js). A click or a tap on a spot, or
// its row in the Guide tab, opens its panel: "Not found yet" (Unknown), the
// `short` line and "Claim it to unlock" (Found), or the facts with their
// sources (Claimed, or an edge marker that is Found). The Guide tab lists
// the spots by kind with the 2 counts. The panel closes with Escape, its
// close button, or a tap outside it.
//
// Keys: M closes the map. Escape closes the open panel, or else the map.
// G opens and closes the Guide tab. The arrow keys or W A S D pan. + and -
// zoom. C centers the map on the skater. Tab moves the focus; Enter or
// Space presses the focused button. The math is in src/ui/fullmap-math.js.
//
// Two layers: the plan (the minimap drawing, src/ui/minimap.js
// drawMapBase(), at a higher resolution, made the first time the map opens)
// and the isometric map (the baked tiles of src/ui/iso-tiles.js), when the
// level has a bake. V or the layer button changes the layer. Each layer has
// its own map space: the plan uses world x and z, the isometric map uses
// the image plane (src/level/geo/iso-map.js). The icons, the names, and the
// skater are projected into the map space of the layer.

import { COLORS, drawArrow, drawIcon, drawMapBase } from "./minimap.js";
import { ICON_SIZE, createIconSource, looksOf, mapSummary, namePlace, newlyClaimed, pulseAt, rectsOverlap, spotPanel } from "./landmark-icons.js";
import { createGuide, createSpotCard } from "./landmark-guide.js";
import { drawSpotIcon, iconCanvas } from "./spot-icon.js";
import { canTravelTo, travelHint } from "./travel-rule.js";
import { mapFrame } from "./minimap-math.js";
import { FULLMAP, baseTransform, clampView, fitView, isoBounds, isoLevelFor, labelFits, nearestIcon, panBy, screenToWorld, streetLabelSpots, visibleTiles, worldToScreen, zoomAt } from "./fullmap-math.js";
import { isoBasis, isoProject, isoUnproject } from "../level/geo/iso-map.js";

// The sky color of the baked isometric map, around the level.
const ISO_BACKGROUND = "#b6dbf2";

function el(tag, className, parent, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// `source` gives the icons and the landmark view (landmark-icons.js
// createIconSource()); with none the map shows the parks only. `freeRun` is
// true in a run with no timer, where no spot can be claimed.
// `reducedMotion()` is true when a newly claimed icon must not pulse.
// `onChange(open)` is called when the map opens or closes. `canOpen()` is
// false while another screen (photo mode) is open. `iso` is the bake of the
// level (src/ui/iso-tiles.js isoTilesFor()) or null. `groundAt(x, z)` is the
// ground height, to place the icons on the isometric map.
// `onTravel(x, z)` turns on fast travel (a debug and play-test aid): a click
// picks a place or an icon, and "Travel here" or T moves the skater there.
// `travelMode` limits the picks (src/ui/travel-rule.js, #271): "any" (the
// default) or "found" (only Found or Claimed spots).
// Null turns it off.
export function createFullMap(parent, level, { source = createIconSource({ level }), onChange = () => {}, canOpen = () => true, iso = null, groundAt = () => 0, onTravel = null, travelMode = "any", freeRun = false, reducedMotion = () => false } = {}) {
  const bounds = level.bounds;
  const spots = streetLabelSpots(level.strips);
  // `card` is the id of the spot whose panel is open. `tab` is "map" or
  // "guide". `pulses` counts the claim pulses that started.
  const state = { open: false, view: null, draws: 0, selected: null, layer: iso ? "iso" : "plan", target: null, travel: Boolean(onTravel), tab: "map", card: null, iconPx: ICON_SIZE.fullmap, pulses: 0 };
  const hasSpots = () => Boolean(source.view && source.view.spots.length);
  // The looks at the last sync. A spot that is claimed while the map is
  // closed pulses when the map opens the next time.
  let version = source.version;
  let looks = looksOf(source.icons);
  // The start time (ms) of the pulse of each newly claimed icon.
  const pulses = new Map();
  const basis = iso ? isoBasis(iso.info.yaw, iso.info.pitch) : null;
  // The map space point of a world point, for the current layer.
  function toMap(x, y, z) {
    if (state.layer !== "iso") return [x, z];
    const [a, b] = isoProject(basis, x, y, z);
    return [a, -b];
  }
  // The world point [x, z] of a map space point, on the ground.
  function toWorld(mx, mz) {
    if (state.layer !== "iso") return [mx, mz];
    const p = isoUnproject(basis, mx, -mz, groundAt);
    return [p[0], p[2]];
  }
  const mapBounds = () => (state.layer === "iso" ? isoBounds(iso.info) : bounds);
  // The loaded tile images, by URL. A tile draws when its image is ready.
  const images = new Map();
  function tileImage(url) {
    let img = images.get(url);
    if (!img) {
      img = new Image();
      img.decoding = "async";
      img.onload = () => {
        dirty = true;
      };
      img.src = url;
      images.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
  let base = null;
  let frame = null;
  let skater = null;
  let dirty = true;

  const root = el("div", "fullmap", null);
  root.id = "fullmap";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", `Map of ${level.title ?? level.name}`);
  const canvas = el("canvas", "fullmap-canvas", root);
  canvas.setAttribute("role", "img");
  const head = el("div", "fullmap-head", root);
  el("div", "fullmap-title", head, level.title ?? level.name);
  el("div", "fullmap-hint", head, `Drag to move · wheel or pinch to zoom · C: center${iso ? " · V: 2D or 3D" : ""}${onTravel ? travelHint(travelMode) : ""} · M: close`);
  // The tabs: the map alone, or the map with the Guide list.
  const tabs = el("div", "fullmap-tabs", head);
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Map views");
  tabs.hidden = !hasSpots();
  const mapTab = el("button", "fullmap-tab", tabs, "Map");
  const guideTab = el("button", "fullmap-tab", tabs, "Guide");
  mapTab.id = "fullmap-tab-map";
  guideTab.id = "fullmap-tab-guide";
  for (const t of [mapTab, guideTab]) {
    t.type = "button";
    t.setAttribute("role", "tab");
  }
  guideTab.setAttribute("aria-controls", "fullmap-guide");
  guideTab.setAttribute("aria-keyshortcuts", "G");
  const closeBtn = el("button", "fullmap-close", head, "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close the map (M or Escape)");
  const tools = el("div", "fullmap-tools", root);
  const zoomIn = el("button", "fullmap-zoom-in", tools, "+");
  const zoomOut = el("button", "fullmap-zoom-out", tools, "−");
  const center = el("button", "fullmap-center", tools, "◎");
  const layerBtn = iso ? el("button", "fullmap-layer", tools, "") : null;
  if (layerBtn) layerBtn.type = "button";
  zoomIn.setAttribute("aria-label", "Zoom in (+ key)");
  zoomOut.setAttribute("aria-label", "Zoom out (- key)");
  center.setAttribute("aria-label", "Center on the skater (C key)");
  for (const b of [zoomIn, zoomOut, center]) b.type = "button";
  const info = el("div", "fullmap-info", root);
  info.hidden = true;
  const infoText = el("span", "fullmap-info-text", info);
  infoText.setAttribute("aria-live", "polite");
  const travelBtn = onTravel ? el("button", "fullmap-travel", info, "Travel here (T)") : null;
  if (travelBtn) travelBtn.type = "button";
  const guide = createGuide(root, { onPick: (id, e) => openSpot(id, { from: e.currentTarget, center: true }) });
  const card = createSpotCard(root, { onClose: () => closeCard() });
  const legend = el("div", "fullmap-legend", root);
  const legendRows = [["you", "You"]];
  if (hasSpots()) legendRows.push(["unknown", "Spot: not found yet"], ["found", "Spot: found"], ["claimed", "Spot: claimed"], ["edge", "Past the map edge"]);
  legendRows.push(["park", "Park"], ["trail", "BeltLine trail"]);
  for (const [cls, text] of legendRows) {
    const row = el("div", "fullmap-legend-row", legend);
    row.dataset.key = cls;
    // A spot key is the icon itself, so the legend and the map agree.
    if (["unknown", "found", "claimed", "edge"].includes(cls)) row.appendChild(iconCanvas({ kind: cls === "edge" ? "edge" : "building", look: cls }, 16));
    else el("span", `fullmap-key fullmap-key-${cls}`, row);
    el("span", null, row, text);
  }
  parent.appendChild(root);
  const ctx = canvas.getContext("2d");

  function size() {
    return { w: canvas.clientWidth, h: canvas.clientHeight, dpr: Math.min(2, window.devicePixelRatio || 1) };
  }

  function setView(v) {
    const { w, h } = size();
    state.view = clampView(v, mapBounds(), w, h);
    dirty = true;
  }

  // The element that opened the panel, to give the focus back on close.
  let cardFrom = null;

  // `target` is the world point for fast travel: the icon, or a place. A
  // landmark spot opens its panel; a park or a place shows the info line.
  function select(icon, target = icon ? { x: icon.x, z: icon.z } : null) {
    const spot = icon ? (source.view?.spots.find((sp) => sp.id === icon.id) ?? null) : null;
    state.selected = icon;
    state.target = onTravel && canTravelTo(travelMode, spot) ? target : null;
    if (travelBtn) travelBtn.hidden = !state.target;
    state.card = spot ? spot.id : null;
    if (spot) {
      card.show(spotPanel(spot, source.card(spot.id), { freeRun }));
      // The foot stays empty (and hidden by CSS) when the spot is no target.
      if (travelBtn) {
        if (state.target) card.foot.appendChild(travelBtn);
        else travelBtn.remove();
      }
    } else {
      card.hide();
      cardFrom = null;
      if (travelBtn) info.appendChild(travelBtn);
    }
    info.hidden = Boolean(spot) || (!icon && !state.target);
    infoText.textContent = icon && !spot ? `${icon.name} · Park` : state.target ? "This place" : "";
    dirty = true;
  }

  // Opens the panel of a spot. `from` is the element that gets the focus
  // back when the panel closes. `center` moves the map to the spot.
  function openSpot(id, { from = null, center = false } = {}) {
    const icon = source.icons.find((i) => i.spot && i.id === id);
    if (!icon) return false;
    select(icon);
    cardFrom = from;
    if (center && state.view) {
      const [x, z] = toMap(icon.x, groundAt(icon.x, icon.z), icon.z);
      setView({ ...state.view, x, z });
    }
    // A press on a Guide row moves the focus into the panel; closeCard()
    // gives it back to the row.
    if (from) card.closeBtn.focus({ preventScroll: true });
    return true;
  }

  function closeCard() {
    if (!state.card) return;
    const from = cardFrom;
    select(null, null);
    if (from) (guide.row(from.dataset?.spot) ?? from).focus?.({ preventScroll: true });
  }

  function setTab(tab) {
    state.tab = tab === "guide" && hasSpots() ? "guide" : "map";
    const on = state.tab === "guide";
    guide.root.hidden = !on;
    root.dataset.tab = state.tab;
    mapTab.setAttribute("aria-selected", String(!on));
    guideTab.setAttribute("aria-selected", String(on));
    if (on) guide.render(source.view);
  }
  setTab("map");

  // A spot changed: the Guide rows, the open panel, and a pulse for a claim.
  function syncSpots(time) {
    if (source.version === version) return;
    version = source.version;
    const icons = source.icons;
    if (!reducedMotion()) {
      for (const id of newlyClaimed(looks, icons)) {
        pulses.set(id, time);
        state.pulses += 1;
      }
    }
    looks = looksOf(icons);
    if (state.tab === "guide") guide.render(source.view);
    if (state.card) {
      const icon = icons.find((i) => i.id === state.card);
      const from = cardFrom;
      // A spot can become a target here (for example Unknown to Found in
      // the "found" travel mode), so the target is the icon again.
      select(icon ?? null, icon ? { x: icon.x, z: icon.z } : null);
      cardFrom = from;
    }
    dirty = true;
  }

  function travel() {
    if (!onTravel || !state.target) return;
    const { x, z } = state.target;
    close();
    onTravel(x, z);
  }

  function open() {
    if (state.open || !canOpen()) return;
    if (!base) {
      frame = mapFrame(bounds, { pxPerMeter: FULLMAP.pxPerMeter, maxTexture: FULLMAP.maxTexture });
      base = drawMapBase(level, frame);
    }
    state.open = true;
    root.hidden = false;
    setTab(state.tab);
    const { w, h } = size();
    state.view = fitView(mapBounds(), w, h);
    select(null);
    dirty = true;
    onChange(true);
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    root.hidden = true;
    onChange(false);
  }

  function centerOnSkater() {
    if (!skater) return;
    const [x, z] = toMap(...skater.position);
    setView({ x, z, zoom: Math.max(state.view.zoom, 2) });
  }

  function syncLayer() {
    if (!layerBtn) return;
    layerBtn.textContent = state.layer === "iso" ? "2D" : "3D";
    layerBtn.setAttribute("aria-label", state.layer === "iso" ? "Show the plan map (V key)" : "Show the 3D map (V key)");
  }
  function setLayer(layer) {
    if (!iso) return;
    state.layer = layer === "plan" ? "plan" : "iso";
    syncLayer();
    if (state.open) {
      const { w, h } = size();
      state.view = fitView(mapBounds(), w, h);
      select(null);
      dirty = true;
    }
  }
  syncLayer();

  // The icons in the map space of the current layer, on the ground.
  function mappedIcons() {
    return source.icons.map((i) => {
      const [x, z] = toMap(i.x, groundAt(i.x, i.z), i.z);
      return { ...i, x, z };
    });
  }

  function zoomBy(factor, sx, sy) {
    const { w, h } = size();
    setView(zoomAt(state.view, w, h, sx ?? w / 2, sy ?? h / 2, factor));
  }

  // A tap or a click removes the focus, so a later Space does not press it.
  const tap = (fn) => (e) => {
    e.stopPropagation();
    fn();
    if (e.detail > 0) e.currentTarget.blur();
  };
  closeBtn.addEventListener("click", tap(close));
  zoomIn.addEventListener("click", tap(() => zoomBy(FULLMAP.step)));
  zoomOut.addEventListener("click", tap(() => zoomBy(1 / FULLMAP.step)));
  center.addEventListener("click", tap(centerOnSkater));
  if (layerBtn) layerBtn.addEventListener("click", tap(() => setLayer(state.layer === "iso" ? "plan" : "iso")));
  if (travelBtn) travelBtn.addEventListener("click", tap(travel));
  mapTab.addEventListener("click", (e) => {
    e.stopPropagation();
    setTab("map");
  });
  guideTab.addEventListener("click", (e) => {
    e.stopPropagation();
    setTab(state.tab === "guide" ? "map" : "guide");
  });
  // A tap outside the open panel closes it. The canvas has its own rule
  // (below): a tap on another spot opens that spot, and a drag keeps it.
  root.addEventListener("pointerdown", (e) => {
    if (!state.card || e.target === canvas || !(e.target instanceof Element)) return;
    // The Guide list is not "outside": a drag there scrolls the list, and a
    // row opens its own spot.
    if (card.root.contains(e.target) || e.target.closest(".fullmap-guide")) return;
    closeCard();
  });

  // The keys go to the map only while it is open. The capture phase and
  // stopImmediatePropagation keep them from the game and from photo mode.
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!state.open) {
      if (e.code === "KeyM" && !e.repeat && canOpen()) {
        e.preventDefault();
        open();
      }
      return;
    }
    const on = e.target instanceof Element ? e.target : null;
    // Enter or Space presses the focused button or follows the focused link.
    // The key stays out of the game, but the browser still does the press.
    if ((e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") && on?.closest("button, a")) {
      e.stopImmediatePropagation();
      return;
    }
    // In a list or a panel the arrow keys scroll it; they do not pan the map.
    if (e.code.startsWith("Arrow") && on?.closest(".fullmap-guide, .fullmap-card")) {
      e.stopImmediatePropagation();
      return;
    }
    const { w, h } = size();
    const step = Math.min(w, h) * FULLMAP.pan;
    let used = true;
    if (e.code === "Escape" && !e.repeat && state.card) closeCard();
    else if ((e.code === "KeyM" || e.code === "Escape") && !e.repeat) close();
    else if (e.code === "KeyG" && !e.repeat && hasSpots()) {
      setTab(state.tab === "guide" ? "map" : "guide");
      if (state.tab === "guide") guideTab.focus({ preventScroll: true });
    } else if (e.code === "ArrowLeft" || e.code === "KeyA") setView(panBy(state.view, step, 0));
    else if (e.code === "ArrowRight" || e.code === "KeyD") setView(panBy(state.view, -step, 0));
    else if (e.code === "ArrowUp" || e.code === "KeyW") setView(panBy(state.view, 0, step));
    else if (e.code === "ArrowDown" || e.code === "KeyS") setView(panBy(state.view, 0, -step));
    else if (e.code === "Equal" || e.code === "NumpadAdd") zoomBy(FULLMAP.step);
    else if (e.code === "Minus" || e.code === "NumpadSubtract") zoomBy(1 / FULLMAP.step);
    else if (e.code === "KeyC") centerOnSkater();
    else if (e.code === "KeyV" && !e.repeat) setLayer(state.layer === "iso" ? "plan" : "iso");
    else if (e.code === "KeyT" && !e.repeat && state.target) travel();
    else if (e.code === "Tab") used = false;
    if (used) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  window.addEventListener("keydown", onKey, true);
  // Key releases also stay in the map, so the game does not see a release
  // without a press.
  const onKeyUp = (e) => {
    if (state.open && e.code !== "Tab") e.stopImmediatePropagation();
  };
  window.addEventListener("keyup", onKeyUp, true);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );

  // Pointers: one pointer drags, two pointers pinch. A short press with no
  // drag is a click: it selects the nearest icon.
  const pointers = new Map();
  let moved = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const r = canvas.getBoundingClientRect();
    if (pointers.size === 1) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      setView(panBy(state.view, dx, dy));
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const other = a === p ? b : a;
      const before = Math.hypot(p.x - other.x, p.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      moved += Math.abs(after - before);
      if (before > 0) zoomBy(after / before, (e.clientX + other.x) / 2 - r.left, (e.clientY + other.y) / 2 - r.top);
    }
    p.x = e.clientX;
    p.y = e.clientY;
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && moved < 6 && e.type === "pointerup") {
      const r = canvas.getBoundingClientRect();
      const { w, h } = size();
      const [x, z] = screenToWorld(state.view, w, h, e.clientX - r.left, e.clientY - r.top);
      const hit = nearestIcon(mappedIcons(), x, z, 18 / state.view.zoom);
      if (hit) {
        select(source.icons.find((i) => i.id === hit.id));
        cardFrom = null;
      } else if (state.card) closeCard();
      else {
        const [wx, wz] = toWorld(x, z);
        select(null, { x: wx, z: wz });
      }
    }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  window.addEventListener("resize", () => {
    if (state.open) setView(state.view);
  });

  function fit() {
    const { w, h, dpr } = size();
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      dirty = true;
    }
    return { w, h, dpr };
  }

  function draw() {
    const { w, h, dpr } = fit();
    const view = state.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = state.layer === "iso" ? ISO_BACKGROUND : COLORS.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state.layer === "iso") {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      // The coarsest level first, so no hole shows while a finer tile loads.
      const info = iso.info;
      const fine = isoLevelFor(view.zoom, info);
      for (const lvl of fine === info.levels - 1 ? [fine] : [info.levels - 1, fine]) {
        for (const t of visibleTiles(view, w, h, info, lvl)) {
          const img = tileImage(iso.url(lvl, t.col, t.row));
          // A half pixel more on each side hides the hairline between tiles.
          if (img) ctx.drawImage(img, t.x - 0.5, t.y - 0.5, t.size + 1, t.size + 1);
        }
      }
    } else {
      ctx.setTransform(...baseTransform(frame, view, canvas.width, canvas.height, dpr));
      // Sharp pixels when the base image is magnified a lot, smooth otherwise.
      ctx.imageSmoothingEnabled = view.zoom / frame.scale < 2.5;
      ctx.drawImage(base, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The screen point of a world point.
    const screenOf = (x, y, z) => worldToScreen(view, w, h, ...toMap(x, y, z));

    // The street names, longest street first, with no overlap.
    const placed = [];
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const s of spots) {
      const tw = ctx.measureText(s.name).width;
      if (!labelFits(s, view.zoom, tw)) continue;
      const gy = groundAt(s.x, s.z);
      const [sx, sy] = screenOf(s.x, gy, s.z);
      // The street direction on the screen, upright.
      const [ex, ey] = screenOf(s.x + Math.cos(s.angle) * 10, gy, s.z + Math.sin(s.angle) * 10);
      let angle = Math.atan2(ey - sy, ex - sx);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      if (sx < -tw || sx > w + tw || sy < -20 || sy > h + 20) continue;
      const hw = (Math.abs(Math.cos(angle)) * tw) / 2 + 8;
      const hh = (Math.abs(Math.sin(angle)) * tw) / 2 + 8;
      const rect = { x0: sx - hw, x1: sx + hw, y0: sy - hh, y1: sy + hh };
      if (placed.some((r) => rectsOverlap(r, rect))) continue;
      placed.push(rect);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 3;
      ctx.strokeText(s.name, 0, 0);
      ctx.fillStyle = COLORS.paper;
      ctx.fillText(s.name, 0, 0);
      ctx.restore();
    }

    // The icons. A spot that is Found or Claimed has its name beside it,
    // where the name does not cover another name. An Unknown spot has none.
    const s = 1.3;
    const time = performance.now();
    // A spot name does not cover a street name either.
    const names = [...placed];
    ctx.font = "700 13px system-ui, sans-serif";
    for (const icon of source.icons) {
      const gy = groundAt(icon.x, icon.z);
      const [ix, iy] = screenOf(icon.x, gy, icon.z);
      if (ix < -40 || ix > w + 40 || iy < -40 || iy > h + 40) continue;
      const chosen = state.selected && icon.id === state.selected.id;
      if (icon.spot) {
        let pulse = null;
        if (pulses.has(icon.id)) {
          pulse = pulseAt((time - pulses.get(icon.id)) / 1000, { reducedMotion: reducedMotion() });
          if (!pulse) pulses.delete(icon.id);
        }
        // The arrow of an edge marker points out of the map, on the screen.
        let angle = 0;
        if (icon.out) {
          const [ox, oy] = screenOf(icon.x + icon.out[0] * 10, gy, icon.z + icon.out[1] * 10);
          angle = Math.atan2(oy - iy, ox - ix);
        }
        drawSpotIcon(ctx, icon, ix, iy, state.iconPx, { angle, pulse });
      } else drawIcon(ctx, icon, ix, iy, s);
      if (icon.name && (icon.spot || chosen)) {
        const place = namePlace(ix, iy, ctx.measureText(icon.name).width, w, names, { force: Boolean(chosen) });
        if (place) {
          names.push(place.rect);
          ctx.textAlign = place.align;
          ctx.textBaseline = "middle";
          ctx.strokeStyle = COLORS.ink;
          ctx.lineWidth = 3.5;
          ctx.strokeText(icon.name, place.x, iy);
          ctx.fillStyle = icon.spot ? COLORS.paper : "#7ef0a0";
          ctx.fillText(icon.name, place.x, iy);
        }
      }
      if (chosen) {
        ctx.strokeStyle = COLORS.paper;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ix, iy, 19, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // A pulse of an icon that is off the screen ends by its time, so the map
    // does not draw every frame for it.
    for (const [id, t0] of pulses) if (time - t0 > 2000) pulses.delete(id);

    // The fast travel target, when it is a place and not an icon.
    if (state.target && !state.selected) {
      const [tx, ty] = screenOf(state.target.x, groundAt(state.target.x, state.target.z), state.target.z);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 6;
      for (const sw of [6, 3]) {
        ctx.lineWidth = sw;
        ctx.strokeStyle = sw === 6 ? COLORS.ink : COLORS.trail;
        ctx.beginPath();
        ctx.moveTo(tx - 9, ty - 9);
        ctx.lineTo(tx + 9, ty + 9);
        ctx.moveTo(tx + 9, ty - 9);
        ctx.lineTo(tx - 9, ty + 9);
        ctx.stroke();
      }
    }

    if (skater) {
      const [ax, ay] = screenOf(...skater.position);
      // The heading on the screen: the skater forward direction is
      // (cos yaw, -sin yaw) in x and z (src/sim/skate/controller.js).
      const [hx, hy] = screenOf(skater.position[0] + Math.cos(skater.yaw) * 5, skater.position[1], skater.position[2] - Math.sin(skater.yaw) * 5);
      const heading = Math.atan2(hx - ax, -(hy - ay));
      // A ring around the arrow, so the player finds it at the overview.
      ctx.strokeStyle = COLORS.trail;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ax, ay, 20, 0, Math.PI * 2);
      ctx.stroke();
      drawArrow(ctx, ax, ay, heading, 1.4);
    }
    canvas.setAttribute("aria-label", `Map of ${level.title ?? level.name}. ${mapSummary(source.view)}`.trim());
    state.draws += 1;
  }

  return {
    root,
    canvas,
    state,
    get isOpen() {
      return state.open;
    },
    open,
    close,
    toggle: () => (state.open ? close() : open()),
    setView,
    setLayer,
    select,
    travel,
    setTab,
    openSpot,
    closeCard,
    // The spot icons on the screen, in CSS pixels (for the tests).
    iconsOnScreen() {
      if (!state.view) return [];
      const { w, h } = size();
      const r = canvas.getBoundingClientRect();
      return source.icons
        .filter((i) => i.spot)
        .map((i) => {
          const [x, y] = worldToScreen(state.view, w, h, ...toMap(i.x, groundAt(i.x, i.z), i.z));
          return { id: i.id, look: i.look, kind: i.kind, x: x + r.left, y: y + r.top, size: state.iconPx };
        });
    },
    // Called once per frame with the skater state. Draws only when open and
    // when something changed.
    update(s) {
      skater = s;
      if (!state.open) return;
      syncSpots(performance.now());
      const { w, h } = size();
      if (state.view && (canvas.width !== Math.round(w * Math.min(2, window.devicePixelRatio || 1)) || dirty || pulses.size > 0)) {
        dirty = false;
        draw();
      }
    },
    dispose() {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      root.remove();
    },
  };
}
