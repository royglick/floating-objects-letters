/* anemone words
   ------------------------------------------------------------
   A word planted on the sea floor, seen straight from above.
   Each glyph of a single-stroke font (Hershey futural,
   lib/strokefont.js) is inflated to a BOLD letter — a thick band
   around its pen strokes — and the band is filled with tentacles
   of REAL physics (Rapier): every tentacle is a chain of capsule
   rigid bodies linked by ball joints, anchored to the floor. The
   trick that makes it kelp instead of rope: GRAVITY POINTS UP —
   net buoyancy — so standing upright is the stable state and
   every disturbance sways back on its own. And tentacles COLLIDE:
   gather them with a press and they bunch and shove instead of
   passing through each other.

   The camera is a trick: perspective WITHIN each letter, parallel
   ACROSS letters. Every letter projects around its own vanishing
   point — as if it stood directly under the camera — so each one
   blooms straight up and splays like its own small anemone, and a
   long word never fans its outer letters sideways. A tentacle is
   a stack of circles at rising heights; points nearer the camera
   project bigger and further from their letter's center.

   Brush to stir, press to gather, double-click to replant.
   Type to plant new words.
   ------------------------------------------------------------ */

import RAPIER from "./lib/rapier.mjs";
await RAPIER.init({});

const DEFAULT_TEXT="B";

/* ---- knobs (buoyancy/drag live; height replants) */
let H=85;                  // tentacle height (world units) — a short dense
                           // pile, fur rather than kelp forest
let BUOY=220;              // upward gravity — how hard the pile rights itself
let DRAG=2.6;              // linear damping — the thickness of the water
let R=0.1;                 // strand radius (0.1–1 knob) — hair-thin
const SPACING=4;           // guide grid pitch — always the densest planting
                           // the body budget allows (it widens itself when
                           // a longer text would blow past MAX_STALKS)
const BOLD=30;             // letter weight (band width around strokes)
const FLOW=2;              // the unified background drift — a whisper; the
                           // visible life of the water is the GUSTS below
/* gusts: brief local currents that touch the fur at random spots — a
   few alive at once, each swelling in and fading out, pushing only what
   sits inside its radius. Subtle by construction: peak push is small
   against BUOY, and the gaussian edge means no seams. */
const GUST_MAX=3;          // gusts alive at once
const GUST_AMP=16;         // peak push (units/s²) — vs BUOY 220: a nudge
const GUST_RAD=[30,80];    // radius range (world units)
const GUST_DUR=[0.9,2.2];  // lifetime range (s)
const GUST_GAP=[0.6,2.4];  // pause between spawns (s)

const D=900;               // camera height above the floor
const SEG=8;               // rigid segments per tentacle — short stalks
                           // need fewer joints, buying a bigger stalk budget
const SUB=3;               // drawn sub-steps per spline span — the curve is
                           // already smooth (Catmull-Rom) and the shading
                           // dither hides banding; more buys nothing visible
const MAX_STALKS=1500;      // body budget: MAX_STALKS×SEG bodies+joints
const HAIRS=10;             // strands per guide AT REF_SPACING — the density
                           // is visual: guides are simulated, hair clumps
                           // ride them (how film hair works: guide + render)
const REF_SPACING=5.5;     // the guide spacing HAIRS was tuned at. When the
                           // body budget widens spacing for a longer text,
                           // strands-per-guide grow as spacing² so HAIR
                           // DENSITY STAYS CONSTANT — more letters no longer
                           // means balder letters
const TOTAL_STRANDS=5000;  // draw budget — the one ceiling density can hit
const HAIR_SPREAD=0.6;     // clumps fan apart toward the tip (× offset)
const BRUSH_SIG=45;        // brush falloff (screen px)
const BRUSH_DV=42;         // brush: velocity handed to a segment (units/s)
const GRAB_SIG=70;         // press falloff (screen px)
const GRAB_A=520;          // press attraction (units/s²)
const STIFF=6;             // bending stiffness: righting spin toward
                           // vertical (1/s per radian of tilt) — without
                           // it, dense rows comb over and jam on each
                           // other like thatch instead of standing back up
