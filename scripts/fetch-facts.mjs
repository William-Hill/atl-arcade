// Records the fact card fixture for a level (M1-07, #17): sends each card's
// `query_dataset` call to the open-data-atl site, checks the text, and writes
// the responses to src/facts/fixtures/<level>.json.
//
// Usage: node scripts/fetch-facts.mjs [level]   (default: beltline-eastside)
// Read the printed texts and apply the content review before you commit.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFact, queryFact } from "../src/facts/client.js";

const level = process.argv[2] ?? "beltline-eastside";
const specs = JSON.parse(readFileSync(new URL(`../levels/${level}/facts.json`, import.meta.url), "utf8")).cards;
const out = {};
for (const spec of specs) {
  const res = await queryFact(spec, { timeoutMs: 20000 });
  // Keep only what a card reads: the rows and the source.
  out[spec.id] = { datasetId: res.datasetId, rows: res.rows, sources: res.sources };
  const card = composeFact(spec, res);
  if (!card) throw new Error(`${spec.id}: the live text is empty or fails the review`);
  console.log(`${spec.id}: ${card.text}  [${card.sourceUrl}]`);
}
const path = new URL(`../src/facts/fixtures/${level}.json`, import.meta.url);
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${path.pathname}`);
