// Fact card collection (M1-07, #17). Pure and immutable. A card is a point
// in the level; the skater collects it when the skater comes near. Each
// card counts once per run and adds `points` to the banked score.

export const FACT_CARDS = {
  radius: 2.5, // m in the ground plane from the skater to the card center. min 1.5 / typical 2.5 / max 4.
  height: 4, // m: the most height between the skater and the card. min 2 / typical 4 / max 6.
  points: 250, // banked points per card. min 100 / typical 250 / max 500.
  showSeconds: 2, // s the pop-up shows the card text. Play does not pause.
};

// `cards` is [{ id, position: [x, y, z] }].
export function createCardState(cards = []) {
  return { cards: cards.map((c) => ({ id: c.id, position: [...c.position] })), collected: [], count: 0, total: cards.length };
}

// The ids of the cards that the skater at `position` collects now.
export function cardsInReach(state, position, k = FACT_CARDS) {
  const [x, y, z] = position;
  return state.cards
    .filter((c) => !state.collected.includes(c.id))
    .filter((c) => Math.hypot(c.position[0] - x, c.position[2] - z) <= k.radius && Math.abs(c.position[1] - y) <= k.height)
    .map((c) => c.id);
}

// Returns { state, collected } where `collected` holds the ids collected this step.
export function stepCards(state, position, k = FACT_CARDS) {
  const collected = cardsInReach(state, position, k);
  if (!collected.length) return { state, collected };
  const all = [...state.collected, ...collected];
  return { state: { ...state, collected: all, count: all.length }, collected };
}
