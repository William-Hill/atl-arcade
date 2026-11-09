// Pure helpers for scripts/perf.mjs: the byte type of a URL, the frame-time
// stats, the budget check, and the Markdown tables. Tested in perf-lib.test.js.

// The download type of a URL (and its MIME type, for a URL with no extension).
export function classifyUrl(url, mime = "") {
  const path = String(url).split(/[?#]/)[0].toLowerCase();
  if (/\.(m?js)$/.test(path) || /javascript/.test(mime)) return "js";
  if (/\.(glb|gltf|bin|drc)$/.test(path) || /gltf/.test(mime)) return "glb";
  if (/\.(png|jpe?g|webp|avif|ktx2|basis|hdr|exr|gif|svg)$/.test(path) || /^image\//.test(mime)) return "textures";
  if (/\.wasm$/.test(path) || /wasm/.test(mime)) return "wasm";
  if (/\.(json|geojson|csv|txt)$/.test(path) || /json/.test(mime)) return "data";
  return "other";
}

// Pure: the MB of the files asked for before the first frame (#190). A file
// with no start time (the page itself) counts as before.
export function firstFrameMB(files, firstFrameMs) {
  if (!files || firstFrameMs == null) return null;
  const kB = files.filter((f) => f.startMs == null || f.startMs < firstFrameMs).reduce((s, f) => s + f.kB, 0);
  return Math.round((kB / 1024) * 100) / 100;
}

// The pbr download groups (#190), by the file name without its build hash.
// The order matters: the first match wins.
export const DOWNLOAD_GROUPS = [
  ["skater", /\/skater(-1024)?[-.]/],
  ["physics", /rapier/],
  ["cars", /\/(vehicles_lod|sedan|taxi|van|bus|box_truck|hatchback|pickup|city_bike|e_scooter)[-.]/],
  ["people", /\/(jogger|cyclist|dog_walker|dog|elder_polo|stroller_dad|stroller|walker_sundress|runner|commuter|[a-z_]*walker[a-z_]*)[-.][^/]*glb$/],
  ["meshy props", /\/(drinking_fountain|food_cart|sculpture_ribbon|picnic_table|bike_dock|patio_umbrella|bollard)[-.]/],
  ["landmark GLBs", /\/(ponce-city-market|telephone-factory-lofts|studioplex|new-realm-brewing|bridge-[a-z-]+|[a-z-]+-lofts)[-.][^/]*glb/],
  ["street kit", /\/(street-kit|painted_wooden_bench)[-.]/],
  ["GLB trees", /\/(oak|magnolia|dogwood|myrtle|pine|street)[-.][^/]*glb/],
  ["facade kit", /\/facade-kit[-.]/],
  ["murals", /\/mural-(atlas|roughness)[-.]/],
  ["pbr ground", /\/(albedo|normal|orm)-(512|1024)[-.]/],
  ["js", /\.m?js$/],
  ["wasm", /\.wasm$/],
];

// Pure: the group of a file (DOWNLOAD_GROUPS), or "other".
export function downloadGroupOf(file) {
  const path = String(file).split(/[?#]/)[0];
  for (const [name, re] of DOWNLOAD_GROUPS) if (re.test(path)) return name;
  return "other";
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// Frame-time stats (ms). The first 5 frames can hold a shader compile, so
// they are left out.
export function frameStats(frameMs) {
  const ms = frameMs.slice(5).filter((v) => v > 0);
  const sorted = [...ms].sort((a, b) => a - b);
  const mean = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  const median = percentile(sorted, 0.5);
  return {
    frames: ms.length,
    meanMs: round1(mean),
    p95Ms: round1(percentile(sorted, 0.95)),
    medianFps: median ? round1(1000 / median) : null,
  };
}

// The value of a budget metric in a run.
export const METRICS = {
  calls: (r) => r.calls,
  triangles: (r) => r.triangles,
  geometries: (r) => r.geometries,
  textures: (r) => r.textures,
  heapMB: (r) => r.heapMB,
  downloadMB: (r) => r.downloadMB.total,
  jsMB: (r) => r.downloadMB.js,
  meanMs: (r) => r.frame.meanMs,
  p95Ms: (r) => r.frame.p95Ms,
  firstFrameMs: (r) => r.firstFrameMs,
  firstDownloadMB: (r) => r.firstDownloadMB ?? firstFrameMB(r.files, r.firstFrameMs),
};

// Pure: the list of "tier/look metric value > cap" lines. The budget is
// { tiers: { low: { calls: 60, ... }, "phone/pbr": { ... } } }. A "tier/look"
// entry adds to (and overrides) the caps of its tier.
export function checkBudget(runs, budget) {
  const over = [];
  for (const r of runs) {
    const caps = { ...(budget.tiers?.[r.quality] ?? {}), ...(budget.tiers?.[`${r.quality}/${r.look}`] ?? {}) };
    for (const [name, cap] of Object.entries(caps)) {
      const get = METRICS[name];
      if (!get) continue;
      const v = get(r);
      if (v != null && v > cap) over.push(`${r.quality}/${r.look} ${name} ${v} > ${cap}`);
    }
  }
  return over;
}

const SYSTEM_ORDER = ["render", "skater", "walkers", "walkersView", "crowd", "crowdView", "traffic", "trafficView", "npcSkaters", "npcSkatersView", "views"];

// Pure: the median of each number over the repeats of one tier and look.
export function mergeRuns(runs) {
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.quality}/${r.look}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const mid = (list) => {
    const v = list.filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length / 2;
    return v.length % 2 ? v[Math.floor(m)] : Math.round(((v[m - 1] + v[m]) / 2) * 1000) / 1000;
  };
  return [...groups.values()].map((g) => {
    const systems = {};
    for (const name of SYSTEM_ORDER) systems[name] = { meanMs: mid(g.map((r) => r.systems?.[name]?.meanMs)), p95Ms: mid(g.map((r) => r.systems?.[name]?.p95Ms)), perStepMs: mid(g.map((r) => r.systems?.[name]?.perStepMs)) };
    return {
      quality: g[0].quality,
      look: g[0].look,
      runs: g.length,
      load: g.map((r) => r.load),
      frame: { meanMs: mid(g.map((r) => r.frame.meanMs)), p95Ms: mid(g.map((r) => r.frame.p95Ms)), medianFps: mid(g.map((r) => r.frame.medianFps)) },
      calls: mid(g.map((r) => r.calls)),
      triangles: mid(g.map((r) => r.triangles)),
      geometries: mid(g.map((r) => r.geometries)),
      textures: mid(g.map((r) => r.textures)),
      heapMB: mid(g.map((r) => r.heapMB)),
      firstFrameMs: mid(g.map((r) => r.firstFrameMs)),
      firstDownloadMB: mid(g.map((r) => METRICS.firstDownloadMB(r))),
      stepsPerFrame: mid(g.map((r) => r.stepsPerFrame)),
      downloadMB: Object.fromEntries(Object.keys(g[0].downloadMB).map((k) => [k, mid(g.map((r) => r.downloadMB[k]))])),
      systems,
    };
  });
}

// Pure: the Markdown tables of a perf result.
export function renderMarkdown(result) {
  const rows = mergeRuns(result.runs);
  const lines = [];
  lines.push(`Run ${result.date.slice(0, 16).replace("T", " ")} UTC, ${result.gpu}, ${result.machine.cpus} CPUs, viewport ${result.viewport}, ride ${result.rideSeconds} s of game time (stopped after ${result.maxWallSeconds ?? "-"} s of wall time), ${Math.max(...rows.map((r) => r.runs))} run(s) per row (median shown).`);
  lines.push("");
  lines.push("| Tier | Look | Mean ms | p95 ms | Median FPS | Draw calls | Triangles | Geometries | Textures | Heap MB | First frame ms | Load avg |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) lines.push(`| ${r.quality} | ${r.look} | ${r.frame.meanMs} | ${r.frame.p95Ms} | ${r.frame.medianFps} | ${r.calls} | ${r.triangles?.toLocaleString("en-US")} | ${r.geometries} | ${r.textures} | ${r.heapMB} | ${r.firstFrameMs} | ${r.load.join(" ")} |`);
  lines.push("");
  lines.push("Download (MB on the wire, gzip as the host serves it):");
  lines.push("");
  lines.push("| Tier | Look | JS | GLB | Textures | WASM | Data | Other | Total | Before first frame |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const d = r.downloadMB;
    lines.push(`| ${r.quality} | ${r.look} | ${d.js} | ${d.glb} | ${d.textures} | ${d.wasm} | ${d.data} | ${d.other} | ${d.total} | ${r.firstDownloadMB ?? "-"} |`);
  }
  lines.push("");
  lines.push("Cost by system (`?perf=1`, CPU ms on the main thread). A sim system (skater, walkers, crowd, traffic, NPC skaters) runs once per 1/60 s step; the table gives its cost per step, which is its cost per frame at 60 FPS. A view or the render runs once per frame; the table gives the mean per frame. `render` is the CPU side of `renderer.render` only: the software GPU works in another process.");
  lines.push("");
  lines.push(`| Tier | Look | ${SYSTEM_ORDER.join(" | ")} | Steps per frame |`);
  lines.push(`|---|---|${SYSTEM_ORDER.map(() => "---").join("|")}|---|`);
  for (const r of rows) lines.push(`| ${r.quality} | ${r.look} | ${SYSTEM_ORDER.map((s) => r.systems[s].perStepMs ?? r.systems[s].meanMs).join(" | ")} | ${r.stepsPerFrame} |`);
  return `${lines.join("\n")}\n`;
}

// Pure: puts the generated tables between the markers of a doc, or returns
// the tables alone when the doc has no markers.
export function spliceMarkdown(doc, tables) {
  const begin = "<!-- perf:begin -->";
  const end = "<!-- perf:end -->";
  const i = doc.indexOf(begin);
  const j = doc.indexOf(end);
  if (i < 0 || j < i) return tables;
  return `${doc.slice(0, i + begin.length)}\n${tables}${doc.slice(j)}`;
}
