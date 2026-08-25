'use strict';
/* ============================================================
   MURMUR WORDS — living letters
   The murmuration is poured into a glyph.

   Same starlings as murmuration/ — 3D volume, ~7 topological
   neighbours, constant cruise, contagious fear, drag-to-loose
   falcon — and they NEVER stop flying. A letter is not a set of
   assigned seats: it is a vessel. The glyph is rasterized in
   real bold type into a signed distance field, and the field's
   walls gently turn any bird that strays. Inside, the full flock
   physics keeps running — streams, folds, whims — so the letter
   reads as a shape that breathes and swirls, drawn at every
   instant by thousands of small flights.

   Press any key to pour the flock into that letter. Esc pauses.
   ============================================================ */

/* ---- knobs --------------------------------------------------------- */
const P = { birds: 10000, scatter: 0, hold: 4, mhold: 6, coh: 1.0, tempo: 1.0, words: true,
            fx: true, sheen: true };
/* dev hook: any knob can be overridden by query param, e.g. ?coh=0.4 */
for (const [k, v] of new URLSearchParams(location.search)) if (k in P) P[k] = parseFloat(v);

/* ---- constants ------------------------------------------------------ */
const MAXB   = 10000;
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
let COUNT = Math.min(MAXB, P.birds|0);   // never above the arrays — ghosts in the grid hang the walk

/* Verlet neighbour lists — see murmuration/sketch.js for the full story:
   near birds claim the slots, skin-zone birds are drift-cover standbys,
   and each bird re-asks the grid only every 4th frame. */
const NBMAX = 24, SKIN = 8;
const nbr = new Int32Array(MAXB*NBMAX);
const nbn = new Uint8Array(MAXB);
const skinBuf = new Int32Array(NBMAX);

/* cheap deterministic randomness for the hot loop */
let rngS = 0x9e3779b9 | 0;
function rnd(){ rngS ^= rngS << 13; rngS ^= rngS >>> 17; rngS ^= rngS << 5; return (rngS >>> 0)/4294967296; }

/* spatial hash — head/next linked lists, zero allocation per frame */
const CELL = 48, NCELL = 4096;
const head = new Int32Array(NCELL), nxt = new Int32Array(MAXB);
const hcell = (x, y, z) => ((x*73856093) ^ (y*19349663) ^ (z*83492791)) & (NCELL - 1);
const OFF = [];
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
  (dx || dy || dz) ? OFF.push([dx, dy, dz]) : OFF.unshift([0, 0, 0]);

/* ---- canvas --------------------------------------------------------- */
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W, H, FL, dpr;
let XMAX, YTOP, YBOT;
const sky  = document.createElement('canvas');
const fore = document.createElement('canvas');
const NDB = 50, NLB = 40;  // dots: 0-9 ink tone, 10-49 sheen (depth x hue bin)
const BUF = Array.from({ length: NDB }, () => new Float32Array(MAXB*2));
const BCNT = new Int32Array(NDB);
const LBUF = Array.from({ length: NLB }, () => new Float32Array(MAXB*4));
const LCNT = new Int32Array(NLB);
const ZC = [725, 900, 1100, 1300, 1475];
const AL = [0.60, 0.53, 0.46, 0.38, 0.31];
const SZ = new Float32Array(10); const FS = new Array(10);
const SH = new Array(30), SD = new Array(40);

