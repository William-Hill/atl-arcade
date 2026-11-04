// Generates the street props with the Meshy text-to-3D API (preview, then refine).
// Needs MESHY_API_KEY in the environment. Writes raw GLBs and task records to
// the output directory (default .meshy-raw/, not committed).
//   node scripts/assets/meshy-street-props.mjs [--only sedan,bus] [--out .meshy-raw]
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.meshy.ai/openapi/v2/text-to-3d";
const NO_BRAND = "no logos, no badges, no text, no lettering, no branding";

export const ASSETS = {
  sedan: {
    polycount: 12000,
    prompt: `Realistic mid-2010s midsize four-door sedan car, generic unbranded design, dark blue metallic paint, tinted glass windows, black tires with silver alloy wheels, headlights and red taillights, closed doors, complete single vehicle, ${NO_BRAND}`,
    texture: `Dark blue metallic car paint, dark tinted glass, black rubber tires, silver alloy rims, black plastic trim, clear headlights, red taillights, blank license plate, ${NO_BRAND}`,
  },
  bus: {
    polycount: 14000,
    prompt: `Realistic long 40-foot low-floor American city transit bus, mid-2010s design, very long low rectangular body about four times longer than tall, flat front with a large one-piece windshield, seven large dark side windows in a row, front door and middle door on the right side, three-quarter roof pod for air conditioning, white body with a blue and orange stripe, black tires, blank destination sign, ${NO_BRAND}`,
    texture: `White painted bus body, blue and orange horizontal stripes, dark tinted windows, black rubber tires, gray hubs, black bumpers, blank dark destination sign, ${NO_BRAND}`,
  },
  pickup: {
    polycount: 12000,
    prompt: `Realistic mid-2010s full-size crew cab pickup truck, generic unbranded design, dark red paint, empty open truck bed, black grille, tinted windows, black tires with steel wheels, complete single vehicle, ${NO_BRAND}`,
    texture: `Dark red car paint, black plastic grille and trim, dark tinted glass, black rubber tires, gray steel wheels, chrome-free bumpers, blank license plate, ${NO_BRAND}`,
  },
  bus_shelter: {
    polycount: 6000,
    prompt: `Realistic modern city bus stop shelter, dark gray steel frame, clear glass back and side panels, flat metal roof, built-in metal bench seat, blank advertising panel at one end, ${NO_BRAND}`,
    texture: `Dark gray powder-coated steel, clear slightly blue glass, brushed metal bench, plain white blank backlit panel, ${NO_BRAND}`,
  },
  planter: {
    polycount: 3000,
    prompt: `Realistic square cast concrete sidewalk planter box filled with dark mulch and small green shrubs, city streetscape furniture, ${NO_BRAND}`,
    texture: `Light gray weathered cast concrete, dark brown mulch, green leafy shrubs, ${NO_BRAND}`,
  },
  bench: {
    polycount: 3000,
    prompt: `Realistic city sidewalk bench, black powder-coated steel frame with wooden slat seat and backrest, three-seat length, two armrests, ${NO_BRAND}`,
    texture: `Black powder-coated steel frame, warm brown hardwood slats, ${NO_BRAND}`,
  },
};

const key = process.env.MESHY_API_KEY;
if (!key) throw new Error("MESHY_API_KEY is not set");
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(method, url, body) {
  const res = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return JSON.parse(text);
}

async function balance() {
  return (await call("GET", "https://api.meshy.ai/openapi/v1/balance")).balance;
}

async function waitTask(id, label) {
  for (;;) {
    const t = await call("GET", `${API}/${id}`);
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`${label} ${t.status}: ${JSON.stringify(t.task_error)}`);
    process.stdout.write(`${label} ${t.status} ${t.progress}%\n`);
    await new Promise((r) => setTimeout(r, 15000));
  }
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

async function generate(name, spec, out) {
  const recPath = join(out, `${name}.json`);
  const rec = existsSync(recPath) ? JSON.parse(await readFile(recPath, "utf8")) : { name };
  const save = () => writeFile(recPath, JSON.stringify(rec, null, 2));
  if (!rec.preview) {
    const b0 = await balance();
    const req = { mode: "preview", prompt: spec.prompt, model_type: "smart-topology", ai_model: "meshy-t2.5", topology: "triangle", target_polycount: spec.polycount, target_formats: ["glb"] };
    const { result } = await call("POST", API, req);
    rec.preview = { id: result, request: req, balance_before: b0 };
    await save();
  }
  const pv = await waitTask(rec.preview.id, `${name} preview`);
  if (!rec.refine) {
    const b1 = await balance();
    rec.preview.credits = rec.preview.balance_before - b1;
    const req = { mode: "refine", preview_task_id: rec.preview.id, enable_pbr: true, texture_prompt: spec.texture, texture_resolution: "2k", target_formats: ["glb"] };
    const { result } = await call("POST", API, req);
    rec.refine = { id: result, request: req, balance_before: b1 };
    await save();
  }
  const rf = await waitTask(rec.refine.id, `${name} refine`);
  if (rec.refine.credits === undefined) rec.refine.credits = rec.refine.balance_before - (await balance());
  rec.preview.seed = pv.seed;
  rec.refine.finished_at = new Date(rf.finished_at).toISOString();
  await download(rf.model_urls.glb, join(out, `${name}.glb`));
  rec.glb = `${name}.glb`;
  await save();
  console.log(`${name} done: preview ${rec.preview.credits} + refine ${rec.refine.credits} credits`);
}

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const out = opt("--out", ".meshy-raw");
const only = opt("--only", Object.keys(ASSETS).join(",")).split(",");
await mkdir(out, { recursive: true });
// Run sequentially so the balance deltas attribute credits to the right task.
for (const n of only) await generate(n, ASSETS[n], out);