const CAP=21, EM=90, LINE_GAP=0.4;

const canvas=document.getElementById("stage");
const ctx=canvas.getContext("2d");
const textbox=document.getElementById("textbox");
let cw=0,ch=0,dpr=1;
const bloom4=document.createElement("canvas"), b4=bloom4.getContext("2d");
const bloom8=document.createElement("canvas"), b8=bloom8.getContext("2d");

/* ---- text → tentacle bases filling BOLD letters ----------------
   Each glyph's pen strokes are inflated to a band BOLD wide — the
   bold letter — and the band is filled with a lightly jittered hex
   grid: letters are volumes of seaweed, not outlines. A grid point
   is planted when it sits within BOLD/2 of any stroke segment;
   crossings can't double-plant thanks to a min-distance check. */
function planBases(text,spacing){
  const linesTxt=text.split("\n").map(l=>l.trimEnd()).filter(l=>l.trim().length);
  const bases=[];
  if(!linesTxt.length) return bases;
  const k=EM/CAP;
  const lineH=EM*(1+LINE_GAP);
  const totalD=linesTxt.length*EM+(linesTxt.length-1)*EM*LINE_GAP;
  const glyph=ch=>STROKE_FONT[ch]||STROKE_FONT["?"];
  const widths=linesTxt.map(l=>[...l].reduce((s,ch)=>s+glyph(ch).w,0)*k);
  const half=BOLD/2, half2=half*half;
  const rowH=spacing*0.866;
  const minD2=(spacing*0.55)**2;
  let lcx=0, lcz=0;                    // current glyph's center — each
  const plant=(x,z)=>{                 // stalk remembers its letter's
    for(const b of bases){             // own vanishing point
      const dx=b.x-x, dz=b.z-z;
      if(dx*dx+dz*dz<minD2) return;
    }
    bases.push({x,z,lcx,lcz});
  };
  const dist2=(px,pz,s)=>{
    const dx=s[2]-s[0], dz=s[3]-s[1];
    const L2=dx*dx+dz*dz;
    let t=L2>0?((px-s[0])*dx+(pz-s[1])*dz)/L2:0;
    t=t<0?0:t>1?1:t;
    const qx=s[0]+dx*t-px, qz=s[1]+dz*t-pz;
    return qx*qx+qz*qz;
  };
  linesTxt.forEach((line,li)=>{
    let penX=-widths[li]/2;
    const zTop=-totalD/2+li*lineH;
    for(const ch of line){
      const g=glyph(ch);
      lcx=penX+g.w*k/2;
      lcz=zTop+EM/2;
      const segs=[];
      let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
      for(const poly of g.p){
        const pts=poly.map(([px,py])=>[penX+px*k, zTop+(py-1)*k]);
        for(const [x,z] of pts){
          if(x<x0)x0=x; if(x>x1)x1=x;
          if(z<z0)z0=z; if(z>z1)z1=z;
        }
        for(let s=0;s<pts.length-1;s++)
          segs.push([pts[s][0],pts[s][1],pts[s+1][0],pts[s+1][1]]);
        if(pts.length===1)
          segs.push([pts[0][0],pts[0][1],pts[0][0],pts[0][1]]);
      }
      for(let z=z0-half,row=0; segs.length&&z<=z1+half; z+=rowH,row++){
        for(let x=x0-half+(row%2)*spacing/2; x<=x1+half; x+=spacing){
          const jx=x+(Math.random()-0.5)*spacing*0.25;
          const jz=z+(Math.random()-0.5)*spacing*0.25;
          for(const s of segs)
            if(dist2(jx,jz,s)<=half2){ plant(jx,jz); break; }
        }
      }
      penX+=g.w*k;
    }
  });
  return bases;
}

