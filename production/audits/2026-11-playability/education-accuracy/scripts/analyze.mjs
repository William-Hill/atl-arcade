// Read-only audit script. It joins the in-game positions (data/ingame.json)
// with the real positions (data/nominatim.json, data/overpass-landmarks.json,
// data/tiger-roads.json, data/osm-live-ways.json) and writes landmarks.csv
// and data/streets.json. Run from the repository root:
//   node production/audits/2026-11-playability/education-accuracy/scripts/analyze.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createProjection, haversine } from "../../../../../src/level/geo/projection.js";
import { pointInRings } from "../../../../../src/level/geo/geo-ground.js";

const DIR = "production/audits/2026-11-playability/education-accuracy/";
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const level = J("levels/beltline-eastside/level.json");
const raw = J("levels/beltline-eastside/raw/overpass.json");
const ing = J(DIR + "data/ingame.json");
const nom = J(DIR + "data/nominatim.json");
const ovl = J(DIR + "data/overpass-landmarks.json").result.elements;
const tiger = J(DIR + "data/tiger-roads.json").features;
const live = J(DIR + "data/osm-live-ways.json").result.elements;
const proj = createProjection(level.origin);

const status = (d) => (d == null ? "N/A" : d < 10 ? "OK" : d <= 30 ? "CHECK" : "WRONG");
const nomPt = (k) => {
  const r = nom[k].results[0];
  return { lat: +r.lat, lon: +r.lon };
};
const el = (type, id) => ovl.find((e) => e.type === type && e.id === id);
const ctr = (e) => e.center ?? { lat: e.lat, lon: e.lon };
const rows = [];
// For a footprint row: is the official address point inside the in-game footprint?
const inside = (name, pt) => {
  const b = level.buildings.find((q) => q.name === name);
  const [x, z] = proj.toLocal(pt.lat, pt.lon);
  return pointInRings(x, z, [b.outer, ...(b.holes ?? [])]) ? "OK (address point inside footprint)" : "WRONG (address point outside footprint)";
};
const add = (r) => {
  const off = r.real && r.game ? haversine(r.real, r.game) : null;
  rows.push({ ...r, offset: off == null ? "" : off.toFixed(1), status: r.status ?? status(off) });
};

// Landmarks.
const tower = ing.landmarks.find((l) => l.id === "ponce-city-market" && l.part === "model");
const sign = ing.landmarks.find((l) => l.part === "sign");
const ksm = ing.landmarks.find((l) => l.id === "krog-street-market");
add({ name: "Ponce City Market tower top (model)", kind: "landmark model", address: "675 Ponce de Leon Ave NE, Atlanta, GA 30308", real: ctr(el("way", 335151383)), realSrc: "OSM building:part way 335151383 (height 14) + flagpole node 3422675418, Overpass 2026-11-03", game: tower, heading: "Model yaw 0. Tower is square, so heading has no effect. Top at 50 m roof + 21 m model = about 71 m; real tower 227 ft (69.2 m) per Traditional Building 2020 (non-catalog).", });
add({ name: "PONCE CITY MARKET rooftop sign", kind: "landmark sign (text)", address: "675 Ponce de Leon Ave NE", real: null, realSrc: "Reference photo landmarks/ponce-city-market/ref/reference.jpg (Tyler Lahti, CC BY-SA 2.0): sign stands on the roof next to the tower, west of it, and faces south toward Historic Fourth Ward Park. No surveyed point found.", game: sign, heading: `Game faces bearing ${sign.facingBearing} (east, to the trail) on the east edge. Reference photo: faces south. MISMATCH.`, status: "WRONG (orientation)" });
add({ name: "Krog Street Market front (model with KROG STREET / MARKET letters)", kind: "landmark model + text", address: "99 Krog St NE, Atlanta, GA 30307", real: nomPt("addr:99 Krog St NE"), realSrc: "Nominatim address search (node/area of Krog Street Market), 2026-11-03", game: ksm, heading: `Game front faces bearing ${ksm.facingBearing} (east, to the parking drive). Reference photo shows a parking drive in front; side not verified against a survey (decisions.md says approximate).`, });
// Offset for KSM is front-to-address-point, so mark CHECK by hand if over 10 m: the address point is the building middle.
const ksmRow = rows[rows.length - 1];
ksmRow.status = "CHECK (side not verified)";
ksmRow.note = "Offset is front wall to the address point at the building middle, so it is not an error by itself. Front is on the real footprint wall.";

