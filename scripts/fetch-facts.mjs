// Records the fact card fixture for a level (M1-07, #17): sends each card's
// `query_dataset` call to the open-data-atl site, checks the text, and writes
// the responses to src/facts/fixtures/<level>.json. The game reads only this
// fixture; it sends no request to the site (#372).
//
// Usage: node scripts/fetch-facts.mjs [level]   (default: beltline-eastside)
// ODA_SITE=<origin> sets another site origin.
// Read the printed texts and apply the content review before you commit.
// Each card must get a City of Atlanta source link (printed after the text).

import { readFileSync, writeFileSync } from "node:fs";
import { composeFact } from "../src/facts/client.js";
import { queryFact } from "./facts-query.mjs";

const level = process.argv[2] ?? "beltline-eastside";
const specs = JSON.parse(readFileSync(new URL(`../levels/${level}/facts.json`, import.meta.url), "utf8")).cards;
const out = {};
for (const spec of specs) {
  const res = await queryFact(spec);
  // Keep only what a card reads: the rows and the source.
  out[spec.id] = { datasetId: res.datasetId, rows: res.rows, sources: res.sources };
  const card = composeFact(spec, res);
  if (!card) throw new Error(`${spec.id}: the live text is empty or fails the review`);
  if (!card.sourceUrl) console.warn(`${spec.id}: no City of Atlanta source URL; the card shows the source name with no link`);
  console.log(`${spec.id}: ${card.text}  [${card.sourceUrl ?? "no link"}]`);
}
const path = new URL(`../src/facts/fixtures/${level}.json`, import.meta.url);
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${path.pathname}`);
