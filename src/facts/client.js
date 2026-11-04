// Fact cards from the open-data-atl site (M1-07, #17). Each card in the
// level data names a dataset, a `query_dataset` input, and a one-line
// template. This module sends the query, fills the template from the rows,
// and checks the text against the content rules in AGENTS.md.
//
// The game must work with no network. Every card has a recorded response
// (the fixture). A card uses the live response only when the live text
// passes the same checks; otherwise it uses the fixture text.
//
// `fetch` is injected, so the module runs in Node (scripts/fetch-facts.mjs)
// and in Vitest with no network.

export const FACTS_SITE = "https://agenticatl.ai";
export const FACTS_TIMEOUT_MS = 4000;

// Datasets that a fact card must not use: their rows are about crime, crashes,
// or harm, and a card must be positive or neutral (AGENTS.md).
export const BLOCKED_DATASETS = ["apd-crime-incidents", "atl-pedestrian-crashes-by-tract", "gdot-traffic-counters"];

// Words that a card text must not contain (AGENTS.md political rules: no
// crime, police, traffic danger, decline, or stigma). A match drops the text.
const BLOCKED_WORDS = /\b(crime|crimes|criminal|police|arrests?|shootings?|violen\w*|murders?|thefts?|robber\w*|assaults?|crash\w*|fatal\w*|deaths?|died|danger\w*|unsafe|blight\w*|declin\w*|poverty|poor|vacant|abandon\w*|homeless\w*|graffiti|gangs?|drugs?)\b/i;

// The longest card text, so it fits one line in the pop-up.
export const MAX_FACT_LENGTH = 110;

// The page on the open-data-atl site for one dataset.
export function datasetPage(id) {
  return `${FACTS_SITE}/datasets/${encodeURIComponent(id)}`;
}

function listOf(values) {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function present(v) {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

// Fills `template` from `rows`. Returns null when a field has no value, so a
// card never shows "undefined" or "NaN".
export function fillTemplate(template, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let ok = true;
  const text = template.replace(/\{([a-z]+:)?([A-Za-z0-9_]+)\}/g, (_, fn, field) => {
    const kind = fn ? fn.slice(0, -1) : null;
    if (!kind && field === "count") return String(rows.length);
    if (kind === "list") {
      const values = [...new Set(rows.map((r) => r[field]).filter(present).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b));
      if (!values.length) ok = false;
      return listOf(values);
    }
    const v = rows[0][field];
    if (kind === "round") {
      const n = Number(v);
      if (!present(v) || !Number.isFinite(n) || n <= 0) ok = false;
      return String(Math.round(n));
    }
    if (kind) {
      ok = false;
      return "";
    }
    if (!present(v)) ok = false;
    return String(v).trim();
  });
  return ok ? text : null;
}

// The content review for one card text: one line, short, and free of the
// blocked words. Returns a list of problems (empty when the text passes).
export function reviewFact(text, dataset) {
  const problems = [];
  if (typeof text !== "string" || !text.trim()) return ["empty"];
  if (BLOCKED_DATASETS.includes(dataset)) problems.push(`blocked dataset ${dataset}`);
  if (/[\r\n]/.test(text)) problems.push("more than one line");
  if (text.length > MAX_FACT_LENGTH) problems.push(`longer than ${MAX_FACT_LENGTH} characters`);
  const word = text.match(BLOCKED_WORDS);
  if (word) problems.push(`blocked word "${word[0]}"`);
  return problems;
}

// One card from a spec and a `query_dataset` response. Null when the text
// cannot be filled or fails the review.
export function composeFact(spec, response) {
  if (!response || !Array.isArray(response.rows)) return null;
  const text = fillTemplate(spec.template, response.rows);
  if (!text || reviewFact(text, spec.dataset).length) return null;
  const source = Array.isArray(response.sources) ? response.sources[0] : null;
  return {
    id: spec.id,
    text,
    dataset: spec.dataset,
    title: source?.title ?? spec.dataset,
    publisher: source?.attribution ?? null,
    fetchedAt: source?.fetchedAt ?? null,
    sourceUrl: datasetPage(spec.dataset),
  };
}

// Sends one `query_dataset` call. `base` is the site origin, or a dev-server
// path that proxies to it. Rejects on a timeout, an HTTP error, or a tool error.
export async function queryFact(spec, { fetch: fetchFn = globalThis.fetch, base = FACTS_SITE, timeoutMs = FACTS_TIMEOUT_MS } = {}) {
  if (BLOCKED_DATASETS.includes(spec.dataset)) throw new Error(`blocked dataset ${spec.dataset}`);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}/api/tools/query_dataset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: spec.dataset, ...spec.query }),
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`query_dataset ${spec.dataset}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`query_dataset ${spec.dataset}: ${body.error}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// The cards of a level from the fixture only. Synchronous, for the first frame.
// `fixture` maps a card id to its recorded response.
export function fixtureFacts(specs, fixture) {
  return specs.map((spec) => {
    const card = composeFact(spec, fixture?.[spec.id]);
    if (!card) throw new Error(`fact card ${spec.id}: the fixture does not give a text that passes the review`);
    return { ...card, origin: "fixture" };
  });
}

// The cards of a level: the live text where the live call works and passes
// the review, the fixture text for every other card. Never rejects.
export async function loadFacts(specs, fixture, opts = {}) {
  const fallback = fixtureFacts(specs, fixture);
  const results = await Promise.allSettled(specs.map((spec) => queryFact(spec, opts)));
  return specs.map((spec, i) => {
    const r = results[i];
    const live = r.status === "fulfilled" ? composeFact(spec, r.value) : null;
    return live ? { ...live, origin: "live" } : { ...fallback[i], error: r.status === "rejected" ? String(r.reason?.message ?? r.reason) : "live text failed the review" };
  });
}

// The fact mode from the page URL. ?facts=fixture or ?facts=live forces one;
// ?facts=0 removes the cards. With no parameter, a browser under automation
// (Playwright sets navigator.webdriver) uses the fixture, so a test never
// calls the network.
export function factsMode(param, { webdriver = false } = {}) {
  if (param === "0" || param === "off") return "off";
  if (param === "fixture" || param === "live") return param;
  return webdriver ? "fixture" : "live";
}
