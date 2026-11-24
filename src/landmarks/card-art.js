// The card art of the landmark story cards (#220). Pure: no DOM, no Three.js.
//
// Each card shows an in-game render of its landmark from a fixed camera, in
// the day pbr look (GDD, "Story card"). scripts/card-art.mjs makes the
// renders again from the cameras here, and writes public/landmark-cards/
// provenance.json with the commit, the cameras and the date.
//
// A camera is { from: [x, h, z], at: [x, h, z] }: x and z in level meters,
// h in meters over the terrain at that point (the same rule as ?cam=).

export const CARD_ART = {
  width: 640, // px of a render
  height: 360, // px; the art box of the card is 16:9
  dir: "landmark-cards", // under public/
  ext: "jpg",
  quality: 82, // JPEG quality
  // The day pbr look: a clear midday in June, on the high tier.
  // No challenge rings, and no step down of the governor during the renders.
  query: "look=pbr&quality=high&date=06-21&time=13.5&weather=clear&rings=0&governor=0&lookdown=0",
};

// The camera rule of each kind: `dist` m back from the look point, `up` m
// over the terrain, and the look point `look` m over the terrain.
export const KIND_CAMERA = {
  building: { dist: 75, up: 12, look: 14 },
  bridge: { dist: 45, up: 5, look: 4 },
  park: { dist: 60, up: 18, look: 2 },
  skate: { dist: 32, up: 10, look: 1 },
  edge: { dist: 70, up: 16, look: 6 },
};

// The changes for one spot. `az` is the compass angle of the camera from
// the look point, in degrees: 0 is +z, 90 is +x. With no `az`, the camera
// stands on the line from the spot to its find point (the trail side).
// `at` moves the look point ([x, z]).
// Tuned by eye on the renders (the level axes: +x east, +z south).
export const CARD_CAMERAS = {
  // The whole block from the north-east, over Ponce de Leon Avenue: the
  // tower is on the north side. The camera is a little past the north edge.
  "ponce-city-market": { az: 120, dist: 240, up: 35, look: 22 },
  "ford-factory-lofts": { dist: 110, up: 14, look: 10 },
  "krog-street-market": { az: 90, dist: 100, up: 16, look: 4 },
  "studioplex": { dist: 70, up: 5, look: 4 },
  // A bridge from the street under it: the BeltLine runs north to south,
  // so the streets under it run east to west.
  "ponce-de-leon-bridge": { az: 270, dist: 50, up: 3, look: 6 },
  "north-avenue-bridge": { az: 270, dist: 50, up: 3, look: 6 },
  "ralph-mcgill-bridge": { az: 110, dist: 60, up: 9, look: 5 },
  "historic-fourth-ward-skatepark": { dist: 40, up: 12 },
};

const DEFAULT_AZ = 225;

// The camera of a spot of landmarks.json.
export function cardCamera(spot, overrides = CARD_CAMERAS, kinds = KIND_CAMERA) {
  const o = overrides[spot.id] ?? {};
  const k = { ...(kinds[spot.kind] ?? kinds.building), ...o };
  const [ax, az] = o.at ?? spot.at;
  let dx;
  let dz;
  if (Number.isFinite(o.az)) {
    dx = Math.sin((o.az * Math.PI) / 180);
    dz = Math.cos((o.az * Math.PI) / 180);
  } else {
    const f = spot.find?.at;
    const fx = f ? f[0] - ax : 0;
    const fz = f ? f[1] - az : 0;
    const len = Math.hypot(fx, fz);
    if (len > 5) {
      dx = fx / len;
      dz = fz / len;
    } else {
      dx = Math.sin((DEFAULT_AZ * Math.PI) / 180);
      dz = Math.cos((DEFAULT_AZ * Math.PI) / 180);
    }
  }
  const r = (v) => Math.round(v * 10) / 10;
  return { from: [r(ax + dx * k.dist), r(k.up), r(az + dz * k.dist)], at: [r(ax), r(k.look), r(az)] };
}

// The URL of the render of a spot, from the site root.
export function cardArtUrl(id, base = "/", k = CARD_ART) {
  return `${base.endsWith("/") ? base : `${base}/`}${k.dir}/${id}.${k.ext}`;
}
