'use strict';
/* ============================================================
   MURMURATION
   Grown from rule 02 of the _grown-by-numbers bench.

   Four things the bench boids got wrong, fixed here:
   1. The flock is a 3D VOLUME projected onto the screen. The
      black billows are line-of-sight density — thousands of
      birds stacking up along your eye-line — not a colour.
   2. Each starling listens to its ~7 NEAREST neighbours,
      however far away they are (Ballerini et al., 2008).
      Topological vision, not a fixed radius, is what lets a
      turn started on one wing cross the whole flock.
   3. Starlings cannot hover. Every bird is pushed back to
      cruise speed every frame. The flock is a flow, never a
      swarm of gnats.
   4. No walls, no wrapping. A soft pull toward a slowly
      wandering roost keeps the ballet composed in the frame.

   And one lie that tells the truth: fear is a substance. The
   falcon injects it, neighbours catch it, it decays. It moves
   through the flock faster than any bird flies — that is the
   dark wave you see. The falcon exists only under your finger:
   drag to loose it, let go and the sky is calm again.
   ============================================================ */

/* ---- knobs --------------------------------------------------------- */
const P = { birds: 3800, k: 7, coh: 1.0, tempo: 1.0 };

/* ---- constants ------------------------------------------------------ */
const MAXB   = 8000;
const CRUISE = 3.1;                 // world units per step — nobody hovers
const SEP    = 13, SEP2 = SEP*SEP;  // personal space
const WS = 0.55, WA = 0.18, WC = 0.0038;  // separation / alignment / cohesion
const DEAD   = 90;                  // roost dead zone — free flight inside it
const WR     = 0.0032;              // roost pull per unit beyond the dead zone
const FEARR  = 230;                 // radius of the falcon's bubble of panic
const VMIN = 12, VMAX = 46;         // adaptive vision bounds
const ZMIN = 650, ZMAX = 1550;      // depth band the flock lives in
const HOR  = 0.44;                  // where the projection centre sits on screen

/* ---- state (flat typed arrays — this is what buys us thousands) ---- */
const px = new Float32Array(MAXB), py = new Float32Array(MAXB), pz = new Float32Array(MAXB);
const vx = new Float32Array(MAXB), vy = new Float32Array(MAXB), vz = new Float32Array(MAXB);
const fear = new Float32Array(MAXB);
const vis  = new Float32Array(MAXB);      // per-bird adaptive vision radius
let COUNT = P.birds;

/* Verlet neighbour lists — a trick borrowed from molecular dynamics.
   Each bird caches WHO it listens to and re-asks the grid only every
   4th frame (staggered, a quarter of the flock per frame). Neighbours
   don't change in 66ms, but the grid search was most of the sim cost.
   Positions are always read fresh; only the guest list is stale. The
   SKIN pads the search radius so drifters stay covered between polls. */
const NBMAX = 24, SKIN = 8;
const nbr = new Int32Array(MAXB*NBMAX);
const nbn = new Uint8Array(MAXB);
const skinBuf = new Int32Array(NBMAX);    // rebuild scratch: skin-zone standbys

/* cheap deterministic randomness for the hot loop — Math.random costs
   ~10x a xorshift, and we roll three dice per bird per step */
let rngS = 0x9e3779b9 | 0;
function rnd(){ rngS ^= rngS << 13; rngS ^= rngS >>> 17; rngS ^= rngS << 5; return (rngS >>> 0)/4294967296; }

/* spatial hash — head/next linked lists, zero allocation per frame */
const CELL = 48, NCELL = 4096;
const head = new Int32Array(NCELL), nxt = new Int32Array(MAXB);
const hcell = (x, y, z) => ((x*73856093) ^ (y*19349663) ^ (z*83492791)) & (NCELL - 1);
const OFF = [];                            // the 27 neighbouring cells, own cell first
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
  (dx || dy || dz) ? OFF.push([dx, dy, dz]) : OFF.unshift([0, 0, 0]);