// Named buildings vs OSM / Nominatim.
const pcmB = ing.buildings.find((b) => b.name === "Ponce City Market");
add({ name: "Ponce City Market (building footprint)", kind: "named building", address: "675 Ponce de Leon Ave NE, Atlanta, GA 30308", real: nomPt("addr:675 Ponce de Leon Ave NE"), realSrc: "Nominatim address search, 2026-11-03", game: pcmB, heading: "", status: inside("Ponce City Market", nomPt("addr:675 Ponce de Leon Ave NE")), note: `OSM way w184803195, height ${pcmB.height} m (${pcmB.heightSource}). Address point is one door; footprint is 238 x 188 m.` });
const ksmB = ing.buildings.find((b) => b.name === "Krog Street Market");
add({ name: "Krog Street Market (building footprint)", kind: "named building", address: "99 Krog St NE, Atlanta, GA 30307", real: nomPt("addr:99 Krog St NE"), realSrc: "Nominatim address search, 2026-11-03", game: ksmB, heading: "", status: inside("Krog Street Market", nomPt("addr:99 Krog St NE")), note: `OSM relation r5413435, height ${ksmB.height} m (${ksmB.heightSource}).` });
const k725 = ing.buildings.find((b) => b.name === "Kroger");
add({ name: "Kroger at 725 Ponce", kind: "named building", address: "725 Ponce de Leon Ave NE, Atlanta, GA 30306", real: nomPt("addr:725 Ponce de Leon Ave NE"), realSrc: "Nominatim address search, 2026-11-03", game: k725, heading: "", status: inside("Kroger", nomPt("addr:725 Ponce de Leon Ave NE")), note: `height ${k725.height} m (${k725.heightSource})` });
for (const b of ing.buildings) {
  if (["Ponce City Market", "Krog Street Market", "Kroger"].includes(b.name)) continue;
  const id = b.id.slice(1);
  const osm = raw.elements.find((e) => String(e.id) === id);
  add({ name: b.name, kind: "named building (data only, no label in game)", address: osm?.tags?.["addr:housenumber"] ? `${osm.tags["addr:housenumber"]} ${osm.tags["addr:street"]}` : "", real: null, realSrc: `Same OSM element ${b.id}; not checked against an independent source`, game: b, heading: "", note: `height ${b.height} m (${b.heightSource})`, status: "N/A (OSM-derived)" });
}

// Parks.
add({ name: "Historic Fourth Ward Park", kind: "named park (data only, no label)", address: "680 Dallas St NE, Atlanta, GA 30308", real: nomPt("Historic Fourth Ward Park"), realSrc: "Nominatim (OSM centroid), 2026-11-03", game: ing.areas.find((a) => a.name === "Historic Fourth Ward Park"), heading: "", note: "Centroid to centroid; same OSM way w182470312, so the offset is centroid method only." });
add({ name: "Atlanta Art Park", kind: "named park (data only, no label)", address: "", real: nomPt("Atlanta Art Park"), realSrc: "Nominatim (OSM centroid), 2026-11-03", game: ing.areas.find((a) => a.name === "Atlanta Art Park"), heading: "", note: "Centroid method only." });
add({ name: "Parque en el centro bonito", kind: "named park (data only, no label)", address: "", real: nomPt("Parque en el centro bonito"), realSrc: "Nominatim; OSM way 1229184075, name added 2025-06-25 by one mapper, no other source found", game: ing.areas.find((a) => a.name === "Parque en el centro bonito"), heading: "", note: "Name is not on any official map found. Treat as unverified.", status: "CHECK (name)" });
for (const a of ing.areas.filter((a) => a.name === "Freedom Park")) add({ name: `Freedom Park (piece ${a.id})`, kind: "named park (data only, no label)", address: "", real: null, realSrc: "OSM relation 12045420 piece, clipped to the bbox", game: a, heading: "", status: "N/A (piece of a larger park)" });

