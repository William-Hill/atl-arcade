// Issue #303: the share assets exist, have the right sizes, carry a provenance file,
// and index.html points at them with absolute URLs for the link preview.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT));
const html = read("index.html").toString("utf8");
const meta = (attr, key) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];

function pngSize(buf) {
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
function jpegSize(buf) {
  expect(buf.readUInt16BE(0)).toBe(0xffd8);
  let i = 2;
  while (i < buf.length) {
    const marker = buf.readUInt16BE(i);
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF3: the frame header holds the height and the width.
    if (marker >= 0xffc0 && marker <= 0xffc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error("no SOF marker");
}

const FILES = {
  "public/share/skate-atl-card-1200x630.jpg": [1200, 630],
  "public/favicon.svg": null,
  "public/favicon-32.png": [32, 32],
  "public/apple-touch-icon.png": [180, 180],
  "public/brand/loader-art.svg": null,
};

describe("share assets (#303)", () => {
  for (const [file, size] of Object.entries(FILES)) {
    it(`${file} exists with its size and a provenance file`, () => {
      const buf = read(file);
      if (file.endsWith(".png")) expect(pngSize(buf)).toEqual(size);
      if (file.endsWith(".jpg")) expect(jpegSize(buf)).toEqual(size);
      if (file.endsWith(".svg")) expect(buf.toString("utf8")).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="/);
      const provPath = `${file}.provenance.json`;
      expect(existsSync(new URL(provPath, ROOT))).toBe(true);
      const prov = JSON.parse(read(provPath).toString("utf8"));
      expect(prov.file).toBe(file.split("/").pop());
      expect(prov.tool).toBeTruthy();
      expect(prov.prompt).toBeTruthy();
      expect(prov.credits.total).toBe(0);
      expect(prov.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(prov.bytes).toBe(buf.length);
    });
  }

  it("index.html sets the Open Graph and X card tags with an absolute image URL", () => {
    expect(meta("property", "og:title")).toBe("Skate ATL");
    expect(meta("property", "og:description")?.length).toBeGreaterThan(40);
    expect(meta("property", "og:image")).toMatch(/^https:\/\/[^/]+\/share\/skate-atl-card-1200x630\.jpg$/);
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(meta("name", "twitter:image")).toBe(meta("property", "og:image"));
  });

  it("index.html links the favicon set and the loader art", () => {
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />');
    expect(html).toMatch(/<img class="loader-art" src="\/brand\/loader-art.svg"/);
  });
});
