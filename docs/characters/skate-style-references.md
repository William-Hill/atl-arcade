# Skate style references (M1-02)

This file records the research for the skater movement. It gives the source for each move in the Nia clip set. Real Atlanta skaters must review the moves before release (AGENTS.md).

## Two styles, two jobs

| Part of play | Style | Source |
|---|---|---|
| Free skate: idle, push, coast, carves, backward ride, style moves | Atlanta rink style ("ATL style") | Cascade, Golden Glide, Culture Roll ATL |
| Rails and air: grinds, air tricks | X Games aggressive skating (1995 to 2004) | Vert and street events, trick dictionaries |

Nia skates on quad skates (`nia-sway-ellis.md`). Aggressive skating at the X Games used inline skates. The grind stances below are the inline names. On quads, the skater grinds on the plate between the trucks or on the boot. The game keeps the inline names, because players know them.

## Atlanta rink style

What the sources say:

- The style is "energetic and percussive" (New York Times, 2024, through NextDraft).
- The character is "swagger, bounce, and call-and-response energy". The skaters often skate backward to hip-hop and Southern rap (Rolla Skate Club).
- The Culture Roll ATL page lists routines, energy, repeated moves, attitude, and synchronization. The key move is the Cross Step. The signature move is "ATL Rydin", a stride with its own swag.
- "The Prep" is a repeated stutter step forward. The left leg crosses behind the right, and a clap keeps the step going (Culture Roll).
- The skaters cross their legs, and they clap and stomp on the beat. The style feels "real swaggy" and cruisy, and it is faster than most other rhythm styles (SK8SHOT Society).
- Atlanta skaters clap with hands "that rose from the shoulder" (New York Times, through a blog excerpt).

The sources do not describe the posture or a tempo in numbers. The values below are design choices. Real skaters must confirm them.

### Rules for the free-skate clips

1. The skater glides. Each push goes diagonally out and back, at about 45 degrees to the line of travel, on the inside edge of a turned-out skate. The push leg ends straight, behind the hip. Then the skate lifts and comes forward under the hips. A push that goes only straight back is a skateboard kick. A push that goes only to the side gives no drive. Do not use either one.
2. The pushes alternate left and right. The arms swing in opposition to the legs: the arm on the glide side swings forward and across the body with a bent elbow, and the other arm swings back almost straight. The shoulders turn with the arms, and the head stays on the line of travel.
3. The body bounces on every beat. The knees go down on the beat.
   The glide (coast) is the ATL Ryde, from the Dun Beezy lesson "How to ATL Ryde on Roller Skates" (https://www.youtube.com/watch?v=oUeLJ5qbyoc). On each downbeat both skates press out on the outside edges, and the arms throw forward and down. On the half beat the skates drag in on the inside edges, on the toes, past parallel, so one skate ends behind the other. The fists come up near the chest ("dice roll"). The skate that goes behind changes on each step. The chest leans forward, as in the Cascade footage in the lesson. On the corners the lesson steps out with the right skate, drags the left skate twice, and then brings the right skate back in. The carve clips use this corner step (2 beats); `carve_right` is the mirror.
4. The weight shifts from skate to skate every beat. The shoulders turn against the hips.
5. The turns use the ATL Ryde corner step: the outside skate steps out wide, the inside skate drags twice behind on its toe, and the outside skate comes back in. (The first version used a Cross Step. No source gave its mechanics.)
6. The switch button (R, or LB on a gamepad) turns the skater to ride backward. She swizzles the skates and looks over each shoulder in turn. The travel direction does not change.
7. The idle clip claps on beats 2 and 4. The hands rise from the shoulders to clap.

### The beat

- The clips are keyed at 24 frames (0.8 s at 30 fps) per beat. This is 75 BPM, the half-time feel of a 150 BPM Southern hip-hop track.
- The game beat clock (`src/audio/beat-clock.js`) sets the real tempo. Its click is 100 BPM now (`BEAT.bpm`). The renderer plays each groove clip at 100 / 75 = 1.33 times speed, so one clip beat lasts one game beat.
- Each groove clip (idle, coast, ride_back, carves) is a whole number of beats. The renderer plays it in phase with the beat clock. Before the first key press the clock does not run, and the renderer counts its own time.
- A push stroke takes 0.4 s (`SKATE.pushCooldown`). The push does not follow the beat, because the player controls it.
- When the game gets music (M2), the music must set the beat clock.

## X Games aggressive skating

Aggressive inline skating was in the first ESPN X Games in 1995, with vert and street events. ESPN removed it in 2005 (Wikipedia). Fabiola da Silva won seven X Games gold medals in vert. In 2005 she became the first woman to land a double backflip on a vert ramp (Wikipedia).

### Grinds used in the game

| Clip | Stance | Source definition |
|---|---|---|
| `grind_frontside` | The body turns 90 degrees to the rail. Both skates go across the rail. The knees are low and the arms point along the rail. | "Turn 90 degrees and land a grind between the middle wheels, each skate on the inside boot" (1997 dictionary) |
| `grind_soul` | The front skate goes across the rail. The back skate goes along the rail on its edge. | Soul: the front skate on the inside grind plate, the back skate on the frame along the rail |
| `grind_unity` | The legs cross. Both skates grind on the outside of the boot. | Unity: "Legs are crossed, and both outside boots grind" |

### Air tricks used in the game

| Clip | Body | Source definition |
|---|---|---|
| `air_mute` | Both knees tuck. One hand grabs the opposite skate across the body. | Mute: grab the opposite skate with your hand |
| `air_japan` | One hand reaches behind to grab the opposite skate. The free knee bends. | Japan: reach behind to grab the opposite leg, the free leg bent |
| `air_liukang` | One knee tucks and the hand grabs it. The other leg kicks out straight. | Liu Kang: one leg grabbed, the other kicked out |

The controller already turns the skater in the air (`SKATE.airTurnRate`). Thus a grab plus the turn gives a 360 or a 540. Flips (misty, backflip) need a pitch turn of the whole body. They are not in this clip set.

## Sources

- Culture Roll, USA Roller Sports: https://www.usarollersports.org/culture-roll
- "Rolling in Rhythm: Black Culture and the Heart of Skate", Rolla Skate Club: https://www.rollaskateclub.com/rolla-blog/rolling-in-rhythm-black-culture-and-the-heart-of-skate
- "Skate styles", SK8SHOT Society: https://chat.skool.com/rollerskate/skate-styles-2?p=c964faa3
- "That's Not How They Roll", NextDraft (on the New York Times report): https://nextdraft.com/archives/n20240502/thats-not-how-they-roll/
- WABE, Atlanta skating culture: https://www.wabe.org/atlanta-has-many-places-to-roll-indoors-or-out-in-its-popular-multi-genre-skating-culture/
- Atlanta Magazine, Cascade Skating Rink: https://www.atlantamagazine.com/50bestthingstodo/roll-soul-cascade-skating-rink/
- "How to ATL Ryde on Roller Skates", Dun Beezy: https://www.youtube.com/watch?v=oUeLJ5qbyoc
- Aggressive inline skating, Wikipedia: https://en.wikipedia.org/wiki/Aggressive_inline_skating
- Dictionary of aggressive inline skating terms (1997): https://toxboe.net/all/1997-aggressive-inline-skating-dictionary
- Fabiola da Silva, Wikipedia: https://en.wikipedia.org/wiki/Fabiola_da_Silva
