// The draw calls and triangles of one frame, split by pass and by object
// kind (?perf=1, #188). It wraps renderer.renderBufferDirect (every draw of
// three.js goes through it: the scene, the shadow map, the post quads) and
// reads the renderer.info counters around each draw. The pass is a label:
// "shadow" inside renderer.shadowMap.render, the post pass label inside a
// wrapped pass, else "main".
//
// Usage: const split = createDrawSplit(renderer); split.wrapPass(pass, "gtao");
// split.begin() before the frame draw, split.report() after it.

// Pure: the kind of a drawn object, for the split. A named object gives its
// name without the tile number or the index at the end ("building-12-3"
// gives "building"); the first named parent stands in for an unnamed one.
export function kindOf(object) {
  if (!object) return "?";
  if (object.isBatchedMesh) return `batched:${baseName(object.name) || "?"}`;
  let o = object;
  while (o && !o.name) o = o.parent;
  const name = baseName(o?.name ?? "");
  const type = object.isSkinnedMesh ? "skinned" : object.isInstancedMesh ? "instanced" : object.isPoints ? "points" : object.isLine ? "line" : object.isSprite ? "sprite" : "mesh";
  return name ? `${type}:${name}` : type;
}

// Pure: a name without the numbers and the tile key at its end.
export function baseName(name) {
  return String(name).replace(/([-_ ]?(-?\d+|tile)(,-?\d+)*)+$/i, "").replace(/[-_ ]+$/, "");
}

// Pure: the rows sorted by draw calls, and the totals by pass.
export function summarize(rows) {
  const byPass = {};
  const list = [...rows.values()].sort((a, b) => b.calls - a.calls || b.triangles - a.triangles);
  for (const r of list) {
    const p = (byPass[r.pass] ??= { calls: 0, triangles: 0 });
    p.calls += r.calls;
    p.triangles += r.triangles;
  }
  const total = list.reduce((t, r) => ({ calls: t.calls + r.calls, triangles: t.triangles + r.triangles }), { calls: 0, triangles: 0 });
  return { total, byPass, rows: list };
}

export function createDrawSplit(renderer) {
  let pass = "main";
  let rows = new Map();
  let last = summarize(rows);
  const info = renderer.info.render;
  const draw = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const c0 = info.calls;
    const t0 = info.triangles;
    draw.call(this, camera, scene, geometry, material, object, group);
    const calls = info.calls - c0;
    const triangles = info.triangles - t0;
    if (calls === 0 && triangles === 0) return;
    const kind = kindOf(object);
    const key = `${pass}|${kind}`;
    const row = rows.get(key) ?? { pass, kind, calls: 0, triangles: 0 };
    row.calls += calls;
    row.triangles += triangles;
    rows.set(key, row);
  };
  const wrap = (owner, name, label) => {
    const fn = owner[name];
    owner[name] = function (...args) {
      const prev = pass;
      pass = typeof label === "function" ? label(prev) : label;
      try {
        return fn.apply(this, args);
      } finally {
        pass = prev;
      }
    };
  };
  // The shadow map renders inside each renderer.render() of a lit scene,
  // also when a post pass draws the scene again: "gtao>shadow" is a shadow
  // map drawn by the GTAO pass.
  wrap(renderer.shadowMap, "render", (prev) => (prev === "main" ? "shadow" : `${prev}>shadow`));
  return {
    wrapPass(p, label) {
      if (p && typeof p.render === "function") wrap(p, "render", label);
    },
    begin() {
      rows = new Map();
    },
    end() {
      last = summarize(rows);
    },
    report() {
      return last;
    },
  };
}
