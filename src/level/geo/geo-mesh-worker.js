// The level builds in a Web Worker (#98). The worker posts { ready } once
// it has loaded. The main thread posts { job, level, options, claimLandmarks }
// and gets { result } back; mesh buffers are moved (transferred), not
// copied. See geo-mesh-async.js. Jobs:
// - "meshes": buildGeoMeshes(level, options) (geo-mesh.js).
// - "props": levelProps(level) (props.js), the street prop placements.

import { buildGeoMeshes } from "./geo-mesh.js";
import { claimLandmarkModels } from "./landmarks.js";
import { levelProps } from "./props.js";
import { meshTransferList } from "./geo-mesh-async.js";

let claimed = false;
self.onmessage = ({ data }) => {
  const { job, level, options, claimLandmarks } = data;
  try {
    // The main thread claims the GLB footprints in its own copy of the
    // landmark list; a worker has its own copy, so it claims them here too.
    if (claimLandmarks && !claimed) {
      claimLandmarkModels();
      claimed = true;
    }
    if (job === "props") {
      self.postMessage({ result: levelProps(level) });
      return;
    }
    const meshes = buildGeoMeshes(level, options);
    self.postMessage({ result: meshes }, meshTransferList(meshes));
  } catch (err) {
    self.postMessage({ error: String(err?.stack ?? err) });
  }
};
self.postMessage({ ready: true });
