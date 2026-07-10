/* YALLA — flat, until it isn't (WebGL edition)
   ------------------------------------------------------------
   Letters are REAL extruded glyph geometry (THREE.TextGeometry) —
   solid sides at any angle. Comic style: black front, white body,
   black ink lines along the geometry edges.

   Division of labor:
   - DOM still owns layout: invisible ghost letters fill the slots,
     so fit()/wrapping/whitespace behave exactly like the CSS
     version, and the burst images still live in the slots.
   - WebGL owns the letters: one mesh per letter on a transparent
     canvas, camera matched so world units == CSS pixels, meshes
     anchored to the measured slots.
   - At rest a mesh faces the camera dead-on, so only its black
     front cap is visible: genuinely flat, until it isn't.

   Wave / tween / pose rules are identical to sketch.js.
   Knobs live in config.js.
   ------------------------------------------------------------ */

const TAU = Math.PI*2;
const DEG = Math.PI/180;
const SECTOR_OFFSET = Math.random()*TAU;  // sector wheel gets a random spin per page load

const easeInOut = x => x<.5 ? 16*x*x*x*x*x : 1-Math.pow(-2*x+2,5)/2;  // quintic: snappier than cubic
const rnd  = (a,b)=>a+Math.random()*(b-a);
const sgn  = ()=>Math.random()<0.5?-1:1;
const clamp= (v,a,b)=>v<a?a:v>b?b:v;

/* ---- image bag: draw burst images without replacement -------
   Every image is used once before any repeats; when the shuffled
   deck empties it reshuffles and continues. build() resets it so
   each render gets the most even spread across the pool. */
let imageBag=[];
function nextImage(){
  if(!imageBag.length){
    imageBag=IMAGES.slice();
    for(let i=imageBag.length-1;i>0;i--){       // Fisher–Yates shuffle
      const j=(Math.random()*(i+1))|0;
      [imageBag[i],imageBag[j]]=[imageBag[j],imageBag[i]];
    }
  }
  return imageBag.pop();
}

/* ---- DOM ---------------------------------------------------- */
const stage=document.getElementById("stage");
const word=document.getElementById("word");
const hint=document.getElementById("hint");
const textbox=document.getElementById("textbox");

let letters=[];
let sMin=Infinity, sMax=-Infinity;  // wave axis extent — set by fit()
let wave=null;                      // {t0} while a sweep is running

/* ---- three.js scene ----------------------------------------- */
const PERSPECTIVE=900;              // matches the CSS version's perspective: 900px
const BEVEL=0;                      // no chamfer: crisp 90° rims so the ink outline always draws

