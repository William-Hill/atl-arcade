// Connects the trick input prototype to an Autopilot agent service on this
// machine (#326). main.js imports this file dynamically, only in a dev build
// and only with ?autopilot=1. The bridge is a copy (see autopilot-bridge.js).
//
// URL parameters:
//   autopilot=1                 turn the bridge on
//   autopilot_url=ws://...      the agent service (ws://127.0.0.1:8765/v1/bridge)
//   autopilot_project_dir=...   the project folder, for the codex (optional)

import { DEFAULT_URL, connectBridge } from "./autopilot-bridge.js";
import { createTrickHooks } from "./hooks.js";

export const PROJECT = "atl-arcade";

export function connectAutopilot({ params, scene, camera, canvas, ti, intents, skaterObject, render, threeRevision }) {
  const hooks = createTrickHooks({ ti, intents, skaterObject, render });
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
