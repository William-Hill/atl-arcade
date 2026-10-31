import RAPIER from "@dimforge/rapier3d-compat";
import { extrudeOutline } from "../sim/level/extrude.js";
import { segmentFrames, stairBoxes } from "../sim/level/parts.js";
import { quarterPipeOutline } from "../sim/level/quarter-pipe.js";
import { quatFromYaw } from "../sim/math/quat.js";

const QUARTER_PIPE_SEGMENTS = 16;

let ready = null;

// Rapier ships its WASM inline in the -compat build, so this is the only
// async step before a world can be built.
export async function initPhysics() {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export { RAPIER };

// Every level object becomes one or more fixed colliders. Nothing here is
// dynamic yet: the skate controller is kinematic and reads the world through
// raycasts, so the block only has to be solid.
export function buildStaticWorld(level, { gravity = { x: 0, y: -9.81, z: 0 } } = {}) {
  const world = new RAPIER.World(gravity);
  const byObject = new Map();

  for (const object of level.objects) {
    const handles = [];
    for (const desc of colliderDescsFor(object)) {
      const collider = world.createCollider(desc);
      collider.userData = { objectId: object.id, kind: object.kind };
      handles.push(collider.handle);
    }
    if (handles.length === 0) throw new Error(`rapier-world: ${object.id} produced no collider`);
    byObject.set(object.id, handles);
  }

  world.step();
  return { world, byObject, colliderCount: world.colliders.len() };
}

export function colliderDescsFor(object) {
  const shape = object.shape;
  switch (shape.type) {
    case "box":
      return [
        placed(
          RAPIER.ColliderDesc.cuboid(shape.size.x / 2, shape.size.y / 2, shape.size.z / 2),
          shape.position,
          shape.yaw ?? 0,
        ),
      ];

    case "stairs":
      return stairBoxes(shape).map((box) =>
        placed(RAPIER.ColliderDesc.cuboid(box.size.x / 2, box.size.y / 2, box.size.z / 2), box.position, box.yaw),
      );

    case "segments":
      return segmentFrames(shape.points).map((frame) => {
        const desc = RAPIER.ColliderDesc.capsule(frame.length / 2, shape.radius);
        desc.setTranslation(frame.center.x, frame.center.y, frame.center.z);
        desc.setRotation(frame.rotation);
        return desc;
      });

    case "quarterPipe": {
      const solid = extrudeOutline(quarterPipeOutline(shape.radius, QUARTER_PIPE_SEGMENTS), shape.width);
      return [placed(RAPIER.ColliderDesc.trimesh(solid.vertices, solid.indices), shape.position, shape.yaw ?? 0)];
    }

    default:
      throw new Error(`rapier-world: unhandled shape ${shape.type}`);
  }
}

function placed(desc, position, yaw) {
  desc.setTranslation(position.x, position.y, position.z);
  if (yaw) desc.setRotation(quatFromYaw(yaw));
  return desc;
}
