/* eye shapes
   ------------------------------------------------------------
   The screen is covered with closed eyes — hand-cut collage style:
   wavy elliptical cutouts, sized with variance, overlapping in
   random stacking order so no background shows. Every eye can wear
   one of three shades: closed, blue open, green open.

   PATTERN MODES (exclusive — one at a time):
   - hypno  : symmetric polar shapes born at the center, growing
              outward forever. An endless tunnel.
   - waves  : three invisible wave sources drift around; each eye is
              shaded by the interference of their ripples.
   - cells  : a cyclic cellular automaton — closed eats green eats
              blue eats closed. Starts as noise, self-organizes into
              rotating spiral waves. Nobody draws them.
   - mirror : the webcam, rendered in eyes. Light → blue, mid →
              green, dark → closed. The field watches you back.

   DEFAULT: when no mode is running, whatever pattern was left on
   screen dissolves — eyes fall back asleep in a staggered scatter.

   MODIFIER:
   - tears  : open eyes weep; tear cutouts fall and drift away.

   Cheap by construction: all cutouts are pre-masked ONCE into
   sprite canvases; one animation driver runs only while a mode,
   fade, or tears has work. Nothing runs when idle.
   ------------------------------------------------------------ */

const canvas=document.getElementById("field");
const ctx=canvas.getContext("2d");

const EYE_ASPECT=1.7;      // ellipse w:h — wide, like an eye
const JITTER=0.25;         // ± fraction of a cell each eye strays from the grid
const SIZE_RANGE=[1.25,1.95]; // eye width as multiple of grid cell — big, varied, overlapping
const VARIANTS=6;          // pre-cut squiggle sprites per eye state
const SKIN="#e7cec3";      // any hairline gap between eyes reads as skin, not page

const TEAR_RATE=0.015;     // tears per open eye per second (plus a base trickle)
const TEAR_G=520;          // gravity (px/s²)

const HYPNO={
  speed:240,               // outward growth (px/s)
  gapMs:620,               // time between shape births — sets the ring thickness
  wobble:0.25,             // max petal amplitude (0 = pure circles)
};
const COUNT={
  stepMs:1500,             // ms per count
  blinkMs:700,             // crowd-blink stagger window on each change
  digitSize:1,             // digit height as a fraction of the screen
  centerY:0.6,            // vertical anchor: 0.5 = screen center, higher = lower
  font:'300 FSpx "Arial Rounded MT Bold","SF Pro Rounded",ui-rounded,sans-serif',
};
const CELLS={
  stepMs:110,              // automaton step cadence
  threshold:3,             // neighbors of the successor shade needed to convert
};
const FADE_MS=2600;        // how long an unattended open eye survives before closing

/* the three shades: two iris images + closed (null) */
const COLOR_SRC={ blue:"eye-open.jpg", green:"eye-open-green.jpg" };
const SHADES=[null,"blue","green"];       // automaton order: closed→blue→green→closed

/* tear cutouts — pre-processed transparent PNGs (tear-0 … tear-6) */
const TEAR_COUNT=7;

const imgClosed=new Image(); imgClosed.src="eye-closed.jpg";
const imgOpen={};
for(const c in COLOR_SRC){ imgOpen[c]=new Image(); imgOpen[c].src=COLOR_SRC[c]; }
const tearSprites=[];
for(let i=0;i<TEAR_COUNT;i++){ const t=new Image(); t.src=`tear-${i}.png`; tearSprites.push(t); }

let W,H,cellW,cellH,cols,rows,eyes=[],eyeGrid=[];
let spritesClosed=[], spritesOpen={};     // spritesOpen[color][variant]
let paintedEyes=[];                       // eyes currently open (tear sources)
let tears=[], tearsOn=false, tearLoopOn=false, tearAcc=0, tearPrev=0;
let mode=null, modeState=null;            // active pattern mode + its private state
let driverOn=false, driverPrev=0;         // the single animation driver

const rnd=(a,b)=>a+Math.random()*(b-a);

/* ---- hand-cut sprites --------------------------------------- */
function squigglePath(c,w,h){
  const k1=(4+Math.random()*2)|0, k2=(7+Math.random()*2)|0;
  const a1=rnd(0.02,0.04), a2=rnd(0.008,0.02);
  const p1=Math.random()*Math.PI*2, p2=Math.random()*Math.PI*2;
  const STEPS=44;
  c.beginPath();
  for(let i=0;i<=STEPS;i++){
    const t=i/STEPS*Math.PI*2;
    const m=1+a1*Math.sin(k1*t+p1)+a2*Math.sin(k2*t+p2);
    const x=w/2+Math.cos(t)*(w/2-2)*m;
    const y=h/2+Math.sin(t)*(h/2-2)*m;
    i?c.lineTo(x,y):c.moveTo(x,y);
  }
  c.closePath();
}