function resize(){
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W*dpr; cv.height = H*dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  FL = Math.min(W, H) * 1.45;

  const s0 = FL/1050;
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
/* while a letter is up, the wild remnant's home drifts high and DEEP —
   a small faint murmuration far behind the glyph, not a cloud on it */
let T = 0, lift = 0;
const anchor = { x: 0, y: 0, z: 1050 };
function moveAnchor(){
  lift += ((MODE === 'free' ? 0 : 1) - lift)*0.02;
  // between words the roost hugs the centre of the frame — a modest
  // wander around the middle, not a tour of the sky
  anchor.x = XMAX*0.26 * (0.7*Math.sin(T*0.052 + 1.7) + 0.3*Math.sin(T*0.021));
  anchor.y = 24 - YTOP*0.14 * (0.6*Math.sin(T*0.043 + 0.6) + 0.4*Math.sin(T*0.017 + 2))
           + YTOP*0.5*lift;
  anchor.z = 1050 + 185*Math.sin(T*0.029 + 2.2) + 280*lift;
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

/* ---- the falcon (drag only) ----------------------------------------- */
const FAL = { on: false, x: 0, y: 0, z: 1050, vx: 1, vy: 0, vz: 0 };
let cenX = 0, cenY = 0, cenZ = 1050, mvX = 0, mvY = 0, mvZ = 0;

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
  if (ptr.down){ FAL.on = true; ptrToWorld(); }
  else FAL.on = false;
}

/* ---- whims (free flight never settles) ------------------------------ */
const WHIM = { i: 0, wait: 240, dur: 0, total: 1, age: 0, x: 1, y: 0, z: 0, r2: 1 };
function whimStep(){
  if (WHIM.dur > 0){ WHIM.dur--; WHIM.age++; return; }
  if (--WHIM.wait > 0) return;
  WHIM.i = (Math.random()*COUNT)|0;
  const a = Math.random()*6.283, e = (Math.random() - 0.5)*1.4;
  WHIM.x = Math.cos(a)*Math.cos(e); WHIM.y = Math.sin(e)*0.7; WHIM.z = Math.sin(a)*Math.cos(e);
  const r = 120 + Math.random()*110;
  WHIM.r2 = r*r;
  WHIM.total = WHIM.dur = (70 + Math.random()*80)|0;
  WHIM.age = 0;
  WHIM.wait = (60*(3.5 + Math.random()*5))|0;
}

/* ---- the words ------------------------------------------------------ */
/* every bird below nT owns one point sampled along the strokes of the
   current word; everyone else stays wild. */
let WORDS = ['YES', 'NO', 'LETS', 'GO', 'WILD'];   // the cycle — edited live from the words box
let nT = 0, MODE = 'free', modeT = 200, wi = 0, lastText = '', lastLen = 6, queued = null;
let typed = '', typedT = 0;

/* the letter as a vessel: a signed distance field of the glyph, in grid
   cells (negative inside). Birds keep full flock physics — the field is
   only walls, felt near and beyond the edge. */
let SDF = null, SGW = 0, SGH = 0, SOX = 0, SOY = 0, SCELL = 1, letX = 0, letY = 0;
const SDF_M = 2.5;                    // margin (cells) where the walls begin

/* even occupancy without stillness: every contained bird keeps a WEAK
   affinity to a random interior point and re-rolls it every few seconds.
   The pull is far too soft to hold anyone still — it only keeps the
   population spread across the whole glyph while the flocking swirls */
let homes = null, nHomes = 0;
let homeStart = null, nLet = 0;        // per-letter ranges into homes
let letL = null, letR = null;          // per-letter world x-bounds
const hom = new Int32Array(MAXB);
const lb  = new Uint8Array(MAXB);      // which letter this bird belongs to
const pickHome = l => homeStart[l] + (rnd()*(homeStart[l+1] - homeStart[l]))|0;

/* nothing snaps: each bird gets its own delay (the transitions are
   scattered across seconds) and its own weight fw that eases 0↔1 —
   flock urges fade out exactly as the letter-pull fades in */
const RAMP = 72, STAG_F = 150, STAG_R = 140;
const fw = new Float32Array(MAXB);        // 0 = flock bird, 1 = word bird
const fd = new Float32Array(MAXB);        // per-bird transition delay, steps
let formClock = 0;

/* the glyph is set in real bold type, rasterized to a coarse grid, and
   turned into a signed distance field by two chamfer sweeps */
/* prefer Archivo Black once it has actually arrived — a still-loading
   webfont makes canvas fillText draw nothing, and the plan sees no pixels */
const FONT_LOADED = '"Archivo Black","Arial Black",sans-serif';
const FONT_LOCAL  = '"Arial Black",sans-serif';
const wordFont = () => (document.fonts && document.fonts.check('900 10px "Archivo Black"')) ? FONT_LOADED : FONT_LOCAL;
const rasterCv = document.createElement('canvas');
function chamfer(d, gw, gh){
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++){
    const i = y*gw + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i-1] + 1);
    if (y > 0){ v = Math.min(v, d[i-gw] + 1);
      if (x > 0) v = Math.min(v, d[i-gw-1] + 1.414);
      if (x < gw-1) v = Math.min(v, d[i-gw+1] + 1.414); }
    d[i] = v;
  }
  for (let y = gh-1; y >= 0; y--) for (let x = gw-1; x >= 0; x--){
    const i = y*gw + x; let v = d[i];
    if (x < gw-1) v = Math.min(v, d[i+1] + 1);
    if (y < gh-1){ v = Math.min(v, d[i+gw] + 1);
      if (x < gw-1) v = Math.min(v, d[i+gw+1] + 1.414);
      if (x > 0) v = Math.min(v, d[i+gw-1] + 1.414); }
    d[i] = v;
  }
}
function planWord(text){
  text = text.toUpperCase();                             // capitals only
  const s0 = FL/1050;
  const FONT = wordFont();
  let g = rasterCv.getContext('2d', { willReadFrequently: true });
  const PROBE = 100;
  g.font = `900 ${PROBE}px ${FONT}`;
  const m = g.measureText(text);
  const w100 = Math.max(1, m.width);
  const asc  = m.actualBoundingBoxAscent  || PROBE*0.78;
  const desc = m.actualBoundingBoxDescent || PROBE*0.24;
  const h100 = asc + desc;
  const F = Math.min(W*0.80/w100, H*0.28/h100)*PROBE;    // smaller, word-sized
  // fences between letters (screen px from the text origin) so each
  // glyph can own its share of the flock
  const chars = [...text];
  const fences = [0];
  for (let k = 1; k <= chars.length; k++)
    fences.push(g.measureText(text.slice(0, k)).width*F/PROBE);
  const padPx = F*0.35;                                  // room for the field
  const CP = 4;                                          // grid cell, screen px
  const gw = Math.ceil((w100*F/PROBE + padPx*2)/CP);
  const gh = Math.ceil((h100*F/PROBE + padPx*2)/CP);
  rasterCv.width = gw; rasterCv.height = gh;
  g = rasterCv.getContext('2d');
  g.font = `900 ${F/CP}px ${FONT}`;
  g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
  g.fillText(text, padPx/CP, (padPx + asc*F/PROBE)/CP);
  const data = g.getImageData(0, 0, gw, gh).data;
  const INF = 1e6;
  const dOut = new Float32Array(gw*gh), dIn = new Float32Array(gw*gh);
  let npx = 0;
  for (let i = 0; i < gw*gh; i++){
    const inside = data[i*4 + 3] > 120;
    dOut[i] = inside ? 0 : INF;
    dIn[i]  = inside ? INF : 0;
    if (inside) npx++;
  }
  if (!npx) return false;
  chamfer(dOut, gw, gh); chamfer(dIn, gw, gh);
  for (let i = 0; i < gw*gh; i++) dOut[i] -= dIn[i];     // signed: <0 inside
  SDF = dOut; SGW = gw; SGH = gh;
  SCELL = CP/s0;                                         // one cell in world units
  SOX = -(gw*CP)/2/s0;                                   // word centred on screen
  SOY = (H*(0.42 - HOR) - (gh*CP)/2)/s0;
  letX = 0; letY = H*(0.42 - HOR)/s0;
  // interior points grouped BY LETTER (cells claimed via the fences),
  // so the flock can be split equally between the glyphs; each letter's
  // world x-bounds are kept so a bird knows when it stands on foreign soil
  const perL = chars.map(() => []);
  const perX0 = new Array(chars.length).fill(1e9);
  const perX1 = new Array(chars.length).fill(-1e9);
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++)
    if (SDF[y*gw + x] < -1.2){
      const wx2 = SOX + (x + 0.5)*SCELL;
      const tx2 = x*CP + CP/2 - padPx;
      let k = 0;
      while (k < chars.length - 1 && tx2 > fences[k + 1]) k++;
      perL[k].push(wx2, SOY + (y + 0.5)*SCELL);
      if (wx2 < perX0[k]) perX0[k] = wx2;
      if (wx2 > perX1[k]) perX1[k] = wx2;
    }
  const own = [], ox0 = [], ox1 = [];                    // spaces own nothing
  for (let k = 0; k < chars.length; k++)
    if (perL[k].length){ own.push(perL[k]); ox0.push(perX0[k]); ox1.push(perX1[k]); }
  nLet = own.length;
  if (!nLet) return false;
  letL = new Float32Array(ox0); letR = new Float32Array(ox1);
  homeStart = new Int32Array(nLet + 1);
  let tot = 0;
  for (let k = 0; k < nLet; k++){ homeStart[k] = tot; tot += own[k].length/2; }
  homeStart[nLet] = tot;
  homes = new Float32Array(tot*2);
  { let o = 0; for (const a of own){ homes.set(a, o*2); o += a.length/2; } }
  nHomes = tot;
  return true;
}

