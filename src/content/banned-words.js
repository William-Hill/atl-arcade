// The banned word list (GDD docs/gdd/trick-input.md R13, #342). Pure data.
//
// The AGENTS.md political rules: the game shows Atlanta at its best. No
// crime, no police, no violence or weapons, no drugs, no decline or stigma,
// and no failure words in a trick name ("WOBBLE", not "BAIL"). Murals, not
// graffiti. A name, a fact, a `short` line, or a hint must not hold one of
// these words. The match is on whole words, in any case: "Bankhead" is not
// "bank", and "neighborhood" is not "hood".
//
// Add a word to its group. Add each form of a word that can show
// ("crash", "crashed"), because the match does not find stems.

export const BANNED_GROUPS = Object.freeze({
  crime: ["crime", "crimes", "criminal", "theft", "steal", "stole", "stolen", "rob", "robbed", "robbery", "burglar", "burglary", "heist", "loot", "looting", "vandal", "vandalism", "graffiti", "tag", "tagging", "arson", "murder", "gang", "gangs", "thug", "riot", "riots", "trespass"],
  police: ["police", "cop", "cops", "arrest", "arrested", "jail", "prison", "handcuff", "handcuffs", "sheriff", "patrol", "siren", "swat", "bail"],
  violence: ["violence", "violent", "fight", "fights", "fighting", "punch", "kill", "killer", "killed", "attack", "assault", "stab", "shoot", "shooting", "shot", "blood", "war", "brawl"],
  weapons: ["weapon", "weapons", "gun", "guns", "pistol", "rifle", "knife", "bomb", "bullet", "bullets", "ammo"],
  drugs: ["drug", "drugs", "dope", "weed", "cocaine", "pills", "dealer", "trap"],
  decline: ["decline", "declined", "declining", "blight", "blighted", "slum", "slums", "ghetto", "hood", "abandoned", "derelict", "ruin", "ruins", "ruined", "condemned", "vacant", "poverty", "gentrification", "displaced", "displacement"],
  failure: ["fail", "fails", "failed", "failure", "crash", "crashed", "wipeout", "wreck", "wrecked", "slam", "bailed", "loser", "lose", "lost", "dead", "die", "dies"],
});

// Every banned word, lower case, once.
export const BANNED_WORDS = Object.freeze([...new Set(Object.values(BANNED_GROUPS).flat())]);

const BANNED_SET = new Set(BANNED_WORDS);

// The whole words of a text, lower case ("Long Rail Grind" -> long, rail, grind).
export const wordsOf = (text) => String(text ?? "").toLowerCase().match(/[a-z]+/g) ?? [];

// The banned words in a text, in their order (empty when the text is clean).
export const bannedIn = (text) => wordsOf(text).filter((w) => BANNED_SET.has(w));
