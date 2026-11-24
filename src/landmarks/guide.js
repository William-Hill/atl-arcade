// The HUD guide line of landmark discovery (#260). Pure: no DOM, no Three.js.
//
// It wraps the claim line of play.js (goalLine) with 2 more parts:
// - When no spot near the skater is left to do, the line says so and points
//   to the next spot: its name (or "a new spot" when it is Unknown), the
//   distance, and the direction from the skater's heading.
// - In a timed round, the line warns when the target spot is too far for
//   the time left. The estimate is a first guess (REACH); a playtest tunes it.
//
// A spot is "to do" when it is a claim spot that is not Claimed (in a mode
// with claims), or a spot that is not Found (an edge marker, or any spot in
// a free run).

import { goalLine, targetOf } from "./play.js";
import { yawFromHeading } from "../sim/skate/controller.js";

export const GUIDE = {
  near: 150, // m. A spot to do inside this distance is "nearby". min 80 / typical 150 / max 250.
};

// The time estimate of a ride to a spot. The level is about 1.9 km long; a
// round is 150 s (production/audits/2026-11-13-design-audit, B3).
export const REACH = {
  speed: 6.5, // m/s, the mean travel speed with turns and stops. maxSpeed is 12. min 5 / typical 6.5 / max 9.
  detour: 1.25, // the path length over the straight distance. min 1.1 / typical 1.25 / max 1.6.
  claimSeconds: 6, // s to set up and do a gap, a grind or a combo at the zone. A line uses its own time.
};

export const NEARBY_DONE = "Nearby spots done";
export const NEW_SPOT = "a new spot";
export const ALL_DONE = "All spots done. Free skate!";
export const TOO_FAR = "Too far for the time left";

// The seconds to ride `distance` m and do the challenge of `spot` (a spot of
// landmarkView). An Unknown spot or an edge marker needs only the ride.
export function reachSeconds(distance, spot = null, k = REACH) {
  const ride = (distance * k.detour) / k.speed;
  const c = spot && spot.state === "found" ? spot.challenge : null;
  if (!c) return ride;
  return ride + (c.type === "line" ? c.seconds : k.claimSeconds);
}

// True when the ride and the challenge fit in `timeLeft` s.
export function reachable(distance, spot, timeLeft, k = REACH) {
  return reachSeconds(distance, spot, k) <= timeLeft + 1e-9;
}

// "40 m", "420 m", "1.2 km". Rounds to 10 m, so the text does not change on
// each frame.
export function distanceText(m) {
  const d = Math.max(0, m);
  if (d >= 995) return `${(Math.round(d / 100) / 10).toFixed(1)} km`;
  return `${Math.max(10, Math.round(d / 10) * 10)} m`;
}

const SIDES = ["ahead", "ahead left", "to the left", "behind left", "behind", "behind right", "to the right", "ahead right"];

// The direction of (dx, dz) from a skater with `yaw` (src/sim/skate/controller.js:
// a positive angle turns left), in 8 sectors of 45 degrees.
export function directionText(yaw, dx, dz) {
  const err = Math.atan2(Math.sin(yawFromHeading(dx, dz) - yaw), Math.cos(yawFromHeading(dx, dz) - yaw));
  const sector = ((Math.round(err / (Math.PI / 4)) % 8) + 8) % 8;
  return SIDES[sector];
}

// True when a spot of landmarkView is still to do.
export function isToDo(spot, { claims = true } = {}) {
  if (spot.state === "unknown") return true;
  return claims && Boolean(spot.challenge) && spot.state === "found";
}

// The point the skater rides to for a spot: the challenge target of a
// Found claim spot, the icon of the others.
const pointOf = (spot) => (spot.state === "found" && spot.challenge ? targetOf(spot) : spot.at);

// The guide line. `view` is landmarkView(); `position` is the skater's
// [x, y, z]; `yaw` its heading. `claims` is false in a free run.
// `timeLeft` is the time left of a timed round (null with no timer, or in
// the overtime). Returns { id, kind, text, warn } or null:
// - kind "claim": the claim line of the nearest Found spot (goalLine).
// - kind "next": the pointer to the next spot.
// - kind "done": every spot is done.
export function guideLine(view, position, yaw = 0, { claims = true, timeLeft = null } = {}, g = GUIDE, k = REACH) {
  const [x, , z] = position;
  const away = (s) => {
    const [px, pz] = pointOf(s);
    return Math.hypot(px - x, pz - z);
  };
  const tooFar = (s, d) => timeLeft !== null && claims && !s.attempt && !reachable(d, s, timeLeft, k);
  const claim = goalLine(view, position, { timed: claims });
  const claimSpot = claim ? view.spots.find((s) => s.id === claim.id) : null;
  const claimD = claimSpot ? away(claimSpot) : Infinity;
  if (claim && (claimD <= g.near || claimSpot.attempt)) {
    const warn = tooFar(claimSpot, claimD);
    return { id: claim.id, kind: "claim", text: warn ? `${claim.text}\n${TOO_FAR}` : claim.text, warn };
  }
  let next = null;
  for (const s of view.spots) {
    if (!isToDo(s, { claims })) continue;
    const d = away(s);
    if (!next || d < next.d) next = { s, d };
  }
  if (!next) {
    if (claim) return { id: claim.id, kind: "claim", text: claim.text, warn: false };
    return view.spots.length ? { id: null, kind: "done", text: ALL_DONE, warn: false } : null;
  }
  // An Unknown spot is near: the player finds it by riding on.
  if (next.d <= g.near) return null;
  const { s, d } = next;
  const [px, pz] = pointOf(s);
  const where = `Next: ${s.state === "unknown" ? NEW_SPOT : s.name}, ${distanceText(d)} ${directionText(yaw, px - x, pz - z)}`;
  const warn = tooFar(s, d);
  return { id: s.id, kind: "next", text: warn ? `${where}\n${TOO_FAR}` : `${NEARBY_DONE}\n${where}`, warn };
}
