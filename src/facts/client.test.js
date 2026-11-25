import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BLOCKED_DATASETS, MAX_FACT_LENGTH, citySourceUrl, composeFact, factsMode, fillTemplate, fixtureFacts, reviewFact } from "./client.js";
import fixture from "./fixtures/beltline-eastside.json";

const SPECS = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/facts.json", import.meta.url), "utf8")).cards;

describe("fillTemplate", () => {
  const rows = [{ NAME: "Old Fourth Ward", AC: 12.6 }, { NAME: "Inman Park", AC: 3 }, { NAME: "Inman Park", AC: 1 }];
  it("fills a field, a rounded number, the row count, and a sorted list", () => {
    expect(fillTemplate("{NAME}", rows)).toBe("Old Fourth Ward");
    expect(fillTemplate("{round:AC} acres", rows)).toBe("13 acres");
    expect(fillTemplate("{count} rows", rows)).toBe("3 rows");
    expect(fillTemplate("{list:NAME}", rows)).toBe("Inman Park and Old Fourth Ward");
    expect(fillTemplate("{list:N}", [{ N: "C" }, { N: "A" }, { N: "B" }])).toBe("A, B and C");
  });
  it("gives null for no rows, a missing field, a bad number, or an unknown function", () => {
    expect(fillTemplate("{NAME}", [])).toBeNull();
    expect(fillTemplate("{OTHER}", rows)).toBeNull();
    expect(fillTemplate("{round:NAME}", rows)).toBeNull();
    expect(fillTemplate("{round:AC}", [{ AC: null }])).toBeNull();
    expect(fillTemplate("{upper:NAME}", rows)).toBeNull();
  });
});

describe("reviewFact", () => {
  it("passes a neutral one-line text", () => {
    expect(reviewFact("Freedom Park covers 124 acres of city park land.", "atl-parks")).toEqual([]);
  });
  it("blocks crime, police, and danger words, a blocked dataset, two lines, and a long text", () => {
    expect(reviewFact("Crime fell here.", "atl-parks")).toEqual(['blocked word "Crime"']);
    expect(reviewFact("A police station.", "atl-parks")[0]).toMatch(/police/);
    expect(reviewFact("Two crashes a year.", "atl-parks")[0]).toMatch(/crashes/);
    expect(reviewFact("A count.", "apd-crime-incidents")).toContain("blocked dataset apd-crime-incidents");
    expect(reviewFact("one\ntwo", "atl-parks")).toContain("more than one line");
    expect(reviewFact("x".repeat(MAX_FACT_LENGTH + 1), "atl-parks")[0]).toMatch(/longer/);
    expect(reviewFact("", "atl-parks")).toEqual(["empty"]);
  });
});

describe("the BeltLine fact cards", () => {
  it("has 3 cards, each with a dataset that is not blocked", () => {
    expect(SPECS).toHaveLength(3);
    for (const s of SPECS) expect(BLOCKED_DATASETS).not.toContain(s.dataset);
  });
  it("gives a reviewed one-line text and a City of Atlanta source link for each card from the fixture", () => {
    const cards = fixtureFacts(SPECS, fixture);
    expect(cards.map((c) => c.text)).toEqual([
      "The Eastside Trail links 3 neighborhoods here: Inman Park, Old Fourth Ward and Poncey-Highland.",
      "Freedom Park covers 124 acres of city park land.",
      "Inman Park-Reynoldstown MARTA rail station is within a mile of the trail.",
    ]);
    for (const c of cards) {
      expect(reviewFact(c.text, c.dataset)).toEqual([]);
      expect(c.sourceUrl).toMatch(/^https:\/\/gis\.atlantaga\.gov\/dpcd\/rest\/services\/OpenDataService1\/FeatureServer\/\d+$/);
      expect(c.publisher).toBe("City of Atlanta Department of City Planning");
      expect(c.origin).toBe("fixture");
    }
    expect(cards.map((c) => c.sourceUrl.split("/").pop())).toEqual(["3", "26", "28"]);
  });
});

describe("citySourceUrl", () => {
  it("gives the ArcGIS layer of a recorded City of Atlanta query URL", () => {
    expect(citySourceUrl("https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/FeatureServer/26/query?where=1%3D1&f=json")).toBe("https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/FeatureServer/26");
    expect(citySourceUrl("https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/AddressPoint/MapServer/0")).toBe("https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/AddressPoint/MapServer/0");
  });
  it("gives no link for a host that is not a City of Atlanta source, a bad URL, or no layer", () => {
    expect(citySourceUrl("https://example.com/datasets/atl-parks")).toBeNull();
    expect(citySourceUrl("http://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/FeatureServer/26")).toBeNull();
    expect(citySourceUrl("https://gis.atlantaga.gov.example.com/x/FeatureServer/1")).toBeNull();
    expect(citySourceUrl("https://gis.atlantaga.gov/dpcd/rest/services")).toBeNull();
    expect(citySourceUrl("not a url")).toBeNull();
  });
  it("gives a card with the source name and no link when the source is not a city source", () => {
    const spec = SPECS[1];
    const response = { rows: fixture["freedom-park"].rows, sources: [{ ...fixture["freedom-park"].sources[0], url: "https://example.com/api/tools/query_dataset" }] };
    const card = composeFact(spec, response);
    expect(card.title).toBe("Parks");
    expect(card.sourceUrl).toBeNull();
  });
});
