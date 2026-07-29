/* YALLA — config
   All the knobs live here. Change a value, refresh, feel the difference.
   The machinery that consumes these is in sketch.js. */

const WORD  = "EVERY\nTHING\nEVERY\nWHERE";

const DEPTH  = 30;    // full extrusion depth (px) when fully awake

/* hover: letters pop when the cursor comes near them.
   Letters within `inner` px of the cursor are fully awake; influence
   fades to zero at `outer`. Tighten both to make it strictly the
   letter under the cursor; widen for a softer halo around it. */
const HOVER = { inner:60, outer:220 };

/* click wave: on click, a front sweeps diagonally top-left → bottom-right.
   Letters within `inner` px of the front (measured along the diagonal) are
   fully awake; influence fades to zero at `outer`. speed is px/ms. */
const WAVE = { inner:100, outer:400, speed:0.5 };

/* burst: random images that explode from behind each letter as it pops.
   spread multiplies the letter's pose radius (>1 = images fly farther).
   SIZE IS THE KNOB YOU WANT: each image's width is a random roll between
   [min, max], in em — i.e. fractions of the letter's font size.
   [0.25, 0.55] ≈ a quarter to half a letter tall. */
const BURST = {
  count:6, spread:1.35, size:[0.35, 0.65],
  /* idle float while airborne (like the letters): y bob in em,
     rotation wobble in deg, seconds per bob cycle [min,max] */
  float:{ y:0.05, deg:9, time:[1.6, 2.8] },
};

/* the pool the burst draws from (file:// pages can't list folders) */
const IMAGES = [
  "acorn_PNG37018.png",
  "alarm_clock_PNG2.png",
  "anaconda_PNG115447.png",
  "ant_PNG19355.png",
  "artichoke_PNG109564.png",
  "ax_PNG92208.png",
  "baby_bottle_PNG43.png",
  "banana_PNG104275.png",
  "bee_PNG74747.png",
  "bellflower_PNG4.png",
  "belt_PNG9595.png",
  "bow_tie_PNG20.png",
  "bug_PNG4000.png",
  "cards_PNG8471.png",
  "chameleon_PNG16.png",
  "chandelier_PNG27.png",
  "cobra_PNG42.png",
  "coil_spring_PNG28.png",
  "converse_PNG48.png",
  "converse_PNG55.png",
  "crab_PNG43.png",
  "dominoes_PNG83.png",
  "electronic_cigarette_PNG53.png",
  "fish_hook_PNG53.png",
  "frog_PNG35773.png",
  "gecko_PNG66.png",
  "green_leaves_PNG3678.png",
  "hairbrush_PNG154.png",
  "jupiter_PNG23.png",
  "kfc_food_PNG67.png",
  "lighter_PNG41537.png",
  "lime_PNG50.png",
  "mantis_PNG65.png",
  "moon_PNG52.png",
  "orange_PNG813.png",
  "pear_PNG3466.png",
  "raspberry_PNG5077.png",
  "red_bull_PNG34.png",
  "shrimps_PNG96485.png",
  "starfish_PNG36.png",
  "swan_PNG54.png",
  "tiger_PNG23242.png",
  "toilet_brush_PNG30.png",
  "vinyl_PNG110.png",
  "viola_PNG37.png",
  "worms_PNG46.png",
];

const POSE = {
  radius: [50,70],       // px from home — how far a pop flies
  toward: [ 45,115],       // px toward the camera
  twistX: [ 15, 38],       // deg (sign randomized)
  twistY: [ 15, 38],       // deg (sign randomized)
  time:   850,             // ms for a full pop (and settle back) — bigger = slower
  float:  { y:5, deg:30.5, speed:0.0021 },  // idle bobbing while awake
};