/* ---- the kelp forest ------------------------------------------
   One fixed anchor in the floor per stalk, then SEG dynamic
   capsules chained upward with ball joints. Joints disable
   contacts between linked neighbors; everything else collides. */
let world=null, stalks=[], f=60, tClock=0, segLen=H/SEG, angDampScale=1;
let gusts=[], nextGust=0.8;
const gAct=[null,null,null];   // per-stalk in-range gusts (reused, no allocs)

function build(text){
  if(world){ world.free(); world=null; }
  world=new RAPIER.World({x:0,y:BUOY,z:0});
  world.timestep=1/60;
  // solver error budget is set from the vertebra size once it's known
  // (below) — a fixed value reads as visible trembling on tiny segments

  // count grows with AREA, so overshoot shrinks with spacing²; strand
  // width stays as set — the hair clumps carry the density instead
  let spacing=SPACING;
  let bases=planBases(text,spacing);
  for(let tries=0; bases.length>MAX_STALKS&&tries<3; tries++){
    spacing*=Math.sqrt(bases.length/MAX_STALKS)*1.03;
    bases=planBases(text,spacing);
  }

  // constant hair density: strands per guide track the built spacing²
  // (each guide covers that much more floor), capped by the draw budget
  const hairN=Math.max(2,Math.min(
    Math.round(HAIRS*(spacing/REF_SPACING)**2),
    Math.floor(TOTAL_STRANDS/Math.max(1,bases.length))));

  segLen=H/SEG;
  world.lengthUnit=Math.max(1,Math.min(10,segLen/2));
  // short vertebrae ring at a higher frequency — keep the damping RATIO
  // constant by scaling angular damping with 1/√segLen (11 ≈ the segLen
  // this feel was tuned at)
  angDampScale=Math.min(2.5,Math.max(0.7,Math.sqrt(11/segLen)));
  // collider sizes are FULLY proportional — to the built spacing (dense
  // plantings get slimmer bodies so neighbors keep clearance) and to the
  // segment length. Absolute minimums here once made colliders LONGER
  // than the joint spacing at low heights: segments two apart in a stalk
  // sat with no air, and the touch→shove→right-again cycle read as
  // shaking. Proportional floors keep air at every height.
  const colR=Math.max(0.3,Math.min(3.2, spacing*0.16, segLen*0.2));
  // capsule caps add colR beyond hh — leave a 2·colR air gap at each
  // joint so consecutive segments never interpenetrate at the hinge
  const hh=Math.max(segLen*0.15,segLen/2-colR*2);
  stalks=bases.map(b=>{
    // a whisper of lean so the forest never stands in perfect unison —
    // bounded so no tip is born touching a neighbor's stalk
    const la=Math.random()*Math.PI*2;
    const lm=Math.random()*Math.min(0.008, spacing*0.25/H);
    const lx=Math.cos(la)*lm, lz=Math.sin(la)*lm;
    const anchor=world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(b.x,0,b.z));
    const bodies=[];
    let below=anchor;
    for(let i=0;i<SEG;i++){
      const y=(i+0.5)*segLen;
      const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.x+lx*y, y, b.z+lz*y)
        .setLinearDamping(DRAG)
        .setAngularDamping(DRAG*0.8*angDampScale));
      world.createCollider(
        RAPIER.ColliderDesc.capsule(hh,colR).setFriction(0).setRestitution(0),
        body);
      // ball joint: this segment's foot to the top of whatever is below
      const jd=RAPIER.JointData.spherical(
        i===0?{x:0,y:0,z:0}:{x:0,y:segLen/2,z:0},
        {x:0,y:-segLen/2,z:0});
      jd.contactsEnabled=false;      // linked segments must not collide
      world.createImpulseJoint(jd, below, body, true);
      bodies.push(body);
      below=body;
    }
    // the clump: fixed offsets around the guide, each strand its own length
    const hairs=[];
    for(let h=0;h<hairN;h++){
      const hr=spacing*0.45*Math.sqrt(Math.random());
      const ha=Math.random()*Math.PI*2;
      hairs.push({hx:Math.cos(ha)*hr, hz:Math.sin(ha)*hr,
                  lf:Math.min(1,0.8+0.25*Math.random()),
                  // fixed per-strand shade offset (in buckets): neighbors
                  // never band in sync, so quantization dissolves into the
                  // tonal variation real fur has anyway
                  bShift:Math.round((Math.random()-0.5)*8)});
    }
    return {bx:b.x, bz:b.z, lcx:b.lcx, lcz:b.lcz,
            bodies, hairs, phase:Math.random()*0.7};
  });
  tClock=0;
  gusts=[]; nextGust=0.8;
  refit();
}