/* ---- canvas --------------------------------------------------------- */
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W, H, FL, dpr;
let XMAX, YTOP, YBOT;                      // world bounds, derived from the frame
const sky  = document.createElement('canvas');   // painted once: gradient + glow
const fore = document.createElement('canvas');   // painted once: ground + vignette

/* depth buckets: 5 depths x 2 moods (calm / afraid). One fillStyle each,
   so drawing 8000 birds is 8000 fillRects and only 10 style changes. */
const NB = 10;
const BUF = Array.from({ length: NB }, () => new Float32Array(MAXB*2));
const BCNT = new Int32Array(NB);
const ZC = [725, 900, 1100, 1300, 1475];
const AL = [0.60, 0.53, 0.46, 0.38, 0.31];
const SZ = new Float32Array(NB); const FS = new Array(NB);

function resize(){
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W*dpr; cv.height = H*dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  FL = Math.min(W, H) * 1.45;              // focal length scales with the frame

  const s0 = FL/1050;                      // world scale at the nominal depth
  XMAX = (W*0.44)/s0; YTOP = -(H*0.36)/s0; YBOT = (H*0.40)/s0;

  for (let b = 0; b < 5; b++){
    SZ[b] = Math.max(1, FL*2.0/ZC[b]);   SZ[b+5] = SZ[b]*1.28;
    FS[b] = `rgba(28,26,23,${AL[b]})`;   FS[b+5] = `rgba(18,16,14,${Math.min(0.82, AL[b]+0.18)})`;
  }
  paintSky(); paintFore();
}

function paintSky(){
  sky.width = W*dpr; sky.height = H*dpr;
  const c = sky.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, H);       // paper, barely graded
  g.addColorStop(0.00, '#f5f3ee'); g.addColorStop(0.55, '#faf9f6');
  g.addColorStop(1.00, '#f0e9db');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const sun = c.createRadialGradient(W*0.40, H*0.90, 0, W*0.40, H*0.90, W*0.5);
  sun.addColorStop(0, 'rgba(214,166,90,0.13)'); sun.addColorStop(1, 'rgba(214,166,90,0)');
  c.fillStyle = sun; c.fillRect(0, 0, W, H);
}

