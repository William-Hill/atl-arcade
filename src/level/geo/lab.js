// The asset lab: fixed camera views of one building, for the art loop
// (docs/art-loop/judge.md, docs/art-loop/director.md). Pure.
//
// A lab view is a normal `?view=fixed&cam=` camera, computed from the
// building footprint, so the building shows in the real renderer with its
// real street around it. The views go from close to far, as the judge brief
// asks: facade (8 m), street (25 m), corner (35 m), mid (70 m), far (250 m),
// and aerial.
//
// ?lab=building&kind=<style>&pick=<n>&labview=<view> in the shell picks the
// camera. pick 0 is the most typical building of that style: the one with
// the height nearest the style median.

import { STYLE_INDEX, chooseStyle } from "./styles.js";
import { frontEdges } from "./facade-kit.js";
import { orientRing } from "./extrude.js";

export const LAB_VIEWS = ["facade", "street", "corner", "mid", "far", "aerial"];

// The smallest building the lab shows (m). Smaller ones are sheds and kiosks.
const MIN_HEIGHT = 5;
// A lab building stands at least this far (m) inside the box of all the
// buildings, so the far views do not show the edge of the level.
export const LAB_MARGIN = 150;

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const [px, pz] of ring) {
    x += px;
    z += pz;
  }
  return [x / ring.length, z / ring.length];
}

// Pure: the buildings of one style, most typical first.
export function labBuildings(level, kind) {
  if (kind && STYLE_INDEX[kind] === undefined) throw new Error(`lab: no building style "${kind}"`);
  const every = (level.buildings ?? []).filter((b) => b.outer?.length >= 3);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of every) {
    const [x, z] = centroid(b.outer);
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], z);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], z);
  }
  const inner = (b) => {
    const [x, z] = centroid(b.outer);
    return Math.min(x - box[0], z - box[1], box[2] - x, box[3] - z) >= LAB_MARGIN;
  };
  const all = every.filter((b) => b.height >= MIN_HEIGHT && inner(b));
  const list = kind ? all.filter((b) => chooseStyle(b) === kind) : all;
  if (!list.length) return [];
  const heights = list.map((b) => b.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  return list.slice().sort((a, b) => Math.abs(a.height - median) - Math.abs(b.height - median) || (a.id < b.id ? -1 : 1));
}

// Pure: the front of a building, with the outward normal. With `front`
// (an entry of frontEdges() in facade-kit.js) it is the wall that the kit
// gives the shop front and the sign band, so the camera sees that wall.
// Without it, it is the longest wall.
export function labFront(b, front = null) {
  const ring = front ? orientRing(b.outer, false) : b.outer;
  let best = null;
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(qx - px, qz - pz);
    if (front ? i === front.edge : !best || len > best.len) best = { len, p: [px, pz], q: [qx, qz] };
  }
  const mid = [(best.p[0] + best.q[0]) / 2, (best.p[1] + best.q[1]) / 2];
  const dir = [(best.q[0] - best.p[0]) / best.len, (best.q[1] - best.p[1]) / best.len];
  let n = [-dir[1], dir[0]];
  // Flip the normal when a point just in front of the edge is inside.
  if (pointInRing(mid[0] + n[0] * 0.5, mid[1] + n[1] * 0.5, ring)) n = [-n[0], -n[1]];
  return { mid, dir, normal: n, length: best.len };
}

// The preset for each view: the distance out from the front (m), the side
// offset along the front (m), the eye height (m), and the look height as a
// fraction of the building height (with a cap in m).
const PRESETS = {
  facade: { d: 8, side: 0, y: 1.7, look: [0.5, 6] },
  street: { d: 25, side: -6, y: 1.7, look: [0.45, 12] },
  corner: { d: 35, side: -35, y: 6, look: [0.45, Infinity] },
  mid: { d: 70, side: 20, y: 18, look: [0.5, Infinity] },
  far: { d: 250, side: 60, y: 45, look: [0.5, Infinity] },
  aerial: { d: 60, side: 30, y: 60, look: [0.5, Infinity], aboveRoof: true },
};
// Other places to try when a neighbor blocks the preset: side offsets and
// distance factors, in order.
const SIDE_TRIES = [0, 12, -12, 25, -25, 40, -40];
const DIST_TRIES = [1, 0.75, 1.35, 0.55];

function bboxOf(b) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of b.outer) {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], z);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], z);
  }
  return box;
}

// Pure: true when another building blocks the view from `eye` to `target`
// ([x, y, z], heights over the ground), or when the eye is inside one.
export function labBlocked(eye, target, others) {
  const dx = target[0] - eye[0];
  const dz = target[2] - eye[2];
  const len = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(len));
  for (const o of others) {
    const [x0, z0, x1, z1] = o.box;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      // Stop 2 m before the target: the lab building itself is there.
      if (len * (1 - t) < 2) break;
      const x = eye[0] + dx * t;
      const z = eye[2] + dz * t;
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const y = eye[1] + (target[1] - eye[1]) * t;
      if (y < o.b.height + 0.5 && pointInRing(x, z, o.b.outer)) return true;
    }
  }
  return false;
}

// Pure: the camera for one lab view, as the `cam` URL value
// [x, y, z, lookX, lookY, lookZ]. Each height is over the terrain, as the
// shell reads `cam`. With `level`, the camera moves along the front or
// nearer and farther until no other building blocks the view. With
// `heightAt(x, z)` (the terrain height), the eye height is over the base of
// the building, not over the ground under the eye: on a slope the ground in
// front of the camera does not hide the ground floor.
export function labCamera(b, view, level = null, heightAt = null) {
  const p = PRESETS[view];
  if (!p) throw new Error(`lab: no view "${view}". Known: ${LAB_VIEWS.join(", ")}`);
  const { mid, dir, normal } = labFront(b, level ? (frontEdges(level).get(b.id) ?? null) : null);
  const h = b.height;
  const [cx, cz] = centroid(b.outer);
  const lookY = Math.min(h * p.look[0], p.look[1]);
  const eyeY = p.aboveRoof ? h + p.y : p.y;
  const target = p.aboveRoof ? [cx, lookY, cz] : [mid[0], lookY, mid[1]];
  const at = (d, side) => [mid[0] + normal[0] * d + dir[0] * side, eyeY, mid[1] + normal[1] * d + dir[1] * side];
  const others = level ? (level.buildings ?? []).filter((o) => o !== b && o.id !== b.id && o.outer?.length >= 3).map((o) => ({ b: o, box: bboxOf(o) })) : [];
  let eye = at(p.d, p.side);
  if (others.length && labBlocked(eye, target, others)) {
    search: for (const k of DIST_TRIES) {
      for (const s of SIDE_TRIES) {
        const e = at(p.d * k, p.side + s);
        if (!labBlocked(e, target, others)) {
          eye = e;
          break search;
        }
      }
    }
  }
  if (heightAt) {
    // The highest ground between the eye and the wall (the base included),
    // so a rise in between does not hide the ground floor.
    const ground = heightAt(eye[0], eye[2]);
    let top = heightAt(mid[0], mid[1]);
    for (let i = 1; i < 20; i += 1) {
      const t = i / 20;
      top = Math.max(top, heightAt(eye[0] + (mid[0] - eye[0]) * t, eye[2] + (mid[1] - eye[2]) * t));
    }
    eye[1] = Math.max(eye[1], eye[1] + top - ground);
  }
  return [...eye, ...target].map((v) => Math.round(v * 100) / 100);
}
