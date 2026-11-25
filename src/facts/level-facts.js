// The fact card data of each level (M1-07, #17): the card specs from the
// level folder and the recorded fixture. A level that is not here has no cards.
// The game uses only the fixture and sends no request for a card (#372).

export const LEVEL_FACTS = {
  "beltline-eastside": async () => ({
    specs: (await import("../../levels/beltline-eastside/facts.json")).default.cards,
    fixture: (await import("./fixtures/beltline-eastside.json")).default,
  }),
};
