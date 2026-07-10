/* ============================================================
   SWARM — text as creatures (p5.js)
   Each sentence is a Worm: characters strung along the trail its
   head carves. Heads flock (separation / alignment / cohesion),
   drift on a slow shared migration, and slither with a sine
   wobble. All worms travel leftward, so the head is always the
   first letter and every sentence reads left-to-right.
   The cursor parts the swarm — except the red worms (intrusive
   thoughts), which are drawn to it and circle it until a click
   sets them free; fresh ones keep arriving from the right.

   TUNE ME: the CFG block. Mantras in SENTENCES, red in THOUGHTS.

   Hot paths (flocking pairs, trail lookups, glyph drawing) use
   plain math and the raw canvas context instead of p5 helpers —
   same output, far less per-frame overhead.
   ============================================================ */

const SENTENCES = [
  "make friends with chaos","hold a calm mind","let things shake","forgive human frailty",
  "champion second chances","defy unkindness","reverence fellowship","listen to the quiet",
  "respect the young","seek growth","trust in change","treasure learning",
  "inspire faith in evolution","hold faith in miracles","look beyond the binary","be wary of the doubtless",
  "honour the bright-headed","grow plants","attend to the weather","be electric",
  "cherish language","celebrate silence","dance daily","bless the handmade",
  "magic up fresh beauty","sing into pain","find joy in shadow","challenge assumptions",
  "follow the wind","look upwards","swoon under clouds","feel your courage",
  "face forward","read history","open your ears","drop your shoulders",
  "bend your knees","raise the roof","keep breathing","be trustworthy",
  "take care of yourself","believe in goodness","head for the light",
];

// the red worms — intrusive thoughts.
// they don't flee the cursor: they're drawn to it, and circle it until you click
const THOUGHTS = [
  "they saw that",
  "it was probably your fault",
  "it's too late to start",
  "everyone noticed",
  "you're behind",
  "they're mad at you",
  "you forgot something",
  "you should be working",

];

// thoughts arrive one at a time, in list order, wrapping around
let thoughtIndex = 0;
function nextThought() {
  return THOUGHTS[thoughtIndex++ % THOUGHTS.length];
}

// the cursor is the classic pixelated pointing hand (hand.png) — what the
// mantras flee and the thoughts circle. White-filled inside, so it occludes
// worms passing behind it. HAND_W = on-screen width in px
const HAND_W = 36;

const CFG = {
  count:     20,
  fontSize:  20,
  speed:     2.5,               // px/frame
  slither:   { amp:1.0, freq:0.004, wave:0.05 },  // freq = wave speed, wave = ripples along the body
  maxTurn:   0.9,                // rad/frame — lower = wider, calmer arcs
  maxClimb:  2,                  // rad from due-left — how steeply worms may climb/dive
  sep:       { r:48,  w:1.15 },
  ali:       { r:95,  w:0.55 },
  coh:       { r:130, w:0.40 },
  wander:    0.30,
  migrate:   0.40,               // strength of the slow shared drift
  cursor:    { r:130, w:4 },   // r = reaction radius, w = dodge strength
  edge:      { margin:80, w:1.6 },  // soft walls: steer back inside when this close to top/bottom
  thought:   { capture:140, orbit:55, tighten:0.05, scale:0.75 },  // red thoughts: capture radius, orbit ring radius, how firmly they settle onto the ring, size vs. the mantras
  center:    { pull:0.006, spread:0.12 },  // condense the river on the y axis: pull toward mid-height, spawn spread as a fraction of height
  redEvery:  50,                 // roughly every Nth worm is red
  ink:"#2b2824", red:"#c24a2f",
};
const FONT_STACK = "ui-sans-serif";

if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  CFG.speed *= 0.35;
  CFG.slither.amp *= 0.4;
}

/* ------------------------- sketch ------------------------- */

let swarm, stage;
let pointerSeen = false;
let handImg = null;

function preload() {
  handImg = loadImage("hand.png", null, () => { handImg = null; });   // no cursor image if it fails to load
}

function setup() {
  stage = document.getElementById("stage");
  createCanvas(stage.clientWidth, stage.clientHeight).parent(stage);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  textFont(FONT_STACK);
  textAlign(CENTER, CENTER);
  noStroke();
  noCursor();   // the pixel hand replaces the pointer
  applyTextDefaults();
  swarm = new Swarm(CFG.count);
}

// glyphs are drawn straight through the canvas API (see Worm.show),
// so its text state must be set by hand
function applyTextDefaults() {
  drawingContext.textAlign = "center";
  drawingContext.textBaseline = "middle";
}