function summon(text){
  if (!planWord(text)) return false;
  lastText = text; lastLen = text.length;
  nT = COUNT - Math.round(COUNT*P.scatter);          // ALL of them (minus scatter)
  for (let i = 0; i < nT; i++){
    fw[i] = 0; fd[i] = rnd()*STAG_F;
    lb[i] = i % nLet;                                 // equal share per letter
    hom[i] = pickHome(lb[i]);
  }
  MODE = 'form'; modeT = STAG_F + RAMP + 40; formClock = 0;
  return true;
}
function release(){
  // the letter drains right to left: each bird is let out of the vessel
  // according to where it happens to be flying right now
  let x0 = 1e9, x1 = -1e9;
  for (let i = 0; i < nT; i++){ if (px[i] < x0) x0 = px[i]; if (px[i] > x1) x1 = px[i]; }
  const span = Math.max(1, x1 - x0);
  for (let i = 0; i < nT; i++)
    fd[i] = (x1 - px[i])/span*STAG_R*0.7 + rnd()*STAG_R*0.3;
  MODE = 'release'; modeT = STAG_R + RAMP + 10; formClock = 0;
}

/* knobs act on the standing letter too: adjust how many birds it holds */
function replan(){
  if (MODE !== 'form' && MODE !== 'hold') return;
  const old = nT;
  nT = COUNT - Math.round(COUNT*P.scatter);
  for (let i = old; i < nT; i++){ fw[i] = 0; fd[i] = rnd()*40; lb[i] = i % nLet; hom[i] = pickHome(lb[i]); }
}

