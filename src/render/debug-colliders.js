import * as THREE from "three";

// Draws Rapier's debug wireframe as line segments. Toggle with the H key or
// `?debug=1`.
export function createDebugColliders(world) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = "debug-colliders";
  lines.renderOrder = 10;
  lines.visible = false;
  let vertexCount = 0;

  function update() {
    if (!lines.visible) return;
    const { vertices, colors } = world.debugRender();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.computeBoundingSphere();
    vertexCount = vertices.length / 3;
  }

  return {
    lines,
    update,
    get visible() {
      return lines.visible;
    },
    set visible(v) {
      lines.visible = v;
      if (v) update();
    },
    get vertexCount() {
      return vertexCount;
    },
  };
}
