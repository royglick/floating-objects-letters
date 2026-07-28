/* loose ends
   ------------------------------------------------------------
   A letter formed by lines that come from beyond the screen.

   Each letter is a single-line (monoline) letterform — a
   little network of strokes meeting at junctions, with LOOSE
   ENDS where a stroke stops in open air. A loose end is a
   door. ONE line forms each letter: it arrives from outside
   the screen along a randomly chosen door's own tangent, pours
   through the network — splitting at junctions, fronts meeting
   mid-stroke — until the letter stands complete; then its tail
   draws itself in and stops exactly at the letter's edge. The
   letters hold until you click — and each empties through a
   DIFFERENT door, the one facing most nearly opposite the one
   it came in by: a T formed from the right drains out the
   left. (An i is two pieces — stem and dot — so it gets one
   line each.)

   The fonts are REAL single-line fonts, made for pen plotters
   (SVG fonts: Cutlings by Marius Surguy, the EMS set by
   Sheldon B. Michaels / Evil Mad Scientist), fetched and
   parsed live; the built-in geometric skeleton
   (lib/linefont.js) rides along as the offline fallback. The
   flow is honest geometry: a multi-source shortest-path front
   over the stroke graph (T-junctions split strokes into edges;
   endpoints that touch nothing are the doors). Closed loops
   with no doors — o, the dot on the i — get a single
   tangential door at their topmost point: the line kisses the
   loop and wraps it both ways.

   Type letters top-right (newlines make lines); knobs
   top-center; click to release.
   ------------------------------------------------------------ */

/* defaults — the panel exposes these live */
let SIZE=0.55;                 // cap height (× min screen dim)
let WEIGHT=0.6;                // stripe width (font units; cap height is 21)
let FORM_MS=9000;              // the head's journey: off-screen through the whole letter
let GAP_MS=150;                // average time between one entrance and the next
let RAILS="dance";             // straight rails, or a dance in the font's nature
let LINE_LEN=6;                // line length in cap heights; at the max it is endless
let FEEL="organic";            // organic: curvature slows the pen, width follows
                               // speed, a wake flutters behind the head
let INK="#1c1a17";
const RET_FRAC=0.4;            // tail retraction, as a slice of FORM_MS
const TOL=0.8;                 // endpoint-on-stroke closer than this is a junction
const DEFAULT_TEXT="what\nthe\nactual\nfuck";

/* real single-line fonts (SVG plotter fonts, fetched live) */
const CDN="https://cdn.jsdelivr.net/gh/msurguy/cnc-text-tool@master/docs/fonts/";
const SVG_FONTS={
  cutlings:   CDN+"Cutlings/CutlingsGeometricRound.svg",
  singularis: CDN+"Cutlings/CutlingsSingularis.svg",
  readability:CDN+"EMS/EMSReadability.svg",      // ← Source Sans Pro
  nixish:     CDN+"EMS/EMSNixish.svg",           // ← Nixie One
  delight:    CDN+"EMS/EMSDelight.svg",          // ← Delius
  herculean:  CDN+"EMS/EMSHerculean.svg",        // ← Poiret One
  osmotron:   CDN+"EMS/EMSOsmotron.svg",         // ← Orbitron
};

const canvas=document.getElementById("stage");
const ctx=canvas.getContext("2d");

const CAP=21, MID=11.5;        // our frame: cap spans y 1..22, baseline 22
let W,H,DPR=1;
let text=DEFAULT_TEXT;
let FONTK="cutlings";
const LOADED={round:{glyphs:LINE_FONT,lh:LH_DEFAULT()}};  // name → {glyphs,lh}
let mode="in", born=0, outBorn=0;
function LH_DEFAULT(){ return 38; }

const clamp01=t=>Math.max(0,Math.min(1,t));

/* easeInOutExpo with its mid-flight speed capped: the ends keep the
   expo creep, but through the middle the speed is clamped — no snap */
const easeIO=(()=>{
  const K=10*Math.LN2, VMAX=2.5;               // raw expo peaks at ~6.9×
  const t1=(10+Math.log2(VMAX/K))/20;          // where raw expo hits the cap
  const raw=t=>Math.pow(2,20*t-10)/2;
  const r1=raw(t1);
  const F1=2*r1+VMAX*(1-2*t1);
  const fn=t=>{
    if(t<=0) return 0;
    if(t>=1) return 1;
    let f;
    if(t<=t1) f=raw(t);
    else if(t<1-t1) f=r1+VMAX*(t-t1);
    else f=F1-raw(1-t);
    return f/F1;
  };
  fn.peak=VMAX/F1;               // plateau speed, × average
  fn.K=K; fn.F1=F1; fn.t1=t1; fn.raw=raw;
  return fn;
})();

/* the ease's local slope, indexed by PROGRESS (not time) — how fast
   the pen is moving when it passes a given fraction of its journey */
const EASE_SLOPE=(()=>{
  const N=256, a=new Float32Array(N+1);
  for(let i=0;i<=N;i++) a[i]=easeIO(i/N);
  const sl=new Float32Array(N);
  for(let i=0;i<N;i++) sl[i]=(a[i+1]-a[i])*N;
  return y=>{
    let lo=0,hi=N;
    while(lo<hi){ const m=(lo+hi)>>1; if(a[m]<y) lo=m+1; else hi=m; }
    return sl[Math.max(0,Math.min(N-1,lo-1))];
  };
})();

function distPtSeg(px,py,ax,ay,bx,by){
  const vx=bx-ax, vy=by-ay;
  const L2=vx*vx+vy*vy;
  const t=L2?clamp01(((px-ax)*vx+(py-ay)*vy)/L2):0;
  return Math.hypot(px-(ax+vx*t), py-(ay+vy*t));
}

/* ---- loading real single-line fonts --------------------------------- */
/* SVG font glyphs are y-UP with their own units; normalize into our
   frame: cap height 21, top of caps y=1, baseline y=22 */
