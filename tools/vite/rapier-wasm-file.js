// Vite plugin (#74): load the Rapier WASM as its own file.
//
// @dimforge/rapier3d-compat inlines its 3 MB WASM as a base64 string in
// dist/rapier.mjs, so the main bundle carries 4.3 MB of text, and a phone
// must decode it before the physics can start. The same package also ships
// the binary dist/rapier_wasm3d_bg.wasm. Its init() passes the decoded
// bytes to the wasm-bindgen loader, which also accepts a URL. This plugin
// swaps the base64 bytes for the URL of the .wasm file next to rapier.mjs.
// Vite then emits the .wasm as an asset, and the browser streams and
// compiles it while it downloads.
//
// The pattern must match exactly once, or the build stops: a new Rapier
// version must not change the bundle in silence.

const FILE = /@dimforge[\\/]rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/;
// <name>.toByteArray("AGFzbQ...").buffer : the base64 WASM ("\0asm" is
// AGFzbQ). The .buffer goes too, or the URL becomes undefined.
const INLINE = /[A-Za-z_$][\w$]*\.toByteArray\("AGFzbQ[A-Za-z0-9+/=]+"\)(?:\.buffer)?/g;

export function rapierWasmFile() {
  return {
    name: "rapier-wasm-file",
    enforce: "pre",
    transform(code, id) {
      if (!FILE.test(id.split("?")[0])) return null;
      const hits = code.match(INLINE);
      if (!hits || hits.length !== 1) {
        this.error(`rapier-wasm-file: expected 1 inline WASM in ${id}, found ${hits ? hits.length : 0}. Check the Rapier version.`);
      }
      return { code: code.replace(INLINE, 'new URL("./rapier_wasm3d_bg.wasm", import.meta.url)'), map: null };
    },
  };
}
