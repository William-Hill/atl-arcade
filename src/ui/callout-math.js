// Fighting game style text callouts (#305): the queue, the beat timing and
// the look of each frame. Pure: no DOM, no clock. src/ui/callouts.js draws
// the state and src/ui/callouts.css gives the type.
//
// A callout is a list of cards. A card is one word or line that slams in,
// holds and leaves ("3", "2", "1", "SKATE!"). Each card starts on a music
// beat: each card waits for the next beat of the music as it is then (at
// most 1 beat), so a pause or a slow frame does not move the cards off the beat.
//
// Timing comes from the motion design skill of #298: gongnyang/awesome-ai-motion
// (MIT). The numbers are its "Stamp Impact" card (Nº 635,
// effects/stamp-impact): a drop from scale 1.2 to 1 in 180 ms (power4.in),
// a press to scaleY 0.98 for 50 ms and back (power2.out), a 2 px shake for 3
// frames, then a still hold. The exit is its "exit before enter" rule: 0.25 s,
// 12 px, power2.out. The stamp is strongest once per screen, so the
// count-in digits use the softer "pop" (the same drop, no press, no shake).

export const CALLOUT = {
  // The drop (stamp-impact): scale `fromScale` to 1, opacity 0 to 1, power4.in.
  in: 0.18, // s (skill range 0.12 to 0.25)
  fromScale: 1.2, // (skill range 1.1 to 1.4)
  // The press: scaleY to 1 - press, then back, in 2 x pressTime.
  press: 0.02, // (skill range 0.01 to 0.04)
  pressTime: 0.05, // s
  // The shake: `shake` px, one frame of `shakeFrame` s each, sign changes.
  shake: 2, // px (skill range 1 to 4)
  shakeFrames: 3,
  shakeFrame: 0.033, // s (30 fps frames)
  // The exit: fade and rise `rise` px in `out` s (power2.out).
  out: 0.25, // s
  rise: 12, // px
  // With reduced motion: a fade in and a fade out only (a swap fade of
  // 200 ms or less, title-card-rhythm).
  fadeIn: 0.2, // s
  fadeOut: 0.2, // s
  // The length of one beat is kept between these values, so a slow or a fast
  // track does not make a callout too long or too short.
  minBeat: 0.4, // s (150 bpm)
  maxBeat: 0.75, // s (80 bpm)
  // A card that comes up to `lateSnap` s after a beat starts on that beat
  // (its age starts a little past 0); a later card waits for the next beat.
  lateSnap: 0.06, // s
  // The most callouts that wait. A new combo replaces a combo that waits.
  maxQueue: 3,
  // The shortest combo that gets a callout, and the names by banked points.
  comboMinLinks: 4,
  comboNames: [
    { min: 2500, name: "NICE COMBO" },
    { min: 6000, name: "BIG COMBO" },
    { min: 12000, name: "HUGE COMBO" },
    { min: 25000, name: "ATL LEGEND" },
  ],
};

// The priority of each kind. A higher kind goes first in the queue; the round
// end clears the queue and stops the callout on show.
export const PRIORITY = { combo: 1, start: 2, claim: 3, end: 4 };

const MEDAL_WORDS = { gold: "GOLD", silver: "SILVER", bronze: "BRONZE" };
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const clamp01 = (t) => Math.min(1, Math.max(0, t));

// The length of one beat in seconds, inside the limits.
export function beatSeconds(bpm, k = CALLOUT) {
  const len = bpm > 0 ? 60 / bpm : k.maxBeat;
  return Math.min(k.maxBeat, Math.max(k.minBeat, len));
}

// The time of the next beat at or after `now`. `phase` is the place in the
// beat (0 to 1) at `now`, or null when no beat plays (then: `now`). A beat
// that is less than 0.03 beat away counts as now.
export function nextBeat(now, phase, bpm) {
  if (phase === null || phase === undefined || !(bpm > 0)) return now;
  const left = (1 - (((phase % 1) + 1) % 1)) % 1;
  if (left < 0.03 || left > 0.97) return now;
  return now + left * (60 / bpm);
}