function windowResized() {
  resizeCanvas(stage.clientWidth, stage.clientHeight);
  applyTextDefaults();   // a canvas resize resets all context state
}

function draw() {
  background("#faf9f6");   // painted on the canvas (not CSS) so recordings capture it too
  swarm.step(millis());
  swarm.show(millis());
  drawCursorHand();
}

// the classic pixel pointing hand, drawn where the pointer is
function drawCursorHand() {
  const ptr = pointer();
  if (!ptr || !handImg) return;
  const w = HAND_W, h = w * (handImg.height / handImg.width);
  image(handImg, ptr.x - w / 2, ptr.y - h / 2, w, h);
}

function mouseMoved() {
  pointerSeen = true;
  document.getElementById("hint").classList.add("gone");
}

// a click frees every thought circling the cursor
function mousePressed() {
  swarm.releaseThoughts();
}

/* ---- record mode: press R to start/stop a 1080×1920 capture ---- */

let recorder = null;

function keyPressed() {
  if (key === "r" || key === "R") toggleRecording();
}

function toggleRecording() {
  if (recorder) { recorder.stop(); return; }

  // bump the canvas backing store to exactly Reels resolution (stage is 9:16)
  pixelDensity(1080 / width);
  applyTextDefaults();
  document.getElementById("hint").classList.add("gone");

  const mime = ["video/webm;codecs=vp9", "video/webm", "video/mp4"]
    .find(m => MediaRecorder.isTypeSupported(m));
  const chunks = [];
  recorder = new MediaRecorder(drawingContext.canvas.captureStream(60),
                               { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = mime.includes("mp4") ? "swarm.mp4" : "swarm.webm";
    a.click();
    URL.revokeObjectURL(a.href);
    recorder = null;
    document.title = "Swarm — instructions for a good life";
    pixelDensity(Math.min(window.devicePixelRatio || 1, 2));   // back to normal viewing
    applyTextDefaults();
  };
  recorder.start();
  document.title = "● recording — R to stop";
}

// pointer position, or null while the mouse is off the canvas
function pointer() {
  if (!pointerSeen) return null;
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return null;
  return { x: mouseX, y: mouseY };
}

// signed shortest difference between two angles → (-PI, PI]
function angleDiff(a, b) {
  return ((a - b + PI * 3) % TWO_PI) - PI;
}

/* ------------------------ the flock ----------------------- */

class Swarm {
  constructor(count) {
    this.worms = Array.from({ length: count }, (_, i) => new Worm(i));
  }

  // the river: a steady leftward current with a slow vertical sway
  migration(t) {
    const sway = sin(t * 0.0004) * 0.6 + sin(t * 0.00017 + 2) * 0.4;
    return createVector(-1, sway * 0.5).mult(CFG.migrate);
  }

  step(t) {
    const drift = this.migration(t);
    const ptr = pointer();   // resolved once per frame, not once per worm
    this.worms.forEach((worm, i) => {
      worm.update(this.worms, drift, ptr);
      if (worm.isOffscreen()) this.worms[i] = this.respawn(worm);
    });
  }

  // once a worm is fully off-screen, a fresh one enters from the right edge, near mid-stream
  respawn(old) {
    return new Worm(old.index, createVector(width + 20, Swarm.streamY()));
  }

  // freed thoughts resume their way leftward and can't be caught again;
  // fresh ones will keep arriving from the right as worms recycle
  releaseThoughts() {
    for (const worm of this.worms) {
      if (worm.state === "orbit") worm.state = "freed";
    }
  }

  // a y position clustered around the vertical center
  static streamY() {
    const y = randomGaussian(height / 2, height * CFG.center.spread);
    return constrain(y, CFG.edge.margin, height - CFG.edge.margin);
  }

  show(t) {
    for (const worm of this.worms) worm.show(t);
  }
}

/* ------------------- one sentence-creature ----------------- */

class Worm {
  constructor(index, pos) {
    this.index = index;
    this.red = index % CFG.redEvery === 2;   // an intrusive thought
    this.color = this.red ? CFG.red : CFG.ink;
    this.size = CFG.fontSize * random(0.85, 1.2) * (this.red ? CFG.thought.scale : 1);
    this.phase = random(TWO_PI);
    this.state = "swim";                     // red worms: swim → orbit (near cursor) → freed (on click)
    this.spin = random() < 0.5 ? 1 : -1;     // which way this thought circles
    this.orbitR = CFG.thought.orbit * random(0.8, 1.25);
    // thoughts are dealt in list order — concurrent reds always differ; mantras stay random
    this.setSentence(this.red ? nextThought() : random(SENTENCES));
    this.spawn(pos || createVector(random(width), Swarm.streamY()));
  }

  // measure each character and its distance back from the head
  setSentence(text) {
    textSize(this.size);
    this.font = `${this.size}px ${FONT_STACK}`;
    this.chars = [...text].map(ch => ({ ch, w: textWidth(ch) }));
    let total = 0;
    for (const c of this.chars) {
      c.d = total + c.w / 2;   // center of this glyph along the body
      total += c.w + 1;
    }
    this.len = total;          // trail length the sentence needs
  }

  // place the head and lay the trail straight back so text shows immediately
  spawn(pos) {
    const ang = PI + random(-CFG.maxClimb, CFG.maxClimb) * 0.8;   // leftward — head = first letter
    this.pos = pos;
    this.vel = p5.Vector.fromAngle(ang).mult(CFG.speed);
    this.path = [];
    const steps = Math.ceil(this.len / CFG.speed) + 6;
    for (let k = 0; k <= steps; k++) {
      this.path.push({ x: pos.x - Math.cos(ang) * k * CFG.speed,
                       y: pos.y - Math.sin(ang) * k * CFG.speed });
    }
    this.measureTrail();
  }

  // separation / alignment / cohesion + wander + walls + mid-stream pull + cursor.
  // Plain scalar math on purpose: this is O(worms²) per frame, so no vector allocations.
  steeringForce(worms, ptr) {
    let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, nAli = 0, nCoh = 0;
    const x = this.pos.x, y = this.pos.y;
    const R = Math.max(CFG.sep.r, CFG.ali.r, CFG.coh.r);
    for (const other of worms) {
      if (other === this) continue;
      const dx = other.pos.x - x, dy = other.pos.y - y;
      if (dx > R || dx < -R || dy > R || dy < -R) continue;   // beyond every radius — skip the sqrt
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0 && d < CFG.sep.r) { sx -= dx / d; sy -= dy / d; }
      if (d < CFG.ali.r) { ax += other.vel.x; ay += other.vel.y; nAli++; }
      if (d < CFG.coh.r) { cx += other.pos.x; cy += other.pos.y; nCoh++; }
    }
    let fx = sx * CFG.sep.w, fy = sy * CFG.sep.w;
    if (nAli) { fx += (ax / nAli) * CFG.ali.w; fy += (ay / nAli) * CFG.ali.w; }
    if (nCoh) { fx += (cx / nCoh - x) * 0.01 * CFG.coh.w; fy += (cy / nCoh - y) * 0.01 * CFG.coh.w; }
    fx += random(-1, 1) * CFG.wander;
    fy += random(-1, 1) * CFG.wander;

    // soft walls — steer back inside when drifting toward the top or bottom edge
    const m = CFG.edge.margin;
    if (y < m)          fy += (1 - y / m) * CFG.edge.w;
    if (y > height - m) fy -= (1 - (height - y) / m) * CFG.edge.w;

    // mid-stream pull — keeps the river condensed around the vertical center
    fy += (height / 2 - y) * CFG.center.pull;

    // the swarm parts around your hand — but red thoughts are not afraid of it
    if (ptr && !this.red) {
      const px = x - ptr.x, py = y - ptr.y;
      const pd = Math.sqrt(px * px + py * py);
      if (pd > 0 && pd < CFG.cursor.r) {
        const f = (1 - pd / CFG.cursor.r) * CFG.cursor.w / pd;
        fx += px * f;
        fy += py * f;
      }
    }
    return { x: fx, y: fy };
  }

  update(worms, drift, ptr) {
    // intrusive thoughts that drift near the cursor get caught circling it
    if (this.red && this.state === "swim" && ptr) {
      const dx = this.pos.x - ptr.x, dy = this.pos.y - ptr.y;
      if (dx * dx + dy * dy < CFG.thought.capture * CFG.thought.capture) this.state = "orbit";
    }
    if (this.state === "orbit") {
      if (ptr) { this.orbit(ptr); return; }
      this.state = "swim";   // the cursor left — let it swim on (still catchable)
    }

    const force = this.steeringForce(worms, ptr);
    const desX = this.vel.x + force.x + drift.x;
    const desY = this.vel.y + force.y + drift.y;
    // turn toward desired, but no faster than maxTurn — smooth natural arcs
    const heading = Math.atan2(this.vel.y, this.vel.x);
    const turn = constrain(angleDiff(Math.atan2(desY, desX), heading), -CFG.maxTurn, CFG.maxTurn);
    // never reverse: clamp the new heading to within maxClimb of due left
    let off = constrain(angleDiff(heading + turn, PI), -CFG.maxClimb, CFG.maxClimb);
    // containment guarantee: the allowed climb/dive shrinks to zero at the top/bottom walls,
    // so near an edge a worm can only run level or turn back inside (off > 0 climbs, off < 0 dives)
    const m = CFG.edge.margin;
    off = constrain(off,
      -CFG.maxClimb * constrain((height - this.pos.y) / m, 0, 1),
       CFG.maxClimb * constrain(this.pos.y / m, 0, 1));
    this.vel.set(Math.cos(PI + off) * CFG.speed, Math.sin(PI + off) * CFG.speed);

    // advance the smooth head — slither is applied at draw time, never baked into the trail
    this.pos.add(this.vel);
    this.path.unshift({ x: this.pos.x, y: this.pos.y });
    this.measureTrail();
  }

  // circle the pointer: steer along the ring's tangent while easing onto this
  // worm's own radius. No leftward clamp here — a circling thought goes anywhere
  orbit(ptr) {
    const rx = this.pos.x - ptr.x, ry = this.pos.y - ptr.y;
    const d = Math.sqrt(rx * rx + ry * ry) || 0.0001;
    const ux = rx / d, uy = ry / d;
    const settle = (this.orbitR - d) * CFG.thought.tighten;   // negative pulls in, positive pushes out
    const desX = -uy * this.spin * CFG.speed + ux * settle;
    const desY =  ux * this.spin * CFG.speed + uy * settle;
    const heading = Math.atan2(this.vel.y, this.vel.x);
    const turn = constrain(angleDiff(Math.atan2(desY, desX), heading), -CFG.maxTurn, CFG.maxTurn);
    this.vel.set(Math.cos(heading + turn) * CFG.speed, Math.sin(heading + turn) * CFG.speed);
    this.pos.add(this.vel);
    this.path.unshift({ x: this.pos.x, y: this.pos.y });
    this.measureTrail();
  }

  // one walk over the trail per frame: build the cumulative-distance table
  // that pointAt() searches, and trim what the sentence no longer needs
  measureTrail() {
    const path = this.path, cum = [0];
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x, dy = path[i].y - path[i - 1].y;
      acc += Math.sqrt(dx * dx + dy * dy);
      cum.push(acc);
      if (acc > this.len + 40) { path.length = i + 1; break; }
    }
    this.cum = cum;
  }

  isOffscreen() {
    const m = this.len + 60;
    return this.pos.x < -m || this.pos.x > width + m || this.pos.y < -m || this.pos.y > height + m;
  }

  // point on the trail `dist` px back from the head (path[0]) — binary search on cum
  pointAt(dist) {
    const path = this.path, cum = this.cum, last = cum.length - 1;
    if (dist <= cum[last]) {
      let lo = 1, hi = last;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < dist) lo = mid + 1; else hi = mid;
      }
      const a = path[lo - 1], b = path[lo];
      const t = (dist - cum[lo - 1]) / ((cum[lo] - cum[lo - 1]) || 0.0001);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    // ran out of trail — extend straight back past the last segment
    const a = path[path.length - 2] || path[0];
    const b = path[path.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const seg = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const over = dist - cum[last];
    return { x: b.x + (dx / seg) * over, y: b.y + (dy / seg) * over };
  }

  // draw straight through the canvas context: one setTransform + fillText per
  // glyph instead of p5's push/translate/rotate/text/pop
  show(t) {
    const ctx = drawingContext, den = pixelDensity();
    ctx.font = this.font;
    ctx.fillStyle = this.color;
    const win = Math.max(7, CFG.fontSize * 0.6);   // sampling span — wider reads a steadier letter angle
    for (const c of this.chars) {
      const ahead  = this.pointAt(Math.max(0, c.d - win));
      const behind = this.pointAt(c.d + win);
      // local trail direction, flipped so glyphs stay upright on leftward travel
      const ang = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) + PI;
      const base = this.pointAt(c.d);
      // slither: each glyph swings on the trail's normal, phase-shifted along the body
      const wob = Math.sin(t * CFG.slither.freq + this.phase - c.d * CFG.slither.wave) * CFG.slither.amp * this.size * 0.24;
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      ctx.setTransform(den * cosA, den * sinA, -den * sinA, den * cosA,
                       den * (base.x - sinA * wob), den * (base.y + cosA * wob));
      ctx.fillText(c.ch, 0, 0);
    }
    ctx.setTransform(den, 0, 0, den, 0, 0);   // restore p5's base transform
  }
}
