// Generates the street props with the Meshy text-to-3D API (preview, then refine).
// Needs MESHY_API_KEY in the environment. Writes raw GLBs and task records to
// the output directory (default .meshy-raw/, not committed).
//   node scripts/assets/meshy-street-props.mjs [--only sedan,bus] [--out .meshy-raw] [--cap 75]
// --cap stops before any task that would take the credits spent in this run past the cap.
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
    prompt: `Realistic 40-foot low-floor American city transit bus, mid-2010s design, long flat-sided box body, length about four times its height and about five times its width, exactly two axles: one front axle just behind the front door and one rear axle, single round black tires with plain steel hubs fully visible in open wheel arches, large flat front windshield, a row of large dark side windows, front door and middle door on the right side, low flat roof with a small air-conditioning pod, white body with one blue stripe and one orange stripe, blank destination sign, ${NO_BRAND}`,
    texture: `White painted bus body, blue and orange horizontal stripes, dark tinted windows, black rubber tires, gray hubs, black bumpers, blank dark destination sign, ${NO_BRAND}`,
  },
  pickup: {
    polycount: 12000,
    prompt: `Realistic mid-2010s full-size crew cab pickup truck, generic unbranded design, dark red paint, empty open truck bed, black grille, tinted windows, black tires with steel wheels, complete single vehicle, ${NO_BRAND}`,
    texture: `Dark red car paint, black plastic grille and trim, dark tinted glass, black rubber tires, gray steel wheels, chrome-free bumpers, blank license plate, ${NO_BRAND}`,
  },
  hatchback: {
    polycount: 12000,
    prompt: `Realistic mid-2010s compact five-door hatchback car like a typical European compact family car, low and long body, length about two and a half times its width and about three times its height, low roofline, long hood, sloped rear hatch, bright teal metallic paint, tinted glass windows, smooth plain grille, black tires with silver alloy wheels, headlights and red taillights, closed doors, complete single vehicle, ${NO_BRAND}`,
    texture: `Bright teal metallic car paint, dark tinted glass, plain black mesh grille with no emblem, black rubber tires, silver alloy rims, black plastic trim, clear headlights, red taillights, blank license plate, ${NO_BRAND}`,
  },
  van: {
    polycount: 12000,
    prompt: `Realistic mid-2010s full-size passenger and cargo van, generic unbranded design, tall boxy body with a high roof, short sloped hood, sliding side door, side windows, two rear doors, light silver gray paint, tinted glass, black tires with steel wheels, exactly two axles, complete single vehicle, ${NO_BRAND}`,
    texture: `Light silver gray car paint, dark tinted glass, black rubber tires, gray steel wheels, black plastic bumpers and trim, clear headlights, red taillights, blank license plate, ${NO_BRAND}`,
  },
  taxi: {
    polycount: 12000,
    prompt: `Realistic mid-2010s full-size four-door sedan taxi cab, generic unbranded design, bright sunflower yellow paint with a thin teal checkered stripe along both sides, small plain blank white roof light box on top, tinted glass windows, black tires with silver wheels, headlights and red taillights, closed doors, complete single vehicle, ${NO_BRAND}`,
    texture: `Bright sunflower yellow car paint, thin teal and white checkered side stripe, plain blank white roof light box, dark tinted glass, black rubber tires, silver rims, black plastic trim, blank license plate, ${NO_BRAND}`,
  },
  box_truck: {
    polycount: 14000,
    prompt: `Realistic medium-duty generic delivery box truck, mid-2010s design, conventional cab with a short hood, large plain white rectangular cargo box behind the cab, box taller than the cab, roll-up rear door, exactly two axles: single front wheels and dual rear wheels, round black tires with plain steel hubs fully visible in open wheel arches, white cab, dark tinted windows, black bumpers, complete single vehicle, ${NO_BRAND}`,
    texture: `White painted cab, plain clean white cargo box with thin gray panel seams, gray roll-up rear door, dark tinted glass, black rubber tires, gray steel hubs, black bumpers and grille, blank license plate, ${NO_BRAND}`,
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

const COST = { preview: 5, refine: 10 };
let startBalance;
let cap = Infinity;
async function checkCap(name, mode) {
  const spent = startBalance - (await balance());
  if (spent + COST[mode] > cap) throw new Error(`${name} ${mode}: ${spent} credits spent, ${COST[mode]} more would pass the cap of ${cap}`);
}

async function generate(name, spec, out) {
  const recPath = join(out, `${name}.json`);
  const rec = existsSync(recPath) ? JSON.parse(await readFile(recPath, "utf8")) : { name };
  const save = () => writeFile(recPath, JSON.stringify(rec, null, 2));
  if (!rec.preview) {
    await checkCap(name, "preview");
    const b0 = await balance();
    const req = { mode: "preview", prompt: spec.prompt, model_type: "smart-topology", ai_model: "meshy-t2.5", topology: "triangle", target_polycount: spec.polycount, target_formats: ["glb"] };
    const { result } = await call("POST", API, req);
    rec.preview = { id: result, request: req, balance_before: b0 };
    await save();
  }
  const pv = await waitTask(rec.preview.id, `${name} preview`);
  if (!rec.refine) {
    await checkCap(name, "refine");
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
cap = Number(opt("--cap", "Infinity"));
if (Number.isNaN(cap) || cap < 0) throw new Error("--cap must be a nonnegative number");
startBalance = await balance();
console.log(`balance ${startBalance}, cap ${cap}`);
await mkdir(out, { recursive: true });
// Run sequentially so the balance deltas attribute credits to the right task.
for (const n of only) await generate(n, ASSETS[n], out);
const end = await balance();
console.log(`balance ${end}, spent ${startBalance - end}`);
