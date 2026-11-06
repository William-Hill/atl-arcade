// The live switches of the settings menu (#94): the ink outlines and the
// bloom of a post chain from src/render/post.js. The full chain turns its
// passes off; the lite chain is one pass, so its ink strength and halftone
// go to 0 and come back to the first values.

const base = new WeakMap();

export function setPostToggles(post, { ink = true, bloom = true } = {}) {
  if (!post) return;
  if (post.kind === "full") {
    if (post.ink) post.ink.enabled = ink;
    if (post.bloom) post.bloom.enabled = bloom;
    return;
  }
  if (post.kind === "lite" && post.ink) {
    const u = post.ink.uniforms;
    if (!base.has(post)) base.set(post, { strength: u.strength.value, halftone: u.halftone.value.z });
    const b = base.get(post);
    u.strength.value = ink ? b.strength : 0;
    u.halftone.value.z = ink ? b.halftone : 0;
  }
}
