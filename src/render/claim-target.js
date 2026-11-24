// The grind claim target (#264): the render layer. The pure part is in
// claim-target-math.js.
//
// A gold tube on the part of the rail or curb that counts, and a post at each
// end. Toon look: flat gold with an ink shell (a back face tube, a little
// larger). Pbr look: the same unlit gold as an emissive overlay, as the
// challenge rings. 2 draw calls while a target shows, 0 otherwise. The
// geometry is built again only when the target changes.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TARGET, grindTargets, targetGain } from "./claim-target-math.js";

// The tube along `points` ([[x, y, z]]) and a post at each end.
function targetGeometry(points, extra, k) {
  const lift = new THREE.Vector3(0, k.lift, 0);
  const path = new THREE.CurvePath();
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = new THREE.Vector3(...points[i]).add(lift);
    const b = new THREE.Vector3(...points[i + 1]).add(lift);
    if (a.distanceToSquared(b) > 1e-8) path.add(new THREE.LineCurve3(a, b));
  }
  const length = path.getLength();
  const parts = [new THREE.TubeGeometry(path, Math.max(4, Math.ceil(length * 2)), k.radius + extra, 8, false)];
  for (const p of [points[0], points[points.length - 1]]) {
    const post = new THREE.CylinderGeometry(k.post.radius + extra, k.post.radius + extra, k.post.height + extra, 8, 1, false);
    post.translate(p[0], p[1] + k.lift + k.post.height / 2, p[2]);
    parts.push(post);
  }
  for (const g of parts) {
    // The pieces must have the same attributes to merge.
    if (!g.index) g.setIndex([...Array(g.getAttribute("position").count).keys()]);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

// `reducedMotion()` is true when nothing must move (#97).
export function createClaimTargets({ look = "toon", reducedMotion = () => false, k = TARGET } = {}) {
  const group = new THREE.Group();
  group.name = "claim-targets";
  const goldColor = new THREE.Color(k.gold);
  const gold = new THREE.MeshBasicMaterial({ color: goldColor.clone(), depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  gold.name = "claim-target";
  const ink = new THREE.MeshBasicMaterial({ color: new THREE.Color(k.inkColor), side: THREE.BackSide });
  ink.name = "claim-target-ink";
  const goldMesh = new THREE.Mesh(new THREE.BufferGeometry(), gold);
  goldMesh.name = "claim-target";
  const inkMesh = new THREE.Mesh(new THREE.BufferGeometry(), ink);
  inkMesh.name = "claim-target-ink";
  for (const m of [goldMesh, inkMesh]) {
    m.visible = false;
    m.renderOrder = 2;
    m.frustumCulled = false;
    // Out of the AO and ink depth pass (src/render/post.js), as the rings.
    m.userData.overlay = true;
    group.add(m);
  }
  // The ink shell is for the toon look; the pbr look has no ink lines.
  const withInk = look !== "pbr";

  let key = null;
  let time = 0;
  let hidden = false;
  const info = { shown: [], active: false, gain: 0, length: 0, points: [], visible: false, look };

  function rebuild(target) {
    goldMesh.geometry.dispose();
    inkMesh.geometry.dispose();
    goldMesh.geometry = target ? targetGeometry(target.points, 0, k) : new THREE.BufferGeometry();
    inkMesh.geometry = target && withInk ? targetGeometry(target.points, k.ink, k) : new THREE.BufferGeometry();
  }

  return {
    group,
    // `spots` is landmarkView().spots, `grindables` the grindables of the
    // level, `position` the skater's [x, y, z]. `dt` is 0 while the game is
    // paused. One target shows at a time: the one the skater grinds, else
    // the nearest.
    update(spots, grindables, position, { dt = 0, timed = true } = {}) {
      time += dt;
      const list = grindTargets(spots, grindables, position, { timed }, k);
      const near = (t) => Math.min(...t.points.map(([x, , z]) => Math.hypot(x - position[0], z - position[2])));
      const target = list.find((t) => t.active) ?? list.sort((a, b) => near(a) - near(b))[0] ?? null;
      const nextKey = target ? `${target.id}:${target.points.length}:${target.points[0].join(",")}` : null;
      if (nextKey !== key) {
        key = nextKey;
        rebuild(target);
      }
      const gain = target ? targetGain(target.active, time, reducedMotion(), k) : 0;
      gold.color.copy(goldColor).multiplyScalar(gain);
      goldMesh.visible = Boolean(target) && !hidden;
      inkMesh.visible = Boolean(target) && withInk && !hidden;
      info.shown = target ? [target.id] : [];
      info.active = Boolean(target?.active);
      info.gain = gain;
      info.length = target ? target.length : 0;
      info.points = target ? target.points : [];
      info.feature = target ? target.feature : null;
      info.visible = Boolean(target);
    },
    // For the pixel check: hides or shows the target.
    setHidden(on) {
      hidden = Boolean(on);
      const shown = info.visible && !hidden;
      goldMesh.visible = shown;
      inkMesh.visible = shown && withInk;
    },
    // For the tests: what shows now.
    get info() {
      return { ...info, meshes: withInk ? 2 : 1, color: k.gold };
    },
  };
}