function parseSvgPath(d,kk){
  const polys=[];
  let cur=null, x=0,y=0, sx=0,sy=0, pcx=null,pcy=null, cmd="";
  const toks=d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/g)||[];
  let i=0;
  const num=()=>+toks[i++];
  const P=(X,Y)=>[X*kk,22-Y*kk];
  const put=(X,Y)=>cur.push(P(X,Y));
  const cubic=(x1,y1,x2,y2,X,Y)=>{
    const x0=x,y0=y;
    for(let t=1;t<=12;t++){
      const u=t/12,v=1-u;
      put(v*v*v*x0+3*v*v*u*x1+3*v*u*u*x2+u*u*u*X,
          v*v*v*y0+3*v*v*u*y1+3*v*u*u*y2+u*u*u*Y);
    }
    x=X;y=Y; pcx=x2;pcy=y2;
  };
  const quad=(x1,y1,X,Y)=>{
    const x0=x,y0=y;
    for(let t=1;t<=10;t++){
      const u=t/10,v=1-u;
      put(v*v*x0+2*v*u*x1+u*u*X, v*v*y0+2*v*u*y1+u*u*Y);
    }
    x=X;y=Y; pcx=x1;pcy=y1;
  };
  while(i<toks.length){
    if(/[a-zA-Z]/.test(toks[i])){ cmd=toks[i++]; }
    let smooth=false;
    switch(cmd){
      case "M": x=num();y=num(); sx=x;sy=y; cur=[P(x,y)]; polys.push(cur); cmd="L"; pcx=null; break;
      case "m": x+=num();y+=num(); sx=x;sy=y; cur=[P(x,y)]; polys.push(cur); cmd="l"; pcx=null; break;
      case "L": x=num();y=num(); put(x,y); pcx=null; break;
      case "l": x+=num();y+=num(); put(x,y); pcx=null; break;
      case "H": x=num(); put(x,y); pcx=null; break;
      case "h": x+=num(); put(x,y); pcx=null; break;
      case "V": y=num(); put(x,y); pcx=null; break;
      case "v": y+=num(); put(x,y); pcx=null; break;
      case "C":{ const a=num(),b=num(),c=num(),d2=num(); cubic(a,b,c,d2,num(),num()); break; }
      case "c":{ const a=x+num(),b=y+num(),c=x+num(),d2=y+num(); cubic(a,b,c,d2,x+num(),y+num()); break; }
      case "S": smooth=true; // falls through
      case "s":{
        const rel=cmd==="s";
        const c1x=pcx!==null?2*x-pcx:x, c1y=pcy!==null?2*y-pcy:y;
        const c2x=(rel?x:0)+num(), c2y=(rel?y:0)+num();
        cubic(c1x,c1y,c2x,c2y,(rel?x:0)+num(),(rel?y:0)+num());
        break;
      }
      case "Q":{ const a=num(),b=num(); quad(a,b,num(),num()); break; }
      case "q":{ const a=x+num(),b=y+num(); quad(a,b,x+num(),y+num()); break; }
      case "T": case "t":{
        const rel=cmd==="t";
        const c1x=pcx!==null?2*x-pcx:x, c1y=pcy!==null?2*y-pcy:y;
        quad(c1x,c1y,(rel?x:0)+num(),(rel?y:0)+num());
        break;
      }
      case "Z": case "z": x=sx;y=sy; if(cur) put(x,y); pcx=null; break;
      default: i++; // anything exotic: skip a token and move on
    }
    if(smooth){} // (S handled above)
  }
  return polys.filter(p=>p.length>1);
}

/* plotter fonts are digitized as straight segments; refit a
   Catmull-Rom spline through the samples so curves read as curves at
   poster size. real corners (sharp turns) stay sharp, endpoints stay
   exactly put — the junction geometry never moves */
function smoothPoly(pl){
  const n=pl.length;
  if(n<3) return pl;
  const closed=Math.hypot(pl[0][0]-pl[n-1][0],pl[0][1]-pl[n-1][1])<1e-6;
  const pts=closed?pl.slice(0,n-1):pl;
  const m=pts.length;
  if(m<3) return pl;
  let perim=0;
  for(let i=0;i<m;i++){
    const q=pts[(i+1)%m];
    perim+=Math.hypot(q[0]-pts[i][0],q[1]-pts[i][1]);
  }
  const tiny=closed&&perim<12;                  // a dot digitized as a square
  const hard=new Array(m).fill(false);
  for(let i=0;i<m&&!tiny;i++){
    if(!closed&&(i===0||i===m-1)){ hard[i]=true; continue; }
    const a=pts[(i-1+m)%m], b=pts[i], c=pts[(i+1)%m];
    const l1=Math.hypot(b[0]-a[0],b[1]-a[1]), l2=Math.hypot(c[0]-b[0],c[1]-b[1]);
    if(l1<1e-6||l2<1e-6) continue;
    const dot=((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]))/(l1*l2);
    if(dot<0.766) hard[i]=true;                 // a turn over ~40° is a corner
  }
  const out=[[pts[0][0],pts[0][1]]];
  const segs=closed?m:m-1;
  for(let i=0;i<segs;i++){
    const i1=i, i2=(i+1)%m;
    const p1=pts[i1], p2=pts[i2];
    const p0=hard[i1]?p1:pts[(i1-1+m)%m];
    const p3=hard[i2]?p2:pts[(i2+1)%m];
    const len=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);
    const steps=Math.min(8,Math.max(1,Math.round(len/0.7)));
    for(let k=1;k<=steps;k++){
      const t=k/steps, t2=t*t, t3=t2*t;
      out.push([
        0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
        0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
      ]);
    }
  }
  return out;
}

async function loadFont(name){
  if(LOADED[name]) return;
  const res=await fetch(SVG_FONTS[name]);
  if(!res.ok) throw new Error("font fetch failed");
  const doc=new DOMParser().parseFromString(await res.text(),"image/svg+xml");
  const face=doc.querySelector("font-face");
  const upem=+(face&&face.getAttribute("units-per-em"))||1000;
  const capH=+(face&&face.getAttribute("cap-height"))||upem*0.7;
  const kk=CAP/capH;
  const fontEl=doc.querySelector("font");
  const defAdv=+(fontEl&&fontEl.getAttribute("horiz-adv-x"))||upem*0.4;
  const asc=+(face&&face.getAttribute("ascent"))||capH*1.2;
  const desc=+(face&&face.getAttribute("descent"))||-capH*0.35;
  const map={};
  doc.querySelectorAll("glyph").forEach(g=>{
    const u=g.getAttribute("unicode");
    if(!u||[...u].length!==1) return;
    const adv=+g.getAttribute("horiz-adv-x")||defAdv;
    const d=g.getAttribute("d");
    map[u]={w:adv*kk,p:d?parseSvgPath(d,kk).map(smoothPoly):[]};
  });
  if(!map[" "]) map[" "]={w:defAdv*kk,p:[]};
  if(!map["?"]) map["?"]=LINE_FONT["?"];
  LOADED[name]={glyphs:map,lh:Math.max(34,(asc-desc)*kk*1.15)};
}

const font=()=>LOADED[FONTK]||LOADED.round;
const glyph=ch=>{ const f=font().glyphs; return f[ch]||f["?"]||LINE_FONT["?"]; };

/* the font's nature, measured from its own strokes: how much it
   curves per unit of ink, and how often it does hard corners */
function fontStats(entry){
  if(entry.stats) return entry.stats;
  let len=0, turn=0, corners=0;
  for(const ch in entry.glyphs){
    for(const pl of entry.glyphs[ch].p){
      for(let i=1;i<pl.length-1;i++){
        const a=pl[i-1], b=pl[i], c=pl[i+1];
        const l1=Math.hypot(b[0]-a[0],b[1]-a[1]), l2=Math.hypot(c[0]-b[0],c[1]-b[1]);
        if(l1<1e-6||l2<1e-6) continue;
        const dot=((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]))/(l1*l2);
        const ang=Math.acos(Math.max(-1,Math.min(1,dot)));
        if(ang>0.7) corners++;
        else turn+=ang;
        len+=l1;
      }
    }
  }
  entry.stats={
    curvK:Math.min(0.5,Math.max(0.02,turn/Math.max(len,1))),
    cornerRate:corners/Math.max(len,1),
  };
  return entry.stats;
}