function coverRect(img,aspect){
  let sw=img.naturalWidth, sh=img.naturalHeight;
  if(sw/sh>aspect) sw=sh*aspect; else sh=sw/aspect;
  return {sx:(img.naturalWidth-sw)/2, sy:(img.naturalHeight-sh)/2, sw, sh};
}

function makeSprites(img){
  const out=[];
  const sw=320, sh=Math.round(320/EYE_ASPECT);
  const s=coverRect(img,EYE_ASPECT);
  for(let v=0;v<VARIANTS;v++){
    const cv=document.createElement("canvas");
    cv.width=sw; cv.height=sh;
    const c=cv.getContext("2d");
    c.drawImage(img,s.sx,s.sy,s.sw,s.sh,0,0,sw,sh);
    c.globalCompositeOperation="destination-in";
    squigglePath(c,sw,sh);
    c.fill();
    out.push(cv);
  }
  return out;
}

/* ---- layout --------------------------------------------------- */
function layout(){
  W=innerWidth; H=innerHeight;
  const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=W*dpr; canvas.height=H*dpr;
  canvas.style.width=W+"px"; canvas.style.height=H+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);

  cellW=Math.max(14, Math.min(72, Math.min(W*0.92/39, (H*0.45/7)*EYE_ASPECT)));
  cellH=cellW/EYE_ASPECT;

  cols=Math.ceil(W/cellW)+2; rows=Math.ceil(H/cellH)+2;

  eyes=[]; eyeGrid=new Array(rows*cols);
  paintedEyes=[]; tears=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const w=cellW*rnd(...SIZE_RANGE);
    const e={
      c, r,
      x:c*cellW+(Math.random()*2-1)*JITTER*cellW,
      y:r*cellH+(Math.random()*2-1)*JITTER*cellH,
      w, h:w/EYE_ASPECT*rnd(0.9,1.1),
      rot:rnd(-0.12,0.12),
      v:(Math.random()*VARIANTS)|0,
      flip:Math.random()<0.5,
      paint:null,                            // null = closed, else a color key
      openedAt:0,                            // for the fade modifier
      next:null, flipAt:0,                   // for the counter's crowd blink
    };
    e.pd=Math.hypot(e.x-W/2, e.y-H/2);       // polar coords around screen center
    e.pa=Math.atan2(e.y-H/2, e.x-W/2);
    eyes.push(e);
    eyeGrid[r*cols+c]=e;
  }
  for(let i=eyes.length-1;i>0;i--){          // random stacking order
    const j=(Math.random()*(i+1))|0;
    [eyes[i],eyes[j]]=[eyes[j],eyes[i]];
  }
  if(mode){                                  // re-init the running mode on the new grid
    if(MODES[mode].stop) MODES[mode].stop(modeState);
    modeState=MODES[mode].init(performance.now());
    ensureDriver();
  }
  render();
}

/* shade an eye, stamping wake time for the fade modifier */
function setShade(e,c,now){
  if(e.paint===c) return;
  e.paint=c;
  if(c) e.openedAt=now;
}

/* ---- paint ---------------------------------------------------- */
function drawEye(e,sprites){
  ctx.save();
  ctx.translate(e.x,e.y);
  ctx.rotate(e.rot);
  if(e.flip) ctx.scale(-1,1);
  ctx.drawImage(sprites[e.v],-e.w/2,-e.h/2,e.w,e.h);
  ctx.restore();
}

function render(){
  ctx.fillStyle=SKIN;
  ctx.fillRect(0,0,W,H);
  // single pass: every eye keeps its fixed stacking depth whatever its
  // state — opening just swaps the image in place, no z jump
  for(const e of eyes) drawEye(e, e.paint?spritesOpen[e.paint]:spritesClosed);
  for(const t of tears) ctx.drawImage(t.sp, t.x-t.w/2, t.y, t.w, t.h);
}

