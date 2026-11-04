import * as THREE from "three";
import { ATLANTA, civilHour, dayOfYear, skyState, sunState, weatherFor, weatherOverride, wetAt } from "../sim/weather.js";

// The day and season weather of a geodata level (src/sim/weather.js for the
// pure model). This module samples the model and applies the result to the
// world each frame:
//
// - the sun: the real solar position for the level's own latitude and
//   longitude (level.json `origin`), so morning shadows fall west and a
//   winter noon stays low
// - the sky dome: zenith and horizon colors, cloud cover, storm darkening
// - the fog and the background: they follow the horizon color and close in
//   under rain
// - the facades: the uLit uniform lights a share of the windows at dusk
//   and at night (and makes day interiors read dark, see the research doc)
// - the ground: the uWet uniform darkens and shines a soaked street
//
// The state re-samples on a slow timer and lerps toward the new state, so
// an afternoon storm moves in over seconds, not in a cut. URL parameters:
// ?date=MM-DD, ?time=HH[.HH], ?weather=auto|clear|clouds|rain|storm, and
// ?timescale=<seconds of clock per real second> for tests and screenshots.

// Pure: the clock for a URLSearchParams and a Date.
export function weatherClock(params, now = new Date()) {
  const date = /^(\d{1,2})-(\d{1,2})$/.exec(params.get("date") ?? "");
  let day = dayOfYear(now);
  if (date) {
    day = Math.floor((Date.UTC(now.getFullYear(), Number(date[1]) - 1, Number(date[2])) - Date.UTC(now.getFullYear(), 0, 1)) / 86400000) + 1;
  }
  const time = params.get("time");
  const hour = time !== null && Number.isFinite(Number(time)) ? Number(time) : civilHour(now);
  const ts = params.get("timescale");
  return { day, hour, override: params.get("weather"), timescale: ts !== null && Number.isFinite(Number(ts)) ? Number(ts) : 0 };
}

// Pure: the full render state for a clock at a place.
export function weatherAt({ day, hour, override, seed = 0, place = ATLANTA }) {
  const w = weatherOverride(weatherFor({ day, hour, seed }), override);
  const sun = sunState({ day, hour, place });
  const s = skyState({ sun, weather: w });
  // The ground remembers the rain of the last hours — but only in the
  // automatic draw; an override sets the whole scene, wet or dry.
  s.wet = override && override !== "auto" ? (w.rain > 0.05 ? Math.min(1, 0.4 + w.rain) : 0) : Math.max(s.wet, wetAt({ day, hour, seed }) * (w.rain > 0.05 ? 1 : 0.85));
  s.kind = w.kind;
  return s;
}

// The scalar and color fields that lerp toward each new sample.
const LERP3 = ["sunColor", "zenith", "horizon", "glow"];
const LERP1 = ["sunIntensity", "hemi", "cloudCover", "fog", "windowLit", "wet", "rainRate", "env", "day", "night"];
function lerpState(cur, tgt, k) {
  for (const f of LERP1) cur[f] += (tgt[f] - cur[f]) * k;
  for (const f of LERP3) for (let i = 0; i < 3; i += 1) cur[f][i] += (tgt[f][i] - cur[f][i]) * k;
  cur.sun.dir = cur.sun.dir.map((v, i) => v + (tgt.sun.dir[i] - v) * k);
  const n = Math.hypot(...cur.sun.dir) || 1;
  cur.sun.dir = cur.sun.dir.map((v) => v / n);
  cur.sun.elevation += (tgt.sun.elevation - cur.sun.elevation) * k;
  return cur;
}

const RESAMPLE_SECONDS = 30;
const LERP_RATE = 0.6; // per second; a new state settles in about 4 s

export function createWeatherView({ scene, renderer, geoLights, sky, levelView, fog = null, place = ATLANTA, clock = { day: 172, hour: 13.6, override: null, timescale: 0 }, exposureBase = 1.05 }) {
  let target = weatherAt({ ...clock, place });
  let cur = { ...target, sun: { ...target.sun, dir: [...target.sun.dir] } };
  let since = 0;
  let first = true; // the first frame applies the state at once, with no lerp
  const colA = new THREE.Color();
  const colB = new THREE.Color();

  function apply() {
    // The sun: real direction, atmospheric color, cloud-cut intensity. A
    // sun under the horizon keeps its direction (the moon light is not
    // modeled) but gives no light.
    if (geoLights) {
      geoLights.setSun?.(cur.sun.dir, colA.setRGB(...cur.sunColor), cur.sunIntensity);
      colA.setRGB(cur.zenith[0] + 0.15, cur.zenith[1] + 0.15, cur.zenith[2] + 0.15);
      colB.setRGB(Math.max(cur.glow[0], 0.12), Math.max(cur.glow[1], 0.1), Math.max(cur.glow[2], 0.08));
      geoLights.setHemi?.(colA, colB, Math.max(cur.hemi, 0.04));
    }
    // The sky dome.
    if (sky) {
      const u = sky.mesh.material.uniforms;
      u.uZenith.value.setRGB(...cur.zenith);
      u.uHorizon.value.setRGB(...cur.horizon);
      u.uSun.value.set(...cur.sun.dir);
      if (u.uCover) u.uCover.value = cur.cloudCover;
      if (u.uCloudDark) u.uCloudDark.value = Math.min(1, cur.rainRate * 0.8 + (cur.kind === "storm" ? 0.25 : 0));
    }
    // The fog and the background follow the horizon.
    const horizon = colA.setRGB(...cur.horizon);
    if (scene.fog) {
      scene.fog.color.copy(horizon);
      scene.fog.near = fog.near * cur.fog;
      scene.fog.far = fog.far * cur.fog;
    }
    scene.background = horizon;
    // The facades and the ground. The uniforms live on the materials and
    // appear when the shaders compile (undefined until then).
    const mats = levelView?.weather;
    if (mats) {
      for (const m of mats.lit) if (m.userData?.uLit) m.userData.uLit.value = cur.windowLit;
      for (const m of mats.wet) if (m.userData?.uWet) m.userData.uWet.value = cur.wet;
    }
    // The exposure eases a little at night; the key stays on the day.
    if (renderer.toneMapping !== THREE.NoToneMapping) renderer.toneMappingExposure = exposureBase * (0.88 + 0.17 * cur.day);
    return cur;
  }

  return {
    get state() {
      return cur;
    },
    // dt: seconds. Returns the current state (for the rain tint).
    update(dt, camera) {
      since += dt;
      if (clock.timescale > 0) {
        clock.hour += (dt * clock.timescale) / 3600;
        if (clock.hour >= 24) {
          clock.hour -= 24;
          clock.day = (clock.day % 365) + 1;
        }
        target = weatherAt({ ...clock, place });
      } else if (since >= RESAMPLE_SECONDS) {
        const live = weatherClock(new URLSearchParams(location.search), new Date());
        clock.day = live.day;
        clock.hour = live.hour;
        target = weatherAt({ ...clock, place });
        since = 0;
      }
      lerpState(cur, target, first ? 1 : 1 - Math.exp(-dt * LERP_RATE));
      first = false;
      return apply();
    },
    // For the tests: the state names the weather kind and the clock.
    info() {
      return { kind: cur.kind, day: clock.day, hour: clock.hour, elevation: cur.sun.elevation, lit: cur.windowLit, wet: cur.wet, rain: cur.rainRate };
    },
  };
}
