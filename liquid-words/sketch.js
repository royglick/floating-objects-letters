/* liquid words
   ------------------------------------------------------------
   Words are cut horizontally into BANDS slices; within a band a
   word is a list of x-intervals. Transitions morph interval lists:
   segments slide (horizontal motion only), stretch, MERGE and
   SPLIT — nearest-neighbor pairing keeps material local, a goo
   filter (blur alpha + re-threshold) makes touching segments neck
   and fuse, easing overshoots so arrivals slosh.

   INPUT MODEL: every line in the box is a LINE on the canvas;
   the space-separated words within a line are that line's
   transition cycle. All lines advance together.

   Knobs top-center; words top-right; click advances.
   ------------------------------------------------------------ */

/* defaults — the panel exposes these live */
let BANDS=6;                     // horizontal cuts per word
let GAP_FRAC=0.22;               // vertical gap between bands (fraction of band height)
let MORPH_MS=1250;               // transition length
let HOLD_MS=500;                 // rest between transitions
let STAGGER_MS=70;               // per-band delay, top to bottom — a cascade
let INK="#1c1a17";               // the liquid
const GOO_REST=0.035;            // goo blur at rest (× band height) — nearly crisp
const GOO_MOVE=0.24;             // goo blur mid-transition — heavy, wet fusion
const OVERSHOOT=0.55;            // slosh: 0 = stop dead, 1 = big wobble (~10% overshoot)
const LINE_GAP=0.34;             // space between canvas lines (× word height)
const FONT="900 FSpx 'Archivo Black','Arial Black',sans-serif";
const PAPER="#faf9f6";

const DEFAULT_TEXT="WHEN WHERE WHAT\nWHO HOW WHY";

const canvas=document.getElementById("stage");
const ctx=canvas.getContext("2d");

let W,H,bandH,gapPx,wordH;       // layout
let lines=[];                    // [{words, bands:[wordIdx][band][{x0,x1}], cur, top0}]
let anim=null;                   // {t0, perLine:[pairs|null]}
let lastAdvance=0;

/* ease-in-out with a back overshoot: a tiny anticipation pull before
   launch, a slosh past the target on arrival — fluids do not stop dead */
const easeIO=(t)=>{
  const c=1.70158*OVERSHOOT, k=c*1.525;
  return t<.5
    ? (Math.pow(2*t,2)*((k+1)*2*t-k))/2
    : (Math.pow(2*t-2,2)*((k+1)*(2*t-2)+k)+2)/2;
};

/* ---- parsing the box --------------------------------------------- */
/* line = a canvas line; its space-separated words = its cycle */
function parseText(text){
  return text.split("\n")
    .map(l=>l.trim().split(/\s+/).filter(Boolean))
    .filter(l=>l.length);
}

/* ---- extracting intervals ---------------------------------------- */
function wordToBands(word,fontPx){
  const cv=document.createElement("canvas");
  const c=cv.getContext("2d",{willReadFrequently:true});
  c.font=FONT.replace("FS",fontPx);
  const m=c.measureText(word);
  const asc=m.actualBoundingBoxAscent, desc=m.actualBoundingBoxDescent;
  const w=Math.ceil(m.width)+20, h=Math.ceil(asc+desc)+20;
  cv.width=w; cv.height=h;
  c.font=FONT.replace("FS",fontPx);
  c.fillStyle="#000";
  c.fillText(word,10,10+asc);
  const bands=[];
  const bh=(asc+desc)/BANDS, LINES=5;
  for(let b=0;b<BANDS;b++){
    // majority vote over several scanlines inside the band — one line
    // misses crossbars; the vote keeps the band honest to the letterform
    const votes=new Uint8Array(w);
    for(let l=0;l<LINES;l++){
      const y=Math.round(10+b*bh+(l+0.5)*bh/LINES);
      const row=c.getImageData(0,y,w,1).data;
      for(let x=0;x<w;x++) if(row[x*4+3]>120) votes[x]++;
    }
    const spans=[];
    let start=-1;
    for(let x=0;x<w;x++){
      const on=votes[x]>=Math.ceil(LINES/2);
      if(on&&start<0) start=x;
      if(!on&&start>=0){ spans.push({x0:start-10,x1:x-10}); start=-1; }
    }
    if(start>=0) spans.push({x0:start-10,x1:w-10});
    // drop hairline slivers — they goo into warts
    bands.push(spans.filter(s=>s.x1-s.x0>bh*0.18));
  }
  return {bands, width:m.width, height:asc+desc};
}

/* ---- pairing: interval list A → interval list B ------------------- */
/* nearest-neighbor matching: every target is fed by its closest source
   (splits), every leftover source drains into its closest target
   (merges). Material never crosses the word — mass flows to the
   closest need, like a liquid actually would. */
