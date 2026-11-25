// The `query_dataset` call of the open-data-atl site, for the offline fixture
// refresh only (scripts/fetch-facts.mjs). The game does not import this file
// and sends no request to the site (#372, owner decision 2026-11-24 in #23).
//
// `fetch` is injected, so Vitest runs it with no network.

import { BLOCKED_DATASETS } from "../src/facts/client.js";

export const ODA_SITE = process.env.ODA_SITE ?? "https://agenticatl.ai";
export const QUERY_TIMEOUT_MS = 20000;

// Sends one `query_dataset` call. Rejects on a blocked dataset, a timeout, an
// HTTP error, or a tool error.
export async function queryFact(spec, { fetch: fetchFn = globalThis.fetch, base = ODA_SITE, timeoutMs = QUERY_TIMEOUT_MS } = {}) {
  if (BLOCKED_DATASETS.includes(spec.dataset)) throw new Error(`blocked dataset ${spec.dataset}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}/api/tools/query_dataset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: spec.dataset, ...spec.query }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`query_dataset ${spec.dataset}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`query_dataset ${spec.dataset}: ${body.error}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}