// Murals: invented art, not real murals.
for (const m of ing.murals) add({ name: `Mural "${m.word}"`, kind: "mural (procedural, invented)", address: "", real: null, realSrc: "No real mural at this wall in OSM tourism=artwork; design is original code art (src/render/murals.js)", game: m, heading: `on ${m.buildingName ?? m.building}, ${m.widthM} m wide`, status: "N/A (invented art)" });
// Real murals near the trail that the game does not show.
for (const e of ovl.filter((e) => e.tags?.tourism === "artwork")) add({ name: `Real artwork: ${e.tags.name}${e.tags.artist_name ? " by " + e.tags.artist_name : ""}`, kind: `real ${e.tags.artwork_type ?? "artwork"} (not in game)`, address: "", real: ctr(e), realSrc: `OSM node ${e.id}, Overpass 2026-11-03`, game: null, heading: "", status: "MISSING" });

// Street signs.
const norm = (s) => String(s ?? "").toLowerCase().replace(/\bnortheast\b/g, "ne").replace(/\bavenue\b/g, "ave").replace(/\bstreet\b/g, "st").replace(/\bboulevard\b/g, "blvd").replace(/\bdrive\b/g, "dr").replace(/\bplace\b/g, "pl").replace(/\bparkway\b/g, "pkwy").replace(/\bcircle\b/g, "cir").replace(/\bterrace\b/g, "ter").replace(/\broad\b/g, "rd").replace(/\blane\b/g, "ln").replace(/\bnorth\b/g, "n").replace(/\bwest\b/g, "w").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const tigerNames = new Set(tiger.map((f) => norm(f.name)));
// Point to polyline distance in meters, in a local frame.
const segDist = (p, a, b) => {
  const [px, pz] = proj.toLocal(p.lat, p.lon), [ax, az] = proj.toLocal(a[1], a[0]), [bx, bz] = proj.toLocal(b[1], b[0]);
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const nearestTiger = (p) => {
  let best = null;
  for (const f of tiger) for (const path of f.paths) for (let i = 0; i < path.length - 1; i += 1) {
    const d = segDist(p, path[i], path[i + 1]);
    if (!best || d < best.d) best = { d, name: f.name };
  }
  return best;
};
const signCheck = [];
for (const s of ing.signs) {
  for (const n of s.names) {
    const near = nearestTiger(s);
    signCheck.push({ sign: n, lat: s.lat, lon: s.lon, inTiger: tigerNames.has(norm(n)), nearestTiger: near.name, nearestTigerM: +near.d.toFixed(1) });
  }
}
// Names that differ from TIGER only by a known cause (checked by hand against the TIGER list).
const EXPLAINED = { "John Lewis Freedom Pkwy NE": "TIGER has the pre-2018 name Freedom Pkwy; OSM is current", "Lampkin St NE": "TIGER: Lampkin St (suffix only)", "Woodall Ave NE": "TIGER: Woodall Ave (suffix only)", "Inman Ln": "TIGER: Inman Ln NE (suffix only)", "Inman Village Pkwy NE": "TIGER: Inman Village Pkwy (suffix only)", "Ralph McGill Blvd": "TIGER: Ralph McGill Blvd NE; game shows both forms", "Inman Way": "City centerlines: Inman Way NE (suffix only)" };
const CITY_NOTE = { "Bishop Way NE": "City centerlines label: Bishops Way NE (spelling differs)", "Prospect Way NE": "Not in City centerlines or TIGER; nearest city label Patterson Way (7 m)", "Austin Ave NE": "City centerlines at this corner: Lake Ave NE / Elizabeth St NE", "Closed Lake Ave": "City centerlines at this corner: Brickworks Cir NE / West Ashland Ave NE. OSM name is a mapper note, not a street name" };
const uniq = [...new Set(signCheck.map((c) => c.sign))].map((n) => ({ name: n, inTiger: signCheck.find((c) => c.sign === n).inTiger || n in EXPLAINED, why: EXPLAINED[n] ?? null }));
for (const s of ing.signs) add({ name: `Street sign: ${s.names.join(" / ")}`, kind: "street sign (text)", address: "", real: null, realSrc: "OSM intersection node (same source). Names checked against US Census TIGER, see data/streets.json", game: s, heading: "", status: s.names.some((n) => n.startsWith("Closed ")) ? "WRONG (not a real street name)" : s.names.every((n) => uniq.find((u) => u.name === n).inTiger) ? "OK (name in TIGER)" : "CHECK (name not in TIGER)", note: s.names.map((n) => uniq.find((u) => u.name === n)).filter((u) => !u.inTiger || u.why).map((u) => (u.why ? u.why : `not in TIGER: ${u.name}${CITY_NOTE[u.name] ? " (" + CITY_NOTE[u.name] + ")" : ""}`)).join("; ") });

// Centerlines: in-game strip vs TIGER same-name line, and vs live OSM.
const SAMPLE = ["Ponce de Leon Avenue Northeast", "North Avenue Northeast", "Highland Avenue Northeast", "Irwin Street Northeast", "Krog Street Northeast", "Ralph McGill Boulevard Northeast"];
const center = [];
for (const name of SAMPLE) {
  const strips = level.strips.filter((s) => s.name === name);
  const tf = tiger.filter((f) => norm(f.name) === norm(name) || norm(f.name).replace(/^n /, "") === norm(name).replace(/^n /, ""));
  const dT = [];
  const dL = [];
  for (const s of strips) {
    const lw = live.find((w) => `w${w.id}` === s.id.split("-")[0]);
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const [ax, az] = s.points[i], [bx, bz] = s.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
      for (let k = 0; k <= n; k += 1) {
        const p = proj.toLatLon(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
        if (tf.length) {
          let m = Infinity;
          for (const f of tf) for (const path of f.paths) for (let j = 0; j < path.length - 1; j += 1) m = Math.min(m, segDist(p, path[j], path[j + 1]));
          dT.push(m);
        }
        if (lw) {
          let m = Infinity;
          for (let j = 0; j < lw.geometry.length - 1; j += 1) m = Math.min(m, segDist(p, [lw.geometry[j].lon, lw.geometry[j].lat], [lw.geometry[j + 1].lon, lw.geometry[j + 1].lat]));
          dL.push(m);
        }
      }
    }
  }
  const stat = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return { n: s.length, median: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1) }; };
  center.push({ name, strips: strips.length, tigerFeatures: tf.length, vsTiger: stat(dT), vsLiveOsm: stat(dL), widthM: strips[0]?.width });
}

