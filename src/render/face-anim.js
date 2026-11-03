// Face state for the skater model: the eye and mouth decal per frame. Pure:
// no Three.js. The renderer applies the result with skater-face.js.
//
// The mood comes from the body clip. Nia blinks at random intervals while
// her eyes are open. A cheer (a banked combo) holds a big smile for a moment.

export const EYES = ["open", "half", "closed", "happy"];
export const MOUTHS = ["neutral", "smile", "open"];

export const FACE = {
  blinkMin: 2.2, // s between blinks
  blinkMax: 5.0,
  blink: [
    // [eyes, duration s]: one blink
    ["half", 0.04],
    ["closed", 0.07],
    ["half", 0.05],
  ],
  cheerTime: 1.2, // s of the cheer face after a banked combo
  landSmile: 0.7, // s of the smile after a landing
};

// The base face for each clip. Clips that are not in the table use `cruise`.
const MOODS = {
  idle: { eyes: "open", mouth: "smile" },
  push: { eyes: "open", mouth: "neutral" },
  coast: { eyes: "open", mouth: "smile" },
  ride_back: { eyes: "open", mouth: "smile" },
  carve_left: { eyes: "open", mouth: "smile" },
  carve_right: { eyes: "open", mouth: "smile" },
  jump: { eyes: "open", mouth: "neutral" },
  land: { eyes: "open", mouth: "smile" },
  manual: { eyes: "open", mouth: "neutral" },
  bail: { eyes: "closed", mouth: "open" },
};
const CHEER = { eyes: "happy", mouth: "open" };

export function moodFor(clip) {
  if (!clip) return { eyes: "open", mouth: "neutral" };
  if (clip.startsWith("dance_")) return { eyes: "happy", mouth: "smile" };
  if (clip.startsWith("air_")) return { eyes: "open", mouth: "open" };
  if (clip.startsWith("grind_")) return { eyes: "open", mouth: "neutral" };
  return MOODS[clip] ?? { eyes: "open", mouth: "neutral" };
}

// A small deterministic random source, so that the tests and the playtest
// harness see the same blinks.
function nextRandom(seed) {
  const s = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return { seed: s, value: s / 4294967296 };
}

function blinkGap(seed) {
  const r = nextRandom(seed);
  return { seed: r.seed, gap: FACE.blinkMin + r.value * (FACE.blinkMax - FACE.blinkMin) };
}

export function createFaceState(seed = 1) {
  const r = blinkGap(seed >>> 0);
  return { seed: r.seed, untilBlink: r.gap, blinkTime: -1, cheer: 0, smile: 0, clip: null, eyes: "open", mouth: "neutral" };
}

// Starts the cheer face (a banked combo).
export const cheer = (state) => ({ ...state, cheer: FACE.cheerTime });

function blinkEyes(t) {
  let acc = 0;
  for (const [eyes, d] of FACE.blink) {
    acc += d;
    if (t < acc) return eyes;
  }
  return null;
}

const BLINK_LENGTH = FACE.blink.reduce((n, [, d]) => n + d, 0);

// One frame. `clip` is the body clip that plays now.
export function stepFace(prev, clip, dt) {
  const next = { ...prev, cheer: Math.max(0, prev.cheer - dt), smile: Math.max(0, prev.smile - dt) };
  if (clip === "land" && prev.clip !== "land") next.smile = FACE.landSmile;
  next.clip = clip;

  let face = moodFor(clip);
  if (next.smile > 0 && face.mouth === "neutral") face = { ...face, mouth: "smile" };
  if (next.cheer > 0 && clip !== "bail") face = CHEER;

  // Blinks run only while the eyes are open.
  if (next.blinkTime >= 0) {
    next.blinkTime += dt;
    if (next.blinkTime >= BLINK_LENGTH) {
      next.blinkTime = -1;
      const r = blinkGap(next.seed);
      next.seed = r.seed;
      next.untilBlink = r.gap;
    }
  } else {
    next.untilBlink -= dt;
    if (next.untilBlink <= 0 && face.eyes === "open") next.blinkTime = 0;
  }
  let eyes = face.eyes;
  if (next.blinkTime >= 0 && face.eyes === "open") eyes = blinkEyes(next.blinkTime) ?? "open";
  next.eyes = eyes;
  next.mouth = face.mouth;
  return next;
}
