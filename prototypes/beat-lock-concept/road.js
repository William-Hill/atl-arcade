// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does pushing on the beat in the browser feel locked to the music?
// Date: 2026-10-30
//
// Straight pseudo-3D road. Same projection idea as the Rush Connector road,
// rewritten here. Segment kinds: "flat" or "rail".

export const SEGMENT_LENGTH = 200;
export const ROAD_WIDTH = 2000;

export function buildRoad(totalSegments = 2000) {
  const road = [];
  // Pattern per 64 segments: 24 flat, 16 rail, 24 flat.
  for (let i = 0; i < totalSegments; i += 1) {
    const m = i % 64;
    const kind = m >= 24 && m < 40 ? "rail" : "flat";
    road.push({ index: i, z: i * SEGMENT_LENGTH, kind });
  }
  return road;
}

export function segmentAt(road, z) {
  const index = Math.floor(z / SEGMENT_LENGTH) % road.length;
  return road[(index + road.length) % road.length];
}

export function project(worldZ, worldY, cameraZ, camera, screen) {
  const dz = Math.max(1, worldZ - cameraZ);
  const scale = camera.depth / dz;
  const x = screen.width / 2;
  const y = screen.height / 2 - (scale * (worldY - camera.height) * screen.height) / 2;
  const w = (scale * ROAD_WIDTH * screen.width) / 2;
  return { x, y, w, scale };
}
