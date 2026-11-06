// Builds the game GLBs, manifests and provenance of the pedestrians, the
// missing street furniture and the BeltLine props from the Meshy downloads of
// scripts/assets/meshy-people-props.mjs (.meshy-raw/people/, git-ignored).
//   node scripts/assets/people-props-build.mjs [--only a,b] [--blender PATH]
// Writes assets/people/, assets/props/street/ and assets/props/beltline/:
// <id>.glb, manifest.json (files, bytes, triangles per LOD, bounds, clips,
// textures) and provenance.json (prompts, Meshy settings, task ids, credits).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { ASSETS } from "./meshy-people-props.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const blender = opt("--blender", process.env.BLENDER ?? "/home/ubuntu/tools/blender");
const RAW = ".meshy-raw/people";
// People remade on meshy-7.1 (15k triangles, rig only): their skins come from
// here, their library clips still from the first batch's actions in RAW.
const RAW2 = ".meshy-raw/people-v2";
const remade = (id) => existsSync(`${RAW2}/${id}_rigged.glb`);
const DATE = new Date().toISOString().slice(0, 10);

// Clip names in the game: walk, run (free with the Meshy rig), idle, sit,
// cheer, push, rest, ride. Shared clips come from another person's library
// actions (same 24-bone Meshy skeleton): no credits.
const PEOPLE = {
  walker_sundress: { clips: { cheer: "Cheer_with_Both_Hands_Up" }, share: { elder_polo: { sit: "Chair_Sit_Idle_M" }, dog_walker: { idle: "Idle" } } },
  elder_polo: { clips: { sit: "Chair_Sit_Idle_M" }, share: { dog_walker: { idle: "Idle" }, walker_sundress: { cheer: "Cheer_with_Both_Hands_Up" } } },
  jogger: { clips: { rest: "Catching_Breath", cheer: "Victory_Cheer" }, share: { dog_walker: { idle: "Idle" }, elder_polo: { sit: "Chair_Sit_Idle_M" } } },
  dog_walker: { clips: { idle: "Idle", cheer: "Motivational_Cheer" }, share: { elder_polo: { sit: "Chair_Sit_Idle_M" } } },
  stroller_dad: { clips: { idle: "Idle" }, share: { elder_polo: { sit: "Chair_Sit_Idle_M" }, walker_sundress: { cheer: "Cheer_with_Both_Hands_Up" } }, push: true },
  cyclist: { clips: { sit: "Chair_Sit_Idle_M", idle: "Idle" }, share: { walker_sundress: { cheer: "Cheer_with_Both_Hands_Up" } }, ride: true },
};
// fit: the dimension scaled to m; long: the glTF axis the longest horizontal
// side turns to; yaw: then turned about up so the front is at +z.
export const PROPS = {
  dog: { dir: "people", fit: "length", m: 0.9, long: "z", lod1: 700, rig: "dog" },
  stroller: { dir: "people", fit: "length", m: 0.95, long: "z", yaw: 180, lod1: 600, spin: { clip: "push", frames: 30, parts: [{ name: "wheels_rear", c: [-0.35, 0.17], r: 0.18, rin: 0.04, x: [0.18, 0.3], turns: 1 }, { name: "wheels_front", c: [0.42, 0.15], r: 0.16, rin: 0.04, x: [0.18, 0.3], turns: 1 }] } },
  drinking_fountain: { dir: "props/street", fit: "height", m: 1.0, long: "x", lod1: 400 },
  bollard: { dir: "props/street", fit: "height", m: 0.9, long: "x", lod1: 120, tex: 512 },
  traffic_cone: { dir: "props/street", fit: "height", m: 0.7, long: "x", lod1: 120, tex: 512 },
  barricade: { dir: "props/street", fit: "length", m: 1.2, long: "x", lod1: 300 },
  e_scooter: { dir: "props/beltline", fit: "length", m: 1.15, long: "z", lod1: 600, spin: { clip: "roll", frames: 30, parts: [{ name: "wheel_rear", c: [-0.42, 0.14], r: 0.16, rin: 0.03, x: [0, 0.05], turns: 3 }, { name: "wheel_front", c: [0.43, 0.14], r: 0.16, rin: 0.03, x: [0, 0.05], turns: 3 }] } },
  city_bike: { dir: "props/beltline", fit: "length", m: 1.8, long: "z", lod1: 800, spin: { clip: "ride", frames: 30, parts: [{ name: "wheel_rear", c: [-0.575, 0.33], r: 0.36, rin: 0, x: [0, 0.05], turns: 2 }, { name: "wheel_front", c: [0.575, 0.33], r: 0.36, rin: 0, x: [0, 0.05], turns: 2 }, { name: "crank", c: [0, 0.29], r: 0.2, rin: 0, x: [0.09, 0.2], turns: 1, top: true }] } },
  bike_dock: { dir: "props/beltline", fit: "height", m: 1.1, long: "x", lod1: 400 },
  food_cart: { dir: "props/beltline", fit: "length", m: 2.2, long: "x", lod1: 800 },
  picnic_table: { dir: "props/beltline", fit: "length", m: 1.8, long: "x", lod1: 400 },
  patio_umbrella: { dir: "props/beltline", fit: "height", m: 2.5, long: "x", lod1: 250 },
  sculpture_ribbon: { dir: "props/beltline", fit: "height", m: 4.0, long: "x", lod1: 1000, lod1Distance: 60 },
};
const DIRS = {
  people: "Pedestrians for the crowd (#133): six rigged everyday Atlantans, a dog and a stroller.",
  "props/street": "Street furniture the kit was missing: drinking fountain and bollard (the OSM amenity=drinking_water and barrier=bollard kinds), plus construction cone and barricade.",
  "props/beltline": "BeltLine props (#115): shared e-scooter, city bike and its dock, food cart, picnic table, patio umbrella, and one original public-art sculpture.",
};

