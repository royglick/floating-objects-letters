/* ============================================================
   GROWN BY NUMBERS — the systems
   Six little engines, each one a law that nature actually runs.
   The point of this sketch is to READ them: every system below is
   a single self-contained function, and the page shows you its
   source (via .toString()) right next to the thing it draws. So
   the code on screen is never a copy — it IS the code that's
   running. Tune the knobs, break the math, watch it answer.

   Shared plumbing (canvas sizing, colour ramps, a noise field)
   lives at the top so the systems themselves stay pure. When you
   read a system's code and see fit2d() / ramp() / noise2(), those
   are the helpers right here.
   ============================================================ */

/* ---- tiny helpers -------------------------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hx = h => { h = h.replace('#', ''); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
const mix = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
const css = c => `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
/* walk a list of colour stops and pick the colour at 0..1 */
function ramp(stops, t){ t = clamp(t,0,1); const n = stops.length-1, f = t*n; let i = Math.floor(f); if (i>=n) i=n-1; return mix(stops[i], stops[i+1], f-i); }

const PHOS = hx('#74e6a6'), OCHRE = hx('#d8a24a'), DEEP = hx('#2ea56f');

/* size a canvas to its box, crisp on retina, and hand back a 2d ctx
   already scaled so we can draw in plain CSS pixels */
function fit2d(cv){
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  const W = Math.max(2, Math.round(r.width)), H = Math.max(2, Math.round(r.height));
  cv.width = W*dpr; cv.height = H*dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  return { W, H, dpr, ctx };
}

/* a pointer we can poke the systems with */
function pointer(cv){
  const p = { x:0, y:0, on:false };
  const rel = e => { const r = cv.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; p.x = t.clientX - r.left; p.y = t.clientY - r.top; };
  cv.addEventListener('pointerdown', e => { p.on = true; rel(e); });
  cv.addEventListener('pointermove', e => { if (p.on) rel(e); });
  cv.addEventListener('pointerup',   () => { p.on = false; });
  cv.addEventListener('pointerleave',() => { p.on = false; });
  return p;
}

/* classic Perlin value-noise in 2D — the raw material for the flow field */
const NP = (() => {
  const p = new Uint8Array(512), perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  return p;
})();
const fade = t => t*t*t*(t*(t*6-15)+10);
const mixn = (a, b, t) => a + (b-a)*t;
const grad = (h, x, y) => ((h&1) ? -x : x) + ((h&2) ? -y : y);
function noise2(x, y){
  const X = Math.floor(x)&255, Y = Math.floor(y)&255; x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y), A = NP[X]+Y, B = NP[X+1]+Y;
  return mixn(mixn(grad(NP[A],x,y),   grad(NP[B],x-1,y),   u),
             mixn(grad(NP[A+1],x,y-1), grad(NP[B+1],x-1,y-1), u), v);
}


/* ============================================================
   THE SIX SYSTEMS
   Each entry: a name, the governing equation, a paragraph, the
   knobs it exposes, and build() — the function the page displays
   and runs. build(canvas, P) returns { step, resize, reset? }.
   ============================================================ */
