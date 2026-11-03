// Connects Skate ATL to an Autopilot agent service on this machine. main.js
// imports this file dynamically, and only when the page has ?autopilot=1, so
// the normal build never loads the bridge.
//
// URL parameters:
//   autopilot=1                 turn the bridge on
//   autopilot_url=ws://...      the agent service (ws://127.0.0.1:8765/v1/bridge)
//   autopilot_project_dir=...   the project folder, for the codex (optional)

import { DEFAULT_URL, connectBridge } from "./autopilot-bridge.js";
import { createSkateHooks } from "./hooks.js";

// The name the Autopilot Three.js adapter reads from package.json.
export const PROJECT = "atl-arcade";

export function connectAutopilot({ params, scene, camera, canvas, renderer, atl, level, skaterObject, threeRevision }) {
  const hooks = createSkateHooks({ atl, level, skaterObject, render: () => renderer.render(scene, camera) });
  const bridge = connectBridge({
    url: params.get("autopilot_url") || DEFAULT_URL,
    scene,
    camera,
    canvas,
    hooks,
    project: PROJECT,
    projectDir: params.get("autopilot_project_dir") || "",
    threeRevision,
    metres: 1,
    onStatus: (s) => console.info(`[autopilot] ${s}`),
  });
  window.__autopilot = bridge;
  return bridge;
}
