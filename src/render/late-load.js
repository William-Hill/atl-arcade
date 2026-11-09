// The pbr downloads that wait for the first frame (#190). Pure: no Three.js
// and no DOM, so Vitest covers it (late-load.test.js).
//
// PR #226 moved the cars, the Meshy people and props, the landmark GLBs and
// the NPC-only skater after the first frame. These groups still loaded
// before it, and none of them is in the first frame of the pbr look:
// - "props": the street kit and the GLB trees (loadPropTemplates). The pbr
//   look adds the prop batch only after the first frame, so the download
//   can wait too.
// - "murals": the painted mural atlas and its roughness atlas. Until they
//   load, the mural cut shows the host wall (murals.js withMuralEdge()).
// - "ground": the pbr ground maps. Until they load, each ground layer has
//   the mean color of its scan (pbr-ground.js loadArray()).
// Once a group has loaded, the look is the same as before.

export const LATE_GROUPS = ["props", "murals", "ground"];

// The limit (ms) for each prop GLB when the props load after the first frame.
// Then they share the link with the cars, the people and the landmarks
// (#226), and nothing waits for them, so the 15 s limit of
// geo-view.js EXTRA_PROP_TIMEOUT_MS is too short: on a 1.6 Mbps link every
// GLB tree missed it and the procedural trees stayed. At 1.6 Mbps all the
// late files of high pbr (about 14 MB) take about 70 s.
export const LATE_PROP_TIMEOUT_MS = 120000;

// Pure: the limit for each prop GLB, or undefined for the default.
export function propTimeoutFor(plan) {
  return plan.props ? LATE_PROP_TIMEOUT_MS : undefined;
}

// Pure: which groups wait for the first frame. Only the pbr look defers;
// ?lateload=0 loads every group at once (for a before/after check in one build).
export function lateLoadPlan({ look = "toon", lateload = null } = {}) {
  const on = look === "pbr" && lateload !== "0";
  return Object.fromEntries(LATE_GROUPS.map((g) => [g, on]));
}

// The gate of each group and when its download started and finished, in ms
// from `now()` (performance.now in the game). `firstFrame` is the promise
// that resolves after the first frame.
export function createLateLoads(plan, firstFrame, { now = () => 0 } = {}) {
  const started = {};
  const done = {};
  const failed = {};
  let firstFrameMs = null;
  firstFrame.then(() => {
    firstFrameMs = now();
  });
  return {
    plan,
    // Runs `load` (a function that returns a promise) at once, or after the
    // first frame when the plan defers `group`. Returns the load's promise.
    run(group, load) {
      const gate = plan[group] ? firstFrame : Promise.resolve();
      return gate.then(() => {
        started[group] ??= now();
        return Promise.resolve()
          .then(load)
          .then(
            (value) => {
              done[group] ??= now();
              return value;
            },
            (err) => {
              failed[group] ??= String(err);
              throw err;
            },
          );
      });
    },
    // Marks a group as loaded from a callback (a texture onLoad).
    loaded(group) {
      done[group] ??= now();
    },
    info() {
      return { plan: { ...plan }, firstFrameMs, started: { ...started }, done: { ...done }, failed: { ...failed } };
    },
  };
}

