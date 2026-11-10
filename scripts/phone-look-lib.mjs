// The phone profiles and the fixed cameras of the phone look measurements
// (#246): scripts/phone-look-perf.mjs and scripts/phone-look-split.mjs.

import { devices } from "@playwright/test";

function device(name, landscape = false) {
  const d = { ...devices[name] };
  delete d.defaultBrowserType;
  if (landscape) d.viewport = { width: d.viewport.height, height: d.viewport.width };
  return d;
}
export const PHONE_PROFILES = {
  "iphone15-port": device("iPhone 15"),
  "iphone15-land": device("iPhone 15", true),
  "pixel7-port": device("Pixel 7"),
  // A small Android phone: 360 x 640 CSS px at pixel ratio 2.
  "360x640": { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent },
};

// --cams spawn,street: a fixed camera (view=fixed) in place of the ride. The
// frame time is then read rAF to rAF with a 1-pixel readPixels, so the
// software GPU completes each frame (the method of scripts/leaf-perf.mjs).
// The same view in every run: use it to rank costs. The people and the cars
// stay in the frame.
export const PHONE_CAMS = {
  // The game's own follow camera at the spawn, with the skater in the frame
  // (no fixed camera): the first view of a ride.
  follow: "",
  // The trail by the spawn: two near tree crowns, the lawn, walkers.
  spawn: "312,2,-175,334,3,-80",
  // The North Avenue tree row and its storefronts.
  street: "-125,9.5,-706,20,16.5,-700",
  // Krog Street Market: a mural, brick storefronts, parked cars.
  krog: "-150,2,780,-70,5,850",
};
