// The intro and the title screen before the first ride (#301). Pure: the
// plan (where the page starts), the phase steps (intro -> title -> play),
// and the camera flight along the BeltLine trail. The DOM part is in
// src/ui/front-screen.js; src/main.js moves the camera.

// The phases, in order. "play" is the game.
export const PHASES = ["intro", "title", "play"];

// The localStorage key of a return visit: "1" after the first intro.
export const INTRO_SEEN_KEY = "atl.intro.v1";

export const INTRO = {
  // The intro flight lasts this long (s); then the title screen shows.
  seconds: 9,
  // The logo fades in over this time (s), after this delay (s).
  logoDelay: 0.4,
  logoFade: 1.2,
  // The camera speed along the trail in the intro (m/s).
  speed: 14,
  // The title camera circles the skater: the turn speed (rad/s), the
  // distance (m), the camera height and the look height over the feet (m).
  titleTurn: 0.12,
  titleRadius: 5.2,
  titleHeight: 1.8,
  titleLook: 1.05,
  // The camera height over the trail (m), its side offset (m, + is right of
  // the direction of travel), and the look point: this far ahead (m), this
  // high over the ground (m).
  height: 16,
  side: 6,
  lookAhead: 45,
  lookHeight: 2,
  // The flight starts this far (m) into the trail line.
  startAt: 40,
  // The longest step of the flight clock (s). A slow frame does not jump.
  maxStep: 0.25,
};

// Pure: where the page starts. `param` is the ?intro= value.
// - "0": straight to the game (e2e tests, the autopilot, the playtests).
// - "1": the intro, also on a return visit or under WebDriver.
// - "title": the title screen.
// Without a flag: a WebDriver browser (Playwright) goes to the game, so the
// e2e suite keeps its old start; a return visit goes to the title screen; a
// first visit plays the intro. Reduced motion never plays the flight: the
// intro becomes the title screen with a still camera. A level that is not a
// geodata level, or a camera view that is not "follow", goes to the game.
// The autopilot (?autopilot=1) goes to the game, as with ?intro=0.
export function introPlan({ param = null, webdriver = false, seen = false, reducedMotion = false, geo = true, view = "follow", autopilot = false } = {}) {
  const p = (param ?? "").trim().toLowerCase();
  if (p === "0" || p === "off" || p === "false") return { start: "play", reason: "flag" };
  if (autopilot) return { start: "play", reason: "autopilot" };
  if (!geo) return { start: "play", reason: "level" };
  if (view !== "follow") return { start: "play", reason: "view" };
  if (p === "title") return { start: "title", reason: "flag" };
  if (p === "1" || p === "on" || p === "true") return { start: reducedMotion ? "title" : "intro", reason: reducedMotion ? "reduced-motion" : "flag" };
  if (webdriver) return { start: "play", reason: "webdriver" };
  if (seen) return { start: "title", reason: "return-visit" };
  if (reducedMotion) return { start: "title", reason: "reduced-motion" };
  return { start: "intro", reason: "first-visit" };
}

