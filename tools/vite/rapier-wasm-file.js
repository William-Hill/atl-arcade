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
  let build = false;
  let transformed = false;
  return {
    name: "rapier-wasm-file",
    enforce: "pre",
    configResolved(config) {
      build = config.command === "build";
    },
    transform(code, id) {
      if (!FILE.test(id.split("?")[0])) return null;
      transformed = true;
      const hits = code.match(INLINE);
      if (!hits || hits.length !== 1) {
        this.error(`rapier-wasm-file: expected 1 inline WASM in ${id}, found ${hits ? hits.length : 0}. Check the Rapier version.`);
      }
      return { code: code.replace(INLINE, 'new URL("./rapier_wasm3d_bg.wasm", import.meta.url)'), map: null };
    },
    // A production build must transform Rapier. If a new Rapier version
    // moves its entry file, the build stops instead of shipping the inline WASM.
    buildEnd(error) {
      if (build && !error && !transformed) this.error("rapier-wasm-file: the Rapier module was not transformed. Check the Rapier version and the FILE pattern.");
    },
  };
}
