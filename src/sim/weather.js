// The day and season weather of the pbr look. Pure: no Three.js imports.
//
// Two parts:
//
// - sunState(): the solar position for a day of the year and a local time
//   at the level's latitude, as a direction in the level frame (+x east,
//   +y up, +z south; north is -z). It includes the longitude offset from
//   the time zone meridian, so shadows point the right way for Atlanta.
//   It skips the equation of time (up to 16 minutes) and uses a simple
//   daylight saving window (second Sunday of March to first Sunday of
//   November, close enough for a game).
//
// - weatherFor(): a deterministic seasonal draw for a day and an hour,
//   from Atlanta's climate: wet and gray winters, summer days that build
//   to afternoon storms, and the clearest days in the fall. The same
//   (dayOfYear, hour, seed) always gives the same weather, so a level
//   load, a screenshot, and a test agree.
//
// - skyState(): the two combined into the numbers the renderer needs:
//   the sun light, the sky colors, the cloud cover, the fog scale, the
//   window light factor, the ground wetness, and the rain rate.
//
// The colors are linear RGB triples (0..1), the intensities are for the
// renderer's physical units, and the angles are degrees.

const DEG = Math.PI / 180;

// Atlanta City Hall, and the Eastern time zone meridians (EST and EDT).
export const ATLANTA = { lat: 33.749, lon: -84.388, tzWinter: -75, tzSummer: -60 };

// Atlanta climate normals, by month: the mean cloud cover (0..1) and the
// chance that a day has rain (0..1). Roughly from the NCEI normals.
const MONTH = [
  /* Jan */ { cloud: 0.55, rain: 0.33, storm: 0.1 },
  /* Feb */ { cloud: 0.52, rain: 0.32, storm: 0.1 },
  /* Mar */ { cloud: 0.5, rain: 0.34, storm: 0.2 },
  /* Apr */ { cloud: 0.45, rain: 0.28, storm: 0.35 },
  /* May */ { cloud: 0.45, rain: 0.3, storm: 0.5 },
  /* Jun */ { cloud: 0.45, rain: 0.35, storm: 0.65 },
  /* Jul */ { cloud: 0.5, rain: 0.4, storm: 0.7 },
  /* Aug */ { cloud: 0.48, rain: 0.36, storm: 0.65 },
  /* Sep */ { cloud: 0.38, rain: 0.26, storm: 0.45 },
  /* Oct */ { cloud: 0.35, rain: 0.22, storm: 0.2 },
  /* Nov */ { cloud: 0.42, rain: 0.27, storm: 0.1 },
  /* Dec */ { cloud: 0.52, rain: 0.32, storm: 0.1 },
];

// A deterministic 32-bit hash, then a mulberry32 stream.
function hash(...ns) {
  let h = 2166136261 >>> 0;
  for (const n of ns) {
    h ^= Math.floor((n + 1024) * 1000) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// The day of the year (1..366) for a Date.
export function dayOfYear(date) {
  const y = date.getFullYear();
  return Math.floor((date - new Date(y, 0, 1)) / 86400000) + 1;
}

// The civil hour (0..24, fractional) for a Date in local time.
export function civilHour(date) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

// Approximate US daylight saving: in effect from the second Sunday of
// March (day 68..74) to the first Sunday of November (day 305..311).
// The boundary days can be off by a day; the error is one hour once a year.
function daylightSaving(day) {
  return day >= 75 && day <= 305;
}

// The solar position. `place` is { lat, lon }; `day` is the day of the
// year; `hour` is the local civil hour (0..24). Returns the elevation and
// the azimuth in degrees (azimuth from north, clockwise, so east is 90),
// and `dir`, the unit vector toward the sun in the level frame.
export function sunState({ day, hour, place = ATLANTA }) {
  const decl = -23.44 * Math.cos(((360 / 365) * (day + 10)) * DEG);
  const tz = daylightSaving(day) ? place.tzSummer : place.tzWinter;
  // The solar hour: the civil hour corrected for the longitude east or
  // west of the zone meridian. Atlanta sits west of it, so solar noon is
  // late (about 12:38 EST, 13:38 EDT).
  const solarHour = hour + (place.lon - tz) / 15;
  const H = (solarHour - 12) * 15 * DEG;
  const lat = place.lat * DEG;
  const d = decl * DEG;
  const sinE = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H);
  const elev = Math.asin(Math.min(Math.max(sinE, -1), 1)) / DEG;
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(lat) - Math.cos(d) * Math.sin(lat) * Math.cos(H)) / DEG;
  const azDeg = (az + 360) % 360;
  const e = elev * DEG;
  const a = azDeg * DEG;
  return { elevation: elev, azimuth: azDeg, dir: [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)] };
}