function pairBands(A,B){
  const out=[];
  for(let b=0;b<BANDS;b++){
    const a=[...A[b]].sort((p,q)=>p.x0-q.x0);
    const bb=[...B[b]].sort((p,q)=>p.x0-q.x0);
    const pairs=[];
    if(!a.length&&!bb.length){ out.push(pairs); continue; }
    if(!a.length){ // material appears: grow from target centers
      for(const t of bb){ const cx=(t.x0+t.x1)/2; pairs.push({a0:cx,a1:cx,b0:t.x0,b1:t.x1}); }
      out.push(pairs); continue;
    }
    if(!bb.length){ // material vanishes: collapse to own centers
      for(const s of a){ const cx=(s.x0+s.x1)/2; pairs.push({a0:s.x0,a1:s.x1,b0:cx,b1:cx}); }
      out.push(pairs); continue;
    }
    const ac=a.map(s=>(s.x0+s.x1)/2), bc=bb.map(t=>(t.x0+t.x1)/2);
    const used=new Array(a.length).fill(false);
    for(let j=0;j<bb.length;j++){
      let bi=0,bd=1e18;
      for(let i=0;i<a.length;i++){
        const d=Math.abs(ac[i]-bc[j]);
        if(d<bd){ bd=d; bi=i; }
      }
      used[bi]=true;
      pairs.push({a0:a[bi].x0,a1:a[bi].x1,b0:bb[j].x0,b1:bb[j].x1});
    }
    for(let i=0;i<a.length;i++){
      if(used[i]) continue;
      let bj=0,bd=1e18;
      for(let j=0;j<bb.length;j++){
        const d=Math.abs(ac[i]-bc[j]);
        if(d<bd){ bd=d; bj=j; }
      }
      pairs.push({a0:a[i].x0,a1:a[i].x1,b0:bb[bj].x0,b1:bb[bj].x1});
    }
    out.push(pairs);
  }
  return out;
}

/* ---- layout -------------------------------------------------------- */
function layout(){
  W=innerWidth; H=innerHeight;
  const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=W*dpr; canvas.height=H*dpr;
  canvas.style.width=W+"px"; canvas.style.height=H+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(!lines.length) return;

  // font size: the longest word (any line) spans ≤72% width, and the
  // stack of lines fits in ~76% of the height
  let longest="";
  for(const l of lines)for(const w of l.words)
    if(w.length>=longest.length) longest=w;
  const probe=wordToBands(longest,100);
  const widthFit=100*(W*0.72)/probe.width;
  const n=lines.length;
  const heightFit=100*(H*0.76)/(probe.height*(n+(n-1)*LINE_GAP));
  const fontPx=Math.min(widthFit,heightFit);

  const d0=wordToBands(longest,fontPx);
  wordH=d0.height;
  bandH=wordH/BANDS;
  gapPx=bandH*GAP_FRAC;

  const totalH=wordH*(n+(n-1)*LINE_GAP);
  const stackTop=(H-totalH)/2;

  lines.forEach((line,i)=>{
    line.top0=stackTop+i*wordH*(1+LINE_GAP);
    line.bands=line.words.map(w=>{
      const d=wordToBands(w,fontPx);
      const off=(W-d.width)/2;
      return d.bands.map(band=>band.map(s=>({x0:s.x0+off,x1:s.x1+off})));
    });
    line.cur=Math.min(line.cur||0,line.words.length-1);
  });

  setGoo(GOO_REST);
  anim=null;
  drawResting();
}

/* the goo breathes: nearly crisp at rest, wet and heavy in flight */
const gooBlurEl=document.querySelector("#goo feGaussianBlur");
function setGoo(k){
  gooBlurEl.setAttribute("stdDeviation",(bandH*k).toFixed(2));
}

/* ---- drawing -------------------------------------------------------- */
/* shapes are drawn plain into a buffer; the buffer lands on screen
   through the goo filter, so the WHOLE composition fuses as one liquid */
let buf=null,bctx=null;
function ensureBuf(){
  if(buf&&buf.width===canvas.width) return;
  buf=document.createElement("canvas");
  buf.width=canvas.width; buf.height=canvas.height;
  bctx=buf.getContext("2d");
}

