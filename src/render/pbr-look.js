import * as THREE from "three";
import { HEIGHT_FOG, bloomThreshold, districtLook, districtWeights, envForSky, timeGrade } from "./pbr-palette.js";
import { ENV_SKY, LOOKS, createSkyEnvironment } from "./look.js";
import { SKATER_RIM } from "./toon.js";

// The per-frame light of the pbr look (#160). Pure values come from
// src/render/pbr-palette.js; this module writes them to the scene:
//
// - the grade pass uniforms (src/render/post.js): the tone grade by time of
//   day and the light tint of the district at the camera
// - the fog color: the horizon color with a part of the district fog tint
// - the environment map: baked again from the sky when the sky colors move
//   (dusk, night, cloud), and its intensity follows the daylight, so the
//   night is not lit by a noon sky
// - the skater rim (src/render/toon.js SKATER_RIM)
// - the sun: the weather sun times LOOKS.pbr.sunScale
// - the bloom threshold: high in the day, so no sunlit surface glows
//
// installHeightFog() changes the Three.js fog chunks, so every material with
// fog gets the height fog. Call it once, before the first material compiles,
// and only in the pbr look.

const f4 = (v) => v.toFixed(4);

export function installHeightFog(f = HEIGHT_FOG) {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes("pbrHeightFog")) return;
  C.fog_pars_vertex = `#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying float vFogWorldY;\n#endif`;
  // The world height from the view-space position: the view matrix is a
  // rotation R and a move t, so the world point is R^T (mv - t).
  C.fog_vertex = `#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorldY = ((mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix)).y;\n#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n\tvarying float vFogWorldY;\n\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif`;
  // pbr-palette.js heightFogFactor(), for the linear fog. The exp2 fog
  // (not used by the levels) keeps the stock formula.
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		// pbrHeightFog
		float fogFd = smoothstep( fogNear, fogFar, vFogDepth );
		float fogHk = exp( - max( vFogWorldY - cameraPosition.y - (${f4(f.base)}), 0.0 ) / ${f4(f.falloff)} );
		float fogFactor = fogFd * mix( ${f4(f.top)}, 1.0, fogHk );
		fogFactor = mix( fogFactor, 1.0, smoothstep( 0.85, 1.0, fogFd ) );
		fogFactor = max( fogFactor, ${f4(f.haze)} * fogHk * smoothstep( fogNear * ${f4(f.hazeStart)}, fogFar, vFogDepth ) );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

// The sky change that bakes the environment map again (max channel step,
// linear), and the shortest time between two bakes (s).
const ENV_REBAKE = { step: 0.025, seconds: 2 };
// The warm white half of the rim color.
const RIM_WARM = new THREE.Color(1, 0.95, 0.88);
const envGround = new THREE.Color();

export function createPbrLook({ scene, renderer, sky = null, geoLights = null, anchors = [], getPost = () => null }) {
  const L = LOOKS.pbr;
  const fogBase = scene.fog ? scene.fog.color.clone() : null;
  const fogTint = new THREE.Color();
  let baked = sky ? snapshot(sky) : null;
  let sinceBake = 0;
  let env = { intensity: 1, ground: 1 };
  let bakes = 0;
  const info = { district: "trail", weights: { trail: 1 }, grade: null, envBakes: 0, envIntensity: scene.environmentIntensity };

  function snapshot(s) {
    const u = s.mesh.material.uniforms;
    return [u.uZenith.value.r, u.uZenith.value.g, u.uZenith.value.b, u.uHorizon.value.r, u.uHorizon.value.g, u.uHorizon.value.b, u.uCover?.value ?? 0];
  }

  // The mean luma of the sky zenith and horizon colors (linear).
  function skyLuma(v) {
    const l = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 0.5 * (l(v[0], v[1], v[2]) + l(v[3], v[4], v[5]));
  }

  function rebake() {
    const old = scene.environment;
    baked = snapshot(sky);
    env = envForSky(skyLuma(baked));
    // The ground disc is the bounce of the street: a sunlit pavement in the
    // day, the dim city glow at night.
    envGround.set(ENV_SKY.ground).multiplyScalar(env.ground);
    scene.environment = createSkyEnvironment(renderer, sky, { ground: envGround });
    if (old) old.dispose();
    sinceBake = 0;
    bakes += 1;
  }

  return {
    info,
    // pos: the camera (or skater) position; state: the weather state
    // (weather-view.js), or null with ?weather=0. dt: seconds.
    update(pos, state, dt = 0) {
      sinceBake += dt;
      const w = districtWeights(pos.x, pos.z, anchors);
      const d = districtLook(w);
      const elevation = state ? state.sun.elevation : 50;
      const g = timeGrade(elevation, state ? state.cloudCover : 0);
      info.weights = w;
      info.district = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
      info.grade = { ...g, saturation: g.saturation * d.saturation, tint: d.tint };

      const post = getPost();
      const u = post?.grade?.uniforms;
      if (u) {
        u.uContrast.value = g.contrast;
        u.uSat.value = g.saturation * d.saturation;
        u.uWarm.value = g.warm;
        if (u.uLift) u.uLift.value = g.lift;
        if (u.uTint) u.uTint.value.set(d.tint[0], d.tint[1], d.tint[2]);
      }
      if (post?.bloom) post.bloom.threshold = bloomThreshold(state ? state.day : 1);

      // The fog: the weather writes the horizon color each frame; with no
      // weather the first fog color is the base.
      if (scene.fog) {
        if (!state && fogBase) scene.fog.color.copy(fogBase);
        // Less tint at night: the dark horizon keeps the night sky.
        const day = state ? state.day : 1;
        fogTint.setRGB(d.fog[0], d.fog[1], d.fog[2]).multiplyScalar(Math.max(0.15, day));
        scene.fog.color.lerp(fogTint, HEIGHT_FOG.tint * (0.4 + 0.6 * day));
      }

      // The environment map follows the sky (once the sky moved enough).
      if (sky && baked && sinceBake >= ENV_REBAKE.seconds) {
        const now = snapshot(sky);
        if (now.some((v, i) => Math.abs(v - baked[i]) > ENV_REBAKE.step)) rebake();
      }
      // The baked map is dark at night; envForSky() keeps a part of the light.
      scene.environmentIntensity = L.environment * env.intensity;
      info.envIntensity = scene.environmentIntensity;
      info.envBakes = bakes;

      // The skater rim: the sky color at the horizon, a part of the grade.
      SKATER_RIM.uRimStrength.value = g.rim;
      if (state) SKATER_RIM.uRimColor.value.setRGB(...state.horizon).lerp(RIM_WARM, 0.5);
      // The pbr sun: the weather writes the sun each frame, so the scale
      // does not add up. With no weather the sun keeps LOOKS.pbr.sun.
      if (geoLights && state) geoLights.sun.intensity *= L.sunScale;
      info.sun = geoLights ? geoLights.sun.intensity : null;
    },
  };
}
