import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { featureLodNode, placedGeometries, placementMatrix, skateFeatureUrl, trimTextureUrl } from "./skatepark-view.js";

describe("skateFeatureUrl", () => {
  it("has a URL for each feature file, and null for an unknown file", () => {
    expect(skateFeatureUrl("ramp_quarter.glb")).toBeTruthy();
    expect(skateFeatureUrl("rail_flatbar_9m.glb")).toBeTruthy();
    expect(skateFeatureUrl("no_such.glb")).toBeNull();
  });
});

describe("trimTextureUrl", () => {
  const textures = { "skate_trim_color.jpg": "/assets/skate_trim_color-abc.jpg", "skate_trim_normal.jpg": "/assets/skate_trim_normal-def.jpg", "skate_trim_orm.jpg": "/assets/skate_trim_orm-123.jpg" };

  it("sends a trim texture to its built URL, from a hashed GLB or an inlined one", () => {
    expect(trimTextureUrl("/assets/textures/skate_trim_color.jpg", textures)).toBe("/assets/skate_trim_color-abc.jpg");
    expect(trimTextureUrl("data:model/gltf-binary;base64,AAAA/textures/skate_trim_orm.jpg", textures)).toBe("/assets/skate_trim_orm-123.jpg");
    expect(trimTextureUrl("http://localhost:5180/assets/skate-features/textures/skate_trim_normal.jpg?v=1", textures)).toBe("/assets/skate_trim_normal-def.jpg");
  });

  it("gives the blank pixel for a texture that the look does not read", () => {
    expect(trimTextureUrl("textures/skate_trim_color.jpg", textures, ["color"])).toBe("/assets/skate_trim_color-abc.jpg");
    expect(trimTextureUrl("textures/skate_trim_normal.jpg", textures, ["color"])).toMatch(/^data:image\/png;base64,/);
    expect(trimTextureUrl("textures/skate_trim_color.jpg", textures, [])).toMatch(/^data:image\/png;base64,/);
  });

  it("leaves every other URL", () => {
    expect(trimTextureUrl("/assets/ramp_quarter-CCZ.glb", textures)).toBe("/assets/ramp_quarter-CCZ.glb");
    expect(trimTextureUrl("/assets/other_skate_trim_color.jpg.bak", textures)).toBe("/assets/other_skate_trim_color.jpg.bak");
  });
});

describe("the placed geometry", () => {
  const scene = () => {
    const root = new THREE.Group();
    for (const name of ["planter_lod0", "planter_lod1"]) {
      const g = new THREE.BoxGeometry(2, 1, 1);
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
      mesh.name = name;
      mesh.position.y = 0.5;
      root.add(mesh);
    }
    return root;
  };

  it("picks the fine LOD, or the coarse one off the high tier", () => {
    const s = scene();
    expect(featureLodNode(s).name).toBe("planter_lod0");
    expect(featureLodNode(s, true).name).toBe("planter_lod1");
    const one = new THREE.Group();
    const only = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    only.name = "rail_lod0";
    one.add(only);
    expect(featureLodNode(one, true).name).toBe("rail_lod0");
  });

  it("moves a feature to its place: the position, and the yaw of Three.js rotation.y", () => {
    const p = { position: [10, 2, -5], yaw: Math.PI / 2 };
    // Model +x goes to world -z at yaw 90 degrees (skate-features.js toWorld()).
    const v = new THREE.Vector3(1, 0, 0).applyMatrix4(placementMatrix(p));
    expect([v.x, v.y, v.z].map((n) => +n.toFixed(6))).toEqual([10, 2, -6]);
    const [g] = placedGeometries(featureLodNode(scene()), p);
    g.computeBoundingBox();
    const b = g.boundingBox;
    expect([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map((n) => +n.toFixed(6))).toEqual([9.5, 10.5, 2, 3, -6, -4]);
    // Only the attributes that every feature has.
    expect(Object.keys(g.attributes).sort()).toEqual(["normal", "position", "uv"]);
  });
});
