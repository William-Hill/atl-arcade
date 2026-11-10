// Pbr lite (#246): the pbr look on the phone tier. It keeps what makes the
// look read as pbr (the standard materials and the palette, the grade, the
// sky light, the ground scans, the painted murals, the Meshy people and the
// GLB cars) and cuts what the phone cannot pay for. The numbers behind each
// cut are in docs/perf/246/README.md.
//
// Pure: main.js reads PBR_LITE and passes the values on.

// Pure: true when the pbr look runs as pbr lite. `param` is ?pbrlite: "0"
// keeps the phone tier's pbr look as it was before #246 (for a before/after
// check in one build), "1" also gives the low tier pbr lite.
export function isPbrLite({ look, quality, param = null } = {}) {
  if (look !== "pbr" || param === "0") return false;
  return quality === "phone" || (param === "1" && quality === "low");
}

export const PBR_LITE = {
  // The trees: the procedural species trees with a solid crown core and this
  // many leaf cards on each crown puff (the full pbr look draws the Blender
  // trees: 300 to 520 cards a tree). No Blender tree GLBs download.
  leafCards: 6,
  // The painted mural atlas at 1024 px (the full look: 2048 px): 5.6 MB of
  // GPU memory, not 22 MB, and 0.25 MB to download, not 0.88 MB.
  muralSize: 1024,
  // The ground scans keep their albedo and ORM samples and lose the second,
  // larger albedo sample against the tile repeat (pbr-ground.js GROUND_CUTS).
  groundCuts: ["oneAlbedo"],
};
