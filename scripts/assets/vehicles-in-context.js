// Loaded into the running game page by vehicles-in-context.mjs: adds rigged
// vehicle GLBs to the live scene (window.__atl.scene) in a row, front wheels
// steered and the wheels_roll clip posed, without touching the game code.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

// spots: [{ url, x, y, z, yaw }] with the game's car yaw (forward = (cos yaw, -sin yaw)).
export async function place(scene, spots, steer = 0.35) {
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const out = [];
  for (const s of spots) {
    const gltf = await loader.loadAsync(s.url);
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.name.startsWith("steer_")) o.rotation.y = steer;
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
      mixer.update(0.3);
    }
    model.position.set(s.x, s.y, s.z);
    model.rotation.y = s.yaw + Math.PI / 2;
    scene.add(model);
    out.push(s.url);
  }
  return out;
}
