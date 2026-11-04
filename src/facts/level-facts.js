// The fact card data of each level (M1-07, #17): the card specs from the
// level folder and the recorded fixture. A level that is not here has no cards.

export const LEVEL_FACTS = {
  "beltline-eastside": async () => ({
    specs: (await import("../../levels/beltline-eastside/facts.json")).default.cards,
    fixture: (await import("./fixtures/beltline-eastside.json")).default,
  }),
};

// The site origin for the live calls. The dev server proxies /oda-api to the
// open-data-atl site, because the site sends no CORS header (see
// docs/decisions.md). A production build calls the site directly, and a
// blocked call falls back to the fixture.
export function factsBase(dev) {
  return dev ? "/oda-api" : undefined;
}
