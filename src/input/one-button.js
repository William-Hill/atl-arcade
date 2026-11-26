// One-button mode (docs/gdd/trick-input.md, R12.1). Pure.
//
// In this mode TRICK picks from the context. The sim gives the context on
// each frame ({ state, railInRange }), and this module gives the intent:
//   grind   true while the sim must act as if GRIND is held (a rail snap,
//           buffered as GRIND.buffer in the air, and the hold on the rail)
//   manual  true while the sim must act as if a manual is held
//   start   null, or { kind: "grab" | "dance", name, dir, button } on the
//           frame a trick starts. A grab in this mode is never a stumble
//           (`clean: true`).
//
// Precedence (R12.1):
// | State                | TRICK press             | TRICK hold                        |
// | Ground, rail in range | grind snap              | stay on the rail                  |
// | Ground, no rail       | nothing at the press; a release before oneButtonHold starts the next dance | at oneButtonHold a manual starts |
// | Air, rail in range    | grind snap (buffered)   | stay on the rail                  |
// | Air, no rail          | the next grab of the set | hold the grab                    |
// | Grind                 | nothing                 | stay on the rail                  |
// | Manual                | nothing                 | stay in the manual                |

export const ONE_BUTTON_HOLD = 0.5; // s, `oneButtonHold`. 0.3 / 0.5 / 0.8

// The one-button sets, in order. The next press takes the next item; after
// the last item the set starts again. `button` and `dir` are the slot of the
// item in the normal mode (R4, R6, R7); the 3 extra Marcus dances have no slot.
export const ONE_BUTTON_SETS = Object.freeze({
  air: [
    { name: "Mute Grab", dir: "n" },
    { name: "Japan Grab", dir: "l" },
    { name: "Side Grab", dir: "r" },
    { name: "Rocket Grab", dir: "u" },
    { name: "Tuck Knee", dir: "d" },
  ],
  grind: [
    { name: "Grind", dir: "n" },
    { name: "Soul Grind", dir: "l" },
    { name: "Unity Grind", dir: "r" },
    { name: "Makio Grind", dir: "u" },
    { name: "Royale Grind", dir: "d" },
  ],
  nia: [
    { name: "Bankhead Bounce", button: "style1", dir: "n" },
    { name: "Walk It Out", button: "style1", dir: "l" },
    { name: "The Prep", button: "style1", dir: "r" },
    { name: "Swag Surf", button: "style1", dir: "u" },
    { name: "Snap Lean", button: "style1", dir: "d" },
    { name: "Cross Step", button: "style2", dir: "n" },
    { name: "Toe Spin", button: "style2", dir: "l" },
    { name: "Smooth Quad", button: "style2", dir: "r" },
    { name: "ATL Rydin", button: "style2", dir: "u" },
    { name: "Sit Spin", button: "style2", dir: "d" },
  ],
  marcus: [
    { name: "Swag Surf", button: "style1", dir: "n" },
    { name: "Walk It Out", button: "style1", dir: "l" },
    { name: "The Prep", button: "style1", dir: "r" },
    { name: "Drumline Count", button: "style1", dir: "u" },
    { name: "Jam Step", button: "style1", dir: "d" },
    { name: "Cross Step", button: "style2", dir: "n" },
    { name: "Toe Spin", button: "style2", dir: "l" },
    { name: "Smooth Quad", button: "style2", dir: "r" },
    { name: "ATL Rydin", button: "style2", dir: "u" },
    { name: "Sit Spin", button: "style2", dir: "d" },
    { name: "Jam Groove", button: null, dir: null },
    { name: "Bankhead Bounce", button: null, dir: null },
    { name: "Snap Lean", button: null, dir: null },
  ],
});

export function createOneButton() {
  // `mode` is how the press now down works: "rail", "ground", "air", "none".
  return { next: { air: 0, grind: 0, nia: 0, marcus: 0 }, down: false, downAt: 0, mode: "none", manual: false };
}

function take(ob, set) {
  const list = ONE_BUTTON_SETS[set];
  const i = ob.next[set] % list.length;
  return { item: list[i], next: { ...ob.next, [set]: (i + 1) % list.length } };
}

// The grind stance of the next snap in this mode, and the next state.
// The sim calls it at the snap that the one-button intent caused.
export function takeStance(ob) {
  const { item, next } = take(ob, "grind");
  return { ob: { ...ob, next }, stance: item };
}

// One frame. `ctx`: { state: "ground" | "air" | "grind" | "manual",
// railInRange, skater: "nia" | "marcus" }. `trick`: TRICK is down.
// `t`: the sim time (s).
export function stepOneButton(ob, ctx, trick, t, hold = ONE_BUTTON_HOLD) {
  const out = { grind: false, manual: false, start: null };
  const rail = Boolean(ctx.railInRange);
  let s = ob;
  if (trick && !ob.down) {
    // The press.
    let mode = "none";
    if (ctx.state === "grind" || ((ctx.state === "ground" || ctx.state === "air") && rail)) mode = "rail";
    else if (ctx.state === "ground") mode = "ground";
    else if (ctx.state === "air") mode = "air";
    else if (ctx.state === "manual") mode = "manual";
    s = { ...s, down: true, downAt: t, mode, manual: ctx.state === "manual" };
    if (mode === "air") {
      const { item, next } = take(s, "air");
      s = { ...s, next };
      out.start = { kind: "grab", name: item.name, dir: item.dir, button: "style1", clean: true };
    }
  } else if (!trick && ob.down) {
    // The release.
    if (ob.mode === "ground" && !ob.manual && t - ob.downAt < hold) {
      const set = ctx.skater === "marcus" ? "marcus" : "nia";
      const { item, next } = take(ob, set);
      s = { ...s, next };
      out.start = { kind: "dance", name: item.name, dir: item.dir, button: item.button };
    }
    s = { ...s, down: false, mode: "none", manual: false };
  }
  if (s.down) {
    // A rail that comes in range during a hold takes the input (R8).
    if (s.mode === "rail" || (rail && s.mode !== "air")) {
      out.grind = true;
      if (s.mode !== "rail") s = { ...s, mode: "rail", manual: false };
    } else if (s.mode === "ground" && !s.manual && t - s.downAt >= hold - 1e-6) {
      // A manual starts on the ground only (R8, R12.1). A hold that is in the
      // air at the threshold starts nothing: the press is spent (mode "none")
      // until the release, so a later touchdown starts no manual.
      s = ctx.state === "ground" ? { ...s, manual: true } : { ...s, mode: "none" };
    }
    if (s.manual) out.manual = true;
  }
  return { ob: s, ...out };
}

// One frame of one-button mode for the game loop (#328). `frame` is the
// input frame; `ctx` is the sim context (oneButtonContext() in
// src/sim/skate/skater.js). Returns the next state and the frame for the
// sim: `grind` is also true while the intent holds GRIND, and `ob` is
// { manual, start } (src/sim/skate/trick-step.js reads it). The real GRIND
// and SPIN still work (R12.1).
export function oneButtonFrame(ob, frame, ctx, t, hold = ONE_BUTTON_HOLD) {
  const r = stepOneButton(ob, ctx, Boolean(frame.style1), t, hold);
  return { ob: r.ob, frame: { ...frame, grind: Boolean(frame.grind) || r.grind, ob: { manual: r.manual, start: r.start } } };
}

// True when the frame needs the rail search of the sim context: TRICK is
// down now or was down on the frame before.
export const oneButtonNeedsRail = (ob, frame) => Boolean(frame.style1) || Boolean(ob.down);
