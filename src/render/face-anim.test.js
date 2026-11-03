import { describe, expect, it } from "vitest";
import { EYES, FACE, MOUTHS, cheer, createFaceState, moodFor, stepFace } from "./face-anim.js";

const run = (state, clip, seconds, dt = 1 / 60) => {
  const seen = [];
  let s = state;
  for (let t = 0; t < seconds; t += dt) {
    s = stepFace(s, clip, dt);
    seen.push(s);
  }
  return { state: s, seen };
};

describe("face moods", () => {
  it("gives every mood a known eye state and mouth state", () => {
    for (const clip of ["idle", "push", "coast", "bail", "land", "dance_prep", "air_mute", "grind_soul", "manual", "unknown", null]) {
      const m = moodFor(clip);
      expect(EYES).toContain(m.eyes);
      expect(MOUTHS).toContain(m.mouth);
    }
  });

  it("smiles while cruising, cheers in the air, and closes the eyes on a bail", () => {
    expect(moodFor("coast")).toEqual({ eyes: "open", mouth: "smile" });
    expect(moodFor("air_japan")).toEqual({ eyes: "open", mouth: "open" });
    expect(moodFor("dance_swagsurf")).toEqual({ eyes: "happy", mouth: "smile" });
    expect(moodFor("bail")).toEqual({ eyes: "closed", mouth: "open" });
  });
});

describe("blinks", () => {
  it("blinks every 2.2 to 5 s while the eyes are open", () => {
    const { seen } = run(createFaceState(7), "coast", 30);
    const closings = seen.filter((s, i) => s.eyes === "closed" && seen[i - 1]?.eyes !== "closed").length;
    expect(closings).toBeGreaterThanOrEqual(Math.floor(30 / FACE.blinkMax));
    expect(closings).toBeLessThanOrEqual(Math.ceil(30 / FACE.blinkMin));
    // A blink goes open, half, closed, half, open.
    const seq = seen.map((s) => s.eyes).filter((e, i, a) => e !== a[i - 1]);
    expect(seq.slice(0, 5)).toEqual(["open", "half", "closed", "half", "open"]);
  });

  it("is deterministic for one seed", () => {
    const a = run(createFaceState(3), "idle", 12).seen.map((s) => s.eyes).join();
    const b = run(createFaceState(3), "idle", 12).seen.map((s) => s.eyes).join();
    expect(a).toBe(b);
  });

  it("does not blink during a dance (happy eyes)", () => {
    const { seen } = run(createFaceState(1), "dance_prep", 10);
    expect(new Set(seen.map((s) => s.eyes))).toEqual(new Set(["happy"]));
  });
});

describe("cheer and landing", () => {
  it("holds the cheer face for the cheer time, then goes back to the mood", () => {
    let s = cheer(createFaceState(1));
    s = stepFace(s, "push", 1 / 60);
    expect([s.eyes, s.mouth]).toEqual(["happy", "open"]);
    s = run(s, "push", FACE.cheerTime).state;
    expect(s.mouth).toBe("neutral");
  });

  it("smiles for a moment after a landing", () => {
    let s = stepFace(createFaceState(1), "land", 1 / 60);
    s = stepFace(s, "push", 1 / 60);
    expect(s.mouth).toBe("smile");
    s = run(s, "push", FACE.landSmile).state;
    expect(s.mouth).toBe("neutral");
  });
});
