// The baked isometric map tiles of each level (scripts/bake-iso-map.mjs,
// scripts/iso-pyramid.py): assets/map/<level>/iso.json and
// assets/map/<level>/<zoom level>/<col>_<row>.jpg. Vite gives each tile a
// URL; the full map (src/ui/fullmap.js) loads only the tiles it shows.

const INFOS = import.meta.glob("../../assets/map/*/iso.json", { eager: true, import: "default" });
const TILES = import.meta.glob("../../assets/map/*/*/*.jpg", { eager: true, query: "?url", import: "default" });

// { info, url(level, col, row) } for a level name, or null with no bake.
export function isoTilesFor(name) {
  const info = INFOS[`../../assets/map/${name}/iso.json`];
  if (!info) return null;
  return { info, url: (level, col, row) => TILES[`../../assets/map/${name}/${level}/${col}_${row}.jpg`] ?? null };
}
