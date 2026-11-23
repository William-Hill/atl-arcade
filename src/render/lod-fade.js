// Timed LOD fade (#279). Pure: no Three.js.
//
// When an instance changes its LOD, the old shape and the new shape both
// draw for a short time (LOD_FADE_SECONDS), with complementary screen-door
// dither. The fade starts when the instance crosses the switch distance.
// It does not depend on a distance band, so only the few instances that
// crossed a switch distance in the last 0.3 s draw twice.
//
// LOD values: 0 (detailed), 1 (simple), -1 (hidden). The value -2 is "not
// set yet": the first LOD of an instance never fades.

export const LOD_FADE_SECONDS = 0.3;
// A camera move longer than this in one update is a teleport or a fast
// travel (m). Then each change is a hard switch, with no fade.
export const LOD_FADE_JUMP = 20;
// The most fade copies of a batch. A copy is a spare instance that draws
// the old shape during a fade. With no free copy, the switch is hard.
export const LOD_FADE_COPIES = 256;

// The dither value of an instance, for the shader:
// - 1: the full shape.
// - d in [0, 1): a shape that fades in. A pixel draws when its dither
//   threshold t (0 < t < 1) is less than d.
// - d in [2, 3]: a shape that fades out. A pixel draws when t >= d - 2.
// Thus at one time the two shapes draw complementary pixels.
export const DITHER_FULL = 1;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function ditherIn(p) {
  return p >= 1 ? DITHER_FULL : clamp01(p);
}

export function ditherOut(p) {
  return 2 + clamp01(p);
}

// `?lodfade=0` turns the fade off (for an A/B test).
export function lodFadeOn(search = globalThis.location?.search ?? "") {
  return new URLSearchParams(search).get("lodfade") !== "0";
}

// The count of spare instances for the fade copies of a batch of `count`.
export function fadeCopies(count, enabled = true) {
  return enabled ? Math.min(count, LOD_FADE_COPIES) : 0;
}

// True when the camera moved more than `limit` m since the last update.
export function cameraJumped(last, now, limit = LOD_FADE_JUMP) {
  if (!last) return true;
  return Math.hypot(now.x - last.x, now.z - last.z) > limit;
}

// What to draw for an instance that fades from `from` to `to` at the
// progress p (0 to 1). `main` is the instance itself, `copy` is its fade
// copy (null when no copy is necessary). Each is { lod, dither }, and a
// lod of -1 is hidden.
// - A LOD switch: the main instance fades in the new shape, the copy
//   fades out the old shape.
// - A show (from -1): the main instance fades in. No copy.
// - A hide (to -1): the main instance keeps the old shape and fades out.
// `flip` is true after a switch back in the middle of a fade: then the new
// shape keeps the pixels that it drew before the switch back (the high
// thresholds), so no pixel changes its shape at the switch back.
export function fadeDraw(from, to, p, flip = false) {
  const hidden = { lod: -1, dither: DITHER_FULL };
  if (from === to || p >= 1) return { main: to >= 0 ? { lod: to, dither: DITHER_FULL } : hidden, copy: null };
  const dIn = flip ? ditherOut(1 - p) : ditherIn(p);
  const dOut = flip ? ditherIn(1 - p) : ditherOut(p);
  if (to < 0) return { main: from >= 0 ? { lod: from, dither: dOut } : hidden, copy: null };
  if (from < 0) return { main: { lod: to, dither: dIn }, copy: null };
  return { main: { lod: to, dither: dIn }, copy: { lod: from, dither: dOut } };
}

export const FADE_NONE = 0;
export const FADE_SNAP = 1;
export const FADE_START = 2;
export const FADE_REVERSE = 3;

// The fade state of `count` instances.
export function createLodFade(count, { duration = LOD_FADE_SECONDS, enabled = true } = {}) {
  const lod = new Int8Array(count).fill(-2); // the LOD now (the fade target)
  const from = new Int8Array(count).fill(-2); // the old LOD; equal to lod when no fade
  const start = new Float64Array(count); // the fade start time (s)
  // 1 after a switch back: the dither polarity of the fade is flipped.
  const flip = new Uint8Array(count);
  let active = [];

  function progress(i, now) {
    if (from[i] === lod[i]) return 1;
    return duration > 0 ? clamp01((now - start[i]) / duration) : 1;
  }

  return {
    lod,
    from,
    flip,
    duration,
    enabled,
    get active() {
      return active.length;
    },
    // The instances in a fade now.
    activeList() {
      return active;
    },
    fading(i) {
      return from[i] !== lod[i];
    },
    progress,
    // Sets the LOD of instance i at the time `now` (s). `snap` makes a hard
    // switch (the first frame, a teleport). Returns FADE_NONE, FADE_SNAP,
    // FADE_START, or FADE_REVERSE.
    set(i, next, now, snap = false) {
      const cur = lod[i];
      if (next === cur) return FADE_NONE;
      const wasFading = from[i] !== cur;
      if (snap || !enabled || duration <= 0 || cur === -2) {
        lod[i] = next;
        from[i] = next;
        if (wasFading) active = active.filter((j) => j !== i);
        return FADE_SNAP;
      }
      if (wasFading && next === from[i]) {
        // A switch back in the middle of a fade: the fade turns around and
        // continues from the same mix of the two shapes. The flipped
        // polarity keeps each pixel on the same shape.
        const p = progress(i, now);
        from[i] = cur;
        lod[i] = next;
        start[i] = now - (1 - p) * duration;
        flip[i] ^= 1;
        return FADE_REVERSE;
      }
      // A new fade from the LOD now. (During a fade to a third LOD, the old
      // shape of that fade stops at once.)
      from[i] = cur;
      lod[i] = next;
      start[i] = now;
      flip[i] = 0;
      if (!wasFading) active.push(i);
      return FADE_START;
    },
    // Ends each fade that is done at `now`. Calls onEnd(i) for each.
    step(now, onEnd) {
      if (active.length === 0) return 0;
      const keep = [];
      for (const i of active) {
        if (now - start[i] >= duration - 1e-9) {
          from[i] = lod[i];
          if (onEnd) onEnd(i);
        } else keep.push(i);
      }
      active = keep;
      return active.length;
    },
    // Ends one fade at once (for example, with no free copy).
    finish(i) {
      if (from[i] === lod[i]) return;
      from[i] = lod[i];
      active = active.filter((j) => j !== i);
    },
    // Ends all fades at once. Calls onEnd(i) for each.
    finishAll(onEnd) {
      for (const i of active) {
        from[i] = lod[i];
        if (onEnd) onEnd(i);
      }
      active = [];
    },
  };
}