// Trail: in-game vs live OSM, extent, length.
const trail = level.strips.filter((s) => s.kind === "trail");
let tLen = 0, minZ = Infinity, maxZ = -Infinity;
const dTrail = [];
for (const s of trail) {
  const lw = live.find((w) => `w${w.id}` === s.id.split("-")[0]);
  for (let i = 0; i < s.points.length; i += 1) {
    const [x, z] = s.points[i];
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    if (i) tLen += Math.hypot(x - s.points[i - 1][0], z - s.points[i - 1][1]);
    if (lw) {
      const p = proj.toLatLon(x, z);
      let m = Infinity;
      for (let j = 0; j < lw.geometry.length - 1; j += 1) m = Math.min(m, segDist(p, [lw.geometry[j].lon, lw.geometry[j].lat], [lw.geometry[j + 1].lon, lw.geometry[j + 1].lat]));
      dTrail.push(m);
    }
  }
}
const liveTrailNames = live.filter((w) => trail.some((s) => s.id.split("-")[0] === `w${w.id}`)).map((w) => ({ id: w.id, name: w.tags.name, bridge: w.tags.bridge ?? null, layer: w.tags.layer ?? null, surface: w.tags.surface ?? null }));

// Integrity: every strip and building id is an OSM element in the raw fetch.
const rawIds = new Set(raw.elements.map((e) => `${e.type[0]}${e.id}`));
const notInRaw = [...level.strips, ...level.buildings, ...level.areas].filter((f) => !rawIds.has(f.id.split("-")[0])).map((f) => f.id);
const streetNames = [...new Set(level.strips.filter((s) => s.kind === "street" && s.name).map((s) => s.name))];
const namesNotInTiger = streetNames.filter((n) => !tigerNames.has(norm(n)));