/* ---- one step of the world ----------------------------------------- */
let frame = 0;
function step(){
  T += 1/60; frame++;
  moveAnchor();
  falconStep();
  whimStep();

  // the letter clock
  modeT--; formClock++;
  if (typed && --typedT <= 0) commit();
  if (MODE === 'free'){
    if (modeT <= 0){
      // auto-cycle only when words are on; a typed word always forms
      const t = queued || (P.words ? WORDS[wi++ % WORDS.length] : null); queued = null;
      if (!t || !summon(t)) modeT = 120;
    }
  } else if (MODE === 'form'){
    if (modeT <= 0){ MODE = 'hold'; modeT = ((P.hold + 0.12*lastLen)*60)|0; }
  } else if (MODE === 'hold'){
    if (modeT <= 0) release();
  } else if (MODE === 'release'){
    if (modeT <= 0){ nT = 0; MODE = 'free'; modeT = queued ? 30 : (P.mhold*60)|0; }
  }

  const whimOn = WHIM.dur > 0, wl = Math.min(WHIM.i, COUNT - 1);
  const wcx = px[wl], wcy = py[wl], wcz = pz[wl];
  const wg = whimOn ? 0.18*Math.sin(Math.PI*WHIM.age/WHIM.total) : 0;

  head.fill(-1);
  for (let i = 0; i < COUNT; i++){
    const h = hcell(Math.floor(px[i]/CELL), Math.floor(py[i]/CELL), Math.floor(pz[i]/CELL));
    nxt[i] = head[h]; head[h] = i;
  }

  const K = 7, cap = Math.min(NBMAX, K*2 + 6);
  const falOn = FAL.on, fx0 = FAL.x, fy0 = FAL.y, fz0 = FAL.z;
  const cohW = WC*P.coh;
  let sX = 0, sY = 0, sZ = 0, sVX = 0, sVY = 0, sVZ = 0;

  for (let i = 0; i < COUNT; i++){
    const x = px[i], y = py[i], z = pz[i];

    // how much this bird belongs to the word right now (eased 0..1)
    let w = 0;
    if (i < nT){
      if (MODE === 'release'){ if (formClock > fd[i] && fw[i] > 0) fw[i] = Math.max(0, fw[i] - 1/RAMP); }
      else if (formClock > fd[i] && fw[i] < 1) fw[i] = Math.min(1, fw[i] + 1/RAMP);
      const f = fw[i]; w = f*f*(3 - 2*f);        // smoothstep: ease in, ease out
    }
    const wflock = 1 - w;

    if (((i + frame) & 3) === 0){
      const ix = Math.floor(x/CELL), iy = Math.floor(y/CELL), iz = Math.floor(z/CELL);
      const r = vis[i], r2 = r*r, rs = r + SKIN, rs2 = rs*rs;
      const rot = (i + frame) % 26;
      const base = i*NBMAX;
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
      if (n < K) vis[i] = Math.min(VMAX, r*1.12);
      else if (n > K + 4) vis[i] = Math.max(VMIN, r*0.90);
      const room = Math.min(ns, cap - n);
      for (let k = 0; k < room; k++) nbr[base + n + k] = skinBuf[k];
      nbn[i] = n + room;
    }

    // listen to the cached neighbours (superset — gate by current vision).
    // flock urges stay FULLY on for everyone: inside the glyph the birds
    // are still a murmuration — the letter is only the shape of the sky
    // inside the vessel personal space shrinks with w: a flat sheet can
    // only hold the whole flock if the birds pack close — the pressure
    // that used to escape into depth is absorbed by tighter spacing
    const sepR = SEP*(1 - 0.6*w), sep2i = sepR*sepR;
    const nn = nbn[i], base = i*NBMAX, r2v = vis[i]*vis[i];
    let cnt = 0, avx = 0, avy = 0, avz = 0, acx = 0, acy = 0, acz = 0;
    let spx = 0, spy = 0, spz = 0, fmax = 0;
    for (let k = 0; k < nn; k++){
      const j = nbr[base + k];
      if (j >= COUNT) continue;
      const dx = px[j] - x, dy = py[j] - y, dz = pz[j] - z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 >= r2v || d2 < 1e-4) continue;
      cnt++;
      avx += vx[j]; avy += vy[j]; avz += vz[j];
      acx += px[j]; acy += py[j]; acz += pz[j];
      if (fear[j] > fmax) fmax = fear[j];
      if (d2 < sep2i){
        const d = Math.sqrt(d2), wgt = (1 - d/sepR)/d;
        spx -= dx*wgt; spy -= dy*wgt; spz -= dz*wgt;
      }
    }

    let fx = 0, fy = 0, fz = 0;
    if (cnt){
      // cohesion nearly vanishes inside the vessel — at word scale it
      // drains the outer letters toward the centroid; the homes compose
      // now. Alignment nearly vanishes too: with personal space shrunk
      // for flat packing, separation no longer scatters the headings, and
      // unopposed alignment locks the crowd into gliding streams — so it
      // is cut hard, and per-bird turbulence (below) supplies the chaos
      const inv = 1/cnt, cw2 = cohW*(1 - 0.85*w), wa2 = WA*(1 - 0.8*w);
      fx += (avx*inv - vx[i])*wa2 + (acx*inv - x)*cw2 + spx*WS;
      fy += (avy*inv - vy[i])*wa2 + (acy*inv - y)*cw2 + spy*WS;
      fz += (avz*inv - vz[i])*wa2 + (acz*inv - z)*cw2 + spz*WS;
    }

    if (w > 0.001 && SDF){
      // your home patch first — it decides whether the walls apply to you.
      // homes stay inside YOUR letter, so each glyph keeps its equal share
      if (((i + frame) % 240) === 0) hom[i] = pickHome(lb[i]);
      const hx = homes[hom[i]*2], hy = homes[hom[i]*2 + 1];
      const dhx = hx - x, dhy = hy - y;
      const dh = Math.sqrt(dhx*dhx + dhy*dhy);
      // standing on foreign soil (not over YOUR letter) = commuting:
      // the walls let you pass, and you hustle home
      const li = lb[i];
      const commuting = x < letL[li] - 12 || x > letR[li] + 12;

      // the glyphs' walls: a nudge inward near the edge, a shove beyond it
      const gx = (x - SOX)/SCELL, gy = (y - SOY)/SCELL;
      if (gx < 1 || gy < 1 || gx >= SGW - 1 || gy >= SGH - 1){
        const d = dh || 1;                           // far off the map: fly to
        fx += dhx/d*0.55*w; fy += dhy/d*0.55*w;      // YOUR letter, not the middle
      } else {
        const id = (gy|0)*SGW + (gx|0);
        const s = SDF[id];
        if (s > -SDF_M){
          const gdx = SDF[id + 1] - SDF[id - 1];
          const gdy = SDF[id + SGW] - SDF[id - SGW];
          const gl = Math.sqrt(gdx*gdx + gdy*gdy) || 1;
          const nx2 = gdx/gl, ny2 = gdy/gl;
          const push = Math.min(1.6, 0.16*(s + SDF_M))*w;
          fx -= nx2*push; fy -= ny2*push;
          if (s > -0.6 && !commuting){
            // the wall doesn't negotiate: outward velocity is stripped —
            // reflected, slightly, once past the edge — so even an aligned
            // 8000-bird ram folds back instead of punching through
            const vout = vx[i]*nx2 + vy[i]*ny2;
            if (vout > 0){
              const k2 = w*(s > 0 ? 1.35 : 0.5);
              vx[i] -= nx2*vout*k2; vy[i] -= ny2*vout*k2;
            }
          }
        }
      }
      // the word is a SHEET, not a slab: a firm (but saturating — the
      // approach flight must keep its budget for x/y homing) pull to the
      // word plane plus a steady bleed of depth-velocity. The crowd's
      // z-jostle finds its own few-unit thickness — flat as physics allows
      const dz0 = z - 1050;
      fz -= Math.max(-0.55, Math.min(0.55, dz0*0.05))*w;
      vz[i] *= 1 - 0.10*w;

      // commute toward your current home patch, then pick another — firm
      // enough that even a coherent 8000-bird knot cannot collectively
      // abandon half the word, brief enough that nobody ever arrives
      if (dh > 10){ const p = (commuting ? 0.5 : 0.24)*w/dh; fx += dhx*p; fy += dhy*p; }
    }
    if (wflock > 0.001){
      const dx = anchor.x - x, dy = anchor.y - y, dz = anchor.z - z;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d > DEAD){ const p = (d - DEAD)*WR/d*wflock; fx += dx*p; fy += dy*p; fz += dz*p; }
    }
    if (y > YBOT) fy += (YBOT - y)*0.02;  if (y < YTOP) fy += (YTOP - y)*0.02;
    if (x > XMAX) fx += (XMAX - x)*0.015; if (x < -XMAX) fx += (-XMAX - x)*0.015;
    if (z < ZMIN) fz += (ZMIN - z)*0.015; if (z > ZMAX) fz += (ZMAX - z)*0.015;

    if (whimOn){
      // whims blow through the letter too, but gently — internal weather
      // that ripples the glyph without tearing holes in it
      const dx = x - wcx, dy = y - wcy, dz = z - wcz;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < WHIM.r2){
        const g = wg*(1 - d2/WHIM.r2)*(1 - 0.65*w);
        fx += WHIM.x*g; fy += WHIM.y*g; fz += WHIM.z*g;
      }
    }
    // turbulence grows inside the vessel — it stands in for the heading-
    // scatter that full-size separation used to provide (but not in depth:
    // the sheet stays flat)
    const nA = 1 + 4*w;
    fx += (rnd() - 0.5)*0.05*nA;
    fy += (rnd() - 0.5)*0.04*nA;
    fz += (rnd() - 0.5)*0.05*(1 - 0.7*w);

    if (falOn){
      const dx = x - fx0, dy = y - fy0, dz = z - fz0;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < FEARR && d > 0.1){
        const q = 1 - d/FEARR;
        fx += dx/d*q*3.4; fy += dy/d*q*3.4; fz += dz/d*q*3.4;
        if (q > fear[i]) fear[i] = q;
      }
    }
    if (fmax > fear[i]) fear[i] += (fmax*0.9 - fear[i])*0.3;
    fear[i] *= 0.955;

    const am = (0.5 + 0.35*w)*(1 + 2.2*fear[i]);
    const fm2 = fx*fx + fy*fy + fz*fz;
    if (fm2 > am*am){ const s = am/Math.sqrt(fm2); fx *= s; fy *= s; fz *= s; }

    vx[i] += fx; vy[i] += fy; vz[i] += fz;

    // nobody hovers, not even in the letter — that's the whole point
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
  BCNT.fill(0);
  const fxOn = P.fx, sheenOn = P.sheen;
  if (fxOn) LCNT.fill(0);
  if (sheenOn){
    // one bright palette, drifting slowly through the hues. Dashes are
    // hued by heading (folds read as colour waves); dots by a stable
    // per-bird hue — nothing stays black while the sheen is on
    const hb = T*14;
    if (fxOn)
      for (let d = 0; d < 5; d++) for (let j = 0; j < 6; j++)
        SH[d*6 + j] = `hsla(${(hb + j*60)%360},68%,46%,${AL[d]})`;
    for (let d = 0; d < 5; d++) for (let j = 0; j < 8; j++)
      SD[d*8 + j] = `hsla(${(hb + j*45)%360},68%,46%,${AL[d]})`;
  }

  const cw = W/2, ch = H*HOR;
  for (let i = 0; i < COUNT; i++){
    const z = pz[i], s = FL/z;
    const x = cw + px[i]*s, y = ch + py[i]*s;
    if (x < -6 || x > W + 6 || y < -6 || y > H + 6) continue;
    const b5 = z < 800 ? 0 : z < 1000 ? 1 : z < 1200 ? 2 : z < 1400 ? 3 : 4;
    const bt = fear[i] > 0.3 ? b5 + 5 : b5;
    if (fxOn){
      const sv = Math.sqrt(vx[i]*vx[i] + vy[i]*vy[i]);
      let L = (sv - 1.4)*2.4;
      if (L > 0.8){                     // this bird is in flight
        // the mark stretches along the heading; with sheen on, its hue
        // depends on where it is going
        if (L > 10) L = 10;
        const half = L*s/2, inv = half/sv;
        let lbi = bt;
        if (sheenOn){
          let j = ((Math.atan2(vy[i], vx[i])*0.15915 + 0.5)*6)|0;
          if (j > 5) j = 5;
          lbi = 10 + b5*6 + j;
        }
        const c = LCNT[lbi], buf = LBUF[lbi];
        buf[c*4] = x; buf[c*4 + 1] = y; buf[c*4 + 2] = vx[i]*inv; buf[c*4 + 3] = vy[i]*inv;
        LCNT[lbi] = c + 1;
        continue;
      }
    }
    const bi = sheenOn ? 10 + b5*8 + ((i ^ (i >> 3)) & 7) : bt;
    const c = BCNT[bi], buf = BUF[bi];
    buf[c*2] = x; buf[c*2 + 1] = y; BCNT[bi] = c + 1;
  }

  ctx.drawImage(sky, 0, 0, W, H);

  if (sheenOn){
    for (let d = 4; d >= 0; d--) for (let j = 0; j < 8; j++){
      const bi = 10 + d*8 + j, n = BCNT[bi]; if (!n) continue;
      const buf = BUF[bi], sz = SZ[d], h = sz/2;
      ctx.fillStyle = SD[d*8 + j];
      for (let c = 0; c < n; c++) ctx.fillRect(buf[c*2] - h, buf[c*2 + 1] - h, sz, sz);
    }
  } else {
    for (let d = 4; d >= 0; d--){
      for (const b of [d, d + 5]){
        const n = BCNT[b]; if (!n) continue;
        const buf = BUF[b], sz = SZ[b], h = sz/2;
        ctx.fillStyle = FS[b];
        for (let c = 0; c < n; c++) ctx.fillRect(buf[c*2] - h, buf[c*2 + 1] - h, sz, sz);
      }
    }
  }
  if (fxOn){
    ctx.lineCap = 'round';
    if (sheenOn){
      for (let d = 4; d >= 0; d--) for (let j = 0; j < 6; j++){
        const bi = 10 + d*6 + j, n = LCNT[bi]; if (!n) continue;
        const buf = LBUF[bi];
        ctx.strokeStyle = SH[d*6 + j]; ctx.lineWidth = Math.max(1, SZ[d]*0.85);
        ctx.beginPath();
        for (let c = 0; c < n; c++){
          const x = buf[c*4], y = buf[c*4 + 1], dx = buf[c*4 + 2], dy = buf[c*4 + 3];
          ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy);
        }
        ctx.stroke();
      }
    } else {
      for (let d = 4; d >= 0; d--){
        for (const b of [d, d + 5]){
          const n = LCNT[b]; if (!n) continue;
          const buf = LBUF[b];
          ctx.strokeStyle = FS[b]; ctx.lineWidth = Math.max(1, SZ[b]*0.85);
          ctx.beginPath();
          for (let c = 0; c < n; c++){
            const x = buf[c*4], y = buf[c*4 + 1], dx = buf[c*4 + 2], dy = buf[c*4 + 3];
            ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy);
          }
          ctx.stroke();
        }
      }
    }
  }

  if (FAL.on){
    const s = FL/FAL.z, x = cw + FAL.x*s, y = ch + FAL.y*s;
    ctx.fillStyle = 'rgba(184,32,26,0.9)';
    ctx.beginPath(); ctx.arc(x, y, 11*s, 0, 6.2832); ctx.fill();
  }

  ctx.drawImage(fore, 0, 0, W, H);
}

