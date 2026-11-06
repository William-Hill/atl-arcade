// Generates the pedestrians (#133), the missing street furniture, and the
// BeltLine props (#115) with the Meshy API: text-to-3D preview + refine,
// then rigging and library animations for the people.
// Needs MESHY_API_KEY. Raw downloads and task records go to .meshy-raw/people/
// (git-ignored).
//   node scripts/assets/meshy-people-props.mjs [--only a,b] [--out .meshy-raw/people] [--cap 400] [--dry]
//     [--model meshy-7.1 --polycount 15000 --no-anim]
// --cap is a hard limit on the credits of this whole batch: the records of
// every earlier run count, and a task that could take the total past the
// cap does not start. Credits come from each task's consumed_credits (the
// account balance is shared with other sessions).
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = "https://api.meshy.ai/openapi";
const NO_BRAND = "no logos, no badges, no text, no lettering, no branding";
const PERSON =
  "full body standing in a T-pose, arms straight out to the sides, palms down, feet slightly apart, looking forward, realistic proportions, friendly relaxed expression, casual 2010s Atlanta streetwear, game character";

// Planned price of each step (docs.meshy.ai/en/api/pricing, meshy-t2.5).
export const PRICE = { preview: 5, refine: 10, rig: 5, action: 3 };
// Standard models (meshy-6, meshy-7.1): the preview mesh costs 20.
export const PRICE_STANDARD = { ...PRICE, preview: 20 };