const SYSTEMS = [

/* 1 ─ PHYLLOTAXIS ─────────────────────────────────────────── */
{
  id: 'phyllotaxis',
  latin: 'Helianthus vogelii',
  common: 'Phyllotaxis · the seed head',
  eq: 'θ&#8341; = n · 137.507° r&#8341; = c·√n',
  blurb: `A sunflower places each new floret one fixed turn from the last — 137.5°, the "golden angle." That number is the most stubbornly irrational turn there is, so no two seeds ever fall on the same ray and the head packs tight with no gaps and no wasted light. There is no plan and no counter; the flower just repeats one rule and optimal packing falls out for free. This is the cleanest case for the whole show: a form we read as pure nature is, underneath, a two-line formula. Slide the angle a hair off 137.5° and the hidden spiral arms leap into view — the order was always arithmetic.`,
  knobs: [
    { k:'angle',  l:'angle°', min:130, max:145,  step:0.01, v:137.507, f:v=>v.toFixed(2) },
    { k:'count',  l:'seeds',  min:200, max:2400, step:10,   v:1200,    f:v=>v|0 },
    { k:'spread', l:'spread', min:4,   max:16,   step:0.1,  v:9,       f:v=>v.toFixed(1) },
    { k:'dot',    l:'size',   min:0.6, max:4,    step:0.1,  v:1.8,     f:v=>v.toFixed(1) },
  ],
  build: function phyllotaxis(cv, P){
    // Vogel's model. Seed n sits at angle n·137.5° and radius c·√n.
    // √n keeps every ring the same area, so the dots stay evenly dense
    // from core to rim. The golden angle is what stops them lining up.
    let s = fit2d(cv), t = 0;
    const RAMP = [hx('#0c3f2b'), DEEP, PHOS, hx('#eafff3')];
    return {
      resize(){ s = fit2d(cv); },
      step(){
        const { ctx, W, H } = s, cx = W/2, cy = H/2;
        const n = P.count|0, ga = P.angle*Math.PI/180, c = P.spread;
        ctx.clearRect(0, 0, W, H);
        t += 0.0016;                                  // a slow drift, so it breathes
        for (let i = 0; i < n; i++){
          const r = c*Math.sqrt(i), a = i*ga + t;
          const x = cx + r*Math.cos(a), y = cy + r*Math.sin(a);
          if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;
          const f = i/n;                              // 0 at the core, 1 at the rim
          ctx.fillStyle = css(ramp(RAMP, 0.15 + f*0.85));
          ctx.beginPath(); ctx.arc(x, y, P.dot*(0.35 + f*1.1), 0, 6.2832); ctx.fill();
        }
      }
    };
  }
},

/* 2 ─ FLOCKING / BOIDS ────────────────────────────────────── */
{
  id: 'boids',
  latin: 'Sturnus reynoldsii',
  common: 'Flocking · boids',
  eq: 'v += w&#8347;·separate + w&#8336;·align + w&#8339;·cohere',
  blurb: `A murmuration of starlings looks choreographed, but no bird is following orders and none can see the whole. Craig Reynolds showed in 1986 that three purely local rules are enough: don't crowd your neighbours, steer roughly the way they steer, and drift toward their centre. Run that on a few hundred bodies and a single fluid super-organism appears — order with no author. It's the founding example of emergence, and the same math now flies drone light-shows and moves crowds in films. Drag on the canvas to play predator and watch the flock tear open and heal around your hand.`,
  knobs: [
    { k:'sep', l:'separate', min:0,  max:3,  step:0.05, v:1.5, f:v=>v.toFixed(2) },
    { k:'ali', l:'align',    min:0,  max:3,  step:0.05, v:1.1, f:v=>v.toFixed(2) },
    { k:'coh', l:'cohere',   min:0,  max:3,  step:0.05, v:1.0, f:v=>v.toFixed(2) },
    { k:'n',   l:'birds',    min:40, max:260,step:5,    v:170, f:v=>v|0 },
    { k:'vis', l:'vision',   min:20, max:90, step:1,    v:48,  f:v=>v|0 },
  ],
  build: function boids(cv, P){
    let s = fit2d(cv);
    const ptr = pointer(cv);
    const B = [];
    for (let i = 0; i < 260; i++){ const a = Math.random()*6.283; B.push({ x:Math.random()*s.W, y:Math.random()*s.H, vx:Math.cos(a), vy:Math.sin(a) }); }
    return {
      resize(){ s = fit2d(cv); },
      step(){
        const { ctx, W, H } = s;
        const n = P.n|0, vis2 = P.vis*P.vis, sep2 = (P.vis*0.5)**2, maxS = 2.6;
        // faint trail instead of a hard clear — the flock leaves streaks
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(6,11,9,0.30)'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++){
          const b = B[i];
          let sx=0, sy=0, ax=0, ay=0, cx=0, cy=0, cnt=0, scnt=0;
          for (let j = 0; j < n; j++){                 // look at everyone in view
            if (i === j) continue;
            const o = B[j], dx = b.x-o.x, dy = b.y-o.y, d = dx*dx + dy*dy;
            if (d < vis2 && d > 0){
              ax += o.vx; ay += o.vy; cx += o.x; cy += o.y; cnt++;   // align + cohere
              if (d < sep2){ const inv = 1/Math.sqrt(d); sx += dx*inv; sy += dy*inv; scnt++; } // separate
            }
          }
          if (cnt){ ax/=cnt; ay/=cnt; cx = cx/cnt - b.x; cy = cy/cnt - b.y; }
          if (scnt){ sx/=scnt; sy/=scnt; }
          b.vx += sx*P.sep*0.08 + ax*P.ali*0.05 + cx*P.coh*0.0009;
          b.vy += sy*P.sep*0.08 + ay*P.ali*0.05 + cy*P.coh*0.0009;
          if (ptr.on){                                  // the predator: flee the cursor
            const dx = b.x-ptr.x, dy = b.y-ptr.y, d = Math.hypot(dx, dy);
            if (d < 130){ b.vx += dx/d*0.9; b.vy += dy/d*0.9; }
          }
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > maxS){ b.vx = b.vx/sp*maxS; b.vy = b.vy/sp*maxS; }
          b.x += b.vx; b.y += b.vy;                      // wrap around the edges
          if (b.x < 0) b.x += W; if (b.x > W) b.x -= W;
          if (b.y < 0) b.y += H; if (b.y > H) b.y -= H;
          ctx.strokeStyle = css(ramp([DEEP, PHOS, hx('#daffe9')], clamp(sp/maxS,0,1)));
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx*3.2, b.y - b.vy*3.2); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }
},

/* 3 ─ REACTION–DIFFUSION (Gray–Scott) ─────────────────────── */
{
  id: 'reaction',
  latin: 'Chromatophora turingii',
  common: 'Reaction–diffusion · Turing patterns',
  eq: '∂a/∂t = D&#8336;∇²a − ab² + f(1−a) ∂b/∂t = D&#8342;∇²b + ab² − (k+f)b',
  blurb: `Two chemicals, one that spreads slowly and one that spreads fast, feeding on and consuming each other — that's the whole recipe, and out of it come leopard spots, zebra stripes, coral, seashells, the ridges of a fingerprint. What makes this the heart of the piece is who wrote it: Alan Turing, the man who laid the foundations of the computer, published these equations in 1952 to explain how an animal gets its markings. The inventor of the machine wrote the chemistry of the wild skin. Two lines of math, a lifetime of camouflage. Drag on the canvas to inject new growth, or flip presets to travel from spots to worms to coral.`,
  presets: [
    { n:'coral',   f:0.0545, k:0.062 },
    { n:'mitosis', f:0.0367, k:0.0649 },
    { n:'worms',   f:0.058,  k:0.065 },
    { n:'spots',   f:0.030,  k:0.062 },
    { n:'maze',    f:0.029,  k:0.057 },
  ],
  knobs: [
    { k:'f', l:'feed', min:0.01, max:0.09, step:0.0005, v:0.0545, f:v=>v.toFixed(4) },
    { k:'k', l:'kill', min:0.04, max:0.07, step:0.0005, v:0.062,  f:v=>v.toFixed(4) },
  ],
  warmup: true,
  build: function reactionDiffusion(cv, P){
    // A coarse grid of two chemicals A and B. Each step every cell
    // diffuses toward its neighbours (the ∇² Laplacian) and reacts:
    // the reaction A + 2B -> 3B eats A and breeds B. Feed f tops A up,
    // kill k removes B. The balance of f and k decides spots vs stripes.
    const GW = 190, GH = 120;
    let A = new Float32Array(GW*GH), B = new Float32Array(GW*GH);
    let A2 = new Float32Array(GW*GH), B2 = new Float32Array(GW*GH);
    const off = document.createElement('canvas'); off.width = GW; off.height = GH;
    const octx = off.getContext('2d'), img = octx.createImageData(GW, GH);
    const ptr = pointer(cv);
    let s = fit2d(cv);
    const RAMP = [hx('#04120c'), hx('#0c3f2b'), DEEP, PHOS, hx('#f0fff6')];
    function seed(gx, gy){                              // drop a blob of B
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++){
        const xx = gx+x, yy = gy+y;
        if (xx>=0 && xx<GW && yy>=0 && yy<GH) B[yy*GW+xx] = 1;
      }
    }
    function reset(){ A.fill(1); B.fill(0); for (let i=0;i<12;i++) seed(Math.random()*GW|0, Math.random()*GH|0); }
    reset();
    function iter(){
      const Da = 1, Db = 0.5, f = P.f, k = P.k;
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++){
        const i = y*GW+x;
        const xm=(x-1+GW)%GW, xp=(x+1)%GW, ym=(y-1+GH)%GH, yp=(y+1)%GH;   // wrap (toroidal)
        const la = A[y*GW+xm]+A[y*GW+xp]+A[ym*GW+x]+A[yp*GW+x]
                 + 0.5*(A[ym*GW+xm]+A[ym*GW+xp]+A[yp*GW+xm]+A[yp*GW+xp]) - 6*A[i];
        const lb = B[y*GW+xm]+B[y*GW+xp]+B[ym*GW+x]+B[yp*GW+x]
                 + 0.5*(B[ym*GW+xm]+B[ym*GW+xp]+B[yp*GW+xm]+B[yp*GW+xp]) - 6*B[i];
        const a = A[i], b = B[i], abb = a*b*b;
        A2[i] = a + (Da*la*0.14 - abb + f*(1-a));
        B2[i] = b + (Db*lb*0.14 + abb - (k+f)*b);
      }
      [A, A2] = [A2, A]; [B, B2] = [B2, B];             // swap buffers
    }
    return {
      resize(){ s = fit2d(cv); },
      reset,
      step(){
        if (ptr.on) seed(ptr.x/s.W*GW|0, ptr.y/s.H*GH|0);
        for (let it = 0; it < 8; it++) iter();           // several sim steps per frame
        const d = img.data;
        for (let i = 0; i < A.length; i++){
          const c = ramp(RAMP, 1 - clamp(A[i]-B[i], 0, 1)), j = i*4;
          d[j]=c[0]; d[j+1]=c[1]; d[j+2]=c[2]; d[j+3]=255;
        }
        octx.putImageData(img, 0, 0);
        s.ctx.imageSmoothingEnabled = true;
        s.ctx.drawImage(off, 0, 0, s.W, s.H);            // blow the little grid up to size
      }
    };
  }
},

