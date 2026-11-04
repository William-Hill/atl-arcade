import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseStyle } from "./styles.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("district styles", () => {
  it("styles mid-size stock from its district mix", () => {
    const krog = LEVEL.buildings.find((b) => b.name === "Krog Street Market");
    const kx = krog.outer.reduce((s, p) => s + p[0], 0) / krog.outer.length;
    const kz = krog.outer.reduce((s, p) => s + p[1], 0) / krog.outer.length;
    // Untyped, mid-size stock within the Inman Park radius. "storefront"
    // is a preserved pick (the mix never un-shops a shop).
    const mix = new Set(["craftsman-house", "shotgun-house", "brick-loft", "stucco-apartment", "garage", "storefront", "brick-warehouse", "industrial-shed"]);
    const styles = new Set(
      LEVEL.buildings
        .filter((b) => {
          if (!b.outer || b.type || b.height >= 30) return false;
          const cx = b.outer.reduce((s, p) => s + p[0], 0) / b.outer.length;
          const cz = b.outer.reduce((s, p) => s + p[1], 0) / b.outer.length;
          return Math.hypot(cx - kx, cz - kz) < 380;
        })
        .map((b) => chooseStyle(b, LEVEL)),
    );
    for (const s of styles) expect(mix.has(s)).toBe(true);
    expect(styles.size).toBeGreaterThan(0);
  });
  it("keeps BY_NAME and BY_TYPE before the district", () => {
    const pcm = LEVEL.buildings.find((b) => b.name === "Ponce City Market");
    expect(chooseStyle(pcm, LEVEL)).toBe("brick-warehouse");
    const krog = LEVEL.buildings.find((b) => b.name === "Krog Street Market");
    expect(chooseStyle(krog, LEVEL)).toBe("brick-market-hall");
  });
});
