import { expect, test } from "@playwright/test";

// #405: a street sign name must read left to right from both sides of the
// blade. The test renders one blade from the front (+z) and from the back
// (-z) with the real sign module and the real atlas. If the back face is
// mirrored, the back image is the mirror of the front image. If it is not,
// the back image is the same as the front image.

const NAME = "Auburn Ave NE";

test("a street sign blade reads left to right from the front and from the back", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  // Any small page on the dev server, so the module imports resolve.
  await page.goto("/package.json");
  const result = await page.evaluate(async (name) => {
    // Import three by the same URL as the sign module, so both share one copy.
    const src = await (await fetch("/src/render/street-signs.js")).text();
    const threeUrl = src.match(/from\s+"([^"]*\/deps\/three\.js[^"]*)"/)[1];
    const THREE = await import(threeUrl);
    const { createStreetSigns } = await import("/src/render/street-signs.js");
    const signs = createStreetSigns([{ x: 0, y: 0, z: 0, names: [name], yaws: [0] }]);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#d9e4ea");
    scene.add(new THREE.AmbientLight(0xffffff, 3));
    scene.add(signs.group);
    signs.update({ x: 0, y: 0, z: 0 });
    scene.updateMatrixWorld(true);

    // The blade is the part of the mesh above the post top less 0.2 m.
    const pos = signs.group.children[0].geometry.attributes.position;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      if (pos.getY(i) < 2.9) continue;
      x0 = Math.min(x0, pos.getX(i));
      x1 = Math.max(x1, pos.getX(i));
    }
    const cx = (x0 + x1) / 2;
    const y = 3.05;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    function shot(side, halfW, halfH, w, h) {
      renderer.setSize(w, h, false);
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 10);
      cam.position.set(cx, y, side * 2);
      cam.lookAt(cx, y, 0);
      renderer.render(scene, cam);
      const gl = renderer.getContext();
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { url: renderer.domElement.toDataURL("image/png"), px };
    }

    // The test crops: the middle of the blade, away from the post at x = 0.
    const W = 600;
    const H = 80;
    const halfW = (x1 - x0) / 2 - 0.2;
    const front = shot(1, halfW, 0.1, W, H).px;
    const back = shot(-1, halfW, 0.1, W, H).px;
    let same = 0;
    let mirror = 0;
    for (let r = 0; r < H; r += 1) {
      for (let c = 0; c < W; c += 1) {
        const i = (r * W + c) * 4;
        const j = (r * W + (W - 1 - c)) * 4;
        for (let k = 0; k < 3; k += 1) {
          same += Math.abs(front[i + k] - back[i + k]);
          mirror += Math.abs(front[i + k] - back[j + k]);
        }
      }
    }

    // The evidence: the whole blade and the post from both sides.
    const fullW = (x1 - x0) / 2 + 0.15;
    const frontUrl = shot(1, fullW, 0.3, 900, 220).url;
    const backUrl = shot(-1, fullW, 0.3, 900, 220).url;
    document.documentElement.innerHTML = `
      <body style="margin:0;padding:16px;background:#fff;font:16px Arial,sans-serif">
        <h3 style="margin:4px 0">#405 one street sign blade, "${name}"</h3>
        <p style="margin:8px 0 4px">Front (camera at +z)</p><img id="front" src="${frontUrl}" width="900" height="220">
        <p style="margin:8px 0 4px">Back (camera at -z)</p><img id="back" src="${backUrl}" width="900" height="220">
      </body>`;
    await Promise.all([...document.images].map((im) => im.decode()));
    return { same, mirror, width: x1 - x0 };
  }, NAME);

  await page.setViewportSize({ width: 940, height: 600 });
  await page.screenshot({ path: "e2e/.output/street-sign-backface.png", fullPage: true });
  console.log(`blade ${result.width.toFixed(2)} m, diff same ${result.same}, diff mirrored ${result.mirror}`);

  expect(errors).toEqual([]);
  // The text is there: the front and the mirrored back are not the same.
  expect(result.mirror).toBeGreaterThan(0);
  // The back reads as the front does, not as its mirror.
  expect(result.same).toBeLessThan(result.mirror * 0.25);
});