/* 4 ─ DIFFERENTIAL GROWTH ─────────────────────────────────── */
{
  id: 'growth',
  latin: 'Gyrus corallinus',
  common: 'Differential growth · the fold',
  eq: 'p&#8346; += a·(neighbours) − r·Σ near split edge if |e| > L',
  blurb: `Give a line two urges — stay close to your neighbours, but push away from anything crowding you — and let it grow new points wherever it stretches. Because it keeps adding length into a space that isn't getting bigger, it has no choice but to buckle, and it folds into the exact convolutions of coral, of kale's frilled edge, of the cortex of your own brain. It's growth under constraint, and it's the most tactile system here: elastic, restless, alive. This is my pick for feel — and the tech statement writes itself if you cage the organic line inside a rigid grid and watch the living thing press against the machine. Drag to poke the tissue and it recoils.`,
  knobs: [
    { k:'att',  l:'attract', min:0.05, max:0.6, step:0.01, v:0.28, f:v=>v.toFixed(2) },
    { k:'rep',  l:'repel r', min:8,    max:30,  step:0.5,  v:16,   f:v=>v.toFixed(1) },
    { k:'grow', l:'growth',  min:2,    max:12,  step:0.5,  v:7,    f:v=>v.toFixed(1) },
    { k:'max',  l:'max pts', min:120,  max:520, step:10,   v:420,  f:v=>v|0 },
  ],
  warmup: true,
  build: function differentialGrowth(cv, P){
    let s = fit2d(cv);
    const ptr = pointer(cv);
    let N = [];
    function reset(){                                    // start as a small ring
      N = []; const cx = s.W/2, cy = s.H/2, r = 26, m = 34;
      for (let i = 0; i < m; i++){ const a = i/m*6.283; N.push({ x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r }); }
    }
    reset();
    return {
      resize(){ s = fit2d(cv); },
      reset,
      step(){
        const { ctx, W, H } = s, n = N.length, R = P.rep, R2 = R*R, att = P.att;
        for (let i = 0; i < n; i++){
          const a = N[i], pr = N[(i-1+n)%n], nx = N[(i+1)%n];
          let fx = ((pr.x+nx.x)*0.5 - a.x)*att, fy = ((pr.y+nx.y)*0.5 - a.y)*att; // pull toward neighbours
          for (let j = 0; j < n; j++){                   // push off anyone too close
            if (j === i) continue;
            const o = N[j], dx = a.x-o.x, dy = a.y-o.y, d2 = dx*dx+dy*dy;
            if (d2 < R2 && d2 > 0.01){ const d = Math.sqrt(d2), w = (1 - d/R)*1.1; fx += dx/d*w; fy += dy/d*w; }
          }
          if (ptr.on){                                   // your finger shoves it away
            const dx = a.x-ptr.x, dy = a.y-ptr.y, d = Math.hypot(dx, dy);
            if (d < 70 && d > 0.1){ fx += dx/d*(1-d/70)*6; fy += dy/d*(1-d/70)*6; }
          }
          a.x = clamp(a.x+fx, 6, W-6); a.y = clamp(a.y+fy, 6, H-6);
        }
        if (N.length < P.max){                           // grow: split any edge that stretched too far
          for (let i = 0; i < N.length; i++){
            const a = N[i], b = N[(i+1)%N.length];
            if (Math.hypot(a.x-b.x, a.y-b.y) > P.grow){ N.splice(i+1, 0, { x:(a.x+b.x)/2, y:(a.y+b.y)/2 }); i++; }
          }
        }
        ctx.clearRect(0, 0, W, H);
        ctx.lineJoin = 'round'; ctx.lineWidth = 1.6; ctx.strokeStyle = css(PHOS);
        ctx.shadowColor = 'rgba(46,165,111,.6)'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(N[0].x, N[0].y);
        for (let i = 1; i < N.length; i++) ctx.lineTo(N[i].x, N[i].y);
        ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0;
      }
    };
  }
},

