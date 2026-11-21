// The fighting game style text callouts (#305): "3, 2, 1, SKATE!",
// "SPOT CLAIMED", the combo name and score, "ROUND OVER" and the medal.
// Plain DOM text, so it scales and translates; no video and no image. The
// queue, the beat timing and the look of each frame are in callout-math.js
// (pure, Vitest); this file only draws them. callouts.css gives the type and
// the place (clear of the HUD column, the minimap and the touch controls).
//
// The element takes no pointer input and never pauses play. While the
// round end callout plays, the results card waits under it (opacity 0), so
// the two do not overlap; the results screen is open and works all the time.

import "./callouts.css";
import { activeCard, cardLook, claimCallout, comboCallout, createCallouts as createQueue, endCallout, pushCallout, startCallout, stepCallouts } from "./callout-math.js";

// The longest wait for the music before the count-in (s).
export const START_WAIT = 3;

// `reducedMotion()` is true when the callout must only fade (#97: the
// player's choice, or prefers-reduced-motion). `beat()` gives
// { phase, bpm } of the music now, with phase null when no beat plays.
export function createCallouts(parent, { reducedMotion = () => false, beat = () => ({ phase: null, bpm: 0 }) } = {}) {
  const root = document.createElement("div");
  root.id = "callout";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.hidden = true;
  const stage = document.createElement("div");
  stage.className = "co-stage";
  const card = document.createElement("div");
  card.className = "co-card";
  const text = document.createElement("div");
  text.className = "co-text";
  const sub = document.createElement("div");
  sub.className = "co-sub";
  card.append(text, sub);
  stage.append(card);
  root.append(stage);
  parent.appendChild(root);

  let q = createQueue();
  let shownKey = null;
  let lastLook = null;
  // For the screenshots: the clock stops when this card text holds still.
  let stopAt = null;
  let stopped = false;
  // For the tests: the longest step in s (null: no limit).
  let maxStep = null;
  // The count-in waits for the music beat (the beat clock starts a moment
  // after the first key or tap, and the track loads), for at most
  // START_WAIT s; then it plays anyway.
  let startWait = null;
  const seen = [];
  const push = (c) => {
    q = pushCallout(q, c);
    return Boolean(c);
  };

  function hide() {
    if (!root.hidden) root.hidden = true;
    document.body.classList.remove("callout-end");
    shownKey = null;
  }

  return {
    start() {
      startWait = START_WAIT;
      return true;
    },
    claim: (points) => push(claimCallout(points)),
    // `points` is the banked combo; `combo` is the combo before the bank
    // (its links and multiplier).
    combo: (points, combo) => push(comboCallout(points, { links: combo?.links?.length ?? 0, multiplier: combo?.multiplier ?? 1 })),
    end(results) {
      // A count-in that still waits must not play after the round end.
      startWait = null;
      return push(endCallout({ medal: results?.medal ?? null, score: results?.medalScore ?? results?.score ?? 0 }));
    },
    // Removes every callout (a new run).
    clear() {
      q = createQueue();
      startWait = null;
      hide();
    },
    // `dt` in s of real time (the music time); 0 while the game is paused
    // (the callout stops too).
    // `held` hides the callout (the clock still runs).
    update(dt, { held = false } = {}) {
      if (stopped) dt = 0;
      // The screenshot hook steps at most 0.1 s, so a slow test browser does not jump over the card.
      else if (stopAt !== null) dt = Math.min(dt, 0.1);
      if (maxStep !== null) dt = Math.min(dt, maxStep);
      const b = beat();
      if (startWait !== null) {
        startWait -= Math.max(0, dt);
        if ((b && b.phase !== null && b.phase !== undefined) || startWait <= 0) {
          startWait = null;
          push(startCallout());
        }
      }
      q = stepCallouts(q, dt, b && b.bpm > 0 ? b : { phase: null, bpm: b?.bpm ?? 0 });
      const now = activeCard(q);
      // The results card waits under the whole round end callout, also before its first beat.
      document.body.classList.toggle("callout-end", q.current?.kind === "end" && !held);
      if (!now || held) {
        if (!root.hidden) root.hidden = true;
        if (!now) shownKey = null;
        return;
      }
      const key = `${q.shown}:${now.index}`;
      if (key !== shownKey) {
        shownKey = key;
        text.textContent = now.card.text;
        sub.textContent = now.card.sub ?? "";
        sub.hidden = !now.card.sub;
        root.dataset.kind = q.current.kind;
        root.dataset.tone = now.card.tone;
        seen.push(now.card.text);
        if (seen.length > 20) seen.shift();
      }
      const reduced = reducedMotion();
      const look = cardLook(now.age, now.length, { reducedMotion: reduced, motion: now.card.motion ?? "stamp" });
      lastLook = look;
      if (stopAt !== null && now.card.text === stopAt && look.opacity === 1 && look.scale === 1 && look.scaleY === 1 && look.x === 0 && look.y === 0) stopped = true;
      root.dataset.motion = reduced ? "reduced" : "full";
      card.style.opacity = look.opacity.toFixed(3);
      card.style.transform = `translate(${look.x.toFixed(1)}px, ${look.y.toFixed(1)}px) scale(${look.scale.toFixed(4)}, ${(look.scale * look.scaleY).toFixed(4)})`;
      if (root.hidden) root.hidden = false;
    },
    // For the screenshots: stop the clock when the card `text` holds still
    // (null: run again).
    // For the tests: steps of at most `s` seconds, so a slow test browser
    // shows every part of a card (null: real time).
    setMaxStep(s) {
      maxStep = s;
    },
    stopOn(text) {
      stopAt = text;
      stopped = false;
    },
    // For the tests: what shows now and what waits.
    get state() {
      const now = activeCard(q);
      return {
        visible: !root.hidden,
        kind: q.current?.kind ?? null,
        text: root.hidden ? null : text.textContent,
        sub: root.hidden || sub.hidden ? null : sub.textContent,
        tone: root.hidden ? null : root.dataset.tone,
        index: now ? now.index : null,
        opacity: Number(card.style.opacity || 0),
        look: root.hidden || !lastLook ? null : { ...lastLook },
        motion: root.dataset.motion ?? null,
        queue: q.queue.map((c) => c.kind),
        waiting: startWait !== null,
        stopped,
        shown: q.shown,
        seen: [...seen],
      };
    },
    element: root,
  };
}
