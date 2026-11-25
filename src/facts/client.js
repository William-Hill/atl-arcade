// Fact cards (M1-07, #17). Each card in the level data names a dataset, a
// `query_dataset` input, and a one-line template. This module fills the
// template from the recorded rows and checks the text against the content
// rules in AGENTS.md.
//
// The game sends no network request for a fact card (#372). It uses only the
// recorded response of each card (the fixture). `scripts/fetch-facts.mjs`
// records the fixture again, offline from the game.
//
// The source link of a card is the public City of Atlanta source of the
// dataset: the ArcGIS layer that the recorded query read.

// Datasets that a fact card must not use: their rows are about crime, crashes,
// or harm, and a card must be positive or neutral (AGENTS.md).
export const BLOCKED_DATASETS = ["apd-crime-incidents", "atl-pedestrian-crashes-by-tract", "gdot-traffic-counters"];

// Words that a card text must not contain (AGENTS.md political rules: no
// crime, police, traffic danger, decline, or stigma). A match drops the text.
const BLOCKED_WORDS = /\b(crime|crimes|criminal|police|arrests?|shootings?|violen\w*|murders?|thefts?|robber\w*|assaults?|crash\w*|fatal\w*|deaths?|died|danger\w*|unsafe|blight\w*|declin\w*|poverty|poor|vacant|abandon\w*|homeless\w*|graffiti|gangs?|drugs?)\b/i;

// The longest card text, so it fits one line in the pop-up.
export const MAX_FACT_LENGTH = 110;

// Hosts of the public City of Atlanta sources. A source URL on another host
// gives no link.
export const CITY_SOURCE_HOSTS = ["gis.atlantaga.gov"];

// The public City of Atlanta page of a recorded source URL: the ArcGIS layer
// (".../FeatureServer/<n>" or ".../MapServer/<n>") with no query. Null when
// the URL is not an https URL on a city host, so the card shows the source
// name with no link.
export function citySourceUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !CITY_SOURCE_HOSTS.includes(u.hostname)) return null;
  const path = u.pathname.replace(/\/query\/?$/, "");
  if (!/\/(FeatureServer|MapServer)\/\d+$/.test(path)) return null;
  return `${u.origin}${path}`;
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
    sourceUrl: source?.url ? citySourceUrl(source.url) : null,
  };
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

// The fact mode from the page URL: ?facts=0 removes the cards. Every other
// value (also the old ?facts=live) uses the fixture. There is no live mode.
export function factsMode(param) {
  if (param === "0" || param === "off") return "off";
  return "fixture";
}
