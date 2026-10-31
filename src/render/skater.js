import * as THREE from "three";
import { SKATE } from "../sim/skate/constants.js";

const STATE_COLORS = {
  coast: 0xff5fb2,
  push: 0xff8ac4,
  brake: 0xff4d4d,
  air: 0x7bdcff,
  land: 0xffe066,
};

// The placeholder skater: a capsule with a nose so the facing is readable.
// It owns no simulation. Every frame it is told where the controller says the
// skater is, and it moves there.
export function createSkaterMesh() {
  const group = new THREE.Group();
  group.name = "skater";

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(SKATE.radius, SKATE.height - SKATE.radius * 2, 6, 16),
    new THREE.MeshStandardMaterial({ color: STATE_COLORS.coast, roughness: 0.5 }),
  );
  body.position.y = SKATE.height / 2;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff1b8, roughness: 0.4 }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, SKATE.height * 0.62, SKATE.radius + 0.22);
  group.add(nose);

  return { group, body, nose };
}

export function syncSkaterMesh(skaterMesh, state) {
  skaterMesh.group.position.set(state.position.x, state.position.y, state.position.z);
  skaterMesh.group.rotation.y = state.yaw;
  const color = STATE_COLORS[state.state] ?? STATE_COLORS.coast;
  if (skaterMesh.body.material.color.getHex() !== color) skaterMesh.body.material.color.setHex(color);
}
