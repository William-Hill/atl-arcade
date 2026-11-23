import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { addLodDither, createBatchFade, ditherBatch } from "./lod-dither.js";

function compile(material) {
  const lib = material.isMeshDepthMaterial ? THREE.ShaderLib.depth : THREE.ShaderLib.toon;
  const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
}

describe("addLodDither", () => {
  it("reads the dither of the instance in the vertex shader and discards in the fragment shader", () => {
    const uniform = { value: null };
    const shader = compile(addLodDither(new THREE.MeshToonMaterial(), uniform));
    expect(shader.uniforms.lodDitherTexture).toBe(uniform);
    expect(shader.vertexShader).toContain("vLodDither = texelFetch(lodDitherTexture");
    expect(shader.fragmentShader).toContain("float lodBayer4(vec2 p)");
    expect(shader.fragmentShader).toMatch(/void main\(\) \{\s*if \(vLodDither != 1\.0\)/);
  });

  it("runs after the material's own patch and keeps its cache key", () => {
    const mat = new THREE.MeshToonMaterial();
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float paint;");
    };
    mat.customProgramCacheKey = () => "cars-v1";
    addLodDither(mat, { value: null });
    const shader = compile(mat);
    expect(shader.vertexShader).toContain("attribute float paint;");
    expect(shader.vertexShader).toContain("vLodDither");
    expect(mat.customProgramCacheKey()).toBe("cars-v1|lod-dither");
    // A second call only changes the uniform.
    const tex = new THREE.DataTexture();
    addLodDither(mat, { value: tex });
    expect(mat.customProgramCacheKey()).toBe("cars-v1|lod-dither");
    expect(mat.userData.lodDither.value).toBe(tex);
  });
});

describe("ditherBatch", () => {
  it("puts the dither on the shadow depth material, also on one set later (the leaf cut)", () => {
    const mesh = new THREE.BatchedMesh(4, 16, 16, new THREE.MeshToonMaterial());
    const fade = createBatchFade(mesh, 0, 0, { geometryOf: () => 0 });
    ditherBatch(mesh, fade.uniform);
    expect(mesh.customDepthMaterial.customProgramCacheKey()).toContain("lod-dither");
    const leaf = new THREE.MeshDepthMaterial();
    leaf.customProgramCacheKey = () => "geo-props-leaf-depth";
    mesh.customDepthMaterial = leaf;
    expect(mesh.customDepthMaterial).toBe(leaf);
    expect(leaf.customProgramCacheKey()).toBe("geo-props-leaf-depth|lod-dither");
    expect(compile(leaf).fragmentShader).toContain("lodBayer4");
  });
});