// Pure: a return visit? `storage` is localStorage or null.
export function introSeen(storage) {
  try {
    return storage?.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

// Marks the intro as seen. A storage error (private mode) is ignored.
export function markIntroSeen(storage) {
  try {
    storage?.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // No storage: the next visit plays the intro again.
  }
}

// Pure: the first state. `t` is the time in the phase (s); `flight` is the
// distance along the trail line (m).
// `orbit` is the angle of the title camera around the skater (rad).
export function createFront(plan, config = INTRO) {
  return { phase: plan.start, t: 0, flight: config.startAt, orbit: 0, changed: false, from: null };
}

function to(state, phase) {
  if (state.phase === phase) return { ...state, changed: false, from: null };
  return { ...state, phase, t: 0, changed: true, from: state.phase };
}

// Pure: one frame. `dt` is the frame time (s); `moving` is false under
// reduced motion (the camera stays still). The intro ends after
// config.seconds. The flight moves in the intro; the title camera turns
// on the title screen.
export function frontStep(state, dt, { moving = true } = {}, config = INTRO) {
  if (state.phase === "play") return state.changed ? { ...state, changed: false, from: null } : state;
  const step = Math.min(Math.max(0, dt), config.maxStep);
  const intro = state.phase === "intro";
  const next = {
    ...state,
    t: state.t + step,
    flight: moving && intro ? state.flight + config.speed * step : state.flight,
    orbit: moving && !intro ? state.orbit + config.titleTurn * step : state.orbit,
    changed: false,
    from: null,
  };
  if (intro && next.t >= config.seconds) return to(next, "title");
  return next;
}

// Pure: a key, a click, a tap, or a pad button. The intro skips to the
// title screen; the title screen starts the game.
export function frontPress(state) {
  if (state.phase === "intro") return to(state, "title");
  if (state.phase === "title") return to(state, "play");
  return { ...state, changed: false, from: null };
}

// Pure: does a key start the game on the title screen? Modifier keys, Tab
// (focus moves), the settings key, and a held key (repeat) do not.
const NOT_START = new Set(["Tab", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock", "Escape", "F5", "F11", "F12"]);
export function keyStarts({ code = "", repeat = false, ctrlKey = false, metaKey = false, altKey = false } = {}, { settingsCode = "KeyO" } = {}) {
  if (repeat || ctrlKey || metaKey || altKey) return false;
  if (code === settingsCode) return false;
  return !NOT_START.has(code);
}

// Pure: the logo opacity (0..1) at time t in the intro. The title screen
// shows the logo at full opacity. Reduced motion shows it at once.
export function logoOpacity(state, { reducedMotion = false } = {}, config = INTRO) {
  if (state.phase === "play") return 0;
  if (state.phase === "title" || reducedMotion) return 1;
  const k = (state.t - config.logoDelay) / config.logoFade;
  return Math.min(1, Math.max(0, k));
}

// Pure: the flight line, from the level strips: the longest "trail" strip
// (on the BeltLine Eastside level, the Eastside Trail from the Ponce City
// Market end to the south). Returns { points: [[x, z]...], length } or
// null when the level has no trail.
export function flightLine(strips = []) {
  let best = null;
  for (const s of strips) {
    if (s.kind !== "trail" || !Array.isArray(s.points) || s.points.length < 2) continue;
    const length = lineLength(s.points);
    if (!best || length > best.length) best = { id: s.id, points: s.points.map(([x, z]) => [x, z]), length };
  }
  return best;
}

function lineLength(points) {
  let n = 0;
  for (let i = 1; i < points.length; i += 1) n += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return n;
}

// Pure: the point and the unit direction at distance d along the line. The
// distance wraps at the end, so the title screen can fly for a long time.
export function pointAt(line, d) {
  const pts = line.points;
  let left = ((d % line.length) + line.length) % line.length;
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    if (left <= len || i === pts.length - 1) {
      const k = Math.min(1, left / len);
      return { x: pts[i - 1][0] + dx * k, z: pts[i - 1][1] + dz * k, dir: [dx / len, dz / len] };
    }
    left -= len;
  }
  const [x, z] = pts[0];
  return { x, z, dir: [1, 0] };
}

// Pure: the camera pose at flight distance d. `height(x, z)` is the ground
// height. Returns { position: [x, y, z], target: [x, y, z] }.
export function flightPose(line, d, height = () => 0, config = INTRO) {
  const here = pointAt(line, d);
  const ahead = pointAt(line, d + config.lookAhead);
  // Right of the direction of travel, with +x east and +z south.
  const right = [-here.dir[1], here.dir[0]];
  const px = here.x + right[0] * config.side;
  const pz = here.z + right[1] * config.side;
  const ground = Math.max(height(px, pz), height(here.x, here.z));
  return {
    position: [px, ground + config.height, pz],
    target: [ahead.x, height(ahead.x, ahead.z) + config.lookHeight, ahead.z],
  };
}

// Pure: the title camera. It looks at the skater from the front-left and
// circles slowly. `feet` is the skater position [x, y, z]; `yaw` is the
// skater heading: the forward vector is [cos yaw, 0, -sin yaw], as in
// heading() of src/sim/skate/controller.js.
export function titlePose(feet, yaw, orbit, config = INTRO) {
  // Start in front of the skater, 35 degrees to the side.
  const a = yaw + 0.6 + orbit;
  return {
    position: [feet[0] + Math.cos(a) * config.titleRadius, feet[1] + config.titleHeight, feet[2] - Math.sin(a) * config.titleRadius],
    target: [feet[0], feet[1] + config.titleLook, feet[2]],
  };
}