const renderer=new THREE.WebGLRenderer({canvas:document.getElementById("gl"), alpha:true, antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(40, 1, 10, 4000);

const FONT=new THREE.Font(FONT_DATA);
/* baseline offset from the line-box top, as a fraction of font-size —
   derived from the same hhea metrics the browser uses to place the
   ghost glyphs (half-leading layout, line-height:1) */
const BASELINE_RATIO=(FONT_DATA.ascender
  + (FONT_DATA.resolution-(FONT_DATA.ascender-FONT_DATA.descender))/2)/FONT_DATA.resolution;

const inkMat=new THREE.MeshBasicMaterial({color:0x1c1a17});   // front cap: flat ink, same as paper design
const whiteBase=new THREE.MeshBasicMaterial({color:0xffffff}); // body: sides + back — unlit, flat white
const lineBase=new THREE.LineBasicMaterial({color:0x1c1a17}); // black ink along every edge

let W=0, H=0;
function resize(){
  W=stage.clientWidth; H=stage.clientHeight;
  renderer.setSize(W,H,false);
  camera.aspect=W/H;
  camera.fov=2*Math.atan((H/2)/PERSPECTIVE)/DEG;   // world units == CSS px at z=0
  camera.position.set(0,0,PERSPECTIVE);
  camera.updateProjectionMatrix();
}
resize();

/* screen px → world coords (origin = stage center, y up) */
const wx=x=>x-W/2;
const wy=y=>H/2-y;

/* one geometry per unique character per font size; rebuilt on build() */
const geoCache=new Map();
function getGeo(ch,F){
  if(geoCache.has(ch)) return geoCache.get(ch);
  if(!FONT_DATA.glyphs[ch]){ geoCache.set(ch,null); return null; }
  const geo=new THREE.TextGeometry(ch,{
    font:FONT, size:F, height:DEPTH,
    curveSegments:10,
    bevelEnabled:false,
  });
  geo.computeBoundingBox();
  const bb=geo.boundingBox;
  const ox=(bb.min.x+bb.max.x)/2, oy=(bb.min.y+bb.max.y)/2;
  // center x/y (so meshes rotate around the glyph center, like CSS
  // transform-origin), and put the FRONT cap at z=0 (like the CSS face)
  geo.translate(-ox,-oy,-(DEPTH+BEVEL));

  // ExtrudeGeometry lumps both caps into material 0 — reassign the BACK
  // cap to the body material (1), so only the front stays ink. Triangles
  // are classified by depth and re-grouped in contiguous runs.
  const pos=geo.attributes.position;
  const groups=geo.groups.slice();
  geo.clearGroups();
  const zMid=-(DEPTH+2*BEVEL)/2;
  for(const g of groups){
    if(g.materialIndex!==0){ geo.addGroup(g.start,g.count,1); continue; }
    let runStart=g.start, runMat=-1;
    for(let v=g.start; v<g.start+g.count; v+=3){
      const m=(pos.getZ(v)+pos.getZ(v+1)+pos.getZ(v+2))/3 > zMid ? 0 : 1;
      if(runMat===-1) runMat=m;
      else if(m!==runMat){ geo.addGroup(runStart,v-runStart,runMat); runStart=v; runMat=m; }
    }
    if(runMat!==-1) geo.addGroup(runStart,g.start+g.count-runStart,runMat);
  }

  // the black comic outline: only REAL creases (cap rims, glyph corners) get
  // ink — the threshold keeps the segmented curves' seams from being drawn
  // across the white sides, where they read as smudged shading
  const edges=new THREE.EdgesGeometry(geo, 30);

  const entry={geo, edges, ox, oy};
  geoCache.set(ch,entry);
  return entry;
}

/* ---- build the letters ------------------------------------- */
function makeLetter(ch,i){
  const slot=document.createElement("div");
  slot.className="slot asleep";
  const el=document.createElement("div");
  el.className="letter";
  el.innerHTML=`<span class="face">${ch}</span>`;   // invisible ghost — layout only
  // burst images live behind the letter, in the slot
  const burst=document.createElement("div");
  burst.className="burst";
  for(let k=0;k<BURST.count;k++){
    const s=document.createElement("img");
    s.className="shape";
    s.src="images/"+nextImage();
    s.style.width=rnd(...BURST.size).toFixed(3)+"em";   // height:auto keeps aspect
    // idle float: per-shape amplitude, cycle time and phase (negative delay
    // starts each bob mid-cycle so the swarm never moves in unison)
    s.style.setProperty("--fy",(BURST.float.y*rnd(0.6,1.4)).toFixed(3)+"em");
    s.style.setProperty("--fr",(BURST.float.deg*rnd(0.6,1.4)).toFixed(1)+"deg");
    s.style.animationDuration=rnd(...BURST.float.time).toFixed(2)+"s";
    s.style.animationDelay=(-rnd(0,4)).toFixed(2)+"s";
    burst.appendChild(s);
  }
  slot.appendChild(burst);
  slot.appendChild(el);
  letters.push({ slot, ch, i, p:0, target:0, phase:Math.random()*TAU, pose:null,
                 shapes:[...burst.children], mesh:null, ox:0, oy:0,
                 mx:0, my:0, cx:0, cy:0, s:0, asleep:true });
  return slot;
}

/* fresh explosion trajectories, rolled alongside the letter's pose */
function rollBurst(L){
  for(const s of L.shapes){
    const a=Math.random()*TAU;
    const d=rnd(...POSE.radius)*BURST.spread;
    s.style.setProperty("--dx",(Math.cos(a)*d).toFixed(1)+"px");
    s.style.setProperty("--dy",(Math.sin(a)*d).toFixed(1)+"px");
    s.style.setProperty("--rt",rnd(-180,180).toFixed(0)+"deg");
  }
}

/* Rebuild everything from free text — same tokenization as sketch.js:
   words become no-break chunks, every space is a visible spacer slot. */
function build(text){
  imageBag=[];   // fresh deck per render — most even spread for the current word
  for(const L of letters) if(L.mesh){ scene.remove(L.mesh); L.whiteMat.dispose(); L.lineMat.dispose(); }
  geoCache.forEach(g=>{ if(g){ g.geo.dispose(); g.edges.dispose(); } });
  geoCache.clear();
  word.innerHTML="";
  letters=[];
  let i=0, prevBreak=false;
  for(const tok of text.match(/[^ \n]+|[ \n]/g)||[]){
    if(tok==="\n"){
      const br=document.createElement("div");
      br.className="break"+(prevBreak?" blank":"");   // Enter twice = visible empty row
      word.appendChild(br);
      prevBreak=true;
      continue;
    }
    prevBreak=false;
    if(tok===" "){
      const sp=document.createElement("div");
      sp.className="slot";
      sp.innerHTML="&nbsp;";
      word.appendChild(sp);
    }else{
      const chunk=document.createElement("div");
      chunk.className="chunk";
      for(const ch of tok) chunk.appendChild(makeLetter(ch,i++));
      word.appendChild(chunk);
    }
  }
  fit();
}

/* ---- fit: biggest font that still fits the stage ------------ */
function fit(){
  const maxW=stage.clientWidth*0.92;
  const maxH=stage.clientHeight*0.80;   // headroom for the pop poses + hint
  let lo=8, hi=1000;
  for(let k=0;k<12;k++){
    const mid=(lo+hi)/2;
    word.style.fontSize=mid+"px";
    if(word.scrollWidth<=maxW && word.offsetHeight<=maxH) lo=mid; else hi=mid;
  }
  word.style.fontSize=lo+"px";
  const F=lo;

  // drop any prior per-line centering shift so we measure raw DOM layout
  for(const el of word.querySelectorAll(".slot")) el.style.transform="";

  // measure the slots once per layout, then anchor the meshes to them:
  // wave centers (cx/cy/s) + glyph-center world position (mx/my)
  geoCache.forEach(g=>{ if(g){ g.geo.dispose(); g.edges.dispose(); } });
  geoCache.clear();
  const padPx=0.02*F;                        // .slot horizontal padding
  for(const L of letters){
    const r=L.slot.getBoundingClientRect();
    L.cx=r.left+r.width/2; L.cy=r.top+r.height/2;
    L.top=r.top; L.halfW=r.width/2;

    if(L.mesh){ scene.remove(L.mesh); L.whiteMat.dispose(); L.lineMat.dispose(); L.mesh=null; }
    const entry=getGeo(L.ch,F);
    if(!entry) continue;
    L.ox=entry.ox; L.oy=entry.oy;
    // per-letter materials whose opacity rides --e (rule 3): at rest the
    // body and outline are invisible AND depth-collapsed — genuinely
    // flat, like the CSS version. Perspective would otherwise expose
    // them on off-center letters even at rest.
    L.whiteMat=whiteBase.clone();
    L.lineMat=lineBase.clone();
    for(const m of [L.whiteMat,L.lineMat]){ m.transparent=true; m.opacity=0; }
    L.mesh=new THREE.Mesh(entry.geo,[inkMat, L.whiteMat]);
    L.mesh.add(new THREE.LineSegments(entry.edges, L.lineMat));
    L.mesh.scale.z=1e-4;
    const baselineY=r.top+BASELINE_RATIO*F;   // browser's baseline inside the line box
    L.mx=wx(r.left+padPx)+L.ox;               // pen start + centering offset
    L.my=wy(baselineY)+L.oy;
    L.mesh.position.set(L.mx,L.my,0);
    scene.add(L.mesh);
  }

  // Re-center each visual line on its LETTERS only. Space slots are flex
  // items that can land at a line's edge (or wrap alone); under
  // justify-content:center a trailing/leading space drags that line's
  // letters off-center, so identical stacked words wouldn't share an x.
  // Fix: rigid-shift the whole line (all its slots, so internal spacing
  // and bursts ride along) until the letters are centered on the stage.
  const slotsByLine=new Map();
  for(const el of word.querySelectorAll(".slot")){
    const k=Math.round(el.getBoundingClientRect().top);
    (slotsByLine.get(k)||slotsByLine.set(k,[]).get(k)).push(el);
  }
  const lettersByLine=new Map();
  for(const L of letters){
    if(!L.mesh) continue;
    const k=Math.round(L.top);
    (lettersByLine.get(k)||lettersByLine.set(k,[]).get(k)).push(L);
  }
  for(const [k,g] of lettersByLine){
    let lo=Infinity, hi=-Infinity;
    for(const L of g){ if(L.cx-L.halfW<lo)lo=L.cx-L.halfW; if(L.cx+L.halfW>hi)hi=L.cx+L.halfW; }
    const shift=W/2-(lo+hi)/2;
    if(Math.abs(shift)<0.05) continue;
    for(const el of slotsByLine.get(k)||[]) el.style.transform=`translateX(${shift.toFixed(2)}px)`;
    for(const L of g){ L.cx+=shift; L.mx+=shift; L.mesh.position.x=L.mx; }
  }

  // wave axis (may have shifted a hair from the re-centering)
  sMin=Infinity; sMax=-Infinity;
  for(const L of letters){
    L.s=(L.cx+L.cy)/Math.SQRT2;   // cx already re-centered above
    if(L.s<sMin)sMin=L.s;
    if(L.s>sMax)sMax=L.s;
  }
}

/* the textarea grows downward to always show its full content */
function growBox(){
  textbox.style.height="auto";
  textbox.style.height=textbox.scrollHeight+"px";
}
textbox.value=WORD;
growBox();
textbox.addEventListener("input",()=>{ growBox(); build(textbox.value); });
window.addEventListener("resize",()=>{ resize(); fit(); });
build(WORD);
document.fonts.ready.then(fit);   // re-measure once the browser's copy of the font arrives

/* ---- pose: each letter owns an exclusive sector ------------- */
function rollPose(i){
  const n=letters.length;
  const sector=TAU/n;
  const ang=SECTOR_OFFSET + i*sector + sector*0.5 + rnd(-0.38,0.38)*sector;
  const R=rnd(...POSE.radius);
  return {
    x:      Math.cos(ang)*R,
    y:      Math.sin(ang)*R,
    toward: rnd(...POSE.toward),
    twistX: rnd(...POSE.twistX)*sgn(),
    twistY: rnd(...POSE.twistY)*sgn(),
  };
}

/* ---- click wave ---------------------------------------------- */
stage.addEventListener("pointerdown",e=>{
  if(e.target===textbox) return;                // typing ≠ triggering
  wave={t0:performance.now()};
  hint.classList.add("gone");
});

/* ---- animation loop ------------------------------------------ */
let prev=performance.now();
function frame(now){
  const dt=now-prev; prev=now;

  // advance the wave front; retire it once it has swept past everything
  let front=Infinity;
  if(wave){
    front=sMin-WAVE.outer+(now-wave.t0)*WAVE.speed;
    if(front>sMax+WAVE.outer) wave=null;
  }

  for(const L of letters){
    const d=Math.abs(L.s-front);
    L.target=clamp(1-(d-WAVE.inner)/(WAVE.outer-WAVE.inner),0,1);

    // fully asleep and staying asleep: no writes at all
    if(L.p===0 && L.target===0){
      L.pose=null;
      if(!L.asleep){ L.slot.classList.add("asleep"); L.asleep=true; }
      continue;
    }
    if(L.asleep){ L.slot.classList.remove("asleep"); L.asleep=false; }

    if(!L.pose){ L.pose=rollPose(L.i); rollBurst(L); }

    L.p += Math.sign(L.target-L.p)*Math.min(Math.abs(L.target-L.p), dt*POSE.speed);
    const e=easeInOut(L.p);
    const P=L.pose;

    // idle float while awake
    const t=now*POSE.float.speed + L.phase;
    const fy=Math.sin(t)*POSE.float.y*e;
    const fr=Math.sin(t*0.8)*POSE.float.deg*e;

    const eStr=e.toFixed(4);                    // the burst inflates with the same easing
    if(eStr!==L.eStr){ L.slot.style.setProperty("--e", eStr); L.eStr=eStr; }

    if(L.mesh){
      // world y is up, CSS y is down — flip; rotations likewise mirrored
      L.mesh.position.set(L.mx+P.x*e, L.my-(P.y*e+fy), P.toward*e);
      L.mesh.rotation.set(-P.twistX*e*DEG, (P.twistY*e+fr)*DEG, 0);
      L.mesh.scale.z=Math.max(e,1e-4);          // depth inflates with the pop
      const o=Math.min(1,e*8);                  // body + outline fade in with it (rule 3)
      L.whiteMat.opacity=o; L.lineMat.opacity=o;
    }
  }

  renderer.render(scene,camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
