// The camera effect flash (#253): a warm full-screen tint over the canvas.
// It is a DOM layer, not a post pass, so it works on every quality tier.
// It takes no pointer input. The canvas pixels do not change, so a photo
// mode save never shows it.

export const FLASH_COLOR = "rgb(255, 214, 140)";

// `after` is the game canvas: the flash goes just after it in the page, so
// the HUD and the panels (added later, no z-index) paint over the flash.
export function createScreenFlash(after) {
  const el = document.createElement("div");
  el.dataset.atl = "screen-flash";
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    background: FLASH_COLOR,
    mixBlendMode: "screen",
    opacity: "0",
    pointerEvents: "none",
  });
  after.after(el);
  let last = 0;
  return {
    // `amount` is 0..1 (the flash offset of the camera effects).
    set(amount) {
      const a = Math.round(Math.min(Math.max(amount, 0), 1) * 1000) / 1000;
      if (a === last) return;
      last = a;
      el.style.opacity = String(a);
    },
    get amount() {
      return last;
    },
    element: el,
  };
}
