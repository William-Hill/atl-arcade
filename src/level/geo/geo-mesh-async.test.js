// The level builds off the main thread (#98): the tile shards, the worker
// protocol (with an in-process fake worker), and the main-thread fallback.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildGeoMeshes, mergeGeoShards, shardOf, sortGeoMeshes } from "./geo-mesh.js";
import { buildGeoMeshesAsync, meshTransferList, meshWorkerCount, startGeoMeshBuild, startLevelProps } from "./geo-mesh-async.js";
import { levelProps } from "./props.js";
import { createLevelEnv } from "../ground.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const FAR = { terrainStep: 2, surfacesOnly: true };

// The bytes of a mesh list, to compare two builds.
function bytesOf(list) {
  return list.map(({ material, tile, mesh }) => [material, tile, Object.keys(mesh).sort().map((k) => [k, mesh[k].constructor.name, Buffer.from(mesh[k].buffer, mesh[k].byteOffset, mesh[k].byteLength).toString("base64")])]);
}

// A fake worker: runs the job in this thread, with a structured clone of
// the message both ways, as a real worker.
function fakeWorker({ failWith = null, neverReady = false } = {}) {
  const w = {
    terminated: false,
    posted: [],
    postMessage(msg) {
      const { job, level, options } = structuredClone(msg);
      this.posted.push(msg);
      setTimeout(() => {
        if (failWith === "error-event") return w.onerror?.({ message: "boom", preventDefault() {} });
        if (failWith === "message-error") return w.onmessageerror?.({});
        if (failWith === "error-twice") {
          w.onmessage?.({ data: { error: "first" } });
          return w.onerror?.({ message: "second", preventDefault() {} });
        }
        if (failWith) return w.onmessage?.({ data: { error: failWith } });
        const result = job === "props" ? levelProps(level) : buildGeoMeshes(level, options);
        w.onmessage?.({ data: structuredClone({ result }) });
      }, 0);
    },
    terminate() {
      this.terminated = true;
    },
  };
  if (!neverReady) setTimeout(() => w.onmessage?.({ data: { ready: true } }), 0);
  return w;
}

describe("the tile shards of a mesh build", () => {
  it("gives every tile one shard", () => {
    for (const count of [1, 2, 3, 4]) {
      for (let i = -5; i <= 5; i += 1) {
        for (let j = -5; j <= 5; j += 1) {
          const s = shardOf(`${i},${j}`, count);
          expect(Number.isInteger(s) && s >= 0 && s < count).toBe(true);
        }
      }
    }
    // Neighbor tiles go to different shards.
    expect(shardOf("0,0", 2)).not.toBe(shardOf("1,0", 2));
    expect(shardOf("0,0", 2)).not.toBe(shardOf("0,1", 2));
  });

  // The full build in 2 shards, the far build in 3 (each full build takes seconds).
  it("builds the same meshes in 2 or 3 shards as in one build", () => {
    for (const [options, count] of [[{}, 2], [FAR, 3]]) {
      const full = bytesOf(buildGeoMeshes(LEVEL, options));
      {
        const parts = [];
        for (let index = 0; index < count; index += 1) parts.push(buildGeoMeshes(LEVEL, { ...options, shard: { index, count } }));
        // Each shard has some tiles, and no key is in two shards.
        for (const p of parts) expect(p.length).toBeGreaterThan(0);
        expect(new Set(parts.flat().map((m) => `${m.material}|${m.tile}`)).size).toBe(parts.flat().length);
        expect(bytesOf(mergeGeoShards(parts))).toEqual(full);
      }
    }
  }, 60000);

  it("sorts by material, then by tile", () => {
    const list = [
      { material: "building", tile: "1,0" },
      { material: "surface", tile: "2,0" },
      { material: "surface", tile: "-1,0" },
      { material: "claimed", tile: "0,0" },
    ];
    expect(sortGeoMeshes(list).map((m) => `${m.material}|${m.tile}`)).toEqual(["claimed|0,0", "surface|-1,0", "surface|2,0", "building|1,0"]);
  });
});

