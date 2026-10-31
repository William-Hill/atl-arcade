import * as THREE from "three";

// Rapier can hand back the whole world as line segments. Drawing them is the
// only honest way to see what the skater will actually hit, so the overlay
// reads straight from the physics world rather than from the level data.
export function createColliderDebug(world) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = "collider-debug";
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 999;

  let vertexCount = 0;

  function update() {
    if (!lines.visible) return;
    const buffers = world.debugRender();
    geometry.setAttribute("position", new THREE.BufferAttribute(buffers.vertices, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 4));
    vertexCount = buffers.vertices.length / 3;
  }

  return {
    object: lines,
    update,
    get vertexCount() {
      return vertexCount;
    },
    get visible() {
      return lines.visible;
    },
    set visible(value) {
      lines.visible = value;
      update();
    },
    toggle() {
      this.visible = !lines.visible;
      return lines.visible;
    },
  };
}
