// Shared by the beat alignment tests (beat.spec.js, music.spec.js).
// Dispatches `count` real keydown events timed to the next beats with the
// same anchor mapping the game uses, and judges each event's timeStamp.
export async function measureTaps(page, count, pauseRender) {
  return page.evaluate(
    async ({ count, pauseRender }) => {
      const clock = window.__atl.beat;
      await clock.start();
      await new Promise((r) => setTimeout(r, 400));
      // The audio clock can sit still for a second after resume() while the
      // output stream starts (Chromium on a PulseAudio null sink); the
      // anchor only maps DOM time to audio time once it moves.
      for (let i = 0, last = clock.ctx.currentTime, moved = 0; i < 250 && moved < 5; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
        moved = clock.ctx.currentTime > last ? moved + 1 : 0;
        last = clock.ctx.currentTime;
      }
      await new Promise((r) => setTimeout(r, 100));
      if (!clock.ctx || clock.ctx.state !== "running") return { error: `audio context state: ${clock.ctx && clock.ctx.state}` };
      window.__atl.renderPaused = pauseRender;
      const offsets = [];
      const taps = [];
      const first = Math.ceil(clock.now() / clock.beatLen) + 1;
      await new Promise((resolve) => {
        const onKey = (e) => {
          if (e.code !== "KeyP") return;
          const j = clock.judge(clock.inputTime(e.timeStamp));
          offsets.push(j.offsetMs);
          taps.push({ index: j.index, offsetMs: Number(j.offsetMs.toFixed(2)), tag: j.tag });
          if (offsets.length === count) {
            window.removeEventListener("keydown", onKey);
            resolve();
          }
        };
        window.addEventListener("keydown", onKey);
        for (let i = 0; i < count; i += 1) {
          // setTimeout fires a few ms late; wake early and spin to the exact
          // time, read from the anchor and latency of that moment: the audio
          // clock can run a little fast or slow against performance.now(),
          // and Chromium can update outputLatency after the stream starts.
          const perfAt = () => {
            const audio = clock.startTime + (first + i) * clock.beatLen + clock.totalOffsetSec;
            return clock.anchor.perf + (audio - clock.anchor.audio) * 1000;
          };
          setTimeout(() => {
            const perf = perfAt();
            while (performance.now() < perf) {
              /* spin */
            }
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", bubbles: true }));
          }, Math.max(0, perfAt() - performance.now() - 8));
        }
      });
      window.__atl.renderPaused = false;
      const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
      const sd = Math.sqrt(offsets.reduce((a, x) => a + (x - mean) ** 2, 0) / (offsets.length - 1));
      return { mean, sd, within60: offsets.filter((o) => Math.abs(o) <= 60).length, taps, bpm: clock.bpm, latencyMs: clock.outputLatencySec * 1000 };
    },
    { count, pauseRender },
  );
}