/* ---- typing ---------------------------------------------------------- */
const cap = document.getElementById('cap');
const CAP_IDLE = 'murmur words · type a word · drag the falcon';
function refreshCap(){ cap.textContent = typed ? typed.toUpperCase() + '▏' : CAP_IDLE; }
function commit(){
  const t = typed.trim(); typed = ''; refreshCap();
  if (!t) return;
  queued = t;
  if (MODE === 'form' || MODE === 'hold') release();      // drain, then rewrite
  else if (MODE === 'free') modeT = Math.min(modeT, 40);  // mid-release: let it finish
}
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape'){ running = !running; return; }
  if (e.key === 'Enter'){ commit(); return; }
  if (e.key === 'Backspace'){ typed = typed.slice(0, -1); typedT = 240; refreshCap(); e.preventDefault(); return; }
  if (e.key.length === 1 && /[\x20-\x7e]/.test(e.key)){
    if (typed.length < 14){ typed += e.key; typedT = 240; refreshCap(); }
    e.preventDefault();
  }
});

/* ---- knobs & chrome -------------------------------------------------- */
const FMT = { birds: v => v|0, hold: v => v.toFixed(1) + 's', mhold: v => v.toFixed(1) + 's', tempo: v => v.toFixed(2) };
document.querySelectorAll('#knobs input[type=range]').forEach(inp => {
  const out = inp.nextElementSibling, k = inp.dataset.k;
  inp.addEventListener('input', () => {
    P[k] = parseFloat(inp.value);
    if (k === 'birds') COUNT = Math.min(MAXB, P.birds|0);
    out.textContent = FMT[k](P[k]);
    if (k === 'birds') replan();
  });
});
/* the words box IS the repertoire: space-separated, cycled in order.
   applying mid-word drains the standing one and rewrites from the top */
