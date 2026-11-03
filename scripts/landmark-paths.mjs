// Removes absolute local paths from the img2threejs files of a landmark.
//
// The img2threejs tools write absolute paths (for example
// /Users/<name>/Development/atl-arcade/.claude/worktrees/<w>/landmarks/...)
// into the spec, the analysis files, the pass checks, and the generated
// factory. These paths show a user name and point to a folder that other
// computers do not have. This script writes:
//
// - a path in the repository as a path relative to the landmark folder
//   (for example `crops/front.png` or `../../assets/landmarks/x.json`),
// - a path in the img2threejs skill as `<img2threejs>/...`,
// - any other home folder path as `~/...`.
//
// run_pass.sh and review.sh of each landmark run it after the tools.
//   node scripts/landmark-paths.mjs landmarks/<name> [--check]
// With --check, the script changes no file and exits 1 if a file has a path.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The characters that end a path in JSON, TypeScript, shell and text files.
const END = "[^\\s\"'`)\\]>,;]*";
// A home folder: /Users/<name>/ (macOS) or /home/<name>/ (Linux).
const HOME = "/(?:Users|home)/[^/\\s\"'`]+/";
// The repository root in a home folder: the main checkout or a worktree.
const REPO = new RegExp(`${HOME}(?:[^\\s"'\`]*?/)?atl-arcade/(?:\\.claude/worktrees/[^/\\s"'\`]+/)?(${END})`, "g");
// The img2threejs skill: the release folder or the skill link.
const SKILL = new RegExp(`${HOME}(?:\\.img2threejs/releases/[0-9a-f]+/img2threejs|\\.claude/skills/img2threejs)(?=/|\\b)`, "g");
const OTHER_HOME = new RegExp(HOME, "g");
// A short test for any home folder path that is left.
export const ABSOLUTE_HOME = new RegExp(HOME);

// Pure: `text` with the absolute paths replaced. `landmarkDir` is the
// landmark folder relative to the repository root (landmarks/<name>).
export function relativizePaths(text, landmarkDir) {
  return text
    .replace(REPO, (_, rest) => path.posix.relative(landmarkDir, rest) || ".")
    .replace(SKILL, "<img2threejs>")
    .replace(OTHER_HOME, "~/");
}

// The text files that the img2threejs tools write.
const TEXT = new Set([".json", ".txt", ".ts", ".md", ".sh", ".html", ".py"]);

export function landmarkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...landmarkFiles(p));
    } else if (TEXT.has(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const check = argv.includes("--check");
  const dirs = argv.filter((a) => !a.startsWith("--"));
  if (dirs.length === 0) {
    console.error("usage: node scripts/landmark-paths.mjs landmarks/<name> [--check]");
    return 2;
  }
  let found = 0;
  for (const dir of dirs) {
    const landmarkDir = path.relative(root, path.resolve(dir)).split(path.sep).join("/");
    for (const file of landmarkFiles(path.join(root, landmarkDir))) {
      const text = fs.readFileSync(file, "utf8");
      const fixed = relativizePaths(text, landmarkDir);
      if (fixed === text) continue;
      found += 1;
      const name = path.relative(root, file);
      if (check) console.log(`absolute path: ${name}`);
      else fs.writeFileSync(file, fixed);
    }
  }
  if (!check) console.log(`landmark-paths: ${found} file(s) changed`);
  return check && found > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
