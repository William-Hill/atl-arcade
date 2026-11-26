import { expect, test } from "@playwright/test";

// #329: the 10 trick clips and the stumble landing in the real skater view.
// The sim does not fill state.trick yet (#327), so the test drives the view
// (src/render/skater-view.js) with states that carry state.trick, the same
// shape that the sim gives (docs/gdd/trick-input.md, Interactions).

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

const NEW_CLIPS = ["air_rocket", "air_tuckknee", "grind_makio", "grind_royale", "manual_toe", "land_stumble"];

for (const name of ["nia", "marcus"]) {
  test(`${name}: the view plays state.trick.clip and the stumble landing`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = collectErrors(page);
    await page.goto(`/skater.html?skater=${name}`);
    await page.waitForFunction(() => window.__skater && (window.__skater.ready || window.__skater.error), null, { timeout: 30000 });
    const out = await page.evaluate(async (who) => {
      const { createSkaterView } = await import("/src/render/skater-view.js");
      const { loadSkaterModel } = await import("/src/render/skater-model.js");
      const view = createSkaterView({ lean: false });
      const model = await loadSkaterModel(who);
      view.attachModel(model);
      const base = { position: [0, 0, 0], yaw: 0, speed: 5, state: "rolling", style: null, pushCooldown: 0, airTime: 0, airFrom: null, trick: null, manual: null };
      const trick = (kind, clip) => ({ kind, id: clip, name: clip, clip, dir: "u", held: true });
      const log = [];
      // Runs n frames of a state and logs the clip and its mixer weight.
      const run = (label, state, n = 30) => {
        for (let i = 0; i < n; i += 1) view.sync({ ...base, ...state }, 1 / 60);
        log.push({ label, clip: view.clip, weight: view.weights[view.clip] ?? 0 });
      };
      run("coast", {});
      run("ramp air, no grab", { state: "air", airFrom: "ramp", airTime: 0.5 });
      for (const clip of ["air_rocket", "air_tuckknee"]) run(clip, { state: "air", airFrom: "ramp", airTime: 0.5, trick: trick("grab", clip) });
      run("land stumble", { landing: "stumble" }, 6);
      run("after stumble", {}, 60);
      run("air again", { state: "air", airFrom: "ramp", airTime: 0.5, trick: trick("grab", "air_mute") });
      run("land clean", { landing: "clean" }, 6);
      for (const clip of ["grind_makio", "grind_royale"]) run(clip, { state: "grind", trick: trick("grind", clip) });
      run("grind, no stance", { state: "grind" });
      run("manual_toe", { manual: { balance: 0, meters: 0 }, trick: trick("manual", "manual_toe") });
      run("manual", { manual: { balance: 0, meters: 0 } });
      const names = model.animations.map((a) => a.name);
      return { log, names };
    }, name);

    for (const clip of NEW_CLIPS) expect(out.names, `${name} GLB has ${clip}`).toContain(clip);
    const at = (label) => out.log.find((r) => r.label === label);
    expect(at("coast").clip).toBe("coast");
    expect(at("ramp air, no grab").clip).toBe("jump");
    expect(at("air_rocket").clip).toBe("air_rocket");
    expect(at("air_tuckknee").clip).toBe("air_tuckknee");
    expect(at("land stumble").clip).toBe("land_stumble");
    expect(at("after stumble").clip).toBe("coast");
    expect(at("land clean").clip).toBe("land");
    expect(at("grind_makio").clip).toBe("grind_makio");
    expect(at("grind_royale").clip).toBe("grind_royale");
    expect(at("grind, no stance").clip).toBe("grind_frontside");
    expect(at("manual_toe").clip).toBe("manual_toe");
    expect(at("manual").clip).toBe("manual");
    // A held clip is fully faded in after 30 frames (0.5 s; the fades are 0.25 s or less).
    for (const label of ["air_rocket", "air_tuckknee", "grind_makio", "grind_royale", "manual_toe"]) expect(at(label).weight, label).toBeGreaterThan(0.99);
    console.log(`${name}: ${out.log.map((r) => `${r.label} -> ${r.clip} (${r.weight})`).join("; ")}`);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test(`${name}: each new clip renders as a contact sheet`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1200, height: 360 });
    for (const view of ["three-quarter", "back"]) {
      await page.goto(`/skater.html?skater=${name}`);
      await page.waitForFunction(() => window.__skater && (window.__skater.ready || window.__skater.error), null, { timeout: 30000 });
      for (const clip of NEW_CLIPS) {
        const info = await page.evaluate(({ n, v }) => window.__skater.sheet(n, 6, v), { n: clip, v: view });
        expect(info.tracks, `${clip} tracks`).toBeGreaterThan(5);
        await page.screenshot({ path: `docs/characters/trick-clips/sheets/${name}-${clip}-${view}.png` });
      }
    }
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}