const wordsIn = document.getElementById('kb-words');
function applyWords(){
  WORDS = wordsIn.value.trim().split(/\s+/).filter(Boolean);
  wi = 0;
  if (MODE === 'form' || MODE === 'hold') release();
  else if (MODE === 'free') modeT = Math.min(modeT, 40);
}
wordsIn.addEventListener('change', applyWords);
wordsIn.addEventListener('keydown', e => {
  e.stopPropagation();                       // the canvas typing must not hear this
  if (e.key === 'Enter'){ applyWords(); wordsIn.blur(); }
  if (e.key === 'Escape') wordsIn.blur();
});
const panel = document.getElementById('panel');
document.getElementById('ptoggle').addEventListener('click', () => panel.classList.toggle('open'));

(() => {
  const g = document.createElement('canvas'); g.width = g.height = 128;
  const gc = g.getContext('2d'), id = gc.createImageData(128, 128), d = id.data;
  for (let i = 0; i < d.length; i += 4){ const v = Math.random()*255|0; d[i] = d[i+1] = d[i+2] = v; d[i+3] = 14; }
  gc.putImageData(id, 0, 0);
  document.getElementById('grain').style.backgroundImage = `url(${g.toDataURL()})`;
})();

/* ---- run ------------------------------------------------------------- */
let running = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (document.fonts) document.fonts.load('900 100px "Archivo Black"');   // warm the type