// The callouts. Each returns { kind, cards: [{ text, sub, beats, tone }] }.
// `tone` picks the color in the CSS: "go", "claim", "combo", "end", or a medal.
export function startCallout() {
  return {
    kind: "start",
    cards: [
      { text: "3", beats: 1, tone: "count", motion: "pop" },
      { text: "2", beats: 1, tone: "count", motion: "pop" },
      { text: "1", beats: 1, tone: "count", motion: "pop" },
      { text: "SKATE!", beats: 2, tone: "go" },
    ],
  };
}

export function claimCallout(points = 0) {
  return { kind: "claim", cards: [{ text: "SPOT CLAIMED", sub: points > 0 ? `+${fmt(points)}` : "", beats: 3, tone: "claim" }] };
}

// The combo name for a banked combo, or null when the combo is too short.
export function comboName(points, links, k = CALLOUT) {
  if (links < k.comboMinLinks) return null;
  let name = null;
  for (const t of k.comboNames) if (points >= t.min) name = t.name;
  return name;
}

// A banked combo: the name, then the multiplier and the points. Null when
// the combo is too short or too small for a callout.
export function comboCallout(points, { links = 0, multiplier = 1 } = {}, k = CALLOUT) {
  const name = comboName(points, links, k);
  if (!name) return null;
  return { kind: "combo", cards: [{ text: name, sub: `x${multiplier}  ${fmt(points)}`, beats: 3, tone: "combo" }] };
}

// The round end: "ROUND OVER", then the medal and the score. With no medal,
// the score shows under "ROUND OVER" and no medal card follows.
export function endCallout({ medal = null, score = 0 } = {}) {
  const word = MEDAL_WORDS[medal];
  if (!word) return { kind: "end", cards: [{ text: "ROUND OVER", sub: fmt(score), beats: 4, tone: "end" }] };
  return {
    kind: "end",
    cards: [
      { text: "ROUND OVER", beats: 3, tone: "end" },
      { text: word, sub: fmt(score), beats: 4, tone: medal },
    ],
  };
}

// The queue. State: { time, current, queue, shown }.
// current: the card on show (see stepCallouts).
export function createCallouts() {
  return { time: 0, current: null, queue: [], shown: 0 };
}

// Adds a callout. The round end clears the queue and the callout on show.
// A combo replaces a combo that waits; when the queue is full, the callout
// with the lowest priority leaves (the new one, if it is the lowest).
export function pushCallout(state, callout, k = CALLOUT) {
  if (!callout) return state;
  if (callout.kind === "end") return { ...state, current: null, queue: [callout] };
  let queue = state.queue;
  if (callout.kind === "combo") queue = queue.filter((c) => c.kind !== "combo");
  // Stable insert by priority: after every item of the same or a higher priority.
  const p = PRIORITY[callout.kind] ?? 0;
  const at = queue.findIndex((c) => (PRIORITY[c.kind] ?? 0) < p);
  queue = at < 0 ? [...queue, callout] : [...queue.slice(0, at), callout, ...queue.slice(at)];
  while (queue.length > k.maxQueue) {
    let low = 0;
    for (let i = 1; i < queue.length; i += 1) if ((PRIORITY[queue[i].kind] ?? 0) <= (PRIORITY[queue[low].kind] ?? 0)) low = i;
    queue = [...queue.slice(0, low), ...queue.slice(low + 1)];
  }
  return { ...state, queue };
}

// The start of a card that comes up at `now`: on the beat. A beat that
// passed `lateSnap` s ago or less is the start (so a card that is a little
// late does not wait a full beat); otherwise the next beat. With no beat
// playing: `now`.
export function snapBeat(now, phase, bpm, k = CALLOUT) {
  if (phase === null || phase === undefined || !(bpm > 0)) return now;
  const since = (((phase % 1) + 1) % 1) * (60 / bpm);
  if (since <= k.lateSnap) return now - since;
  return nextBeat(now, phase, bpm);
}

