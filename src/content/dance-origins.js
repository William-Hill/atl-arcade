// The origin of each dance for the trick list (#330, GDD R13,
// docs/ux/trick-hud.md 9.3). From docs/characters/atl-dance-references.md.
//
// Rules (R13): the place, the year, the creators, and the public source
// only. A song title shows only after the lyric check of that song passes
// (`lyricCheck: "passed"`). While it is "open", the text names no song.
// Real skaters review this text before release (AGENTS.md).

export const NO_SOURCE = "no source yet";

export const DANCE_ORIGINS = Object.freeze({
  "Bankhead Bounce": {
    short: "Bankhead, west Atlanta, 1995",
    detail: "From Bankhead, a neighborhood on the west side of Atlanta. Popular from 1995, with the A-Town Players and D-Roc.",
    sources: [
      { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Bankhead_Bounce" },
      { name: "The Atlanta Journal-Constitution", url: "https://www.ajc.com/life/arts-culture/hip-hop-50/evolution-of-atlantas-hip-hop-dance-crazes/BOICXZM72JD5PF4TQI4D4SWL24/" },
    ],
    lyricCheck: "open",
  },
  "Walk It Out": {
    short: "Atlanta snap era, 2006",
    detail: "Made famous by DJ Unk of Atlanta in 2006.",
    sources: [
      { name: "KAXE", url: "https://www.kaxe.org/news/2025-01-29/unks-walk-it-out-defined-a-fun-hyperlocal-moment-in-atlanta-rap-history" },
      { name: "The Atlanta Journal-Constitution", url: "https://www.ajc.com/life/arts-culture/hip-hop-50/evolution-of-atlantas-hip-hop-dance-crazes/BOICXZM72JD5PF4TQI4D4SWL24/" },
    ],
    lyricCheck: "open",
  },
  "The Prep": {
    short: "ATL rink move",
    detail: "A stutter step forward, with a clap to keep the move going.",
    sources: [{ name: "USA Roller Sports, “Culture Roll”", url: "https://www.usarollersports.org/culture-roll" }],
    lyricCheck: "open",
  },
  "Swag Surf": {
    short: "South side of Atlanta, 2009",
    detail: "The dance came from the south side of Atlanta. Fast Life Yungstaz of Stone Mountain made it famous in 2009. Now an anthem at HBCU homecomings.",
    sources: [
      { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Swag_Surfin" },
      { name: "uDiscover Music", url: "https://www.udiscovermusic.com/stories/fast-life-yungstaz-swag-surfin/" },
    ],
    lyricCheck: "open",
  },
  "Snap Lean": {
    short: "Bankhead snap music, 2005",
    detail: "Snap music started in Bankhead in the early 2000s. Dem Franchize Boyz of Atlanta made the snap lean famous in 2005.",
    sources: [{ name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Snap_music" }],
    lyricCheck: "open",
  },
  "Cross Step": {
    short: "Key move of ATL style",
    detail: "The key move of ATL style rink skating.",
    sources: [{ name: "USA Roller Sports, “Culture Roll”", url: "https://www.usarollersports.org/culture-roll" }],
    lyricCheck: "open",
  },
  "ATL Rydin": {
    short: "Signature move of ATL style",
    detail: "The signature move of ATL style rink skating.",
    sources: [{ name: "USA Roller Sports, “Culture Roll”", url: "https://www.usarollersports.org/culture-roll" }],
    lyricCheck: "open",
  },
  "Toe Spin": { short: `rink move (${NO_SOURCE})`, detail: null, sources: [], lyricCheck: "open" },
  "Smooth Quad": { short: `rink move (${NO_SOURCE})`, detail: null, sources: [], lyricCheck: "open" },
  "Sit Spin": { short: `rink move (${NO_SOURCE})`, detail: null, sources: [], lyricCheck: "open" },
  "Drumline Count": { short: NO_SOURCE, detail: null, sources: [], lyricCheck: "open" },
  "Jam Step": { short: NO_SOURCE, detail: null, sources: [], lyricCheck: "open" },
  "Jam Groove": { short: NO_SOURCE, detail: null, sources: [], lyricCheck: "open" },
});

// The origin of a dance, or the no-source entry.
export const originOf = (name) => DANCE_ORIGINS[name] ?? { short: NO_SOURCE, detail: null, sources: [], lyricCheck: "open" };
