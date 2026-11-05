// The game's music tracks (assets/music/tracks.json, #110) and the stored
// track choice. The beat clock gets `beatClockOptions()`.
//
// ?music=0 keeps the synthesized click; ?music=<id> picks a track for this
// visit without storing it. The choice from the results screen is kept in
// localStorage under STORAGE_KEY.

import meta from "../../assets/music/tracks.json";
import { CLICK_ID } from "./music-math.js";

export const STORAGE_KEY = "skate-atl.music";
export const TRACKS = meta.tracks;

const url = (file) => new URL(`../../assets/music/${file}`, import.meta.url).href;

// Opus in Ogg where the browser plays it, else the AAC fallback (older Safari).
export function trackUrl(track, canPlayType = () => "probably") {
  return canPlayType('audio/ogg; codecs="opus"') ? url(track.file) : url(track.fallback);
}

export function readChoice(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeChoice(storage, id) {
  try {
    storage?.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
}

// The track list for the results screen: the tracks, then the click.
export const trackChoices = (tracks = TRACKS) => [...tracks.map((t) => ({ id: t.id, title: t.title })), { id: CLICK_ID, title: "Click (no music)" }];

export function beatClockOptions(params, storage, { fetchFn = globalThis.fetch, canPlayType } = {}) {
  const off = params.get("music") === "0";
  const tracks = off ? [] : TRACKS;
  const asked = params.get("music");
  const trackId = asked && tracks.some((t) => t.id === asked) ? asked : readChoice(storage);
  const audio = typeof Audio === "function" ? new Audio() : null;
  const can = canPlayType ?? ((type) => (audio ? audio.canPlayType(type) : "probably"));
  const loadTrack = async (track) => {
    const res = await fetchFn(trackUrl(track, can));
    if (!res.ok) throw new Error(`music ${track.id}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };
  return { tracks, trackId, loadTrack };
}
