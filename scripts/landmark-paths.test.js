import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ABSOLUTE_HOME, landmarkFiles, relativizePaths } from "./landmark-paths.mjs";

const KSM = "landmarks/krog-street-market";
const WT = "/Users/someone/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f";

describe("relativizePaths", () => {
  it("writes a worktree path in the landmark folder as a relative path", () => {
    const text = JSON.stringify({ crop: { path: `${WT}/${KSM}/crops/front-masked.png` } });
    expect(JSON.parse(relativizePaths(text, KSM)).crop.path).toBe("crops/front-masked.png");
  });

  it("writes a path in another folder of the repository relative to the landmark folder", () => {
    expect(relativizePaths(`"${WT}/assets/landmarks/textures/brick/color.jpg"`, KSM)).toBe('"../../assets/landmarks/textures/brick/color.jpg"');
    expect(relativizePaths(`"/home/ci/src/atl-arcade/${KSM}"`, KSM)).toBe('"."');
  });

  it("writes a path in the main checkout as a relative path", () => {
    expect(relativizePaths(`see /Users/someone/Development/atl-arcade/${KSM}/renders/v2-blockout/cmp.png now`, KSM)).toBe("see renders/v2-blockout/cmp.png now");
  });

  it("writes an img2threejs skill path as <img2threejs>", () => {
    const release = "/Users/someone/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json";
    expect(relativizePaths(`"${release}"`, KSM)).toBe('"<img2threejs>/docs/materials/material-reference.json"');
    expect(relativizePaths("/Users/someone/.claude/skills/img2threejs/grimoire/review/x.md", KSM)).toBe("<img2threejs>/grimoire/review/x.md");
  });

  it("writes any other home folder path as ~/", () => {
    expect(relativizePaths("/Users/someone/Downloads/photo.jpg", KSM)).toBe("~/Downloads/photo.jpg");
  });

  it("changes no other text, and a second run changes nothing", () => {
    const text = `a "${WT}/${KSM}/ref/front.jpg" b /usr/local/bin/python3 c`;
    const once = relativizePaths(text, KSM);
    expect(once).toBe('a "ref/front.jpg" b /usr/local/bin/python3 c');
    expect(relativizePaths(once, KSM)).toBe(once);
  });
});

describe("the landmark files", () => {
  for (const dir of fs.readdirSync("landmarks").map((d) => `landmarks/${d}`)) {
    if (!fs.statSync(dir).isDirectory()) continue;
    it(`${dir} has no absolute home folder path`, () => {
      const bad = landmarkFiles(dir).filter((f) => ABSOLUTE_HOME.test(fs.readFileSync(f, "utf8")));
      expect(bad.map((f) => path.relative(".", f)), "run: node scripts/landmark-paths.mjs " + dir).toEqual([]);
    });
  }
});