// Bounds vs bbox.
const bb = level.bbox;
const [wx] = proj.toLocal(bb.south, bb.west), [ex] = proj.toLocal(bb.south, bb.east), [, nz] = proj.toLocal(bb.north, bb.west), [, sz] = proj.toLocal(bb.south, bb.west);
const bounds = { bboxLocal: { minX: +wx.toFixed(2), maxX: +ex.toFixed(2), minZ: +nz.toFixed(2), maxZ: +sz.toFixed(2) }, levelBounds: level.bounds, trailZ: [minZ, maxZ], trailNorthLat: proj.toLatLon(0, minZ).lat, trailSouthLat: proj.toLatLon(0, maxZ).lat };

const streets = { signs: { posts: ing.signs.length, uniqueNames: uniq.length, notInTiger: uniq.filter((u) => !u.inTiger).map((u) => u.name), sample: signCheck.slice(0, 40) }, centerlines: center, trail: { ways: trail.length, lengthM: +tLen.toFixed(0), vsLiveOsm: dTrail.length ? { n: dTrail.length, max: +Math.max(...dTrail).toFixed(2) } : null, liveTags: liveTrailNames }, integrity: { featuresNotInRawFetch: notInRaw, streetNames: streetNames.length, streetNamesNotInTiger: namesNotInTiger }, bounds };
writeFileSync(DIR + "data/streets.json", JSON.stringify(streets, null, 1));

// CSV.
const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const head = ["name", "kind", "real_address", "real_lat", "real_lon", "real_source", "game_x_m", "game_z_m", "game_lat", "game_lon", "offset_m", "heading_check", "status", "note"];
const lines = [head.join(",")];
for (const r of rows) lines.push([r.name, r.kind, r.address, r.real?.lat?.toFixed?.(6) ?? "", r.real?.lon?.toFixed?.(6) ?? "", r.realSrc, r.game?.x ?? "", r.game?.z ?? "", r.game?.lat ?? "", r.game?.lon ?? "", r.offset, r.heading, r.status, r.note ?? ""].map(q).join(","));
writeFileSync(DIR + "landmarks.csv", lines.join("\n") + "\n");
const count = {};
for (const r of rows) count[r.status] = (count[r.status] ?? 0) + 1;
console.log(JSON.stringify({ rows: rows.length, count }, null, 1));
console.log(JSON.stringify(rows.slice(0, 7).map((r) => [r.name, r.offset, r.status]), null, 0));
console.log(JSON.stringify({ signsNotInTiger: streets.signs.notInTiger, center, trail: { ...streets.trail, liveTags: streets.trail.liveTags.length }, integrity: { notInRaw: notInRaw.length, namesNotInTiger }, bounds }, null, 1));