// people: rigged with Meshy (walk and run come free with the rig), plus
// library actions (ids from docs.meshy.ai/en/api/animation-library).
export const ASSETS = {
  walker_sundress: {
    person: { height: 1.68, actions: { Idle_02: 11, Cheer_with_Both_Hands_Up: 298 } },
    polycount: 6000,
    prompt: `A cheerful young Black woman with natural curly hair, yellow floral sundress, white sneakers, small canvas tote bag on her shoulder, ${PERSON}, ${NO_BRAND}`,
    texture: `Warm brown skin, dark curly hair, bright yellow sundress with small white flowers, white canvas sneakers, beige canvas tote, ${NO_BRAND}`,
  },
  elder_polo: {
    person: { height: 1.75, actions: { Chair_Sit_Idle_M: 33, Cheer_with_One_Hand_Up: 306 } },
    polycount: 6000,
    prompt: `A friendly older Black man in his sixties with a short gray beard, light blue polo shirt, khaki trousers, brown loafers, plain flat cap, ${PERSON}, ${NO_BRAND}`,
    texture: `Deep brown skin, short gray beard, light blue cotton polo shirt, khaki chino trousers, brown leather loafers, plain gray flat cap, ${NO_BRAND}`,
  },
  jogger: {
    person: { height: 1.7, actions: { Catching_Breath: 31, Victory_Cheer: 59 } },
    polycount: 6000,
    prompt: `An athletic Latina woman jogger with a high ponytail, coral running tank top, black running leggings, teal running shoes, plain sport watch, ${PERSON}, ${NO_BRAND}`,
    texture: `Tan skin, dark brown ponytail, coral athletic tank top, black leggings, teal and white running shoes, black watch band, ${NO_BRAND}`,
  },
  dog_walker: {
    person: { height: 1.65, actions: { Idle: 0, Motivational_Cheer: 49 } },
    polycount: 6000,
    prompt: `A smiling young East Asian woman with a short bob haircut, light denim jacket over a white t-shirt, olive green trousers, white sneakers, small crossbody bag, ${PERSON}, ${NO_BRAND}`,
    texture: `Light skin, black bob hair, faded light blue denim jacket, plain white t-shirt, olive green trousers, white sneakers, tan crossbody bag, ${NO_BRAND}`,
  },
  stroller_dad: {
    person: { height: 1.82, actions: { Push_and_Walk_Forward: 261, Idle: 0 } },
    polycount: 6000,
    prompt: `A relaxed young white father with a short brown beard, heather gray hoodie, dark jeans, brown boots, plain baseball cap, ${PERSON}, ${NO_BRAND}`,
    texture: `Fair skin, short brown beard, heather gray cotton hoodie, dark blue jeans, brown leather boots, plain navy cap, ${NO_BRAND}`,
  },
  cyclist: {
    person: { height: 1.75, actions: { Chair_Sit_Idle_M: 33, Idle: 0 } },
    polycount: 6000,
    prompt: `A fit South Asian man cyclist with a plain matte green bike helmet, fitted orange cycling jersey, black knee-length cycling shorts, gray sneakers, fingerless gloves, ${PERSON}, ${NO_BRAND}`,
    texture: `Medium brown skin, matte green helmet, solid orange cycling jersey, black cycling shorts, gray sneakers, black gloves, ${NO_BRAND}`,
  },
  dog: {
    polycount: 3000,
    prompt: `A friendly medium-sized mixed breed dog, tan and white short fur, floppy ears, standing on all four legs in a neutral pose, tail out, red nylon collar, realistic, ${NO_BRAND}`,
    texture: `Short tan fur with a white chest and white paws, black nose, brown eyes, red nylon collar, ${NO_BRAND}`,
  },
  stroller: {
    polycount: 2500,
    prompt: `A modern baby stroller, empty seat with a folded-back canopy, black aluminum frame, four black wheels, push handle, small basket underneath, ${NO_BRAND}`,
    texture: `Teal fabric seat and canopy, black aluminum frame, black rubber wheels, black mesh basket, ${NO_BRAND}`,
  },
  drinking_fountain: {
    polycount: 1500,
    prompt: `A modern outdoor public drinking fountain on a park trail, single stainless steel pedestal with a bowl and a bottle filler spout, concrete footing, ${NO_BRAND}`,
    texture: `Brushed stainless steel, dark gray powder-coated steel post, light gray concrete footing, ${NO_BRAND}`,
  },
  bollard: {
    polycount: 400,
    prompt: `A simple cylindrical steel sidewalk bollard with a rounded top, one reflective band near the top, city streetscape, ${NO_BRAND}`,
    texture: `Dark charcoal powder-coated steel, one thin silver reflective band, ${NO_BRAND}`,
  },
  traffic_cone: {
    polycount: 400,
    prompt: `A standard orange traffic cone with two white reflective bands and a square black rubber base, ${NO_BRAND}`,
    texture: `Bright orange plastic, white reflective bands, black rubber base, ${NO_BRAND}`,
  },
  barricade: {
    polycount: 1000,
    prompt: `A folding A-frame construction barricade with two orange and white striped horizontal boards on white plastic legs, ${NO_BRAND}`,
    texture: `Orange and white diagonal stripes on the boards, white plastic legs, ${NO_BRAND}`,
  },
  e_scooter: {
    polycount: 2500,
    prompt: `A generic shared electric kick scooter standing on its kickstand, slim deck, tall stem with handlebars, small front and rear wheels, plain design, ${NO_BRAND}`,
    texture: `Matte teal painted aluminum stem and deck, black grip tape, black rubber wheels and grips, ${NO_BRAND}`,
  },
  city_bike: {
    polycount: 3000,
    prompt: `A generic step-through city bike, sturdy frame, front basket, fenders, chain guard, upright handlebars, comfortable saddle, two round spoked wheels, standing upright on a kickstand, ${NO_BRAND}`,
    texture: `Glossy sky blue painted frame, black wire basket, silver fenders, black tires, brown saddle and grips, ${NO_BRAND}`,
  },
  bike_dock: {
    polycount: 1500,
    prompt: `A single bike share docking post module on a flat steel base plate, rounded post with a wheel slot, small blank screen panel, ${NO_BRAND}`,
    texture: `Light gray powder-coated steel, dark gray base plate, black blank screen, ${NO_BRAND}`,
  },
  food_cart: {
    polycount: 3000,
    prompt: `A cheerful street food cart with a striped canvas awning, stainless steel counter, small wheels, blank chalkboard menu panel, ${NO_BRAND}`,
    texture: `Teal and white striped canvas awning, brushed stainless steel counter, sunflower yellow cart body, black rubber wheels, blank black chalkboard, ${NO_BRAND}`,
  },
  picnic_table: {
    polycount: 1200,
    prompt: `A wooden park picnic table with two attached benches, sturdy plank top, A-frame legs, ${NO_BRAND}`,
    texture: `Warm weathered natural wood planks, dark galvanized bolts, ${NO_BRAND}`,
  },
  patio_umbrella: {
    polycount: 800,
    prompt: `An open square patio market umbrella on a straight pole with a round weighted base, ${NO_BRAND}`,
    texture: `Terracotta orange canvas, dark bronze aluminum pole, black weighted base, ${NO_BRAND}`,
  },
  sculpture_ribbon: {
    polycount: 4000,
    prompt: `An original abstract public art sculpture for a city trail, a tall twisting ribbon of brushed steel rising in a double spiral from a low square concrete plinth, smooth and elegant, about four meters tall, ${NO_BRAND}`,
    texture: `Brushed stainless steel ribbon with teal and warm gold painted inner faces, light gray concrete plinth, ${NO_BRAND}`,
  },
};

