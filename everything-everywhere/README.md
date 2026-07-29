# YALLA — flat, until it isn't

A word that looks like flat ink on paper. Hover a letter, and it pops up out
of its place as a real 3D volume — black face, white body, black ink along
every edge — while random cutout images explode from behind it. Click, and a
wave sweeps diagonally across the screen, popping every letter in turn.
Then everything settles back to flat ink.

Type anything in the top-right box; the text refits and rewraps live.

Part of the *language, given physics* sketches.

## Files

| File | What's in it |
|------|--------------|
| `index.html` | Shell — markup, script tags |
| `style.css` | Palette, layout, burst-image animation (CSS custom-property driven) |
| `config.js` | **All the knobs** — word, depth, hover radius, wave, pose ranges, burst images |
| `sketch.js` | The machinery — layout, hover + wave, tween, Three.js letter meshes |
| `lib/` | Local Three.js + Archivo Black glyph outlines (works offline, from `file://`) |
| `images/` | The burst cutouts (resized; full-res originals in `images/_originals/`, untracked) |

## Run

Open `index.html` directly, or any static server from this folder:

```bash
python3 -m http.server 8000
```

## How it works

Layout is DOM: invisible ghost letters fill real flex slots, so fitting,
wrapping and whitespace behave like ordinary text. A binary search picks the
biggest font size that fits the stage. The visible letters are extruded glyph
meshes (`THREE.TextGeometry`) on a transparent WebGL canvas, with the camera
matched so world units equal CSS pixels — each mesh anchors to its measured
slot baseline.

Two drivers set each letter's graded target, and the letter takes the
stronger one: cursor proximity (full inside `HOVER.inner`, zero past
`HOVER.outer`), and — after a click — a wave front sweeping perpendicular to
the ↘ diagonal, measured the same way with `WAVE.inner`/`WAVE.outer`.
Awakeness `e` chases the target through a sharp quintic ease. `e` drives everything in
lockstep: mesh depth inflates, body/edge materials fade in, the letter flies to
a random pose inside its own exclusive circular sector, and the burst images
(plain DOM, reading `--e`) explode behind it a bit farther than the letter
flies. At rest, depth and opacity are zero — genuinely flat ink again.

## Rules baked into the code (learned the hard way — don't undo)

1. **Never sense the animated thing** — hover reads the fixed `.slot` center,
   not the moving letter. Self-sensing creates a feedback loop and jitter.
2. **No discontinuities** — all motion runs through an eased timeline. Snaps
   read as glitches.
3. **Nothing 3D visible at rest** — depth scale AND side/edge opacity ride `e`
   together; either alone leaves fringes or perspective leaks on off-center
   letters.
4. **Pose rolls on the sleep→wake transition**, not on p/target thresholds —
   hover proximity ramps targets gradually, and threshold checks race the tween.