describe("the worker helpers", () => {
  it("lists each mesh buffer once", () => {
    const a = new Float32Array(6);
    const b = new Uint32Array(3);
    const list = meshTransferList([{ mesh: { positions: a, indices: b } }, { mesh: { positions: a, colors: new Float32Array(0) } }]);
    expect(list).toEqual([a.buffer, b.buffer]);
  });

  it("keeps one core for the main thread, with 1 to 2 workers", () => {
    expect(meshWorkerCount(8)).toBe(2);
    expect(meshWorkerCount(3)).toBe(2);
    expect(meshWorkerCount(2)).toBe(1);
    expect(meshWorkerCount(1)).toBe(1);
    expect(meshWorkerCount(undefined)).toBe(1);
    expect(meshWorkerCount(16, 4)).toBe(4);
  });
});

describe("a mesh build in workers", () => {
  it("gives the same meshes as a main-thread build, in 1 or 2 workers, and closes the workers", async () => {
    const full = bytesOf(buildGeoMeshes(LEVEL, FAR));
    for (const workers of [1, 2]) {
      const made = [];
      const build = startGeoMeshBuild(LEVEL, FAR, { workers, createWorker: () => made.push(fakeWorker()) && made.at(-1) });
      await build.ready;
      expect(bytesOf(await build.meshes)).toEqual(full);
      expect(made.length).toBe(workers);
      expect(made.every((w) => w.terminated)).toBe(true);
      if (workers === 2) expect(made.map((w) => w.posted[0].options.shard)).toEqual([{ index: 0, count: 2 }, { index: 1, count: 2 }]);
    }
  }, 30000);

  it("tells the worker to claim the landmark footprints", async () => {
    const w = fakeWorker();
    await buildGeoMeshesAsync(LEVEL, FAR, { claimLandmarks: true, createWorker: () => w });
    expect(w.posted[0].claimLandmarks).toBe(true);
  });

  it("builds on the main thread with no worker, a failed worker, or a worker error", async () => {
    const full = bytesOf(buildGeoMeshes(LEVEL, FAR));
    const cases = [
      [null, null],
      [() => null, null],
      [() => {
        throw new Error("no workers here");
      }, "no workers here"],
      [() => fakeWorker({ failWith: "bad level" }), "bad level"],
      [() => fakeWorker({ failWith: "error-event" }), "boom"],
      [() => fakeWorker({ failWith: "message-error" }), "could not be read"],
      [() => fakeWorker({ failWith: "error-twice" }), "first"],
    ];
    for (const [createWorker, why] of cases) {
      const onFallback = vi.fn();
      expect(bytesOf(await buildGeoMeshesAsync(LEVEL, FAR, { createWorker, onFallback }))).toEqual(full);
      expect(onFallback).toHaveBeenCalledTimes(1);
      const arg = onFallback.mock.calls[0][0];
      if (why) expect(String(arg?.message ?? arg)).toContain(why);
      else expect(arg).toBe(null);
    }
  }, 30000);

  it("is ready after `readyWait` ms when a worker does not load", async () => {
    vi.useFakeTimers();
    try {
      let ready = false;
      const build = startGeoMeshBuild(LEVEL, FAR, { readyWait: 500, createWorker: () => ({ postMessage() {}, terminate() {} }) });
      build.ready.then(() => (ready = true));
      await vi.advanceTimersByTimeAsync(499);
      expect(ready).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the street props in a worker", () => {
  it("gives the same placements as levelProps(), and the env uses them", async () => {
    const level = structuredClone(LEVEL);
    const direct = levelProps(level);
    const job = startLevelProps(level, { createWorker: () => fakeWorker() });
    await job.ready;
    const placed = await job.props;
    expect(placed).toEqual(direct);
    const env = createLevelEnv(level, { placed });
    expect(env.props).toBe(placed);
    expect(env.grindables.length).toBe(createLevelEnv(level).grindables.length);
  }, 30000);

  it("builds the props on the main thread with no worker", async () => {
    const job = startLevelProps(LEVEL, { createWorker: null });
    expect((await job.props).length).toBe(levelProps(LEVEL).length);
  });
});