const key = process.env.MESHY_API_KEY;
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return JSON.parse(text);
}

async function waitTask(path, label) {
  for (;;) {
    const t = await call("GET", path);
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`${label} ${t.status}: ${JSON.stringify(t.task_error)}`);
    process.stdout.write(`${label} ${t.status} ${t.progress ?? 0}%\n`);
    await new Promise((r) => setTimeout(r, 10000));
  }
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

// Pure: the credits of one record (consumed, or the planned price for a
// step that started but has no count yet).
export function recordCredits(rec) {
  let sum = 0;
  for (const step of ["preview", "refine", "rig", "anim"]) if (rec[step]) sum += rec[step].credits ?? rec[step].planned ?? 0;
  return sum;
}

const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const args = main ? process.argv.slice(2) : [];
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const out = opt("--out", ".meshy-raw/people");
const cap = Number(opt("--cap", "400"));
const dry = args.includes("--dry");
const only = opt("--only", Object.keys(ASSETS).join(",")).split(",");
// --model meshy-7.1 --polycount 15000: a standard (not smart-topology) model,
// remeshed to that many triangles. --no-anim: rig only (the library clips are
// shared from the first batch's same-skeleton actions).
const model = opt("--model", "meshy-t2.5");
const polycount = opt("--polycount", null);
const noAnim = args.includes("--no-anim");
const price = model.startsWith("meshy-t") ? PRICE : PRICE_STANDARD;
if (Number.isNaN(cap) || cap < 0) throw new Error("--cap must be a nonnegative number");

async function allRecords() {
  if (!existsSync(out)) return [];
  const names = (await readdir(out)).filter((f) => f.endsWith(".json"));
  return Promise.all(names.map(async (f) => JSON.parse(await readFile(join(out, f), "utf8"))));
}

async function spent() {
  return (await allRecords()).reduce((s, r) => s + recordCredits(r), 0);
}

async function guard(name, step, cost) {
  const s = await spent();
  if (s + cost > cap) throw new Error(`${name} ${step}: ${s} credits spent, ${cost} more would pass the cap of ${cap}`);
  console.log(`${name} ${step}: start (${s} spent, +${cost}, cap ${cap})`);
}