/* letter centers sit at a fixed mid-height scale; only the offsets
   from a letter's center get true perspective */
const midScale=()=>1/(D-H*0.55);
function refit(){
  const sway=H*0.14+BOLD/2+R*2;
  const sM=midScale(), sT=1/(D-H);      // per unit of f
  let qx=60*sT, qz=60*sT;
  for(const s of stalks){
    qx=Math.max(qx, Math.abs(s.lcx)*sM+(Math.abs(s.bx-s.lcx)+sway)*sT);
    qz=Math.max(qz, Math.abs(s.lcz)*sM+(Math.abs(s.bz-s.lcz)+sway)*sT);
  }
  f=Math.min((cw/2*0.92)/qx, (ch/2*0.90)/qz);
}

/* the body's up-axis in world (its quaternion applied to (0,1,0)) */
const upOf=q=>({x:2*(q.x*q.y-q.w*q.z),
                y:1-2*(q.x*q.x+q.z*q.z),
                z:2*(q.y*q.z+q.w*q.x)});

/* ---- pointer ---------------------------------------------------- */
let mx=0,my=0,pxl=null,pyl=null,pressed=false,inside=false;
let brushX=0,brushY=0;     // pointer motion since the last frame — events
                           // only accumulate; the impulse pass runs once per
                           // frame, so a 240Hz mouse costs the same as 60Hz
canvas.addEventListener("pointermove",e=>{
  mx=e.clientX; my=e.clientY; inside=true;
  if(pxl!==null&&!pressed){ brushX+=mx-pxl; brushY+=my-pyl; }
  pxl=mx; pyl=my;
});
canvas.addEventListener("pointerdown",e=>{
  pressed=true; inside=true;
  mx=e.clientX; my=e.clientY; pxl=mx; pyl=my;
  canvas.setPointerCapture(e.pointerId);
});
const release=()=>{ pressed=false; };
canvas.addEventListener("pointerup",release);
canvas.addEventListener("pointercancel",release);
canvas.addEventListener("pointerleave",()=>{ inside=false; pxl=null; });
canvas.addEventListener("dblclick",()=>build(textbox.value||DEFAULT_TEXT));

/* brushing: segments near the cursor inherit some of its motion */
function brush(dxPx,dyPx){
  if(!stalks.length) return;
  const cx=cw/2, cy=ch/2;
  const cut=(BRUSH_SIG*3)**2, sig2=2*BRUSH_SIG*BRUSH_SIG;
  const step=Math.hypot(dxPx,dyPx);
  if(step<1e-3) return;
  const sM=f*midScale();
  // a stalk whose BASE is further than the brush radius plus its own
  // projected reach can't have a segment in range — skip it whole
  const reach=(H+10)*f/(D-H);
  const rcut=(BRUSH_SIG*3+reach)**2;
  const sc0=f/D;
  for(const s of stalks){
    const bx0=cx+s.lcx*sM+(s.bx-s.lcx)*sc0;
    const by0=cy+s.lcz*sM+(s.bz-s.lcz)*sc0;
    if((bx0-mx)**2+(by0-my)**2>rcut) continue;
    for(const body of s.bodies){
      const tp=body.translation();
      const sc=f/(D-tp.y);
      const sx=cx+s.lcx*sM+(tp.x-s.lcx)*sc;
      const sy=cy+s.lcz*sM+(tp.z-s.lcz)*sc;
      const d2=(sx-mx)**2+(sy-my)**2;
      if(d2>cut) continue;
      const G=Math.exp(-d2/sig2)*(tp.y/H);
      // hand the segment a bounded velocity along the stroke
      const dv=Math.min(BRUSH_DV, step*2.2)*G;
      const m=body.mass();
      body.applyImpulse({x:dxPx/step*dv*m, y:0, z:dyPx/step*dv*m}, true);
    }
  }
}