const stat = document.getElementById('stat');
let fps = 60, statT = 0;

resize();
window.addEventListener('resize', resize);
initBirds();
for (let i = 0; i < 140; i++) step();
render();

/* dev hook: ?steps=N fast-forwards deterministically (headless rAF timing
   is unreliable for screenshots — real browsers never hit this) */
const mSteps = /steps=(\d+)/.exec(location.search);
if (mSteps){
  for (let i = 0, n = +mSteps[1]; i < n; i++) step();
  render();
  let minS = 1e9, maxS = -1e9, neg = 0;
  if (SDF){ for (let i = 0; i < SGW*SGH; i++){ const v = SDF[i]; if (v < minS) minS = v; if (v > maxS) maxS = v; if (v < 0) neg++; } }
  let mx = 0, my = 0; for (let i = 0; i < nT; i++){ mx += px[i]; my += py[i]; }
  document.title = `${MODE} ${lastText} sdf[${minS|0},${maxS|0}] neg=${neg} grid=${SGW}x${SGH} nLet=${nLet} ` +
    `flock=(${(mx/Math.max(1,nT))|0},${(my/Math.max(1,nT))|0})`;
}
if (!running) cap.textContent = 'murmur words · esc to fly · type a word';

let last = performance.now(), acc = 0;
function loop(now){
  requestAnimationFrame(loop);
  const dt = now - last; last = now;
  fps += (1000/Math.max(1, dt) - fps)*0.05;
  if ((statT += dt) > 500){ statT = 0; stat.textContent = `${COUNT} birds · ${fps|0} fps`; }
  if (!running && !ptr.down) return;
  acc += dt;
  if (acc < 1000/60 - 1) return;
  acc = Math.min(acc - 1000/60, 32);
  step(); render();
}
requestAnimationFrame(loop);