/* ---- pattern modes --------------------------------------------- */
const MODES={

  /* symmetric polar shapes from the center — an endless tunnel */
  hypno:{
    init(now){
      const states=[...SHADES];
      for(let i=states.length-1;i>0;i--){
        const j=(Math.random()*(i+1))|0; [states[i],states[j]]=[states[j],states[i]];
      }
      return { shapes:[], born:0, nextAt:now, states };
    },
    step(st,now,dt){
      if(now>=st.nextAt){
        const k=[0,3,4,5,6,8][(Math.random()*6)|0];
        st.shapes.unshift({
          k, a:k?rnd(0.08,HYPNO.wobble):0,
          phi:rnd(0,Math.PI*2), rot:rnd(-0.5,0.5),
          color:st.states[st.born%st.states.length],
          r:0,
        });
        st.born++;
        st.nextAt=now+HYPNO.gapMs;
      }
      const reach=Math.hypot(W,H)/2;
      for(const s of st.shapes){ s.r+=HYPNO.speed*dt; s.phi+=s.rot*dt; }
      while(st.shapes.length&&st.shapes[st.shapes.length-1].r*(1-st.shapes[st.shapes.length-1].a)>reach)
        st.shapes.pop();
      for(const e of eyes){
        for(const s of st.shapes){
          if(e.pd<=s.r*(1+s.a*Math.cos(s.k*e.pa+s.phi))){ setShade(e,s.color,now); break; }
        }
      }
    },
  },

  /* the counter: 1, 2, 3… — digits exist as which eyes are open,
     rasterized in a light rounded face to a low-res mask. On every
     change, eyes flip at their own random moment inside a short
     window: a crowd blinking the next number into place. */
  count:{
    init(now){
      const MS=Math.max(2/cellW,0.08);
      const mask=document.createElement("canvas");
      mask.width=Math.ceil(W*MS); mask.height=Math.ceil(H*MS);
      const st={
        t0:now, lastStr:"", MS, mask,
        mctx:mask.getContext("2d",{willReadFrequently:true}),
        maskData:null,
      };
      for(const e of eyes) e.next=e.paint;   // no stale blink targets
      return st;
    },
    step(st,now,dt){
      const str=String(1+Math.floor((now-st.t0)/COUNT.stepMs));
      if(str!==st.lastStr){
        st.lastStr=str;
        // rasterize the count, centered, as big as fits
        const mw=st.mask.width, mh=st.mask.height, c=st.mctx;
        c.clearRect(0,0,mw,mh);
        c.textAlign="center"; c.textBaseline="middle";
        c.font=COUNT.font.replace("FS","100");
        const w100=c.measureText(str).width||1;
        const fs=Math.min(mh*COUNT.digitSize, mw*0.92*100/w100);
        c.font=COUNT.font.replace("FS",String(fs));
        c.fillText(str,mw/2,mh*COUNT.centerY);
        st.maskData=c.getImageData(0,0,mw,mh).data;
        // stagger the crowd blink toward the new number
        for(const e of eyes){
          const mx=Math.round(e.c*cellW*st.MS), my=Math.round(e.r*cellH*st.MS);
          const inside=mx>=0&&my>=0&&mx<mw&&my<mh&&st.maskData[(my*mw+mx)*4+3]>120;
          const target=inside?"green":null;
          if(target!==e.paint){ e.next=target; e.flipAt=now+Math.random()*COUNT.blinkMs; }
          else e.next=target;
        }
      }
      for(const e of eyes)
        if(e.next!==e.paint&&now>=e.flipAt) setShade(e,e.next,now);
    },
  },

  /* cyclic cellular automaton: closed→blue→green→closed, each shade
     eaten by its successor. Noise self-organizes into spiral waves.
     The LOGIC stays synchronous (that's what makes the spirals), but
     each generation is PRESENTED staggered: every changed eye flips
     at its own moment inside the step window — shimmer, not pulse. */
  cells:{
    init(now){
      const state=new Uint8Array(cols*rows);
      for(let i=0;i<state.length;i++) state[i]=(Math.random()*3)|0;
      for(const e of eyes) e.next=e.paint;   // no stale flip targets
      return { state, next:new Uint8Array(cols*rows), lastStep:0 };
    },
    step(st,now,dt){
      if(now-st.lastStep>=CELLS.stepMs){
        st.lastStep=now;
        const {state,next}=st;
        for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
          const i=r*cols+c, s=state[i], succ=(s+1)%3;
          let n=0;
          for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
            if(!dr&&!dc) continue;
            const rr=(r+dr+rows)%rows, cc=(c+dc+cols)%cols;   // torus
            if(state[rr*cols+cc]===succ) n++;
          }
          next[i]=n>=CELLS.threshold?succ:s;
        }
        st.state=next; st.next=state;
        for(const e of eyes){
          const target=SHADES[st.state[e.r*cols+e.c]];
          if(target!==e.paint){ e.next=target; e.flipAt=now+Math.random()*CELLS.stepMs*0.9; }
          else e.next=target;
        }
      }
      for(const e of eyes)
        if(e.next!==e.paint&&now>=e.flipAt) setShade(e,e.next,now);
    },
  },

};


