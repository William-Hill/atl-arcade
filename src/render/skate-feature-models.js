// The skate feature GLBs (assets/skate-features) share one trim sheet, but
// GLTFLoader makes a material and textures per file. shareSkateFeatureMaterial
// points every mesh at the first loaded material, so the whole set uploads
// three textures once and batches by material.
export function shareSkateFeatureMaterial(roots, name = "skate_trim") {
  let shared = null;
  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isMesh || o.material?.name !== name) return;
      if (!shared) {
        shared = o.material;
        return;
      }
      if (o.material === shared) return;
      const old = o.material;
      o.material = shared;
      for (const k of [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "aoMap",
      ])
        old[k]?.dispose();
      old.dispose();
    });
  }
  return shared;
}
