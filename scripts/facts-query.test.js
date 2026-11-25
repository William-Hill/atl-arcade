import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { queryFact } from "./facts-query.mjs";
import fixture from "../src/facts/fixtures/beltline-eastside.json";

// The offline fixture refresh (scripts/fetch-facts.mjs). The game does not
// use this call (#372).

const SPECS = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/facts.json", import.meta.url), "utf8")).cards;

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("queryFact", () => {
  const spec = SPECS[1];
  it("posts the query_dataset input to the tools API", async () => {
    let seen = null;
    const fetch = async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return jsonResponse(fixture["freedom-park"]);
    };
    const body = await queryFact(spec, { fetch, base: "/oda" });
    expect(seen.url).toBe("/oda/api/tools/query_dataset");
    expect(seen.body).toEqual({ id: "atl-parks", ...spec.query });
    expect(body.rows).toEqual(fixture["freedom-park"].rows);
  });
  it("rejects on an HTTP error, a tool error, and a timeout", async () => {
    await expect(queryFact(spec, { fetch: async () => jsonResponse({ error: "rate limited" }, 429) })).rejects.toThrow(/HTTP 429/);
    await expect(queryFact(spec, { fetch: async () => jsonResponse({ error: "Unknown dataset" }) })).rejects.toThrow(/Unknown dataset/);
    const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(queryFact(spec, { fetch: hang, timeoutMs: 20 })).rejects.toThrow(/aborted/);
  });
  it("does not query a blocked dataset", async () => {
    await expect(queryFact({ ...spec, dataset: "apd-crime-incidents" }, { fetch: async () => jsonResponse({ rows: [] }) })).rejects.toThrow(/blocked/);
  });
});
