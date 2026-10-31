// Scripted input: a list of { frames, input } entries played back one fixed
// tick at a time. Pure. Playwright and Vitest drive the controller with it,
// so no real keyboard or gamepad is needed.

export function createScriptPlayer(script) {
  const entries = script.map((e) => ({ frames: Math.max(0, Math.floor(e.frames ?? 0)), input: e.input ?? {} }));
  let index = 0;
  let left = entries.length ? entries[0].frames : 0;
  while (index < entries.length && left === 0) {
    index += 1;
    left = index < entries.length ? entries[index].frames : 0;
  }
  const total = entries.reduce((n, e) => n + e.frames, 0);
  let played = 0;

  return {
    get done() {
      return index >= entries.length;
    },
    get played() {
      return played;
    },
    get total() {
      return total;
    },
    // The input for this tick, or null when the script is over.
    next() {
      if (index >= entries.length) return null;
      const input = entries[index].input;
      left -= 1;
      played += 1;
      while (index < entries.length && left <= 0) {
        index += 1;
        left = index < entries.length ? entries[index].frames : 0;
      }
      return input;
    },
  };
}