/* toggle a mode: same one = off, another = switch */
function setMode(m){
  const prev=mode;
  if(mode&&MODES[mode].stop) MODES[mode].stop(modeState);
  mode=null; modeState=null;
  document.querySelectorAll("#panel .mode").forEach(b=>b.classList.remove("on"));
  if(prev!==m){
    mode=m;
    modeState=MODES[m].init(performance.now());
    document.getElementById(m+"Btn").classList.add("on");
  }else{
    // no mode left running — the abandoned pattern dissolves, each eye
    // on its own clock, scattered across the fade window
    const now=performance.now();
    for(const e of eyes) if(e.paint) e.openedAt=now-rnd(0,FADE_MS*0.9);
  }
  paintedEyes=eyes.filter(e=>e.paint);       // fresh tear sources either way
  ensureDriver();
}

/* ---- the single animation driver -------------------------------- */
function ensureDriver(){
  if(driverOn) return;
  driverOn=true; driverPrev=performance.now();
  requestAnimationFrame(driverStep);
}

function driverStep(now){
  const dt=Math.min(0.05,(now-driverPrev)/1000); driverPrev=now;

  let anyPaint=false;
  if(mode){
    MODES[mode].step(modeState,now,dt);
  }else{
    // default behavior: an unattended pattern dissolves
    for(const e of eyes){
      if(e.paint&&now-e.openedAt>FADE_MS) e.paint=null;
      anyPaint=anyPaint||!!e.paint;
    }
  }

  if(mode||tearsOn) paintedEyes=eyes.filter(e=>e.paint);  // live tear sources

  render();

  if(mode||anyPaint){ requestAnimationFrame(driverStep); }
  else{ driverOn=false; render(); }
}

/* ---- tears ------------------------------------------------------ */
function spawnTear(){
  if(!paintedEyes.length) return;
  const e=paintedEyes[(Math.random()*paintedEyes.length)|0];
  if(!e.paint) return;
  const sp=tearSprites[(Math.random()*tearSprites.length)|0];
  const tall=sp.height/sp.width>1.8;
  const h=cellH*rnd(0.7,1.4)*(tall?1.9:1);
  tears.push({
    sp, h, w:h*sp.width/sp.height,
    x:e.x+rnd(-0.15,0.15)*e.w,
    y:e.y+e.h*0.3,
    vy:rnd(20,70), vx:rnd(-14,14),
  });
}

function ensureTearLoop(){
  if(tearLoopOn) return;
  tearLoopOn=true; tearPrev=performance.now();
  requestAnimationFrame(tearStep);
}

function tearStep(now){
  const dt=Math.min(0.05,(now-tearPrev)/1000); tearPrev=now;
  if(tearsOn&&paintedEyes.length){
    tearAcc+=dt*(1.5+paintedEyes.length*TEAR_RATE);
    while(tearAcc>=1){ tearAcc-=1; spawnTear(); }
  }
  for(const t of tears){
    t.vy+=TEAR_G*dt;
    t.y+=t.vy*dt;
    t.x+=t.vx*dt;
  }
  tears=tears.filter(t=>t.y<H+80);
  if(!driverOn) render();                     // while the driver runs, it renders
  if(tearsOn||tears.length){ requestAnimationFrame(tearStep); }
  else{ tearLoopOn=false; render(); }
}

/* ---- panel ------------------------------------------------------ */
for(const m of ["hypno","count","cells"]){
  document.getElementById(m+"Btn").addEventListener("click",()=>setMode(m));
}

const tearBtn=document.getElementById("tearBtn");
tearBtn.addEventListener("click",()=>{
  tearsOn=!tearsOn;
  tearBtn.classList.toggle("on",tearsOn);
  if(tearsOn){ paintedEyes=eyes.filter(e=>e.paint); ensureTearLoop(); }
});

/* the panel is furniture — grab a blank spot and carry it anywhere */
function makeDraggable(el){
  el.addEventListener("pointerdown",e=>{
    if(e.target.closest("input,button,textarea,select,a")) return;
    e.preventDefault();
    const r=el.getBoundingClientRect();
    const dx=e.clientX-r.left, dy=e.clientY-r.top;
    // pin to left/top pixels so the centering transform lets go
    Object.assign(el.style,{left:r.left+"px",top:r.top+"px",right:"auto",bottom:"auto",transform:"none"});
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
makeDraggable(document.getElementById("panel"));

/* boot once all images are in */
const toLoad=[imgClosed,...Object.values(imgOpen),...tearSprites];
let loaded=0;
for(const img of toLoad) img.onload=()=>{
  if(++loaded===toLoad.length){
    spritesClosed=makeSprites(imgClosed);
    for(const c in imgOpen) spritesOpen[c]=makeSprites(imgOpen[c]);
    layout();
  }
};
window.addEventListener("resize",()=>{ if(loaded===toLoad.length) layout(); });