/* entries: [{bands, top0}] — one per canvas line */
function drawAll(entries){
  ensureBuf();
  const dpr=Math.min(devicePixelRatio||1,2);
  bctx.setTransform(dpr,0,0,dpr,0,0);
  bctx.clearRect(0,0,W,H);
  bctx.fillStyle=INK;
  for(const {bands,top0} of entries){
    for(let b=0;b<BANDS;b++){
      const y=top0+b*bandH+gapPx/2, h=bandH-gapPx;
      const r=h/2;
      for(const s of bands[b]){
        const w=s.x1-s.x0;
        if(w<0.5) continue;
        bctx.beginPath();
        bctx.roundRect(s.x0,y,w,h,Math.min(r,w/2));
        bctx.fill();
      }
    }
  }
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.filter="url(#goo)";
  ctx.drawImage(buf,0,0);
  ctx.restore();
}

function drawResting(){
  drawAll(lines.map(l=>({bands:l.bands[l.cur],top0:l.top0})));
}

/* ---- the transition -------------------------------------------------- */
function advance(){
  if(!lines.some(l=>l.words.length>1)){ lastAdvance=performance.now(); return; }
  anim={
    t0:performance.now(),
    perLine:lines.map(line=>{
      if(line.words.length<2) return null;         // single word — it just sits
      const next=(line.cur+1)%line.words.length;
      const pairs=pairBands(line.bands[line.cur],line.bands[next]);
      line.cur=next;
      return pairs;
    }),
  };
}

function frame(now){
  if(anim){
    // the liquid envelope: 0 at both ends of the whole transition,
    // 1 in the middle — the goo swells while material is in flight
    const total=MORPH_MS+STAGGER_MS*(BANDS-1);
    const overall=Math.max(0,Math.min(1,(now-anim.t0)/total));
    setGoo(GOO_REST+(GOO_MOVE-GOO_REST)*Math.sin(Math.PI*overall));

    let done=true;
    const entries=lines.map((line,i)=>{
      const pairs=anim.perLine[i];
      if(!pairs) return {bands:line.bands[line.cur],top0:line.top0};
      const bands=[];
      for(let b=0;b<BANDS;b++){
        const t=Math.max(0,Math.min(1,(now-anim.t0-b*STAGGER_MS)/MORPH_MS));
        if(t<1) done=false;
        const e=easeIO(t);
        bands.push(pairs[b].map(p=>({
          x0:p.a0+(p.b0-p.a0)*e,
          x1:p.a1+(p.b1-p.a1)*e,
        })));
      }
      return {bands,top0:line.top0};
    });
    drawAll(entries);
    if(done){ anim=null; lastAdvance=now; setGoo(GOO_REST); drawResting(); }
  }else if(now-lastAdvance>HOLD_MS){
    advance();
  }
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointerdown",()=>{ if(!anim) advance(); });
window.addEventListener("resize",layout);

/* ---- the panel -------------------------------------------------------- */
const K=id=>document.getElementById(id);
const wordsBox=K("wordsBox");

function growBox(){
  wordsBox.style.height="auto";
  wordsBox.style.height=wordsBox.scrollHeight+"px";
}

function initPanel(){
  K("k-bands").value=BANDS;
  K("k-gap").value=GAP_FRAC;
  K("k-morph").value=MORPH_MS;
  K("k-hold").value=HOLD_MS;
  K("k-stagger").value=STAGGER_MS;
  K("k-ink").value=INK;
  wordsBox.value=DEFAULT_TEXT;
  growBox();

  // structural knob — the bands must be re-extracted
  K("k-bands").addEventListener("input",e=>{ BANDS=+e.target.value; layout(); });
  // cosmetic knobs — redraw is enough
  K("k-gap").addEventListener("input",e=>{
    GAP_FRAC=+e.target.value; gapPx=bandH*GAP_FRAC;
    if(!anim) drawResting();
  });
  K("k-ink").addEventListener("input",e=>{
    INK=e.target.value;
    if(!anim) drawResting();
  });
  // timing knobs — picked up by the next transition
  K("k-morph").addEventListener("input",e=>{ MORPH_MS=+e.target.value; });
  K("k-hold").addEventListener("input",e=>{ HOLD_MS=+e.target.value; });
  K("k-stagger").addEventListener("input",e=>{ STAGGER_MS=+e.target.value; });

  // the text: lines are canvas lines; spaces separate a line's cycle
  wordsBox.addEventListener("input",()=>{
    growBox();
    const parsed=parseText(wordsBox.value);
    if(!parsed.length) return;                  // keep the last valid text
    lines=parsed.map((words,i)=>({words, cur:lines[i]?Math.min(lines[i].cur,words.length-1):0}));
    layout();
    lastAdvance=performance.now();
  });
}

document.fonts.ready.then(()=>{
  initPanel();
  lines=parseText(DEFAULT_TEXT).map(words=>({words,cur:0}));
  layout();
  lastAdvance=performance.now();
  requestAnimationFrame(frame);
});
