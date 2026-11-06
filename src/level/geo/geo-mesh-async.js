// Builds the level meshes and the street prop placements off the main
// thread (#98). The mesh build (buildGeoMeshes) and the props (levelProps)
// take seconds on a phone; in Web Workers they run while the main thread
// makes the renderer, and the physics WASM compiles. A mesh build is split
// in shards (one per worker, by tile), and the result is the same list of
// meshes as buildGeoMeshes().
//
// Chromium boots a worker with tasks on the main thread, so a worker made
// just before a long main-thread task starts only after it. `ready` resolves
// when every worker has loaded (or after `readyWait` ms): await it before
// the long work.
//
// Without a Worker (Node, an old browser), or when a worker fails, its shard
// builds on the main thread, as before.

import { buildGeoMeshes, mergeGeoShards } from "./geo-mesh.js";
import { levelProps } from "./props.js";

// The buffers of the meshes, once each, for postMessage(..., transfer).
export function meshTransferList(meshes) {
  const out = new Set();
  for (const { mesh } of meshes) {
    for (const v of Object.values(mesh)) if (ArrayBuffer.isView(v) && v.buffer.byteLength > 0) out.add(v.buffer);
  }
  return [...out];
}

// The number of workers for one build: one core stays for the main thread,
// and at most `max` (more workers each pay the module load and the shared
// setup of the build).
export function meshWorkerCount(cores, max = 2) {
  const n = Number.isFinite(cores) ? Math.floor(cores) - 1 : 1;
  return Math.max(1, Math.min(max, n));
}

// The default worker. Vite bundles the worker file from this URL.
export function createMeshWorker() {
  return new Worker(new URL("./geo-mesh-worker.js", import.meta.url), { type: "module" });
}

// The main-thread build of a job, the same as the worker's.
function runJob(job, level, options) {
  return job === "props" ? levelProps(level) : buildGeoMeshes(level, options);
}

// One job in one worker, or here when there is no worker.
// Returns { ready, result }.
function startJob(job, level, options, { claimLandmarks, createWorker, onFallback }) {
  const local = (why) => {
    onFallback?.(why);
    return runJob(job, level, options);
  };
  let worker = null;
  let failed = null;
  try {
    worker = createWorker?.() ?? null;
  } catch (err) {
    failed = err;
  }
  if (!worker) return { ready: Promise.resolve(), result: Promise.resolve().then(() => local(failed)) };
  let isReady;
  const ready = new Promise((r) => (isReady = r));
  const result = new Promise((resolve) => {
    // The first result or failure ends the job; a later event does nothing.
    let ended = false;
    const done = (fn) => {
      if (ended) return;
      ended = true;
      isReady();
      worker.terminate?.();
      resolve(fn());
    };
    worker.onmessage = ({ data }) => {
      if (data?.ready) isReady();
      else done(() => (data?.error ? local(data.error) : data.result));
    };
    worker.onerror = (e) => {
      e?.preventDefault?.();
      done(() => local(e?.message ?? e));
    };
    // A result that cannot be read here: build here, so the level does not wait forever.
    worker.onmessageerror = () => done(() => local("the worker result could not be read"));
    try {
      worker.postMessage({ job, level, options, claimLandmarks });
    } catch (err) {
      // A level that cannot be cloned: build here.
      done(() => local(err));
    }
  });
  return { ready, result };
}

// The `ready` of some jobs: all loaded, or `wait` ms passed.
function readyOf(jobs, wait) {
  const all = Promise.all(jobs.map((j) => j.ready));
  return wait > 0 ? Promise.race([all, new Promise((r) => setTimeout(r, wait))]) : all;
}

const defaultWorker = () => (typeof Worker === "function" ? createMeshWorker : null);

// Starts a build. Returns { ready, meshes }: `meshes` is a promise of the
// meshes, and `ready` resolves when the workers have loaded (at most
// `readyWait` ms). `workers` shards share the build. `createWorker` makes a
// worker (null or a throw: that shard builds on the main thread). Each
// worker is closed when its shard is done. `claimLandmarks` tells the
// workers that the main thread called claimLandmarkModels()
// (src/level/geo/landmarks.js).
export function startGeoMeshBuild(level, options = {}, { workers = 1, readyWait = 2000, claimLandmarks = false, createWorker = defaultWorker(), onFallback = null } = {}) {
  const count = createWorker ? Math.max(1, Math.floor(workers)) : 1;
  const ctx = { claimLandmarks, createWorker, onFallback };
  const shards = [];
  for (let index = 0; index < count; index += 1) shards.push(startJob("meshes", level, count > 1 ? { ...options, shard: { index, count } } : options, ctx));
  const meshes = count === 1 ? shards[0].result : Promise.all(shards.map((s) => s.result)).then(mergeGeoShards);
  return { ready: readyOf(shards, readyWait), meshes };
}

// Starts the street prop placements (levelProps()) in a worker. Returns
// { ready, props }, as startGeoMeshBuild().
export function startLevelProps(level, { readyWait = 2000, createWorker = defaultWorker(), onFallback = null } = {}) {
  const job = startJob("props", level, {}, { claimLandmarks: false, createWorker, onFallback });
  return { ready: readyOf([job], readyWait), props: job.result };
}

// The meshes only (see startGeoMeshBuild()).
export function buildGeoMeshesAsync(level, options = {}, opts = {}) {
  return startGeoMeshBuild(level, options, opts).meshes;
}
