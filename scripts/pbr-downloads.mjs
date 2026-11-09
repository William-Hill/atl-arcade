// Lists the downloads of a perf run (scripts/perf.mjs JSON) by group and by
// file, for each tier and look, split at the first frame (#190). It uses
// run 1 of each tier and look.
//   node scripts/pbr-downloads.mjs docs/perf/190/runs/perf-after.json [--look pbr] [--files]
// --files adds the table of every file of 20 kB or more.
import { readFileSync } from "node:fs";
import { DOWNLOAD_GROUPS, downloadGroupOf } from "./perf-lib.mjs";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const look = args.includes("--look") ? args[args.indexOf("--look") + 1] : "pbr";
const withFiles = args.includes("--files");
const result = JSON.parse(readFileSync(path, "utf8"));
const runs = ["low", "phone", "high"].map((q) => result.runs.find((r) => r.quality === q && r.look === look && r.run === 1) ?? result.runs.find((r) => r.quality === q && r.look === look)).filter(Boolean);
const before = (r, f) => f.startMs == null || f.startMs < r.firstFrameMs;
const mb = (kB) => (kB / 1024).toFixed(2);

const groups = [...DOWNLOAD_GROUPS.map(([g]) => g), "other"];
const lines = [];
lines.push(`${look} look, ${result.date.slice(0, 10)}, MB on the wire before / after the first frame (run 1).`);
lines.push("");
lines.push(`| Group | ${runs.map((r) => `${r.quality} before | ${r.quality} after`).join(" | ")} |`);
lines.push(`|---|${runs.map(() => "---|---").join("|")}|`);
const sum = (r, g, b) => r.files.filter((f) => (g == null || downloadGroupOf(f.file) === g) && before(r, f) === b).reduce((s, f) => s + f.kB, 0);
for (const g of groups) {
  if (runs.every((r) => sum(r, g, true) + sum(r, g, false) === 0)) continue;
  lines.push(`| ${g} | ${runs.map((r) => `${mb(sum(r, g, true))} | ${mb(sum(r, g, false))}`).join(" | ")} |`);
}
lines.push(`| **total** | ${runs.map((r) => `**${mb(sum(r, null, true))}** | **${mb(sum(r, null, false))}**`).join(" | ")} |`);
lines.push(`| first frame ms | ${runs.map((r) => `${r.firstFrameMs} | `).join(" | ")} |`);
if (withFiles) {
  for (const r of runs) {
    lines.push("");
    lines.push(`${r.quality}/${look}: files of 20 kB or more (first frame at ${r.firstFrameMs} ms).`);
    lines.push("");
    lines.push("| File | Group | kB | Start ms | Before the first frame |");
    lines.push("|---|---|---|---|---|");
    for (const f of r.files.filter((f) => f.kB >= 20)) lines.push(`| \`${f.file.replace(/^\/assets\//, "")}\` | ${downloadGroupOf(f.file)} | ${f.kB} | ${f.startMs ?? "-"} | ${before(r, f) ? "yes" : "no"} |`);
  }
}
console.log(lines.join("\n"));