async function generate(name, spec) {
  const recPath = join(out, `${name}.json`);
  const rec = existsSync(recPath) ? JSON.parse(await readFile(recPath, "utf8")) : { name };
  const save = () => writeFile(recPath, JSON.stringify(rec, null, 2));
  if (!rec.preview) {
    await guard(name, "preview", price.preview);
    const req = model.startsWith("meshy-t")
      ? { mode: "preview", prompt: spec.prompt, model_type: "smart-topology", ai_model: model, topology: "triangle", target_polycount: Number(polycount ?? spec.polycount), target_formats: ["glb"] }
      : { mode: "preview", prompt: spec.prompt, model_type: "standard", ai_model: model, should_remesh: true, topology: "triangle", target_polycount: Number(polycount ?? spec.polycount), target_formats: ["glb"] };
    if (spec.person) req.pose_mode = "t-pose";
    const { result } = await call("POST", "/v2/text-to-3d", req);
    rec.preview = { id: result, request: req, planned: price.preview };
    await save();
  }
  const pv = await waitTask(`/v2/text-to-3d/${rec.preview.id}`, `${name} preview`);
  rec.preview.credits = pv.consumed_credits ?? price.preview;
  rec.preview.seed = pv.seed;
  await save();
  if (!rec.refine) {
    await guard(name, "refine", price.refine);
    const req = { mode: "refine", preview_task_id: rec.preview.id, enable_pbr: true, texture_prompt: spec.texture, texture_resolution: "2k", target_formats: ["glb"] };
    const { result } = await call("POST", "/v2/text-to-3d", req);
    rec.refine = { id: result, request: req, planned: price.refine };
    await save();
  }
  const rf = await waitTask(`/v2/text-to-3d/${rec.refine.id}`, `${name} refine`);
  rec.refine.credits = rf.consumed_credits ?? price.refine;
  rec.refine.finished_at = new Date(rf.finished_at).toISOString();
  await download(rf.model_urls.glb, join(out, `${name}.glb`));
  rec.glb = `${name}.glb`;
  await save();
  if (spec.person) {
    if (!rec.rig) {
      await guard(name, "rig", price.rig);
      const req = { input_task_id: rec.refine.id, height_meters: spec.person.height };
      const { result } = await call("POST", "/v1/rigging", req);
      rec.rig = { id: result, request: req, planned: price.rig };
      await save();
    }
    const rg = await waitTask(`/v1/rigging/${rec.rig.id}`, `${name} rig`);
    rec.rig.credits = rg.consumed_credits ?? price.rig;
    await download(rg.result.rigged_character_glb_url, join(out, `${name}_rigged.glb`));
    await download(rg.result.basic_animations.walking_glb_url, join(out, `${name}_walk.glb`));
    await download(rg.result.basic_animations.running_glb_url, join(out, `${name}_run.glb`));
    await save();
    const ids = noAnim ? [] : Object.values(spec.person.actions);
    if (ids.length && !rec.anim) {
      const cost = price.action * ids.length;
      await guard(name, "anim", cost);
      const req = { rig_task_id: rec.rig.id, action_ids: ids, post_process: { operation_type: "change_fps", fps: 30 } };
      const { result } = await call("POST", "/v1/animations", req);
      rec.anim = { id: result, request: req, actions: spec.person.actions, planned: cost };
      await save();
    }
    if (rec.anim) {
      const an = await waitTask(`/v1/animations/${rec.anim.id}`, `${name} anim`);
      rec.anim.credits = an.consumed_credits ?? rec.anim.planned;
      await download(an.result.animation_glb_url, join(out, `${name}_actions.glb`));
      rec.anim.result_keys = Object.keys(an.result);
      await save();
    }
  }
  console.log(`${name} done: ${recordCredits(rec)} credits`);
}

if (!main) {
  // Imported for ASSETS (scripts/assets/people-props-build.mjs).
} else if (dry) {
  let total = 0;
  for (const n of only) {
    const s = ASSETS[n];
    const c = price.preview + price.refine + (s.person ? price.rig + (noAnim ? 0 : price.action * Object.keys(s.person.actions).length) : 0);
    total += c;
    console.log(n.padEnd(20), c);
  }
  console.log("planned".padEnd(20), total, "spent so far", await spent(), "cap", cap);
} else {
  if (!key) throw new Error("MESHY_API_KEY is not set");
  await mkdir(out, { recursive: true });
  // One asset at a time, so the cap check sees every earlier task.
  for (const n of only) {
    if (!ASSETS[n]) throw new Error(`unknown asset ${n}`);
    await generate(n, ASSETS[n]);
  }
  console.log(`batch total ${await spent()} credits (cap ${cap})`);
}
