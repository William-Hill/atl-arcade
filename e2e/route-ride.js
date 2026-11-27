// A route on the strip network of a geodata level (#336): the shortest way
// along the center lines of the trails, paths, sidewalks, and streets from
// one point to the next, as a list of way points. Test helper, not game code.
// The one-button goal test rides it to collect the fact cards.

const KINDS = ["trail", "path", "sidewalk", "street"];
// Extra cost per meter by kind: the route keeps to the trail and the paths.
const COST = { trail: 1, path: 1.1, sidewalk: 1.3, street: 1.6 };

const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

// The graph: a node per strip point (shared points join the strips), edges
// along each strip, and a link between the points of 2 strips that are
// nearer than `join` m (a junction that OSM did not share).
export function stripGraph(level, { join = 4, step = 4 } = {}) {
  const nodes = new Map(); // key -> { p, edges: [[key, cost]] }
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { p, edges: [] });
    return k;
  };
  const link = (a, b, cost) => {
    nodes.get(a).edges.push([b, cost]);
    nodes.get(b).edges.push([a, cost]);
  };
  for (const s of level.strips ?? []) {
    if (!KINDS.includes(s.kind) || !(s.points?.length > 1)) continue;
    let prev = null;
    for (let i = 0; i + 1 < s.points.length; i += 1) {
      const [ax, az] = s.points[i];
      const [bx, bz] = s.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let j = i === 0 ? 0 : 1; j <= n; j += 1) {
        const p = [ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n];
        const k = node(p);
        if (prev && prev !== k) link(prev, k, Math.hypot(p[0] - nodes.get(prev).p[0], p[1] - nodes.get(prev).p[1]) * COST[s.kind]);
        prev = k;
      }
    }
  }
  // Junctions: a grid of the nodes, then a link to each near node.
  const cell = (p) => `${Math.floor(p[0] / join)},${Math.floor(p[1] / join)}`;
  const grid = new Map();
  for (const [k, n] of nodes) {
    const c = cell(n.p);
    if (!grid.has(c)) grid.set(c, []);
    grid.get(c).push(k);
  }
  for (const [k, n] of nodes) {
    const [cx, cz] = cell(n.p).split(",").map(Number);
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dz = -1; dz <= 1; dz += 1)
        for (const o of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (o <= k) continue;
          const d = Math.hypot(nodes.get(o).p[0] - n.p[0], nodes.get(o).p[1] - n.p[1]);
          if (d < join) link(k, o, d * 1.5);
        }
  }
  return nodes;
}

function nearest(nodes, p) {
  let best = null;
  let bd = Infinity;
  for (const [k, n] of nodes) {
    const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

// The way points [x, z] of the shortest route from `a` to `b` (Dijkstra with
// a plain array queue: the graph has some 10,000 nodes).
export function route(nodes, a, b) {
  const from = nearest(nodes, a);
  const to = nearest(nodes, b);
  const dist = new Map([[from, 0]]);
  const back = new Map();
  const open = [[0, from]];
  const done = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i][0] < open[bi][0]) bi = i;
    const [d, k] = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (done.has(k)) continue;
    done.add(k);
    if (k === to) break;
    for (const [o, c] of nodes.get(k).edges) {
      const nd = d + c;
      if (nd < (dist.get(o) ?? Infinity)) {
        dist.set(o, nd);
        back.set(o, k);
        open.push([nd, o]);
      }
    }
  }
  if (!done.has(to)) return null;
  const way = [];
  for (let k = to; k; k = back.get(k)) way.push(nodes.get(k).p);
  return way.reverse();
}