/* ---- current + gather (forces as per-step impulses) -------------- */
function forces(dt){
  const cx=cw/2, cy=ch/2;
  const gCut=(GRAB_SIG*3)**2, gSig2=2*GRAB_SIG*GRAB_SIG;
  const grabbing=pressed&&inside;
  const sM=f*midScale();
  const t=tClock;
  // spawn/expire gusts — each lands near a random stalk, so touches
  // always happen ON the word, never in empty water
  if(t>=nextGust&&gusts.length<GUST_MAX&&stalks.length){
    const at=stalks[(Math.random()*stalks.length)|0];
    const ang=Math.random()*Math.PI*2;
    gusts.push({
      x:at.bx+(Math.random()-0.5)*40, z:at.bz+(Math.random()-0.5)*40,
      ux:Math.cos(ang), uz:Math.sin(ang),
      rad:GUST_RAD[0]+Math.random()*(GUST_RAD[1]-GUST_RAD[0]),
      t0:t, dur:GUST_DUR[0]+Math.random()*(GUST_DUR[1]-GUST_DUR[0]),
      amp:GUST_AMP*(0.5+Math.random()*0.5)});
    nextGust=t+GUST_GAP[0]+Math.random()*(GUST_GAP[1]-GUST_GAP[0]);
  }
  gusts=gusts.filter(g=>t-g.t0<g.dur);
  const live=gusts.map(g=>({
    x:g.x, z:g.z, ux:g.ux, uz:g.uz,
    // swell in, fade out (slightly quick attack — a touch, not a tide)
    s:g.amp*Math.pow(Math.sin(Math.PI*(t-g.t0)/g.dur),0.7),
    inv:1/(2*(g.rad*0.5)**2),
    cut2:(g.rad*1.5)**2,
    bcut2:(g.rad*1.5+H+20)**2}));      // stalk-level reject, from the base
  const reachG=(GRAB_SIG*3+(H+10)*f/(D-H))**2;
  const sc0=f/D;
  for(const s of stalks){
    // stalk-level culls: the base position decides what CAN matter for
    // every segment above it — whole stalks skip the per-body extras
    let gn=0;
    for(let q=0;q<live.length;q++){
      const g=live[q];
      const dx=s.bx-g.x, dz=s.bz-g.z;
      if(dx*dx+dz*dz<g.bcut2) gAct[gn++]=g;
    }
    let stalkGrab=false;
    if(grabbing){
      const bx0=cx+s.lcx*sM+(s.bx-s.lcx)*sc0;
      const by0=cy+s.lcz*sM+(s.bz-s.lcz)*sc0;
      stalkGrab=(bx0-mx)**2+(by0-my)**2<reachG;
    }
    for(const body of s.bodies){
      const tp=body.translation();
      const hf=Math.min(1,tp.y/H);
      const a=FLOW*Math.pow(hf,1.6);
      let ax=a*(Math.sin(t*0.12+s.bx*0.011+tp.y*0.005+s.phase)*0.8
              +Math.sin(t*0.05+s.bz*0.007-tp.y*0.004)*0.5);
      let az=a*(Math.cos(t*0.10+s.bz*0.011+tp.y*0.004+s.phase*1.7)*0.8
              +Math.cos(t*0.06+s.bx*0.006+tp.y*0.003)*0.5);
      for(let q=0;q<gn;q++){
        const g=gAct[q];
        const gdx=tp.x-g.x, gdz=tp.z-g.z;
        const gd2=gdx*gdx+gdz*gdz;
        if(gd2>g.cut2) continue;
        const w=g.s*Math.exp(-gd2*g.inv)*hf;
        ax+=g.ux*w; az+=g.uz*w;
      }
      if(stalkGrab){
        const sc=f/(D-tp.y);
        const sx=cx+s.lcx*sM+(tp.x-s.lcx)*sc;
        const sy=cy+s.lcz*sM+(tp.z-s.lcz)*sc;
        const d2=(sx-mx)**2+(sy-my)**2;
        if(d2<gCut){
          const G=Math.exp(-d2/gSig2)*hf*hf;
          // the pointer, unprojected through THIS letter's camera
          const wx=s.lcx+((mx-cx)-s.lcx*sM)/sc;
          const wz=s.lcz+((my-cy)-s.lcz*sM)/sc;
          ax+=Math.max(-GRAB_A,Math.min(GRAB_A,(wx-tp.x)*8))*G;
          az+=Math.max(-GRAB_A,Math.min(GRAB_A,(wz-tp.z)*8))*G;
        }
      }
      if(ax||az){
        const m=body.mass();
        body.applyImpulse({x:ax*m*dt, y:0, z:az*m*dt}, true);
      }
      // bending stiffness: spin each segment back toward vertical,
      // proportional to its tilt (|up×ŷ| = sin tilt); below ~1.8° the
      // correction is nil — resting fur skips the two WASM calls
      const up=upOf(body.rotation());
      if(up.y<0.9995){
        const av=body.angvel();
        body.setAngvel({x:av.x-up.z*STIFF*dt,
                        y:av.y,
                        z:av.z+up.x*STIFF*dt}, true);
      }
    }
  }
}

