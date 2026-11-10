import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { sceneTextureMemory, textureBytes, textureFacts } from "./texture-memory.js";

describe("textureBytes", () => {
  it("is width x height x 4 for an RGBA8 texture", () => {
    expect(textureBytes({ width: 1024, height: 1024 })).toBe(4194304);
  });
  it("adds a third for the mip chain", () => {
    expect(textureBytes({ width: 1024, height: 1024, mips: true })).toBe(5592405);
  });
  it("counts the layers of an array and the bytes of a float", () => {
    expect(textureBytes({ width: 512, height: 512, depth: 5 })).toBe(5242880);
    expect(textureBytes({ width: 16, height: 16, channels: 4, bytesPerChannel: 2 })).toBe(2048);
  });
});

describe("textureFacts", () => {
  it("reads a data texture", () => {
    const t = new THREE.DataTexture(new Uint8Array(4 * 64 * 32), 64, 32);
    expect(textureFacts(t)).toMatchObject({ width: 64, height: 32, depth: 1, channels: 4, bytesPerChannel: 1, mips: false });
  });
  it("reads an array texture with mips and 2 channels", () => {
    const t = new THREE.DataArrayTexture(new Uint8Array(2 * 128 * 128 * 56), 128, 128, 56);
    t.format = THREE.RGFormat;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    const f = textureFacts(t);
    expect(f).toMatchObject({ width: 128, height: 128, depth: 56, channels: 2, mips: true });
    expect(textureBytes(f)).toBe(Math.round((128 * 128 * 56 * 2 * 4) / 3));
  });
});

describe("sceneTextureMemory", () => {
  it("counts each texture once, from material properties and uniforms", () => {
    const map = new THREE.DataTexture(new Uint8Array(4 * 256 * 256), 256, 256);
    const mask = new THREE.DataTexture(new Uint8Array(4 * 128 * 128), 128, 128);
    const scene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map })));
    scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map })));
    scene.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { tMask: { value: mask } } })));
    const m = sceneTextureMemory(scene);
    expect(m.count).toBe(2);
    expect(m.bytes).toBe(4 * 256 * 256 + 4 * 128 * 128);
    expect(m.top[0]).toMatchObject({ width: 256, height: 256 });
  });
});
