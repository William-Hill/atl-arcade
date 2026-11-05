// Builds the #114 style frames from the in-game captures: one JPG and one
// provenance.json per option in docs/style-frames/<subject>/, the today
// frames in docs/style-frames/today/, and a contact sheet of all options,
// grouped by subject. ImageMagick 6 only (no image model, 0 credits).
//   node scripts/art/style-frames.mjs --raw ~/evidence/art/raw [--out docs/style-frames]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, f) => (args.includes(n) ? args[args.indexOf(n) + 1] : f);
const raw = opt("--raw", "frames");
const out = opt("--out", "docs/style-frames");
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const manifest = JSON.parse(readFileSync("scripts/art/style-frames.json", "utf8"));
const shots = Object.fromEntries(JSON.parse(readFileSync("scripts/art/shots-today.json", "utf8")).shots.map((s) => [s.name, s]));
// The renderer log of each capture (draw calls, triangles, the applied tune).
const logs = {};
for (const f of readdirSync(raw).filter((f) => f.startsWith("shots-log-")).sort()) {
  for (const e of JSON.parse(readFileSync(join(raw, f), "utf8"))) logs[e.name] = e;
}
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const im = execFileSync("convert", ["-version"], { encoding: "utf8" }).split("\n")[0].replace("Version: ", "");
const three = JSON.parse(readFileSync("node_modules/three/package.json", "utf8")).version;
const pw = JSON.parse(readFileSync("node_modules/@playwright/test/package.json", "utf8")).version;
const date = new Date().toISOString().slice(0, 10);
const tmp = join(tmpdir(), `style-frames-${process.pid}`);
mkdirSync(tmp, { recursive: true });

function build(dir, o, subject) {
  mkdirSync(dir, { recursive: true });
  const src = join(raw, `${o.shot}.png`);
  const shot = shots[o.shot];
  const log = logs[o.shot];
  if (!shot || !log) throw new Error(`no capture for ${o.shot}`);
  let img = src;
  if (o.paintover) {
    img = join(tmp, `${subject}-${o.id}.png`);
    execFileSync("scripts/art/paintover.sh", [o.paintover, src, img]);
  }
  const jpg = join(dir, `${o.id}.jpg`);
  execFileSync("convert", [img, "-strip", "-quality", "84", "-sampling-factor", "4:2:0", jpg]);
  const prov = {
    file: `${o.id}.jpg`,
    title: o.title,
    subject,
    tool: o.paintover
      ? `Skate ATL game renderer (Three.js ${three}, ?look=pbr, Chromium SwiftShader via Playwright ${pw}) + scripts/art/paintover.sh "${o.paintover}" (${im})`
      : `Skate ATL game renderer (Three.js ${three}, ?look=pbr, Chromium SwiftShader via Playwright ${pw})`,
    method: o.paintover ? "in-game capture + scripted paintover (no image model)" : "in-game capture (no image model)",
    prompt: null,
    settings: {
      url: log.url,
      cam: shot.cam,
      params: shot.params ?? {},
      tune: shot.tune ?? null,
      paintover: o.paintover ?? null,
      viewport: [1280, 720],
      capture: "scripts/art/pbr-frames.mjs --shots scripts/art/shots-today.json",
      build: "scripts/art/style-frames.mjs",
      renderer: log.renderer,
      look: log.look,
      grade: log.grade,
      bloom: log.bloom,
      commit,
    },
    credits: 0,
    date,
    license: "Original work for ATL Arcade. In-frame assets keep their own provenance: CC0 Poly Haven ground scans (assets/ground/provenance.json), original murals (assets/murals), original skaters, landmarks and props.",
  };
  writeFileSync(join(dir, `${o.id}.provenance.json`), JSON.stringify(prov, null, 2) + "\n");
  return { jpg, title: o.title };
}

function tile(t, w = 480) {
  const f = join(tmp, `tile-${Math.random().toString(36).slice(2)}.png`);
  execFileSync("convert", [t.jpg, "-resize", `${w}x`, "-gravity", "south", "-background", "#111", "-splice", "0x34",
    "-font", FONT, "-pointsize", "16", "-fill", "#fff", "-annotate", "+0+7", t.title, f]);
  return f;
}
function row(title, tiles) {
  const strip = join(tmp, `row-${Math.random().toString(36).slice(2)}.png`);
  execFileSync("montage", [...tiles.map((t) => tile(t)), "-tile", `${tiles.length}x1`, "-geometry", "+6+6", "-background", "#222", strip]);
  const f = join(tmp, `rowl-${Math.random().toString(36).slice(2)}.png`);
  execFileSync("convert", [strip, "-gravity", "northwest", "-background", "#222", "-splice", "0x46",
    "-font", FONT, "-pointsize", "28", "-fill", "#ffcf6b", "-annotate", "+12+8", title, f]);
  return f;
}

const rows = [];
const today = manifest.today.map((o) => build(join(out, "today"), { ...o, id: o.id }, "today"));
rows.push(row("TODAY: the pbr look as it is (in-game, commit " + commit.slice(0, 7) + ")", today));
for (const s of manifest.subjects) {
  const tiles = s.options.map((o) => build(join(out, s.id), o, s.id));
  rows.push(row(`STYLE FRAMES: ${s.title} (${tiles.length} options)`, tiles));
}
execFileSync("convert", [...rows, "-background", "#222", "-gravity", "west", "-append", "-quality", "82", join(out, "contact-sheet.jpg")]);
writeFileSync(
  join(out, "contact-sheet.provenance.json"),
  JSON.stringify(
    {
      file: "contact-sheet.jpg",
      tool: `${im} montage of the style frames in this folder`,
      method: "contact sheet of in-game captures and scripted paintovers (no image model)",
      prompt: null,
      settings: { build: "scripts/art/style-frames.mjs", manifest: "scripts/art/style-frames.json", commit },
      credits: 0,
      date,
      license: "Original work for ATL Arcade; see each frame's provenance.json.",
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote", join(out, "contact-sheet.jpg"));