/* ---- render -------------------------------------------------------
   Each guide's polyline is sampled once, then every strand of its
   clump is that polyline shifted by the strand's offset (fanning
   apart toward the tip) and drawn as short round-capped stroke
   segments. Segments are bucketed by their TRUE altitude and
   painted floor-first (painter's algorithm) — a toppled tentacle
   correctly dims and slides under its neighbors. The shade climbs
   from near-black at the floor to white at full height. */
const BUCKETS=96;
const GPTS=SEG*SUB+1;                     // guide sub-points, incl. the root
const guide=new Float32Array(GPTS*3);    // reusable [x,y,z]× curve samples
const knots=new Float32Array((SEG+3)*3); // joint points + phantom ends
let bins=[];
function draw(){
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.globalCompositeOperation="source-over";
  ctx.globalAlpha=1;
  ctx.fillStyle="#000";
  ctx.fillRect(0,0,cw,ch);
  const cx=cw/2, cy=ch/2;
  if(bins.length!==BUCKETS) bins=Array.from({length:BUCKETS},()=>[]);
  else for(const b of bins) b.length=0;
  const sM=f*midScale();
  for(const s of stalks){
    // the guide curve: a Catmull-Rom spline THROUGH the joint points
    // (root + each segment's top end), sampled at SUB steps per span —
    // the strand bends smoothly where the physics has a hard elbow, so
    // the chain reads like several times its real joint count
    knots[3]=s.bx; knots[4]=0; knots[5]=s.bz;
    let ki=6;
    for(const body of s.bodies){
      const tp=body.translation(), up=upOf(body.rotation());
      knots[ki++]=tp.x+up.x*segLen/2;
      knots[ki++]=tp.y+up.y*segLen/2;
      knots[ki++]=tp.z+up.z*segLen/2;
    }
    for(let c=0;c<3;c++){                    // phantom ends by reflection —
      knots[c]=2*knots[3+c]-knots[6+c];      // natural tangents at root/tip
      knots[ki+c]=2*knots[ki-3+c]-knots[ki-6+c];
    }
    guide[0]=s.bx; guide[1]=0; guide[2]=s.bz;
    let gi=3;
    for(let i=0;i<SEG;i++){
      const b0=i*3, b1=b0+3, b2=b0+6, b3=b0+9;
      for(let k=1;k<=SUB;k++){
        const u=k/SUB;
        for(let c=0;c<3;c++){
          const p0=knots[b0+c], p1=knots[b1+c], p2=knots[b2+c], p3=knots[b3+c];
          guide[gi++]=p1+0.5*u*(p2-p0
            +u*(2*p0-5*p1+4*p2-p3
            +u*(3*(p1-p2)+p3-p0)));
        }
      }
    }
    for(const hair of s.hairs){
      const n=1+Math.round((GPTS-1)*hair.lf);
      // bins hold RUNS — [count, x0,y0, x1,y1, …] — consecutive segments
      // in the same bucket extend one polyline instead of each paying a
      // moveTo and repeating its start point
      let px=0, py=0, runBi=-1, runAt=-1;
      for(let i=0;i<n;i++){
        const x=guide[i*3], y=guide[i*3+1], z=guide[i*3+2];
        const spread=1+HAIR_SPREAD*(i/(GPTS-1));
        const sc=f/(D-y);
        const sx=cx+s.lcx*sM+(x+hair.hx*spread-s.lcx)*sc;
        const sy=cy+s.lcz*sM+(z+hair.hz*spread-s.lcz)*sc;
        if(i>0){
          const ym=(guide[i*3-2]+y)/2;
          const bi=Math.max(0,Math.min(BUCKETS-1,
            Math.floor(ym/(H*1.1)*BUCKETS)+hair.bShift));
          const bin=bins[bi];
          if(bi!==runBi){
            runBi=bi; runAt=bin.length;
            bin.push(2,px,py,sx,sy);
          }else{
            bin[runAt]++;
            bin.push(sx,sy);
          }
        }
        px=sx; py=sy;
      }
    }
  }
  ctx.lineCap="round";
  ctx.lineJoin="round";
  for(let bi=0;bi<BUCKETS;bi++){
    const pts=bins[bi];
    if(!pts.length) continue;
    const yMid=(bi+0.5)/BUCKETS*H*1.1;
    const c=Math.round(8+247*Math.pow(Math.min(1,yMid/H),1.7));
    ctx.strokeStyle=`rgb(${c},${c},${c})`;
    ctx.lineWidth=Math.max(0.3, 2*R*f/(D-yMid));
    ctx.beginPath();
    for(let i=0;i<pts.length;){
      const cnt=pts[i++];
      ctx.moveTo(pts[i],pts[i+1]);
      for(let j=1;j<cnt;j++) ctx.lineTo(pts[i+j*2],pts[i+j*2+1]);
      i+=cnt*2;
    }
    ctx.stroke();
  }
  // the glow: the frame, downsampled twice and added back on top —
  // bright tips bleed softly into the dark water
  if(bloom8.width>0&&bloom8.height>0){
    b4.drawImage(canvas,0,0,bloom4.width,bloom4.height);
    b8.drawImage(bloom4,0,0,bloom8.width,bloom8.height);
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation="lighter";
    ctx.globalAlpha=0.32;
    ctx.drawImage(bloom8,0,0,canvas.width,canvas.height);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation="source-over";
  }
}

