// Game-feel sounds (#105): the pure part. The sounds are synthesized in
// sfx.js (no sample files), so they need no license and no provenance.json.
//
// Each function gives the parameters of one sound from the game state:
// the gain (0..1), the pitch in Hz, the length in s, and the noise part.
// Real skaters must review the sounds and the tuning (AGENTS.md).

export const SFX = {
  // The bonk: a low body thud with a short knock. Louder for a faster hit.
  bonk: { gain: [0.28, 0.6], freq: [120, 85], length: 0.22, knock: 0.2, cooldown: 0.12 },
  // The landing: a wheel clack on a small drop, a deep thud on a big one.
  // `fullHeight` is the fall height (m) of the loudest, lowest landing.
  land: { gain: [0.1, 0.55], freq: [240, 70], length: [0.07, 0.26], noise: [0.35, 0.18], fullHeight: 2.2, minHeight: 0.04 },
  // The scrape: band-passed noise while the skater slides on a wall.
  scrape: { gain: [0.06, 0.2], band: [1500, 3200], minSpeed: 1, fullSpeed: 11, attack: 0.03, release: 0.08 },
};

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;

// Pure: the bonk sound for a strength 0..1 (feel.js feelTriggers().bonk).
export function bonkVoice(strength, k = SFX) {
  const t = clamp01(strength);
  if (t <= 0) return null;
  const B = k.bonk;
  return { gain: lerp(B.gain[0], B.gain[1], t), freq: lerp(B.freq[0], B.freq[1], t), length: B.length, knock: B.knock * t };
}

// Pure: the landing sound for a fall height (m). A higher fall is louder,
// lower and longer, with less of the bright wheel noise. A landing from
// almost no height (a step down) is silent.
export function landVoice(height, k = SFX) {
  const L = k.land;
  if (!(height >= L.minHeight)) return null;
  // A square-root curve: a small drop is audible, a big one is not too loud.
  const t = Math.sqrt(clamp01(height / L.fullHeight));
  return { gain: lerp(L.gain[0], L.gain[1], t), freq: lerp(L.freq[0], L.freq[1], t), length: lerp(L.length[0], L.length[1], t), noise: lerp(L.noise[0], L.noise[1], t) };
}

// Pure: the scrape level for a slide at `speed` m/s, or 0 for no slide.
// Returns { gain, band } (band: the center of the band-pass in Hz).
export function scrapeLevel(sliding, speed, k = SFX) {
  const S = k.scrape;
  const v = Math.abs(speed ?? 0);
  if (!sliding || v < S.minSpeed) return { gain: 0, band: S.band[0] };
  const t = clamp01((v - S.minSpeed) / (S.fullSpeed - S.minSpeed));
  return { gain: lerp(S.gain[0], S.gain[1], t), band: lerp(S.band[0], S.band[1], t) };
}