function paintFore(){
  fore.width = W*dpr; fore.height = H*dpr;
  const c = fore.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const v = c.createRadialGradient(W/2, H*0.45, Math.min(W, H)*0.42, W/2, H*0.45, Math.hypot(W, H)*0.6);
  v.addColorStop(0, 'rgba(28,26,23,0)'); v.addColorStop(1, 'rgba(28,26,23,0.12)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
}

/* ---- the roost ------------------------------------------------------ */
/* a point that wanders the sky on slow incommensurate sines — the flock
   never settles because home itself keeps drifting */
let T = 0;
const anchor = { x: 0, y: 0, z: 1050 };
function moveAnchor(){
  anchor.x = XMAX*0.5 * (0.7*Math.sin(T*0.052 + 1.7) + 0.3*Math.sin(T*0.021));
  anchor.y = YTOP*0.42 - YTOP*0.22 * (0.6*Math.sin(T*0.043 + 0.6) + 0.4*Math.sin(T*0.017 + 2));
  anchor.z = 1050 + 185*Math.sin(T*0.029 + 2.2);
}

/* ---- birds ---------------------------------------------------------- */
const gauss = () => (Math.random() + Math.random() + Math.random()) - 1.5;
function initBirds(){
  moveAnchor();
  for (let i = 0; i < MAXB; i++){
    px[i] = anchor.x + gauss()*160; py[i] = anchor.y + gauss()*100; pz[i] = anchor.z + gauss()*160;
    const a = Math.random()*6.283, b = (Math.random() - 0.5)*1.2;
    vx[i] = Math.cos(a)*Math.cos(b)*CRUISE; vy[i] = Math.sin(b)*CRUISE; vz[i] = Math.sin(a)*Math.cos(b)*CRUISE;
    fear[i] = 0; vis[i] = 26;
  }
  nbn.fill(0);
}

/* ---- the falcon ----------------------------------------------------- */
const FAL = { on: false, x: 0, y: 0, z: 1050, vx: 1, vy: 0, vz: 0 };
let cenX = 0, cenY = 0, cenZ = 1050, mvX = 0, mvY = 0, mvZ = 0;   // flock centroid + mean velocity

/* a whim: every few seconds one bird decides, for no reason at all, to
   turn — and for a couple of seconds its whole neighbourhood is leaned
   the same way. Alignment does the rest. This is what keeps the flock
   from ever settling into a stable circling orbit: the next fold is
   always already coming. */
const WHIM = { i: 0, wait: 240, dur: 0, total: 1, age: 0, x: 1, y: 0, z: 0, r2: 1 };
function whimStep(){
  if (WHIM.dur > 0){ WHIM.dur--; WHIM.age++; return; }
  if (--WHIM.wait > 0) return;
  WHIM.i = (Math.random()*COUNT)|0;                 // any bird can start it
  const a = Math.random()*6.283, e = (Math.random() - 0.5)*1.4;
  WHIM.x = Math.cos(a)*Math.cos(e); WHIM.y = Math.sin(e)*0.7; WHIM.z = Math.sin(a)*Math.cos(e);
  const r = 120 + Math.random()*110;                 // the size of the knot it sways
  WHIM.r2 = r*r;
  WHIM.total = WHIM.dur = (70 + Math.random()*80)|0; // ~1.2–2.5s of leaning
  WHIM.age = 0;
  WHIM.wait = (60*(3.5 + Math.random()*5))|0;        // next whim in 3.5–8.5s
}

const ptr = { down: false, mx: 0, my: 0 };
function ptrToWorld(){
  const s = FL/cenZ;
  const wx = (ptr.mx - W/2)/s, wy = (ptr.my - H*HOR)/s;
  FAL.vx = (wx - FAL.x)*0.5 + FAL.vx*0.5; FAL.vy = (wy - FAL.y)*0.5 + FAL.vy*0.5; FAL.vz = 0;
  FAL.x = wx; FAL.y = wy; FAL.z = cenZ;
}
cv.addEventListener('pointerdown', e => { ptr.down = true; ptr.mx = e.clientX; ptr.my = e.clientY; FAL.x = (ptr.mx - W/2)*cenZ/FL; FAL.y = (ptr.my - H*HOR)*cenZ/FL; FAL.z = cenZ; });
cv.addEventListener('pointermove', e => { if (ptr.down){ ptr.mx = e.clientX; ptr.my = e.clientY; } });
const drop = () => { ptr.down = false; FAL.on = false; };
cv.addEventListener('pointerup', drop); cv.addEventListener('pointercancel', drop); cv.addEventListener('pointerleave', drop);

function falconStep(){
  // the falcon exists only under your finger
  if (ptr.down){ FAL.on = true; ptrToWorld(); }
  else FAL.on = false;
}

/* ---- one step of the world ----------------------------------------- */
let frame = 0;
function step(){
  T += 1/60; frame++;
  moveAnchor();
  falconStep();
  whimStep();

  // the whim rides on its bird; ease it in and out so nothing snaps
  const whimOn = WHIM.dur > 0, wl = Math.min(WHIM.i, COUNT - 1);
  const wcx = px[wl], wcy = py[wl], wcz = pz[wl];
  const wg = whimOn ? 0.18*Math.sin(Math.PI*WHIM.age/WHIM.total) : 0;

  // rebuild the spatial hash
  head.fill(-1);
  for (let i = 0; i < COUNT; i++){
    const h = hcell(Math.floor(px[i]/CELL), Math.floor(py[i]/CELL), Math.floor(pz[i]/CELL));
    nxt[i] = head[h]; head[h] = i;
  }

  const K = P.k|0, cap = Math.min(NBMAX, K*2 + 6);
  const falOn = FAL.on, fx0 = FAL.x, fy0 = FAL.y, fz0 = FAL.z;
  const cohW = WC*P.coh;
  let sX = 0, sY = 0, sZ = 0, sVX = 0, sVY = 0, sVZ = 0;

  for (let i = 0; i < COUNT; i++){
    const x = px[i], y = py[i], z = pz[i];

    // every 4th frame (staggered) this bird re-asks the grid who's near
    if (((i + frame) & 3) === 0){
      const ix = Math.floor(x/CELL), iy = Math.floor(y/CELL), iz = Math.floor(z/CELL);
      const r = vis[i], r2 = r*r, rs = r + SKIN, rs2 = rs*rs;
      const rot = (i + frame) % 26;               // de-bias the early exit
      const base = i*NBMAX;
      // birds truly in view claim the slots; skin-zone birds are only
      // standbys for drift cover. The skin shell is ~3/4 of the search
      // volume, so first-come filling would hand it most of the list —
      // starving separation and fooling the vision tuner into growing
      // inside a dense knot (that's a runaway: wider vision, more pull)
      let n = 0, ns = 0;
      outer:
      for (let oi = 0; oi < 27; oi++){
        const o = OFF[oi === 0 ? 0 : 1 + ((oi - 1 + rot) % 26)];
        for (let j = head[hcell(ix + o[0], iy + o[1], iz + o[2])]; j !== -1; j = nxt[j]){
          if (j === i) continue;
          const dx = px[j] - x, dy = py[j] - y, dz = pz[j] - z;
          const d2 = dx*dx + dy*dy + dz*dz;
          if (d2 >= rs2 || d2 < 1e-4) continue;
          if (d2 < r2){ nbr[base + n] = j; n++; if (n >= cap) break outer; }
          else if (ns < NBMAX) skinBuf[ns++] = j;
        }
      }
      // topological vision: tune the radius on the TRUE in-view count
      if (n < K) vis[i] = Math.min(VMAX, r*1.12);
      else if (n > K + 4) vis[i] = Math.max(VMIN, r*0.90);
      const room = Math.min(ns, cap - n);
      for (let k = 0; k < room; k++) nbr[base + n + k] = skinBuf[k];
      nbn[i] = n + room;
    }

    // listen to the cached neighbours — their positions are always fresh.
    // the list is a candidate SUPERSET (it reaches into the skin zone and
    // members drift between polls), so only birds currently inside this
    // bird's vision get a vote — otherwise cohesion reaches farther than
    // separation and the flock quietly over-condenses
    const nn = nbn[i], base = i*NBMAX, r2v = vis[i]*vis[i];
    let cnt = 0, avx = 0, avy = 0, avz = 0, acx = 0, acy = 0, acz = 0;
    let spx = 0, spy = 0, spz = 0, fmax = 0;
    for (let k = 0; k < nn; k++){
      const j = nbr[base + k];
      if (j >= COUNT) continue;                    // the birds knob shrank
      const dx = px[j] - x, dy = py[j] - y, dz = pz[j] - z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 >= r2v || d2 < 1e-4) continue;        // out of view right now
      cnt++;
      avx += vx[j]; avy += vy[j]; avz += vz[j];    // align with them
      acx += px[j]; acy += py[j]; acz += pz[j];    // drift toward them
      if (fear[j] > fmax) fmax = fear[j];          // catch their fear
      if (d2 < SEP2){                               // but keep your distance
        const d = Math.sqrt(d2), w = (1 - d/SEP)/d;
        spx -= dx*w; spy -= dy*w; spz -= dz*w;
      }
    }

    let fx = 0, fy = 0, fz = 0;
    if (cnt){
      const inv = 1/cnt;
      fx += (avx*inv - vx[i])*WA + (acx*inv - x)*cohW + spx*WS;
      fy += (avy*inv - vy[i])*WA + (acy*inv - y)*cohW + spy*WS;
      fz += (avz*inv - vz[i])*WA + (acz*inv - z)*cohW + spz*WS;
    }

    // the roost: indifferent nearby, insistent far away
    {
      const dx = anchor.x - x, dy = anchor.y - y, dz = anchor.z - z;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);          // hypot is 5x slower
      if (d > DEAD){ const p = (d - DEAD)*WR/d; fx += dx*p; fy += dy*p; fz += dz*p; }
    }
    // soft walls of the stage
    if (y > YBOT) fy += (YBOT - y)*0.02;  if (y < YTOP) fy += (YTOP - y)*0.02;
    if (x > XMAX) fx += (XMAX - x)*0.015; if (x < -XMAX) fx += (-XMAX - x)*0.015;
    if (z < ZMIN) fz += (ZMIN - z)*0.015; if (z > ZMAX) fz += (ZMAX - z)*0.015;

    // the current whim, if you're standing in it
    if (whimOn){
      const dx = x - wcx, dy = y - wcy, dz = z - wcz;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < WHIM.r2){ const g = wg*(1 - d2/WHIM.r2); fx += WHIM.x*g; fy += WHIM.y*g; fz += WHIM.z*g; }
    }
    // and a grain of free will for everyone, every step
    fx += (rnd() - 0.5)*0.05;
    fy += (rnd() - 0.5)*0.04;
    fz += (rnd() - 0.5)*0.05;

    // the falcon injects fear; fear makes you flee
    if (falOn){
      const dx = x - fx0, dy = y - fy0, dz = z - fz0;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < FEARR && d > 0.1){
        const q = 1 - d/FEARR;
        fx += dx/d*q*3.4; fy += dy/d*q*3.4; fz += dz/d*q*3.4;
        if (q > fear[i]) fear[i] = q;
      }
    }
    // fear is contagious — this wave outruns the birds themselves
    if (fmax > fear[i]) fear[i] += (fmax*0.9 - fear[i])*0.3;
    fear[i] *= 0.955;

    // frightened birds turn harder
    const am = 0.5*(1 + 2.2*fear[i]);
    const fm2 = fx*fx + fy*fy + fz*fz;
    if (fm2 > am*am){ const s = am/Math.sqrt(fm2); fx *= s; fy *= s; fz *= s; }

    vx[i] += fx; vy[i] += fy; vz[i] += fz;

    // constant speed: relax to cruise (frightened birds sprint)
    const sp = Math.sqrt(vx[i]*vx[i] + vy[i]*vy[i] + vz[i]*vz[i]) || 1e-4;
    const tgt = CRUISE*P.tempo*(1 + 0.85*fear[i]);
    const s = (sp + (tgt - sp)*0.12)/sp;
    vx[i] *= s; vy[i] *= s; vz[i] *= s;

    px[i] = x + vx[i]; py[i] = y + vy[i]; pz[i] = z + vz[i];
    sX += px[i]; sY += py[i]; sZ += pz[i]; sVX += vx[i]; sVY += vy[i]; sVZ += vz[i];
  }

  const inv = 1/Math.max(1, COUNT);
  cenX = sX*inv; cenY = sY*inv; cenZ = sZ*inv;
  mvX = sVX*inv; mvY = sVY*inv; mvZ = sVZ*inv;
}