const only = opt("--only", [...Object.keys(PEOPLE), ...Object.keys(PROPS)].join(",")).split(",");
mkdirSync(`${RAW}/stats`, { recursive: true });
const run = (script, a) => {
  const outp = execFileSync(blender, ["-b", "-P", script, "--", ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
  const line = outp.split("\n").find((l) => l.startsWith("STATS "));
  if (!line) throw new Error(`${script} ${a.join(" ")}: no STATS\n${outp.slice(-3000)}`);
  return JSON.parse(line.slice(6));
};

for (const id of only) {
  if (PEOPLE[id]) {
    const p = PEOPLE[id];
    mkdirSync("assets/people", { recursive: true });
    const clips = ["walk=walk", "run=run", ...Object.entries(p.clips).map(([g, a]) => `${g}=${a}`)].join(",");
    const share = Object.entries(p.share ?? {}).flatMap(([who, c]) => Object.entries(c).map(([g, a]) => `${who}:${g}=${a}`)).join(",");
    const a = [remade(id) ? RAW2 : RAW, id, `assets/people/${id}.glb`, "--clips", clips, "--actions", RAW, "--stats", `${RAW}/stats/${id}.json`];
    if (share) a.push("--share", share);
    if (p.push) a.push("--push");
    if (p.ride) a.push("--ride");
    run("scripts/blender/people.py", a);
  } else if (PROPS[id]) {
    const p = PROPS[id];
    mkdirSync(`assets/${p.dir}`, { recursive: true });
    const out = p.rig || p.spin ? `${RAW}/${id}_static.glb` : `assets/${p.dir}/${id}.glb`;
    const s = run("scripts/blender/people_props.py", [`${RAW}/${id}.glb`, out, id, "--fit", p.fit, "--m", String(p.m), "--long", p.long, "--yaw", String(p.yaw ?? 0), "--lod1", String(p.lod1), "--lod1-distance", String(p.lod1Distance ?? 20), "--tex", String(p.tex ?? 1024), "--stats", `${RAW}/stats/${id}.json`]);
    if (p.rig === "dog") {
      const r = run("scripts/blender/dog_rig.py", [out, `assets/${p.dir}/${id}.glb`]);
      writeFileSync(`${RAW}/stats/${id}.json`, JSON.stringify({ ...s, bones: r.bones, clips: r.clips }, null, 2));
    }
    if (p.spin) {
      writeFileSync(`${RAW}/stats/${id}_spin.json`, JSON.stringify(p.spin));
      const r = run("scripts/blender/prop_wheels.py", [out, `assets/${p.dir}/${id}.glb`, id, `${RAW}/stats/${id}_spin.json`]);
      const source = `keyed in Blender: ${Object.keys(r.parts).join(", ")} turning (prop_wheels.py)`;
      writeFileSync(`${RAW}/stats/${id}.json`, JSON.stringify({ ...s, triangles: r.triangles, clips: { [r.clip]: { frames: r.frames, source } }, parts: r.parts }, null, 2));
    }
  } else throw new Error(`unknown asset ${id}`);
  console.log("built", id);
}

// Manifests and provenance for every folder (from all the built stats).
const dirOf = (id) => (PEOPLE[id] ? "people" : PROPS[id].dir);
for (const dir of Object.keys(DIRS)) {
  const ids = [...Object.keys(PEOPLE), ...Object.keys(PROPS)].filter((id) => dirOf(id) === dir && existsSync(`${RAW}/stats/${id}.json`) && existsSync(`assets/${dir}/${id}.glb`));
  if (!ids.length) continue;
  const manifest = {
    frame: "glTF model space: +y up, +z forward, origin at the ground center of the footprint, meters. Nodes <id>_lod0 / <id>_lod1, extras.lodDistance in m. People and the dog: one skin over both LODs, clips by game name.",
    assets: {},
  };
  const prov = {
    date: DATE,
    asset: DIRS[dir],
    tool: "Meshy text-to-3D API (POST /openapi/v2/text-to-3d, preview then refine; props: meshy-t2.5, smart topology; people: meshy-7.1 standard, remeshed to 15k triangles, first made on meshy-t2.5 at 6k); people: Meshy rigging (POST /openapi/v1/rigging) and library animations (POST /openapi/v1/animations); then Blender 5.2.3 LTS headless: scripts/blender/people.py (people), scripts/blender/people_props.py (props), scripts/blender/dog_rig.py (dog rig and clips keyed in Blender). Draco GLB export.",
    pipeline: "node scripts/assets/meshy-people-props.mjs --cap 400 (needs MESHY_API_KEY; raw downloads and task records in .meshy-raw/people/, git-ignored); people remade with --only <the six> --out .meshy-raw/people-v2 --cap 400 --model meshy-7.1 --polycount 15000 --no-anim; then node scripts/assets/people-props-build.mjs",
    license: "Generated with the project owner's Meshy account; usage is governed by Meshy's terms of service for that account. Blender steps and keyed clips: original work for this project.",
    style: "Realistic mid-2010s Atlanta, positive everyday people, no branding (prompts forbid logos and text); the sculpture is an original abstract design, not a copy of any artwork.",
    verify: "scripts/assets/people-props-preview.html (in the game's pbr renderer) and node scripts/assets/people-props-shots.mjs",
    files: {},
  };
  for (const id of ids) {
    const s = JSON.parse(readFileSync(`${RAW}/stats/${id}.json`, "utf8"));
    const rec1 = JSON.parse(readFileSync(`${RAW}/${id}.json`, "utf8"));
    const rec = PEOPLE[id] && remade(id) ? JSON.parse(readFileSync(`${RAW2}/${id}.json`, "utf8")) : rec1;
    const bytes = statSync(`assets/${dir}/${id}.glb`).size;
    if (bytes > 10e6) throw new Error(`${id}.glb is ${bytes} bytes (over 10 MB)`);
    const bounds = s.bounds_m.min ? s.bounds_m : { min: [s.bounds_m.x[0], s.bounds_m.y[0], s.bounds_m.z[0]], max: [s.bounds_m.x[1], s.bounds_m.y[1], s.bounds_m.z[1]] };
    manifest.assets[id] = {
      file: `${id}.glb`,
      bytes,
      triangles: s.triangles,
      lodDistance: { lod0: 0, lod1: s.lod1_distance ?? (PEOPLE[id] ? 25 : 20) },
      bounds,
      size: bounds.max.map((v, k) => +(v - bounds.min[k]).toFixed(3)),
      ...(s.clips ? { clips: Object.fromEntries(Object.entries(s.clips).map(([k, v]) => [k, { frames: v.frames, fps: 30, source: v.source, ...(v.shared_from ? { shared_from: v.shared_from.replace("_actions.glb", "") } : {}) }])) } : {}),
      ...(s.bones ? { bones: s.bones } : {}),
      ...(s.parts ? { parts: s.parts } : {}),
      textures: s.textures.filter((t) => t.startsWith(id)),
    };
    const steps = ["preview", "refine", "rig", "anim"].filter((k) => rec[k]);
    const credits = Object.fromEntries(steps.map((k) => [k === "anim" ? "animation" : k, rec[k].credits]));
    // A remade person: its clips were bought with the first body, which the
    // remake replaced (both spends are counted).
    if (rec !== rec1) {
      if (rec1.anim) credits.animation = rec1.anim.credits;
      credits.first_body_replaced = ["preview", "refine", "rig"].reduce((t, k) => t + (rec1[k]?.credits ?? 0), 0);
    }
    prov.files[`${id}.glb`] = {
      prompt: ASSETS[id].prompt,
      texture_prompt: ASSETS[id].texture,
      meshy: {
        ...Object.fromEntries(Object.entries(rec.preview.request).filter(([k]) => !["mode", "prompt"].includes(k))),
        enable_pbr: true,
        texture_resolution: "2k",
        preview_task_id: rec.preview.id,
        refine_task_id: rec.refine.id,
        seed: rec.preview.seed,
        ...(rec.rig ? { rig_task_id: rec.rig.id, height_meters: rec.rig.request.height_meters } : {}),
        ...(rec1.anim ? { animation_task_id: rec1.anim.id, action_ids: rec1.anim.actions } : {}),
        ...(rec !== rec1 ? { first_body: { ai_model: rec1.preview.request.ai_model, target_polycount: rec1.preview.request.target_polycount, preview_task_id: rec1.preview.id, refine_task_id: rec1.refine.id, rig_task_id: rec1.rig.id, replaced: "too blocky up close (6k triangles)" } } : {}),
      },
      generated: rec.refine.finished_at?.slice(0, 10),
      credits: { ...credits, total: Object.values(credits).reduce((a, b) => a + b, 0) },
      blender: PEOPLE[id]
        ? `scripts/blender/people.py ${id} (clips: walk and run from the rig, ${Object.entries(PEOPLE[id].clips).map(([g, a]) => `${g} = ${a}`).join(", ")}${PEOPLE[id].share ? `; shared, 0 credits: ${Object.entries(PEOPLE[id].share).flatMap(([w, c]) => Object.entries(c).map(([g, a]) => `${g} = ${a} of ${w}`)).join(", ")}` : ""}${PEOPLE[id].push ? "; push keyed in Blender (IK)" : ""}${PEOPLE[id].ride ? "; ride keyed in Blender (IK)" : ""})`
        : `scripts/blender/people_props.py ${id} --fit ${PROPS[id].fit} --m ${PROPS[id].m} --long ${PROPS[id].long}${PROPS[id].yaw ? ` --yaw ${PROPS[id].yaw}` : ""} --lod1 ${PROPS[id].lod1}${PROPS[id].rig ? "; then scripts/blender/dog_rig.py" : ""}${PROPS[id].spin ? `; then scripts/blender/prop_wheels.py (${PROPS[id].spin.clip}: ${PROPS[id].spin.parts.map((q) => q.name).join(", ")} turning)` : ""}`,
      result: { bytes, triangles: s.triangles, size_m: manifest.assets[id].size },
    };
  }
  prov.credits_total = Object.values(prov.files).reduce((a, f) => a + f.credits.total, 0);
  writeFileSync(`assets/${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(`assets/${dir}/provenance.json`, JSON.stringify(prov, null, 2) + "\n");
  console.log(dir, ids.length, "assets", prov.credits_total, "credits");
}
