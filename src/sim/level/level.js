// Level data rules. A level is plain data: a spawn, a fixed screenshot camera,
// and a list of objects. Rendering, physics and the grind system all read the
// same list, so this file is where the shape of that data is enforced.

import { polylineLength } from "./spline.js";

export const OBJECT_KINDS = ["ground", "sidewalk", "curb", "rail", "ledge", "ramp", "stairs"];
export const SHAPE_TYPES = ["box", "segments", "quarterPipe", "stairs"];

// Kinds the skater can grind. They must carry a spline. Curbs are only 22 cm
// tall and run the whole block, so they stay out until the snap rules in M0-05
// have been tuned against the rails and ledges.
export const GRINDABLE_KINDS = ["rail", "ledge"];

export function validateLevel(level) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!level || typeof level !== "object") throw new Error("level: not an object");
  if (!level.id) fail("level needs an id");
  if (!level.spawn || !isVec3(level.spawn.position)) fail("level needs a spawn position");
  if (level.spawn && !Number.isFinite(level.spawn.yaw)) fail("level spawn needs a finite yaw");
  if (!Array.isArray(level.objects) || level.objects.length === 0) {
    fail("level needs at least one object");
    throw new Error(`invalid level: ${problems.join("; ")}`);
  }

  const seen = new Set();
  for (const object of level.objects) {
    const where = object?.id ?? "<no id>";
    if (!object.id) fail("an object has no id");
    else if (seen.has(object.id)) fail(`duplicate object id ${object.id}`);
    seen.add(object.id);

    if (!OBJECT_KINDS.includes(object.kind)) fail(`${where}: unknown kind ${object.kind}`);
    if (!object.shape || !SHAPE_TYPES.includes(object.shape.type)) {
      fail(`${where}: unknown shape type ${object.shape?.type}`);
      continue;
    }
    problems.push(...shapeProblems(where, object.shape));

    if (GRINDABLE_KINDS.includes(object.kind)) {
      if (!Array.isArray(object.spline) || object.spline.length < 2) {
        fail(`${where}: a ${object.kind} needs a grind spline of at least two points`);
      } else if (!object.spline.every(isVec3)) {
        fail(`${where}: grind spline has a non-finite point`);
      } else if (polylineLength(object.spline) <= 0) {
        fail(`${where}: grind spline has no length`);
      }
    }
  }

  if (problems.length > 0) throw new Error(`invalid level: ${problems.join("; ")}`);
  return level;
}

export function grindables(level) {
  return level.objects.filter((o) => GRINDABLE_KINDS.includes(o.kind) && Array.isArray(o.spline));
}

export function objectsOfKind(level, kind) {
  return level.objects.filter((o) => o.kind === kind);
}

export function findObject(level, id) {
  return level.objects.find((o) => o.id === id);
}

// Axis-aligned bounds of everything with a position, for the camera and for
// keeping the skater on the block.
export function levelBounds(level) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const grow = (p) => {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  };

  for (const object of level.objects) {
    const shape = object.shape;
    if (shape.type === "box") {
      grow({
        x: shape.position.x - shape.size.x / 2,
        y: shape.position.y - shape.size.y / 2,
        z: shape.position.z - shape.size.z / 2,
      });
      grow({
        x: shape.position.x + shape.size.x / 2,
        y: shape.position.y + shape.size.y / 2,
        z: shape.position.z + shape.size.z / 2,
      });
    } else if (shape.type === "segments") {
      for (const p of shape.points) grow(p);
    } else {
      grow(shape.position);
    }
  }
  return { min, max };
}

function shapeProblems(where, shape) {
  const problems = [];
  switch (shape.type) {
    case "box":
      if (!isVec3(shape.position)) problems.push(`${where}: box needs a position`);
      if (!isVec3(shape.size) || shape.size.x <= 0 || shape.size.y <= 0 || shape.size.z <= 0) {
        problems.push(`${where}: box needs a positive size`);
      }
      break;
    case "segments":
      if (!Array.isArray(shape.points) || shape.points.length < 2 || !shape.points.every(isVec3)) {
        problems.push(`${where}: segments need at least two finite points`);
      }
      if (!(shape.radius > 0)) problems.push(`${where}: segments need a positive radius`);
      break;
    case "quarterPipe":
      if (!isVec3(shape.position)) problems.push(`${where}: ramp needs a position`);
      if (!(shape.radius > 0)) problems.push(`${where}: ramp needs a positive radius`);
      if (!(shape.width > 0)) problems.push(`${where}: ramp needs a positive width`);
      break;
    case "stairs":
      if (!isVec3(shape.position)) problems.push(`${where}: stairs need a position`);
      if (!Number.isInteger(shape.steps) || shape.steps < 1) problems.push(`${where}: stairs need a step count`);
      if (!(shape.rise > 0) || !(shape.run > 0) || !(shape.width > 0)) {
        problems.push(`${where}: stairs need a positive rise, run and width`);
      }
      break;
    default:
      problems.push(`${where}: unhandled shape ${shape.type}`);
  }
  if (shape.yaw !== undefined && !Number.isFinite(shape.yaw)) problems.push(`${where}: yaw must be finite`);
  return problems;
}

function isVec3(p) {
  return Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}