/* ---- render --------------------------------------------------------- */
function render(){
  ctx.drawImage(sky, 0, 0, W, H);

  BCNT.fill(0);
  const cw = W/2, ch = H*HOR;
  for (let i = 0; i < COUNT; i++){
    const z = pz[i], s = FL/z;
    const x = cw + px[i]*s, y = ch + py[i]*s;
    if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
    let b = z < 800 ? 0 : z < 1000 ? 1 : z < 1200 ? 2 : z < 1400 ? 3 : 4;
    if (fear[i] > 0.3) b += 5;
    const c = BCNT[b], buf = BUF[b];
    buf[c*2] = x; buf[c*2 + 1] = y; BCNT[b] = c + 1;
  }
  for (let d = 4; d >= 0; d--){                 // far to near — painter's order
    for (const b of [d, d + 5]){
      const n = BCNT[b]; if (!n) continue;
      const buf = BUF[b], sz = SZ[b], h = sz/2;
      ctx.fillStyle = FS[b];
      for (let c = 0; c < n; c++) ctx.fillRect(buf[c*2] - h, buf[c*2 + 1] - h, sz, sz);
    }
  }

  if (FAL.on){                                   // the falcon: a heavier dash
    const s = FL/FAL.z, x = cw + FAL.x*s, y = ch + FAL.y*s;
    const n = Math.hypot(FAL.vx, FAL.vy) || 1;
    const dx = FAL.vx/n*9*s, dy = FAL.vy/n*9*s;
    ctx.strokeStyle = 'rgba(28,26,23,0.9)'; ctx.lineWidth = Math.max(1.5, 3.2*s); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
  }

  ctx.drawImage(fore, 0, 0, W, H);
}