// The weather for a day and an hour. `seed` salts the draw, so two levels
// could keep their own weather. Returns:
//   kind: "clear" | "clouds" | "rain" | "storm"
//   cloud: the cloud cover 0..1
//   rain: the rain rate right now 0..1 (0 when kind is not rain or storm)
export function weatherFor({ day, hour, seed = 0 }) {
  const month = MONTH[Math.min(11, Math.floor(((day - 1) / 365) * 12))];
  const rnd = mulberry32(hash(day, seed, 7));
  const wetDay = rnd() < month.rain;
  const storm = wetDay && rnd() < month.storm;
  const cellStart = 12 + rnd() * 6; // the storm cell, in the afternoon
  const cellLen = 1.5 + rnd() * 2;
  const baseCloud = clamp01(month.cloud + (rnd() - 0.5) * 0.4);
  // The rain profile over the day: a seeded value noise on the half hour,
  // so the intensity moves but is deterministic per hour.
  const rainNoise = (h) => {
    const r = mulberry32(hash(day, Math.floor(h * 2), seed, 13));
    const a = r();
    const b = mulberry32(hash(day, Math.floor(h * 2) + 1, seed, 13))();
    return mix(a, b, (h * 2) % 1);
  };
  if (!wetDay) {
    // Summer cumulus: the cloud grows over the afternoon on dry days.
    const build = month.storm > 0.4 ? 0.15 * smooth(11, 17, hour) : 0;
    const cloud = clamp01(baseCloud + build);
    return { kind: cloud < 0.35 ? "clear" : "clouds", cloud, rain: 0 };
  }
  if (storm) {
    const inCell = smooth(cellStart - 1, cellStart + 0.3, hour) * (1 - smooth(cellStart + cellLen - 0.3, cellStart + cellLen + 1, hour));
    const rain = clamp01(inCell * (0.75 + 0.25 * rainNoise(hour)) + 0.1 * rainNoise(hour + 9));
    return { kind: "storm", cloud: 0.9 + 0.1 * inCell, rain };
  }
  const rain = clamp01(0.35 + 0.5 * rainNoise(hour));
  return { kind: "rain", cloud: 0.8 + 0.15 * rainNoise(hour + 5), rain };
}

// A weather override from the URL parameter (?weather=clear|clouds|rain|storm),
// applied over the drawn weather.
export function weatherOverride(weather, name) {
  if (name === "clear") return { kind: "clear", cloud: 0.06, rain: 0 };
  if (name === "clouds") return { kind: "clouds", cloud: 0.6, rain: 0 };
  if (name === "rain") return { kind: "rain", cloud: 0.9, rain: 0.6 };
  if (name === "storm") return { kind: "storm", cloud: 1, rain: 0.95 };
  return weather;
}

// The sky palettes, as linear RGB.
const PALETTE = {
  dayZenith: [0.1, 0.38, 0.8],
  dayHorizon: [0.62, 0.8, 0.98],
  duskZenith: [0.14, 0.16, 0.38],
  duskHorizon: [1.0, 0.52, 0.26],
  nightZenith: [0.008, 0.016, 0.04],
  nightHorizon: [0.04, 0.07, 0.14],
  grayZenith: [0.38, 0.44, 0.52],
  grayHorizon: [0.62, 0.67, 0.72],
};

// The full look for a moment: the solar position plus the weather, mixed
// into renderer-ready values.
//   sun.dir/intensity/color: the directional light
//   hemi: the hemisphere light intensity (fills in until the env map exists)
//   zenith/horizon: the sky dome colors and the fog/background color
//   cloudCover: the sky shader cloud amount
//   fog: a multiplier on the tier's fog near and far
//   windowLit: how much the windows glow (0 day, 1 night)
//   wet: the ground wetness (0 dry, 1 soaked)
//   rainRate: the rain streak density 0..1
//   env: the environment map intensity
//   day: the daylight factor for the exposure (0 night, 1 noon)
export function skyState({ sun, weather }) {
  const e = sun.elevation;
  const wDay = smooth(-3, 10, e);
  const wNight = 1 - smooth(-12, -5, e);
  const wDusk = Math.max(0, 1 - wDay - wNight);
  const { cloud, rain } = weather;
  const storm = weather.kind === "storm" ? 1 : 0;

  // Sky: day/dusk/night by the sun elevation, then a gray blend for the
  // cloud cover (clouds at night only dim the sky).
  let zenith = mix3(mix3(PALETTE.nightZenith, PALETTE.duskZenith, wDusk / Math.max(1e-5, wDusk + wNight)), PALETTE.dayZenith, wDay);
  let horizon = mix3(mix3(PALETTE.nightHorizon, PALETTE.duskHorizon, wDusk / Math.max(1e-5, wDusk + wNight)), PALETTE.dayHorizon, wDay);
  const gray = clamp01(cloud * (1 - wNight * 0.6) + storm * 0.25);
  zenith = mix3(zenith, PALETTE.grayZenith, gray * wDay);
  horizon = mix3(horizon, PALETTE.grayHorizon, gray * wDay * 0.85);

  // The sun light: warm at the horizon, white at noon, and cut by the
  // cloud. The intensity is in the same units as LOOKS.pbr.sun.
  const warm = smooth(15, 0, e);
  const sunColor = mix3([1, 0.95, 0.86], [1, 0.5, 0.2], warm);
  const sunIntensity = 3.0 * smooth(-1, 12, e) * (1 - cloud * 0.85) * (storm ? 0.35 : 1);

  const day = wDay * (1 - cloud * 0.45);
  return {
    sun,
    sunColor,
    sunIntensity,
    hemi: mix(0.05, 0.3, day),
    zenith,
    horizon,
    cloudCover: cloud,
    fog: mix(1, storm ? 0.45 : 0.6, rain) * mix(1, 0.85, wNight),
    windowLit: clamp01((8 - e) / 9 + cloud * 0.2 + rain * 0.15),
    wet: clamp01(rain * 1.5),
    rainRate: rain,
    env: mix(0.15, 0.9, day),
    day,
    night: wNight,
  };
}

// The wetness with memory: it also counts the rain of the last three
// hours, so a street stays wet after a storm passes.
export function wetAt({ day, hour, seed = 0 }) {
  let wet = 0;
  for (let back = 0; back <= 3; back += 1) {
    const w = weatherFor({ day, hour: hour - back, seed });
    wet = Math.max(wet, w.rain * (1 - back * 0.25));
  }
  return clamp01(wet * 1.4);
}
