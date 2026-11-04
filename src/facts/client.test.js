import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BLOCKED_DATASETS, MAX_FACT_LENGTH, composeFact, datasetPage, factsMode, fillTemplate, fixtureFacts, loadFacts, queryFact, reviewFact } from "./client.js";
import fixture from "./fixtures/beltline-eastside.json";

const SPECS = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/facts.json", import.meta.url), "utf8")).cards;

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

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
  it("gives a reviewed one-line text and a dataset link for each card from the fixture", () => {
    const cards = fixtureFacts(SPECS, fixture);
    expect(cards.map((c) => c.text)).toEqual([
      "The Eastside Trail links 3 neighborhoods here: Inman Park, Old Fourth Ward and Poncey-Highland.",
      "Freedom Park covers 124 acres of city park land.",
      "Inman Park-Reynoldstown MARTA rail station is within a mile of the trail.",
    ]);
    for (const c of cards) {
      expect(reviewFact(c.text, c.dataset)).toEqual([]);
      expect(c.sourceUrl).toBe(datasetPage(c.dataset));
      expect(c.sourceUrl).toMatch(/^https:\/\/agenticatl\.ai\/datasets\//);
      expect(c.publisher).toBe("City of Atlanta Department of City Planning");
      expect(c.origin).toBe("fixture");
    }
  });
});

describe("queryFact and loadFacts", () => {
  const spec = SPECS[1];
  it("posts the query_dataset input to the tools API", async () => {
    let seen = null;
    const fetch = async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return jsonResponse(fixture["freedom-park"]);
    };
    await queryFact(spec, { fetch, base: "/oda" });
    expect(seen.url).toBe("/oda/api/tools/query_dataset");
    expect(seen.body).toEqual({ id: "atl-parks", ...spec.query });
  });
  it("uses the live text when the live call works", async () => {
    const live = { rows: [{ NAME: "Freedom Park", GIS_AC: 130.2 }], sources: fixture["freedom-park"].sources };
    const cards = await loadFacts([spec], fixture, { fetch: async () => jsonResponse(live) });
    expect(cards[0]).toMatchObject({ origin: "live", text: "Freedom Park covers 130 acres of city park land." });
  });
  it("uses the fixture text with no network, on an HTTP error, a tool error, or a live text that fails the review", async () => {
    const cases = [
      async () => {
        throw new TypeError("Failed to fetch");
      },
      async () => jsonResponse({ error: "rate limited" }, 429),
      async () => jsonResponse({ error: "Unknown dataset" }),
      async () => jsonResponse({ rows: [{ NAME: "Freedom Park police post", GIS_AC: 1 }] }),
      async () => jsonResponse({ rows: [] }),
    ];
    for (const fetch of cases) {
      const [card] = await loadFacts([spec], fixture, { fetch });
      expect(card.origin).toBe("fixture");
      expect(card.text).toBe("Freedom Park covers 124 acres of city park land.");
      expect(card.error).toBeTruthy();
    }
  });
  it("uses the fixture text when the live call takes longer than the timeout", async () => {
    const fetch = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const [card] = await loadFacts([spec], fixture, { fetch, timeoutMs: 20 });
    expect(card.origin).toBe("fixture");
  });
  it("throws when the fixture has no text for a card", () => {
    expect(() => fixtureFacts([spec], {})).toThrow(/freedom-park/);
  });
  it("does not query a blocked dataset", async () => {
    await expect(queryFact({ ...spec, dataset: "apd-crime-incidents" }, { fetch: async () => jsonResponse({ rows: [] }) })).rejects.toThrow(/blocked/);
  });
});

describe("factsMode", () => {
  it("reads the URL parameter, and uses the fixture under automation", () => {
    expect(factsMode(null)).toBe("live");
    expect(factsMode(null, { webdriver: true })).toBe("fixture");
    expect(factsMode("live", { webdriver: true })).toBe("live");
    expect(factsMode("fixture")).toBe("fixture");
    expect(factsMode("0")).toBe("off");
  });
});

describe("composeFact", () => {
  it("gives null for a response with no rows", () => {
    expect(composeFact(SPECS[0], null)).toBeNull();
    expect(composeFact(SPECS[0], { error: "x" })).toBeNull();
  });
});