/* ---- knobs & chrome -------------------------------------------------- */
const FMT = { birds: v => v|0, k: v => v|0, coh: v => v.toFixed(2), tempo: v => v.toFixed(2) };
document.querySelectorAll('#knobs input[type=range]').forEach(inp => {
  const out = inp.nextElementSibling, k = inp.dataset.k;
  inp.addEventListener('input', () => {
    P[k] = parseFloat(inp.value);
    if (k === 'birds') COUNT = P.birds|0;
    out.textContent = FMT[k](P[k]);
  });
});
const panel = document.getElementById('panel');
document.getElementById('ptoggle').addEventListener('click', () => panel.classList.toggle('open'));

/* film grain — one small random tile, repeated */
(() => {
  const g = document.createElement('canvas'); g.width = g.height = 128;
  const gc = g.getContext('2d'), id = gc.createImageData(128, 128), d = id.data;
  for (let i = 0; i < d.length; i += 4){ const v = Math.random()*255|0; d[i] = d[i+1] = d[i+2] = v; d[i+3] = 14; }
  gc.putImageData(id, 0, 0);
  document.getElementById('grain').style.backgroundImage = `url(${g.toDataURL()})`;
})();

/* ---- run ------------------------------------------------------------- */
let running = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.addEventListener('keydown', e => {
  if (e.code === 'Space'){ running = !running; e.preventDefault(); }
});

const stat = document.getElementById('stat');
let fps = 60, statT = 0;

resize();
window.addEventListener('resize', resize);
initBirds();
for (let i = 0; i < 260; i++) step();           // warm up: open mid-ballet
render();
if (!running) document.getElementById('cap').textContent = 'murmuration · space to fly · drag to loose the falcon';

let last = performance.now(), acc = 0;
function loop(now){
  requestAnimationFrame(loop);
  const dt = now - last; last = now;
  fps += (1000/Math.max(1, dt) - fps)*0.05;
  if ((statT += dt) > 500){ statT = 0; stat.textContent = `${COUNT} birds · ${fps|0} fps`; }
  if (!running && !ptr.down) return;
  // at most ONE sim step per displayed frame: if a frame runs long the
  // ballet slows down a touch instead of stuttering — catching up by
  // running extra steps only makes the slow frame slower (death spiral)
  acc += dt;
  if (acc < 1000/60 - 1) return;                // pace 120Hz displays to 60
  acc = Math.min(acc - 1000/60, 32);            // spend one step, bank almost nothing
  step(); render();
}
requestAnimationFrame(loop);