// The current callout with card `index` on show from `start`.
function cardAt(c, index, start, beatLen) {
  return { kind: c.kind, cards: c.cards, index, start, beat: beatLen, end: start + c.cards[index].beats * beatLen };
}

// Moves the clock by `dt` (0 while the game is paused). `beat` is
// { phase, bpm } of the music now, or { phase: null, bpm } when no beat
// plays. Each card starts on a beat of the music as it is now: after a
// pause, or after slow frames, the next card finds the beat again.
// current: { kind, cards, index, start, beat, end } (s).
export function stepCallouts(state, dt, beat = { phase: null, bpm: 0 }, k = CALLOUT) {
  const time = state.time + Math.max(0, dt);
  let { current, queue, shown } = state;
  const len = beat.bpm > 0 ? beatSeconds(beat.bpm, k) : null;
  // The phase was read at `time`.
  if (current && time >= current.end) {
    const next = current.index + 1;
    current = next < current.cards.length ? cardAt(current, next, snapBeat(time, beat.phase, beat.bpm, k), len ?? current.beat) : null;
  }
  if (!current && queue.length) {
    const [next, ...rest] = queue;
    current = cardAt(next, 0, snapBeat(time, beat.phase, beat.bpm, k), len ?? beatSeconds(beat.bpm, k));
    queue = rest;
    shown += 1;
  }
  if (time === state.time && current === state.current && queue === state.queue) return state;
  return { time, current, queue, shown };
}

// The card on show now and its age: { card, index, age, length } or null
// (before its beat, or with no callout).
export function activeCard(state) {
  const c = state.current;
  if (!c || state.time < c.start || state.time >= c.end) return null;
  return { card: c.cards[c.index], index: c.index, age: state.time - c.start, length: c.end - c.start };
}

const power4In = (t) => t ** 4;
const power2Out = (t) => 1 - (1 - t) ** 2;

// The look of a card at `age` s of `length` s:
// { opacity, scale, scaleY, x, y } (scale for both axes, then scaleY on top;
// x and y in px). `motion` is "stamp" or "pop". With reduced motion the card
// only fades: scale 1, no move.
export function cardLook(age, length, { reducedMotion = false, motion = "stamp" } = {}, k = CALLOUT) {
  const still = { opacity: 0, scale: 1, scaleY: 1, x: 0, y: 0 };
  const left = length - age;
  if (age < 0 || left <= 0) return still;
  if (reducedMotion) return { ...still, opacity: Math.min(clamp01(age / k.fadeIn), clamp01(left / k.fadeOut)) };
  // The exit is at most a third of the card, so a 1 beat digit still holds.
  const out = Math.min(k.out, length / 3);
  if (left < out) {
    const e = power2Out(1 - left / out);
    return { ...still, opacity: 1 - e, y: -k.rise * e };
  }
  if (age < k.in) {
    const e = power4In(age / k.in);
    return { ...still, opacity: e, scale: k.fromScale + (1 - k.fromScale) * e };
  }
  if (motion !== "stamp") return { ...still, opacity: 1 };
  const after = age - k.in;
  let scaleY = 1;
  if (after < 2 * k.pressTime) {
    // Yoyo: down in pressTime, back in pressTime.
    const u = after < k.pressTime ? after / k.pressTime : 2 - after / k.pressTime;
    scaleY = 1 - k.press * power2Out(u);
  }
  let x = 0;
  let y = 0;
  const frame = Math.floor(after / k.shakeFrame);
  if (frame < k.shakeFrames) {
    const sign = frame % 2 === 0 ? 1 : -1;
    x = k.shake * sign;
    y = -k.shake * sign;
  }
  return { opacity: 1, scale: 1, scaleY, x, y };
}

// Is a callout on show or waiting?
export function busy(state) {
  return Boolean(state.current || state.queue.length);
}