/* 5 ─ CURL-NOISE FLOW ─────────────────────────────────────── */
{
  id: 'curl',
  latin: 'Fluidus perlinii',
  common: 'Curl noise · the current',
  eq: 'v = ( ∂ψ/∂y , −∂ψ/∂x ), ψ = noise(x, y, t)',
  blurb: `Random noise on its own is a mess of hills and pits. But take its curl — swap the two partial derivatives and flip one sign — and something beautiful happens: the field becomes divergence-free, meaning nothing is ever created or destroyed, exactly the condition a real incompressible fluid obeys. Drop particles into it and they swirl like smoke, like wind over a field, like the undertow beneath a flock. It's the tech-to-nature direction of the whole theme running backward: pure computed randomness, shaped by one derivative into something that moves like water. Drag to stir the current with your own vortex.`,
  knobs: [
    { k:'scale', l:'scale',     min:1,    max:8,    step:0.1,   v:3,   f:v=>v.toFixed(1) },
    { k:'speed', l:'speed',     min:0.2,  max:3,    step:0.05,  v:1.1, f:v=>v.toFixed(2) },
    { k:'n',     l:'particles', min:200,  max:1600, step:50,    v:900, f:v=>v|0 },
    { k:'trail', l:'trail',     min:0.02, max:0.25, step:0.005, v:0.06,f:v=>v.toFixed(3) },
  ],
  build: function curlNoise(cv, P){
    let s = fit2d(cv);
    const ptr = pointer(cv);
    const Pt = [];
    for (let i = 0; i < 1600; i++) Pt.push({ x:Math.random()*s.W, y:Math.random()*s.H, life:Math.random()*200 });
    let t = 0;
    // ψ (the "potential"): noise sampled at two scales, drifting with time
    const pot = (x, y, sc, z) => noise2(x*sc+z, y*sc) + 0.5*noise2(x*sc*2.1, y*sc*2.1 - z);
    return {
      resize(){ s = fit2d(cv); },
      step(){
        const { ctx, W, H } = s, n = P.n|0, sc = P.scale/900, z = t, e = 1.2;
        t += 0.004*P.speed;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(6,11,9,'+P.trail+')'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++){
          const p = Pt[i];
          // velocity = curl of ψ  =  ( ∂ψ/∂y , −∂ψ/∂x ), by finite difference
          const vx =  (pot(p.x, p.y+e, sc, z) - pot(p.x, p.y-e, sc, z)) / (2*e);
          const vy = -(pot(p.x+e, p.y, sc, z) - pot(p.x-e, p.y, sc, z)) / (2*e);
          let dx = vx*260*P.speed, dy = vy*260*P.speed;
          if (ptr.on){                                   // add a swirl around the cursor
            const ddx = p.x-ptr.x, ddy = p.y-ptr.y, d = Math.hypot(ddx, ddy);
            if (d < 120){ dx += -ddy/d*2.4*(1-d/120); dy += ddx/d*2.4*(1-d/120); }
          }
          const ox = p.x, oy = p.y; p.x += dx; p.y += dy; p.life--;
          if (p.x<0 || p.x>W || p.y<0 || p.y>H || p.life<0){   // respawn drifters
            p.x = Math.random()*W; p.y = Math.random()*H; p.life = 120 + Math.random()*160; continue;
          }
          ctx.strokeStyle = css(ramp([DEEP, PHOS, OCHRE], clamp(Math.hypot(dx,dy)/2.4,0,1)*0.9));
          ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
    };
  }
},

/* 6 ─ VORONOI ─────────────────────────────────────────────── */
{
  id: 'voronoi',
  latin: 'Tessella giraffae',
  common: 'Voronoi · the cells',
  eq: 'cell(p) = { x : |x − p| ≤ |x − q|  ∀ q }',
  blurb: `Scatter a handful of seeds and give every point in the plane to whichever seed is nearest — that single rule carves space into cells, and it's how nature divides almost everything: a giraffe's coat, dragonfly wings, cracked mud, soap foam, the panels of a turtle's shell. It's the oldest law of territory, older than any equation, and yet it's also a data structure we independently re-invented for maps, mesh generation and cell-tower coverage. Nature and engineering arriving at the identical answer from opposite ends. Drag to steer one cell and watch its borders renegotiate with the rest.`,
  knobs: [
    { k:'n',      l:'cells',  min:6, max:26, step:1,   v:15, f:v=>v|0 },
    { k:'motion', l:'drift',  min:0, max:2,  step:0.05,v:0.6,f:v=>v.toFixed(2) },
    { k:'edge',   l:'cracks', min:0, max:8,  step:0.2, v:3,  f:v=>v.toFixed(1) },
  ],
  build: function voronoi(cv, P){
    const BW = 170, BH = 110;                            // compute cheap on a small grid, blow it up
    const off = document.createElement('canvas'); off.width = BW; off.height = BH;
    const octx = off.getContext('2d'), img = octx.createImageData(BW, BH);
    let s = fit2d(cv);
    const ptr = pointer(cv);
    const seeds = [];
    for (let i = 0; i < 26; i++) seeds.push({
      x:Math.random()*BW, y:Math.random()*BH, vx:Math.random()-0.5, vy:Math.random()-0.5,
      tint: ramp([hx('#0e3a29'), DEEP, OCHRE, hx('#e8d9a6')], i/25)
    });
    return {
      resize(){ s = fit2d(cv); },
      step(){
        const { ctx, W, H } = s, n = P.n|0, edge = P.edge;
        for (let i = 0; i < n; i++){                      // drift the seeds, bounce off walls
          const sd = seeds[i]; sd.x += sd.vx*P.motion*0.4; sd.y += sd.vy*P.motion*0.4;
          if (sd.x<0 || sd.x>BW) sd.vx *= -1; if (sd.y<0 || sd.y>BH) sd.vy *= -1;
          sd.x = clamp(sd.x,0,BW); sd.y = clamp(sd.y,0,BH);
        }
        if (ptr.on){ seeds[0].x = clamp(ptr.x/W*BW,0,BW); seeds[0].y = clamp(ptr.y/H*BH,0,BH); }
        const d = img.data;
        for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++){
          let d1 = 1e9, d2 = 1e9, best = 0;              // nearest and second-nearest seed
          for (let i = 0; i < n; i++){
            const dx = x-seeds[i].x, dy = y-seeds[i].y, dd = dx*dx+dy*dy;
            if (dd < d1){ d2 = d1; d1 = dd; best = i; } else if (dd < d2) d2 = dd;
          }
          const c = seeds[best].tint;
          const shade = clamp(1 - Math.sqrt(d1)/60, 0.35, 1);          // dome each cell
          const border = (Math.sqrt(d2)-Math.sqrt(d1)) < edge ? 0.18 : 1; // dark seam at boundaries
          const m = shade*border, j = (y*BW+x)*4;
          d[j]=c[0]*m; d[j+1]=c[1]*m; d[j+2]=c[2]*m; d[j+3]=255;
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H);
      }
    };
  }
},

];