/* ---- loop ------------------------------------------------------------ */
let prev=performance.now(), acc=0;
function loop(now){
  const dt=Math.min(0.05,(now-prev)/1000); prev=now;
  // the frame's coalesced pointer motion becomes one brush pass
  if((brushX||brushY)&&!pressed) brush(brushX,brushY);
  brushX=0; brushY=0;
  acc=Math.min(acc+dt,3/60);
  while(acc>=1/60){
    tClock+=1/60;
    forces(1/60);
    world.step();
    acc-=1/60;
  }
  draw();
  requestAnimationFrame(loop);
}

/* ---- textbox / knobs / boot ------------------------------------------- */
function growBox(){
  textbox.style.height="auto";
  textbox.style.height=textbox.scrollHeight+"px";
}
let rebuildTimer=null;
textbox.addEventListener("input",()=>{
  growBox();
  clearTimeout(rebuildTimer);
  rebuildTimer=setTimeout(()=>build(textbox.value||DEFAULT_TEXT),300);
});

const bindKnob=(id,apply,rebuild)=>{
  const el=document.getElementById("kn"+id);
  const out=document.getElementById("kv"+id);
  el.addEventListener("input",()=>{
    out.textContent=el.value;
    apply(parseFloat(el.value));
    if(rebuild){
      clearTimeout(rebuildTimer);
      rebuildTimer=setTimeout(()=>build(textbox.value||DEFAULT_TEXT),150);
    }
  });
};
bindKnob("H", v=>{H=v;}, true);        // segment lengths change: replant
bindKnob("R", v=>{R=v; refit();}, false);
bindKnob("B", v=>{BUOY=v; if(world) world.gravity.y=v;}, false);
bindKnob("D", v=>{
  DRAG=v;
  for(const s of stalks) for(const b of s.bodies){
    b.setLinearDamping(v); b.setAngularDamping(v*0.8*angDampScale);
  }
}, false);

