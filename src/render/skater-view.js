import * as THREE from "three";
import { SKATER_BODY } from "../sim/skate/constants.js";

// A capsule bound to the controller output. The nose cone shows the facing.
export function createSkaterView() {
  const group = new THREE.Group();
  group.name = "skater";
  const bodyLength = SKATER_BODY.height - 2 * SKATER_BODY.radius;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(SKATER_BODY.radius, bodyLength, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0xff5fb2, roughness: 0.5 }),
  );
  body.position.y = SKATER_BODY.height / 2;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.5 }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(SKATER_BODY.radius + 0.1, 0.5, 0);
  group.add(nose);

  return {
    group,
    body,
    sync(state) {
      group.position.set(state.position[0], state.position[1], state.position[2]);
      // While grinding the capsule leans with the balance meter.
      let lean = state.state === "grind" && state.grind ? -state.grind.balance * 0.6 : 0;
      let spin = 0;
      let rock = 0;
      // Placeholder style animations: "tilt" rocks side to side, "spin" turns once.
      if (state.style) {
        const p = Math.min(state.style.time / state.style.duration, 1);
        if (state.style.anim === "tilt") rock = Math.sin(p * Math.PI * 4) * 0.45;
        else if (state.style.anim === "spin") spin = p * Math.PI * 2;
      }
      group.rotation.set(lean, state.yaw + spin, rock, "YXZ");
    },
  };
}