/* ---- the stroke network --------------------------------------------- */
const cumsum=pts=>{
  const c=[0];
  for(let i=1;i<pts.length;i++)
    c.push(c[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  return c;
};
/* sub-polyline between arc positions a..b */
function cutPoly(pts,cum,a,b){
  const out=[];
  const at=d=>{
    let i=0;
    while(i<cum.length-1&&cum[i+1]<d) i++;
    const seg=cum[i+1]-cum[i]||1, t=(d-cum[i])/seg;
    return [pts[i][0]+(pts[i+1][0]-pts[i][0])*t, pts[i][1]+(pts[i+1][1]-pts[i][1])*t];
  };
  out.push(at(a));
  for(let i=0;i<pts.length;i++) if(cum[i]>a+1e-6&&cum[i]<b-1e-6) out.push(pts[i]);
  out.push(at(b));
  return out;
}

let netCache=new Map();        // font|char → the letter's network
function buildNet(ch){
  // cache under the font actually in use — while a font is still
  // loading, the fallback's geometry must not squat on its key
  const key=(LOADED[FONTK]?FONTK:"round")+"|"+ch;
  let net=netCache.get(key);
  if(net) return net;

  const polys=glyph(ch).p.map(pl=>pl.map(p=>p.slice()));
  const isLoop=pl=>pl.length>2&&Math.hypot(pl[0][0]-pl[pl.length-1][0],pl[0][1]-pl[pl.length-1][1])<0.6;

  // endpoints that rest on another stroke become junctions: snap the
  // endpoint onto the stroke and remember where to split it
  const splits=polys.map(()=>[]);
  for(let i=0;i<polys.length;i++){
    const pl=polys[i];
    if(pl.length<2||isLoop(pl)) continue;
    for(const end of [0,1]){
      const Pt=end?pl[pl.length-1]:pl[0];
      let best=null;
      for(let j=0;j<polys.length;j++){
        if(j===i) continue;
        const q=polys[j], qc=cumsum(q);
        for(let s=0;s<q.length-1;s++){
          const d=distPtSeg(Pt[0],Pt[1],q[s][0],q[s][1],q[s+1][0],q[s+1][1]);
          if(d<TOL&&(!best||d<best.d)){
            const vx=q[s+1][0]-q[s][0], vy=q[s+1][1]-q[s][1];
            const L2=vx*vx+vy*vy;
            const t=L2?clamp01(((Pt[0]-q[s][0])*vx+(Pt[1]-q[s][1])*vy)/L2):0;
            best={d,j,pos:qc[s]+Math.hypot(vx,vy)*t,
                  x:q[s][0]+vx*t,y:q[s][1]+vy*t};
          }
        }
      }
      if(best){
        Pt[0]=best.x; Pt[1]=best.y;
        splits[best.j].push(best.pos);
      }
    }
  }

  const nodes=[];
  const nodeAt=(x,y)=>{
    for(let i=0;i<nodes.length;i++)
      if(Math.hypot(nodes[i][0]-x,nodes[i][1]-y)<1.2) return i;
    nodes.push([x,y]);
    return nodes.length-1;
  };

  const edges=[];
  for(let i=0;i<polys.length;i++){
    const pl=polys[i];
    if(pl.length<2) continue;
    const cum=cumsum(pl), L=cum[cum.length-1];
    if(L<0.5) continue;
    const cuts=[...new Set(splits[i].map(v=>+v.toFixed(2)))]
      .filter(v=>v>1&&v<L-1).sort((a,b)=>a-b);
    if(isLoop(pl)){
      const ext=pl.concat(pl.slice(1)), ec=cumsum(ext);
      let start=0;
      if(cuts.length) start=cuts[0];
      else{
        let ti=0;
        for(let k=1;k<pl.length-1;k++) if(pl[k][1]<pl[ti][1]) ti=k;
        start=cum[ti];
      }
      const stops=cuts.length?cuts:[start];
      for(let k=0;k<stops.length;k++){
        const a=stops[k], b=k+1<stops.length?stops[k+1]:stops[0]+L;
        const pts=cutPoly(ext,ec,a,b);
        edges.push({pts,cum:cumsum(pts),
          u:nodeAt(pts[0][0],pts[0][1]),
          v:nodeAt(pts[pts.length-1][0],pts[pts.length-1][1]),
          loopOnly:!cuts.length});
      }
    }else{
      const stops=[0,...cuts,L];
      for(let k=0;k<stops.length-1;k++){
        const pts=cutPoly(pl,cum,stops[k],stops[k+1]);
        edges.push({pts,cum:cumsum(pts),
          u:nodeAt(pts[0][0],pts[0][1]),
          v:nodeAt(pts[pts.length-1][0],pts[pts.length-1][1])});
      }
    }
  }
  for(const e of edges) e.len=e.cum[e.cum.length-1];

  const deg=new Array(nodes.length).fill(0);
  for(const e of edges){ deg[e.u]++; deg[e.v]++; }

  // the inky width profile, frozen into the letterform: bends swell
  // (the pen was slow), open terminals pool (the lines poured in
  // there), junctions bleed a little (ink gathers where strokes meet)
  for(const e of edges){
    const BIN=1.4;
    const n2=Math.max(1,Math.ceil(e.len/BIN));
    const kap=new Float32Array(n2);
    for(let i=1;i<e.pts.length-1;i++){
      const ax=e.pts[i][0]-e.pts[i-1][0], ay=e.pts[i][1]-e.pts[i-1][1];
      const bx=e.pts[i+1][0]-e.pts[i][0], by=e.pts[i+1][1]-e.pts[i][1];
      const l1=Math.hypot(ax,ay), l2=Math.hypot(bx,by);
      if(l1<1e-6||l2<1e-6) continue;
      const dot=(ax*bx+ay*by)/(l1*l2);
      const turn=Math.acos(Math.max(-1,Math.min(1,dot)));
      kap[Math.min(n2-1,Math.floor(e.cum[i]/BIN))]+=turn;
    }
    for(let i=0;i<n2;i++) kap[i]/=BIN;
    for(let pass=0;pass<2;pass++){
      const src=kap.slice();
      for(let i=0;i<n2;i++){
        const a2=src[Math.max(0,i-1)], c2=src[Math.min(n2-1,i+1)];
        kap[i]=(a2+2*src[i]+c2)/4;
      }
    }
    const uT=deg[e.u]===1, vT=deg[e.v]===1;
    const uJ=deg[e.u]>=3, vJ=deg[e.v]>=3;
    const prof=new Float32Array(n2);
    for(let i=0;i<n2;i++){
      const mid=(i+0.5)*BIN;
      const du2=mid, dv2=e.len-mid;
      // same curvature→width law as the rails (and so the bridge
      // letters): the letterforms wear the same ink
      let f=Math.min(2.1,Math.pow(1+kap[i]*CAP*0.75,0.55));
      let sw=1;
      if(uT){ const t2=Math.max(0,1-du2/2.5); sw=Math.max(sw,1+0.55*t2*t2); }
      if(vT){ const t2=Math.max(0,1-dv2/2.5); sw=Math.max(sw,1+0.55*t2*t2); }
      if(uJ){ const t2=Math.max(0,1-du2/1.8); sw=Math.max(sw,1+0.3*t2*t2); }
      if(vJ){ const t2=Math.max(0,1-dv2/1.8); sw=Math.max(sw,1+0.3*t2*t2); }
      prof[i]=Math.min(2.1,f*sw);
    }
    e.wprof=prof; e.wbin=BIN;
  }
  const entries=[];
  const tangent=(e,atU)=>{
    const d=Math.min(2,e.len*0.4);
    const Pt=atU?e.pts[0]:e.pts[e.pts.length-1];
    const Q=cutPoly(e.pts,e.cum,atU?0:e.len-d,atU?d:e.len)[atU?1:0];
    const l=Math.hypot(Pt[0]-Q[0],Pt[1]-Q[1])||1;
    return [(Pt[0]-Q[0])/l,(Pt[1]-Q[1])/l];
  };
  for(const e of edges){
    if(e.loopOnly&&e.u===e.v){       // doorless loop: kiss it at the top
      const [dx,dy]=tangent(e,true);
      entries.push({node:e.u,x:e.pts[0][0],y:e.pts[0][1],dx,dy});
    }
  }
  for(let n=0;n<nodes.length;n++){
    if(deg[n]!==1) continue;
    const e=edges.find(e2=>e2.u===n||e2.v===n);
    const [dx,dy]=tangent(e,e.u===n);
    entries.push({node:n,x:nodes[n][0],y:nodes[n][1],dx,dy});
  }

  // ink flows from each door on its own clock: per-door shortest paths,
  // and how deep each door must pour to fill everything it can reach
  const distPer=entries.map(en=>{
    const dist=new Array(nodes.length).fill(1e9);
    dist[en.node]=0;
    for(let pass=0;pass<nodes.length+2;pass++){
      let moved=false;
      for(const e of edges){
        if(dist[e.u]+e.len<dist[e.v]-1e-9){ dist[e.v]=dist[e.u]+e.len; moved=true; }
        if(dist[e.v]+e.len<dist[e.u]-1e-9){ dist[e.u]=dist[e.v]+e.len; moved=true; }
      }
      if(!moved) break;
    }
    return dist;
  });
  entries.forEach((en,i)=>{
    let depth=1;
    for(const e of edges){
      const du=distPer[i][e.u], dv=distPer[i][e.v];
      if(du<1e8&&dv<1e8) depth=Math.max(depth,(du+dv+e.len)/2);
    }
    en.depth=depth;
  });

  // connected pieces: one line forms each piece, another empties it
  const parent=[...Array(nodes.length).keys()];
  const find=a=>parent[a]===a?a:(parent[a]=find(parent[a]));
  for(const e of edges){ const a=find(e.u),b=find(e.v); if(a!==b) parent[a]=b; }
  const groups={};
  entries.forEach((en,i)=>{
    const r=find(en.node);
    (groups[r]=groups[r]||[]).push(i);
  });
  const compGroups=Object.values(groups);

  net={w:glyph(ch).w,edges,nodes,entries,distPer,compGroups};
  netCache.set(key,net);
  return net;
}

/* ---- layout & drawing ----------------------------------------------- */
function layout(){
  W=innerWidth; H=innerHeight;
  DPR=Math.min(devicePixelRatio||1,2);
  canvas.width=W*DPR; canvas.height=H*DPR;
  canvas.style.width=W+"px"; canvas.style.height=H+"px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
  DANCE_CACHE=new Map();
}

function strokePartial(pts,cum,a,b,x,yMid,s){
  if(b-a<0.05) return;
  const sub=cutPoly(pts,cum,Math.max(0,a),Math.min(cum[cum.length-1],b));
  ctx.beginPath();
  for(let i=0;i<sub.length;i++){
    const X=x+sub[i][0]*s, Y=yMid+(sub[i][1]-MID)*s;
    i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);
  }
  ctx.stroke();
}
const clampLen=(v,L)=>Math.max(0,Math.min(v,L));

/* a variable-width line as chained round-capped strokes: the canvas
   stroker builds the envelope (it cannot fold or crease, unlike a
   hand-offset polygon), a degenerate end segment becomes a perfect
   direction-independent disc, and runs break only when the width has
   drifted ~4% — steps far below visibility */
function fillRibbon(S){
  if(S.length<2) return;
  let i=0;
  while(i<S.length-1){
    const w0=S[i][2];
    let j=i+1;
    while(j<S.length-1&&Math.abs(S[j][2]-w0)<=w0*0.04) j++;
    ctx.lineWidth=Math.max(0.2,(w0+S[j][2])/2);
    ctx.beginPath();
    ctx.moveTo(S[i][0],S[i][1]);
    for(let k=i+1;k<=j;k++) ctx.lineTo(S[k][0],S[k][1]);
    ctx.stroke();
    i=j;
  }
}

/* a letter edge with its frozen ink profile, ribbon-rendered; widths
   interpolate between bin centers, so they flow */
function strokeEdgeOrganic(e,a,b,x,yMid,s){
  a=Math.max(0,a); b=Math.min(e.len,b);
  if(b-a<0.05) return;
  const BIN=e.wbin, prof=e.wprof, base=WEIGHT*s;
  const sub=cutPoly(e.pts,e.cum,a,b);
  const rib=[];
  let arc=a;
  for(let k=0;k<sub.length;k++){
    if(k>0) arc+=Math.hypot(sub[k][0]-sub[k-1][0],sub[k][1]-sub[k-1][1]);
    const f=arc/BIN-0.5;
    const i0=Math.max(0,Math.min(prof.length-1,Math.floor(f)));
    const i1=Math.min(prof.length-1,i0+1);
    const t=Math.min(1,Math.max(0,f-i0));
    rib.push([x+sub[k][0]*s,yMid+(sub[k][1]-MID)*s,base*(prof[i0]*(1-t)+prof[i1]*t)]);
  }
  fillRibbon(rib);
}

function strokePartialPx(pts,cum,a,b){
  if(b-a<0.5) return;
  const sub=cutPoly(pts,cum,Math.max(0,a),Math.min(cum[cum.length-1],b));
  ctx.beginPath();
  for(let i=0;i<sub.length;i++)
    i?ctx.lineTo(sub[i][0],sub[i][1]):ctx.moveTo(sub[i][0],sub[i][1]);
  ctx.stroke();
}

/* an improvised dance in the nature of the font: built OUTWARD from
   the door (so the arrival tangent is always clean), curving with the
   font's own bend radius, kinking as often as the font does corners,
   calm near the letter and freer the farther out it goes, gently
   steered until it leaves the screen */
let DANCE_CACHE=new Map();
let BRIDGE_BOXES=[];           // where bridge letters already stand this cycle
const angDiff=(to,from)=>{
  let d=to-from;
  while(d>Math.PI) d-=2*Math.PI;
  while(d<-Math.PI) d+=2*Math.PI;
  return d;
};
function makeDance(ex,ey,dx,dy,s,stats,R,bridges,tx,ty,block){
  const capPx=CAP*s;
  const rBase=Math.min(Math.max(0.9*s/stats.curvK,capPx*0.3),capPx*1.3);
  const step=Math.max(3,capPx*0.035);
  const homeAng=Math.atan2(dy,dx);
  const calm=capPx*0.8;
  const pts=[[ex,ey]];
  let px_=ex, py_=ey, ang=homeAng;
  let kcur=0, kTarget=0, beatLeft=0, traveled=0, guard=0;
  let bi=0, bOff=0;               // which bridge is next, and how much
                                  // path the written letters have added
  const inScreen=()=>px_>-60&&px_<W+60&&py_>-60&&py_<H+60;
  while(guard++<5000&&inScreen()){
    if(bi<bridges.length&&traveled>=bridges[bi].at+bOff){
      // write the letter here — unless it would sit on the text
      // itself or fall off the screen: then keep dancing and retry
      const st=bridges[bi].pts;
      const bs=s;                 // bridge letters at full size
      const ox=px_-st[0][0]*bs;
      let oy=py_-st[0][1]*bs;
      // sit the letter on the nearest text baseline — in line with
      // the final letters
      if(block&&block.baselines&&block.baselines.length){
        const gBase=oy+22*bs;
        let near=block.baselines[0];
        for(const b2 of block.baselines)
          if(Math.abs(b2-gBase)<Math.abs(near-gBase)) near=b2;
        oy+=near-gBase;
      }
      let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
      for(const p of st){
        const X=ox+p[0]*bs, Y=oy+p[1]*bs;
        if(X<mnx)mnx=X; if(X>mxx)mxx=X;
        if(Y<mny)mny=Y; if(Y>mxy)mxy=Y;
      }
      const pad=capPx*0.2;
      const onText=block&&mxx>block.x0-pad&&mnx<block.x1+pad&&mxy>block.y0-pad&&mny<block.y1+pad;
      const onScreen=mnx>10&&mxx<W-10&&mny>10&&mxy<H-10;
      const onOther=BRIDGE_BOXES.some(b2=>
        mxx>b2.x0-pad&&mnx<b2.x1+pad&&mxy>b2.y0-pad&&mny<b2.y1+pad);
      if(!onText&&onScreen&&!onOther){
        BRIDGE_BOXES.push({x0:mnx,y0:mny,x1:mxx,y1:mxy});
        bi++;
        const before=traveled;
        for(let i=0;i<st.length;i++){
          const nx=ox+st[i][0]*bs, ny=oy+st[i][1]*bs;
          traveled+=Math.hypot(nx-px_,ny-py_);
          px_=nx; py_=ny;
          pts.push([px_,py_]);
        }
        bOff+=traveled-before;
        const a=st[st.length-2]||st[0], b=st[st.length-1];
        ang=Math.atan2(b[1]-a[1],b[0]-a[0]);
        kcur=0; kTarget=0; beatLeft=0;
        continue;
      }
      if(traveled>bridges[bi].at+bOff+capPx*8) bi++;   // no clear spot — let it go
    }
    if(beatLeft<=0){
      beatLeft=rBase*(0.6+R()*1.3);
      const calmF=Math.min(1,traveled/calm);
      if(traveled>calm*0.6&&R()<Math.min(0.6,stats.cornerRate*beatLeft/s*1.4)){
        ang+=(R()<0.5?-1:1)*(0.6+R()*0.9);        // the font does corners — kink
        kTarget=0;
      }else{
        kTarget=(R()<0.5?-1:1)*(0.5+R()*1.3)/rBase*calmF;
      }
    }
    kcur+=(kTarget-kcur)*0.2;
    ang+=kcur*step;
    // ever-growing pull toward this line's own compass direction, so
    // entrances spread evenly around the center
    const outAng=Math.atan2(ty-py_,tx-px_);
    ang+=angDiff(outAng,ang)*Math.min(0.08,traveled/(capPx*30));
    px_+=Math.cos(ang)*step;
    py_+=Math.sin(ang)*step;
    traveled+=step; beatLeft-=step;
    pts.push([px_,py_]);
  }
  while(guard++<9000&&inScreen()){                // safety: walk straight out
    const outAng=Math.atan2(ty-py_,tx-px_);
    px_+=Math.cos(outAng)*step; py_+=Math.sin(outAng)*step;
    pts.push([px_,py_]);
  }
  pts.reverse();                                  // 0 = off-screen start, end = door
  const cum=cumsum(pts);
  // effort: arc length plus a premium per radian of turning — the
  // organic clock advances through effort, so bends cost time. the
  // premium is blurred along the path so the head never stutters over
  // lumpy vertex spacing
  const KC=capPx*0.75;
  const segL=[], prem=[];
  for(let i=1;i<pts.length;i++){
    const seg=cum[i]-cum[i-1];
    let turn=0;
    if(i<pts.length-1){
      const ax=pts[i][0]-pts[i-1][0], ay=pts[i][1]-pts[i-1][1];
      const bx=pts[i+1][0]-pts[i][0], by=pts[i+1][1]-pts[i][1];
      const l1=Math.hypot(ax,ay), l2=Math.hypot(bx,by);
      if(l1>1e-6&&l2>1e-6){
        const dot=(ax*bx+ay*by)/(l1*l2);
        turn=Math.acos(Math.max(-1,Math.min(1,dot)));
      }
    }
    segL.push(seg);
    prem.push(seg>1e-6?KC*turn/seg:0);
  }
  for(let pass=0;pass<4;pass++){
    const src=prem.slice();
    for(let i=0;i<prem.length;i++){
      const a2=src[Math.max(0,i-1)], c2=src[Math.min(prem.length-1,i+1)];
      prem[i]=(a2+2*src[i]+c2)/4;
    }
  }
  const eff=[0];
  for(let i=0;i<segL.length;i++) eff.push(eff[i]+segL[i]*(1+prem[i]));
  return {pts,cum,A:cum[cum.length-1],eff,Et:eff[eff.length-1]};
}

/* arc position for a given effort along a path */
function arcOfEffort(P,e){
  const eff=P.eff, cum=P.cum;
  if(e<=0) return 0;
  if(e>=P.Et) return P.A;
  let lo=0, hi=eff.length-1;
  while(lo<hi){ const m=(lo+hi)>>1; if(eff[m]<e) lo=m+1; else hi=m; }
  const i=lo-1, sp=eff[i+1]-eff[i]||1;
  return cum[i]+(cum[i+1]-cum[i])*(e-eff[i])/sp;
}

const RET=()=>FORM_MS*RET_FRAC;
let FORMED_AT=null;            // when the last line finished forming
const formedAll=now=>FORMED_AT!==null&&now-FORMED_AT>=RET();

/* a stable shuffle: every line's entrance delay is random, rerolled
   each time the letters form (and again when they release) */
const rnd=(a,b,seed)=>{
  const x=Math.sin(a*127.1+b*311.7+seed*0.618034)*43758.5453;
  return x-Math.floor(x);
};

function draw(now){
  ctx.clearRect(0,0,W,H);
  const lines=text.split("\n");
  const LH=font().lh;
  const widths=lines.map(l=>[...l].reduce((a,ch)=>a+glyph(ch).w,0));
  const maxW=Math.max(...widths,1);
  // the comfortable fit first, then the size knob scales from there —
  // 0.55 is exactly the fitted look, the top of the range runs the
  // text full-bleed, never past the screen
  let s=0.55*Math.min(W,H)/CAP;
  s=Math.min(s,0.92*W/maxW,0.84*H/(lines.length*LH));
  s=Math.min(s*SIZE/0.55,W/maxW,H/(lines.length*LH));

  ctx.lineCap="round"; ctx.lineJoin="round";
  ctx.strokeStyle=INK;
  ctx.fillStyle=INK;             // the organic ribbons are filled
  ctx.lineWidth=WEIGHT*s;
  const Lpx=LINE_LEN>=6?Infinity:LINE_LEN*CAP*s;
  const VCAP=0.85*Math.max(W,H)/1000;   // top cruise speed: px per ms

  // organic rail: drawn in short runs — width follows the pen's local
  // speed (global ease over curvature effort), and a damped wake
  // flutters behind the moving end, settling as it passes
  const capPx=CAP*s, baseW=WEIGHT*s, chunkLen=Math.max(6,capPx*0.07);
  function railOrganic(d,a0,a1,anchor,sgn){
    const P=d.path, pts=P.pts, cum=P.cum, eff=P.eff;
    a0=Math.max(0,a0); a1=Math.min(P.A,a1);
    if(a1-a0<0.5) return;
    let i=0;
    while(i<cum.length-2&&cum[i+1]<=a0) i++;
    const lerpAt=(j,arc)=>{
      const t=(arc-cum[j])/((cum[j+1]-cum[j])||1);
      return [pts[j][0]+(pts[j+1][0]-pts[j][0])*t,
              pts[j][1]+(pts[j+1][1]-pts[j][1])*t,
              eff[j]+(eff[j+1]-eff[j])*t, arc];
    };
    let S=[lerpAt(i,a0)];
    for(let j=i+1;j<pts.length&&cum[j]<a1;j++) S.push([pts[j][0],pts[j][1],eff[j],cum[j]]);
    let j2=i; while(j2<cum.length-2&&cum[j2+1]<a1) j2++;
    S.push(lerpAt(j2,a1));
    // densify long straight stretches so width can flow along them
    const D=[S[0]];
    for(let k=1;k<S.length;k++){
      const p0=D[D.length-1], p1=S[k];
      const gap=p1[3]-p0[3];
      const nIns=Math.floor(gap/chunkLen);
      for(let m=1;m<=nIns;m++){
        const t=m*chunkLen/gap;
        if(t>=1) break;
        D.push([p0[0]+(p1[0]-p0[0])*t,p0[1]+(p1[1]-p0[1])*t,
                p0[2]+(p1[2]-p0[2])*t,p0[3]+gap*t]);
      }
      D.push(p1);
    }
    S=D;
    // the wake: offset each sample along its normal. the ripple is
    // pinned to the path, so a fast head sweeps its envelope over the
    // standing wave — beyond a couple of flips per second that reads
    // as churn, and a fast pen should streak clean instead: fade the
    // flutter with the apparent flip rate at the moving end
    const lam=2*Math.PI*capPx*0.16;
    const flips=(d.vAnchor||0)*1000/lam;
    const calm=1/(1+flips*flips*0.25);
    for(let k=0;k<S.length;k++){
      const p=S[k];
      const q0=S[Math.max(0,k-1)], q1=S[Math.min(S.length-1,k+1)];
      let nx=q1[1]-q0[1], ny=-(q1[0]-q0[0]);
      const nl=Math.hypot(nx,ny)||1; nx/=nl; ny/=nl;
      const behind=sgn*(anchor-p[3]);
      if(behind>0){
        const r=Math.max(0.12,EASE_SLOPE(Math.min(1,p[2]/d.spanEff)));
        // the ripple is pinned to the PATH (phase from absolute arc),
        // only its envelope travels with the head — frame-coherent at
        // any speed. amplitude is capped in ABSOLUTE px and the quiet
        // zone at the tip grows with the stroke width, so thick lines
        // don't writhe at the head
        const quiet=Math.max(chunkLen*1.2,baseW*1.6);
        const del=calm*Math.min(baseW*1.1,capPx*0.1)*Math.min(1.4,Math.max(0,r-0.5))
          *Math.sin(p[3]/(capPx*0.16))
          *Math.exp(-behind/(capPx*0.7))
          *Math.min(1,behind/quiet)             // the tip itself stays steady
          *Math.max(0,Math.min(1,(d.A-p[3])/(capPx*0.5)));
        p[0]+=nx*del; p[1]+=ny*del;
      }
    }
    // one ribbon: per-sample widths interpolated between FIXED arc
    // bins — smooth thick→thin flow, no cap discs, no frame flicker
    const effAtArc=arc=>{
      if(arc<=0) return 0;
      if(arc>=P.A) return P.Et;
      let lo=0,hi=cum.length-1;
      while(lo<hi){ const m=(lo+hi)>>1; if(cum[m]<arc) lo=m+1; else hi=m; }
      const j=lo-1, sp=cum[j+1]-cum[j]||1;
      return eff[j]+(eff[j+1]-eff[j])*(arc-cum[j])/sp;
    };
    const wCache=new Map();
    const widthOfBin=bi=>{
      let w=wCache.get(bi);
      if(w===undefined){
        const b0=Math.max(0,Math.min(P.A-0.001,bi*chunkLen));
        const b1=Math.min(P.A,b0+chunkLen);
        const eA=effAtArc(b0), eB=effAtArc(b1);
        const dens=Math.max(1,(eB-eA)/Math.max(0.001,b1-b0));
        const y=Math.min(1,((eA+eB)/2)/d.spanEff);
        const r=Math.max(0.12,EASE_SLOPE(y)/dens);
        w=baseW*Math.max(0.55,Math.min(2.1,Math.pow(1/r,0.55)));
        wCache.set(bi,w);
      }
      return w;
    };
    // a rail shorter than a couple of pen-widths is being born or
    // absorbed — it thins away instead of popping in and out as a
    // full-width disc
    const melt=Math.min(1,(a1-a0)/Math.max(chunkLen,baseW*2.2));
    // approaching the door the pen's width eases into the letter's
    // own ink there — the landing swell never outgrows the letter
    const doorW=baseW*(d.doorK||1);
    const BL=Math.max(baseW*2,capPx*0.35);
    const rib=[];
    for(const p of S){
      const f=p[3]/chunkLen-0.5;
      const i0=Math.max(0,Math.floor(f));
      const t=Math.min(1,Math.max(0,f-i0));
      let w=widthOfBin(i0)*(1-t)+widthOfBin(i0+1)*t;
      const nd=Math.max(0,1-(P.A-p[3])/BL);
      w+=(doorW-w)*nd*nd;
      rib.push([p[0],p[1],w*melt]);
    }
    fillRibbon(rib);
  }

  // one line per letter (per connected piece): it enters on a randomly
  // drawn moment inside a window sized so entrances are, on average,
  // one gap apart, and takes its own full journey at the tempo
  let totalLines=0;
  for(const ch of text) if(ch!=="\n") totalLines+=buildNet(ch).compGroups.length;
  const releasing=mode==="out";
  const WINDOW=GAP_MS*totalLines;
  const lt=releasing?now-outBorn:now-born;
  const seed=born;               // the release keeps the entrance's order

  let allCovered=true, allArrived=true, allGone=true;

  // the text's own ground — bridge letters stay off it, but sit on
  // its baselines
  const block={
    x0:W/2-maxW*s/2, x1:W/2+maxW*s/2,
    y0:H/2-((lines.length-1)/2*LH+10.5)*s,
    y1:H/2+((lines.length-1)/2*LH+17.5)*s,
    baselines:lines.map((_,ln)=>H/2+(ln-(lines.length-1)/2)*LH*s+(22-MID)*s),
  };
  let lineNo=0;                  // running line index → compass slots

  let li=0;
  for(let ln=0;ln<lines.length;ln++){
    const yMid=H/2+(ln-(lines.length-1)/2)*LH*s;
    if(!lines[ln].length) continue;
    let x=W/2-widths[ln]*s/2;
    for(const ch of lines[ln]){
      const net=buildNet(ch);
      const adv=net.w*s;
      const myLi=li++;
      if(!net.entries.length){ x+=adv; continue; }

      const doorGeo=di=>{
        const en=net.entries[di];
        if(en.wk===undefined){
          // the letter's own ink width right at this door — the rail
          // blends into it so line and letter read as one stroke
          const e2=net.edges.find(e3=>e3.u===en.node||e3.v===en.node);
          en.wk=e2?e2.wprof[e2.u===en.node?0:e2.wprof.length-1]:1;
        }
        const ex=x+en.x*s, ey=yMid+(en.y-MID)*s;
        let A=1e9;
        if(en.dx>1e-6) A=Math.min(A,(W+60-ex)/en.dx);
        if(en.dx<-1e-6) A=Math.min(A,(-60-ex)/en.dx);
        if(en.dy>1e-6) A=Math.min(A,(H+60-ey)/en.dy);
        if(en.dy<-1e-6) A=Math.min(A,(-60-ey)/en.dy);
        if(A>1e8) A=(W+H)/2;
        return {ex,ey,dx:en.dx,dy:en.dy,A,di,depth:en.depth,doorK:en.wk};
      };
      // ONE line per piece: a random door forms it; a different door —
      // the most opposite one — empties it on release
      const letterDelay=rnd(myLi,1,seed)*WINDOW;
      const doors=[];
      for(let gi=0;gi<net.compGroups.length;gi++){
        const list=net.compGroups[gi];
        const entryDi=list[Math.min(list.length-1,Math.floor(rnd(myLi,2+gi,seed)*list.length))];
        let useDi=entryDi;
        if(releasing&&list.length>1){
          const ed=net.entries[entryDi];
          let bj=entryDi, bs=1e9;
          for(const j of list){
            if(j===entryDi) continue;
            const sc=ed.dx*net.entries[j].dx+ed.dy*net.entries[j].dy
                     +0.3*rnd(myLi,40+j,seed);
            if(sc<bs){ bs=sc; bj=j; }
          }
          useDi=bj;
        }
        const d=doorGeo(useDi);
        const myLine=lineNo++;
        if(RAILS==="dance"){
          const ck=myLi+"|"+useDi+"|"+(releasing?"o":"i");
          let path=DANCE_CACHE.get(ck);
          if(!path){
            let k=0;
            const salt=myLi*13.7+useDi*3.1+(releasing?51:7);
            const R=()=>rnd(salt,k++,seed);
            // every line owns an evenly spaced compass direction —
            // entrances spread all around the center
            const compass=2*Math.PI*((myLine*0.618034+rnd(0.77,0.13,seed))%1);
            const tx=W/2+Math.cos(compass)*(W+H);
            const ty=H/2+Math.sin(compass)*(W+H);
            // the bridges: three random letters written along the way,
            // scattered over the whole journey (probed first)
            let k2=0;
            const R2=()=>rnd(salt,k2++,seed);
            const probe=makeDance(d.ex,d.ey,d.dx,d.dy,s,fontStats(font()),R2,[],tx,ty,block);
            const pool="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
            const bridges=[];
            for(let bn=0;bn<3;bn++){
              const bg=glyph(pool[Math.floor(rnd(salt,7000+bn,seed)*pool.length)%pool.length]);
              let best=null, bl=0;
              for(const pl of (bg?bg.p:[])){
                const c=cumsum(pl), L2=c[c.length-1];
                if(L2>bl&&pl.length>1){ bl=L2; best=pl; }
              }
              if(best) bridges.push({pts:best,at:probe.A*(0.08+rnd(salt,9000+bn,seed)*0.8)});
            }
            bridges.sort((a,b)=>a.at-b.at);
            path=makeDance(d.ex,d.ey,d.dx,d.dy,s,fontStats(font()),R,bridges,tx,ty,block);
            DANCE_CACHE.set(ck,path);
          }
          d.path=path; d.A=path.A;
        }
        d.delay=letterDelay;
        if(FEEL==="organic"&&!d.path){
          // straight rails get a two-point path so they too can carry
          // width and wake
          d.path={pts:[[d.ex+d.dx*d.A,d.ey+d.dy*d.A],[d.ex,d.ey]],
                  cum:[0,d.A],A:d.A,eff:[0,d.A],Et:d.A};
        }
        const span=d.A+d.depth*s;
        d.span=span;
        const Et=(FEEL==="organic"&&d.path)?d.path.Et:d.A;
        const S2=Et+d.depth*s;
        d.spanEff=S2;
        // speed cap on the PLATEAU only: the launch and the landing
        // keep the tempo's exact accel curve; a journey too long to
        // cruise under the cap spends longer in the middle instead
        const tt=lt-d.delay;
        let ge;
        if(easeIO.peak*S2/FORM_MS<=VCAP){
          d.T=FORM_MS;
          const yE=easeIO(tt/FORM_MS);
          ge=(releasing?1-yE:yE)*S2;
          d.vHead=(tt<=0||tt>=FORM_MS)?0:EASE_SLOPE(yE)*S2/FORM_MS;
        }else{
          const tc=Math.max(0.001,
            (10+Math.log2(VCAP*FORM_MS*easeIO.F1/(S2*easeIO.K)))/20);
          const tr=tc*FORM_MS;
          const dR=S2*easeIO.raw(tc)/easeIO.F1;
          const tMid=Math.max(0,S2-2*dR)/VCAP;
          d.T=2*tr+tMid;
          const q=releasing?d.T-tt:tt;
          if(q<=0){ ge=0; d.vHead=0; }
          else if(q<tr){ ge=S2*easeIO.raw(q/FORM_MS)/easeIO.F1;
            d.vHead=2*easeIO.K*ge/FORM_MS; }
          else if(q<tr+tMid){ ge=dR+VCAP*(q-tr); d.vHead=VCAP; }
          else if(q<d.T){ ge=S2-S2*easeIO.raw((d.T-q)/FORM_MS)/easeIO.F1;
            d.vHead=2*easeIO.K*(S2-ge)/FORM_MS; }
          else{ ge=S2; d.vHead=0; }
        }
        if(FEEL==="organic"&&d.path){
          // the organic clock advances through EFFORT — bends and
          // bridge letters cost time, so the pen slows in them
          d.g=ge<=Et?arcOfEffort(d.path,ge):d.A+(ge-Et);
        }else{
          d.g=ge;
        }
        if(!releasing&&d.g<d.A-0.5) allArrived=false;
        if(releasing&&d.g>0.5) allGone=false;
        doors.push(d);
      }

      // ink coverage: how far the line's flow has reached
      const nn=net.nodes.length;
      const cov=new Array(nn).fill(-1e9);
      for(const d of doors){
        const dist=net.distPer[d.di];
        const inkPx=d.g-d.A;
        for(let n2=0;n2<nn;n2++){
          const c=inkPx/s-dist[n2];
          if(c>cov[n2]) cov[n2]=c;
        }
      }
      for(const e of net.edges){
        const cu=clampLen(cov[e.u],e.len);
        const cv=clampLen(cov[e.v],e.len);
        if(cu+cv<e.len-0.05) allCovered=false;
        if(cu<=0&&cv<=0) continue;
        const inkDraw=FEEL==="organic"
          ?(a2,b2)=>strokeEdgeOrganic(e,a2,b2,x,yMid,s)
          :(a2,b2)=>strokePartial(e.pts,e.cum,a2,b2,x,yMid,s);
        if(cu+cv>=e.len-0.05) inkDraw(0,e.len);
        else{
          if(cu>0) inkDraw(0,cu);
          if(cv>0) inkDraw(e.len-cv,e.len);
        }
      }

      // the lines outside: head at min(g,A). each line's tail draws
      // itself in the moment ITS journey is done — first in, first
      // gone — and on release it reaches back out in the same order.
      // a finite length makes the line a traveling worm: its far end
      // folds forward without waiting for the head to arrive
      for(const d of doors){
        const head=Math.min(d.g,d.A);
        let tc;
        if(!releasing){
          // fold from wherever the tail actually is, in proportional
          // time — a short line's stub never sits waiting
          const wormTc=Lpx<Infinity?Math.max(0,Math.min(d.A,d.span-Lpx)):0;
          const remain=Math.max(d.A-wormTc,1e-6);
          const dur=Math.max(RET()*0.15,RET()*remain/Math.max(d.A,1));
          const tR=(lt-d.delay-d.T)/dur;
          tc=tR<=0?0:wormTc+easeIO(tR)*remain;
          if(Lpx<Infinity) tc=Math.max(tc,Math.min(d.A,d.g-Lpx));
        }else if(Lpx===Infinity){
          // endless lines reach all the way out and drain through
          tc=(1-easeIO((lt-d.delay)/RET()))*d.A;
        }else{
          // finite lines conserve: what drains out of the letter IS
          // the line — a column whose front starts moving with the
          // first drop and rides the rail out once the letter is empty
          tc=Math.max(0,d.g-(d.span-d.A));
        }
        if(head-tc>0.5){
          if(FEEL==="organic"&&d.path){
            d.vAnchor=d.vHead||0;
            if(releasing&&Lpx===Infinity){
              // the endless drain's front rides the RET sweep, not
              // the door clock — the wake trails that end instead
              const tR=(lt-d.delay)/RET();
              d.vAnchor=(tR<=0||tR>=1)?0:EASE_SLOPE(easeIO(tR))*d.A/RET();
            }
            railOrganic(d,tc,head,releasing?tc:head,releasing?-1:1);
          }
          else if(d.path) strokePartialPx(d.path.pts,d.path.cum,tc,head);
          else{
            ctx.beginPath();
            ctx.moveTo(d.ex+d.dx*(d.A-tc), d.ey+d.dy*(d.A-tc));
            ctx.lineTo(d.ex+d.dx*(d.A-head), d.ey+d.dy*(d.A-head));
            ctx.stroke();
          }
        }
      }
      x+=adv;
    }
  }

  // the moments the whole text crosses its thresholds
  if(!releasing){
    if(FORMED_AT===null&&totalLines&&allCovered&&allArrived) FORMED_AT=now;
  }else if(lt>RET()&&allGone){
    reform();
  }
}

function frame(now){
  draw(now);
  requestAnimationFrame(frame);
}

window.addEventListener("resize",layout);
canvas.addEventListener("pointerdown",()=>{
  const now=performance.now();
  if(mode==="in"&&formedAll(now)){ mode="out"; outBorn=now; BRIDGE_BOXES=[]; }
});

/* ---- the panel ------------------------------------------------------ */
const K=id=>document.getElementById(id);
const lettersBox=K("lettersBox");

function growBox(){
  lettersBox.style.height="auto";
  lettersBox.style.height=lettersBox.scrollHeight+"px";
}

/* the panel is furniture — grab a blank spot and carry it anywhere */
function makeDraggable(el){
  el.addEventListener("pointerdown",e=>{
    if(e.target.closest("input,button,textarea,select,a")) return;
    e.preventDefault();
    const r=el.getBoundingClientRect();
    const dx=e.clientX-r.left, dy=e.clientY-r.top;
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
makeDraggable(K("panel"));

function reform(){
  mode="in"; born=performance.now(); FORMED_AT=null;
  DANCE_CACHE=new Map();
  BRIDGE_BOXES=[];
}
function pickFont(key){
  FONTK=key;
  reform();
  if(SVG_FONTS[key]&&!LOADED[key]){
    loadFont(key)
      .then(()=>{ if(FONTK===key) reform(); })
      .catch(()=>{ if(FONTK===key){ FONTK="round"; K("k-font").value="round"; reform(); } });
  }
  netCache=new Map();
}

function initPanel(){
  K("k-font").value=FONTK;
  K("k-rails").value=RAILS;
  K("k-feel").value=FEEL;
  K("k-size").value=SIZE;
  K("k-weight").value=WEIGHT;
  K("k-speed").value=FORM_MS;
  K("k-gap").value=GAP_MS;
  K("k-len").value=LINE_LEN;
  K("k-ink").value=INK;
  lettersBox.value=DEFAULT_TEXT;
  growBox();

  K("k-font").addEventListener("change",e=>pickFont(e.target.value));
  K("k-rails").addEventListener("change",e=>{ RAILS=e.target.value; reform(); });
  K("k-feel").addEventListener("change",e=>{ FEEL=e.target.value==="clean"?"clean":"organic"; reform(); });
  K("k-size").addEventListener("input",e=>{ SIZE=+e.target.value; reform(); });
  K("k-weight").addEventListener("input",e=>{ WEIGHT=+e.target.value; });
  K("k-speed").addEventListener("input",e=>{ FORM_MS=+e.target.value; });
  K("k-gap").addEventListener("input",e=>{ GAP_MS=+e.target.value; reform(); });
  K("k-len").addEventListener("input",e=>{ LINE_LEN=+e.target.value; });
  K("k-ink").addEventListener("input",e=>{ INK=e.target.value; });

  lettersBox.addEventListener("input",()=>{
    growBox();
    const t=lettersBox.value;
    if(!t.replace(/\s/g,"").length) return;   // keep the last letters
    text=t;
    reform();
  });
}

initPanel();
layout();
pickFont(FONTK);
requestAnimationFrame(frame);