/* the panel is furniture — grab a blank spot and carry it anywhere */
function makeDraggable(el){
  el.addEventListener("pointerdown",e=>{
    if(e.target.closest("input,button,textarea,select,a")) return;
    e.preventDefault();
    const r=el.getBoundingClientRect();
    const dx=e.clientX-r.left, dy=e.clientY-r.top;
    // pin to left/top pixels so the right/bottom anchoring lets go
    Object.assign(el.style,{left:r.left+"px",top:r.top+"px",right:"auto",bottom:"auto"});
    el.setPointerCapture(e.pointerId);
    const move=ev=>{
      el.style.left=Math.max(4,Math.min(ev.clientX-dx,innerWidth -r.width -4))+"px";
      el.style.top =Math.max(4,Math.min(ev.clientY-dy,innerHeight-r.height-4))+"px";
    };
    const drop=()=>{
      el.removeEventListener("pointermove",move);
      el.removeEventListener("pointerup",drop);
      el.removeEventListener("pointercancel",drop);
    };
    el.addEventListener("pointermove",move);
    el.addEventListener("pointerup",drop);
    el.addEventListener("pointercancel",drop);
  });
}
makeDraggable(document.getElementById("knobs"));

function resize(){
  dpr=Math.min(devicePixelRatio||1,2);
  cw=innerWidth; ch=innerHeight;
  canvas.width=Math.round(cw*dpr); canvas.height=Math.round(ch*dpr);
  canvas.style.width=cw+"px"; canvas.style.height=ch+"px";
  bloom4.width=Math.max(1,Math.round(canvas.width/4));
  bloom4.height=Math.max(1,Math.round(canvas.height/4));
  bloom8.width=Math.max(1,Math.round(canvas.width/8));
  bloom8.height=Math.max(1,Math.round(canvas.height/8));
  refit();
}
window.addEventListener("resize",resize);

// ?text=… plants a word from the link; ?warm=6 pre-steps the world
// so the page opens on an already-settled forest
const params=new URLSearchParams(location.search);
textbox.value=params.get("text")||DEFAULT_TEXT;
growBox();
resize();
build(textbox.value);
const warm=parseFloat(params.get("warm"))||0;
for(let w=0;w<warm;w+=1/60){ tClock+=1/60; forces(1/60); world.step(); }
requestAnimationFrame(loop);
