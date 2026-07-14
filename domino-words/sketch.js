/* domino words
   ------------------------------------------------------------
   Words built from standing domino bricks, seen straight from
   above (orthographic). At rest every brick shows only its thin
   black top — the word reads as flat 2D stripes. Brush a brick
   and it topples with real physics (cannon.js), knocking its
   neighbors down the stroke; fallen bricks reveal colored faces.

   Placement is exact: the glyphs are a SINGLE-STROKE font
   (Hershey futural, lib/strokefont.js) — every letter is already
   its pen strokes as polylines. Bricks are dropped along each
   stroke at even arc length, rotated to the local tangent, and
   consecutive bricks on a stroke are the chain links.

   Type in the box (lines are lines). Double-click resets.
   ------------------------------------------------------------ */

/* ---- knobs -------------------------------------------------- */
const DEFAULT_TEXT="SING INTO CHAOS WHEN NEEDED";
let T=1, HD=20.8, WD=12.6;    // domino: thickness (run axis), height, width
let SPACING=4.8;               // center distance along a run — gap ≈ half the
                               // height, so falls gather momentum before impact
                               // (T/HD/WD/SPACING are live — panel sliders)
const EM_WORLD=90;             // text cap size in world units
const LINE_GAP=0.35;           // gap between text lines (× line height)
const MAX_DOMINOES=1600;       // budget — spacing widens if the text wants more
const GRAVITY=980;             // world units/s²
const KICK_V=10;               // hover flick: push (units/s)
const KICK_W=7;                // hover flick: tip-over spin (rad/s)
const BRUSH_R=8;               // hover: radius of the push circle around the
                               // cursor — passing close counts, no need to hit
const SWEEP_R=120.2;           // press-sweep: radius of the push circle
const SWEEP_V=75;              // press-sweep: top push speed (units/s)
const BRICK_VMAX=75;           // debris speed cap — see capSpeeds()
const INK=0x1c1a17, PAPER=0xfaf9f6, FACE_A=0xd64520, FACE_B=0x2757c4;

const canvas=document.getElementById("stage");
const textbox=document.getElementById("textbox");

/* ---- three ---------------------------------------------------- */
const renderer=new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();
scene.background=new THREE.Color(PAPER);
const camera=new THREE.OrthographicCamera(-100,100,100,-100,1,4000);
scene.add(new THREE.HemisphereLight(0xffffff,0xd8d2c8,1.05));
const sun=new THREE.DirectionalLight(0xffffff,0.55);
sun.position.set(60,120,40);
scene.add(sun);

const floor=new THREE.Mesh(
  new THREE.PlaneGeometry(4000,4000),
  new THREE.MeshLambertMaterial({color:PAPER}));
floor.rotation.x=-Math.PI/2;
scene.add(floor);

/* ---- cannon ---------------------------------------------------- */
const world=new CANNON.World();
world.gravity.set(0,-GRAVITY,0);
world.broadphase=new CANNON.SAPBroadphase(world);
world.allowSleep=true;
world.solver.iterations=12;
const matGround=new CANNON.Material("ground");
const matBrick=new CANNON.Material("brick");
const cmFloor=new CANNON.ContactMaterial(matGround,matBrick,
  {friction:0.1,restitution:0,contactEquationStiffness:1e9,contactEquationRelaxation:2});
world.addContactMaterial(cmFloor);   // cmFloor.friction is a live slider
const cmBricks=new CANNON.ContactMaterial(matBrick,matBrick,
  {friction:0,restitution:0,contactEquationStiffness:1e9,contactEquationRelaxation:2});
world.addContactMaterial(cmBricks);  // cmBricks.friction is a live slider
const ground=new CANNON.Body({mass:0,material:matGround,shape:new CANNON.Plane()});
ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0),-Math.PI/2);
world.addBody(ground);

/* press-sweep is NOT a physics body. A kinematic pusher is infinitely
   strong — grinding bricks against standing letters forced the solver
   to mint runaway velocities and sustained interpenetration (the
   "ghosts" streaking under letters). Instead the sweep sets bounded
   velocities directly on bricks inside a circle: see stepSweep() */
let sweeping=false;
/* ---- text → dominoes along single-stroke letter paths ------------
   The letters ARE line data: each glyph in STROKE_FONT (Hershey
   futural) is a list of polylines — the pen strokes themselves.
   Placement is just walking each stroke and dropping a brick every
   SPACING units of arc length, rotated to the local tangent.
   Consecutive samples on a stroke are the chain links. */
const CAP=21;                        // Hershey cap height (y spans 1..22)

function planDominoes(text,spacing){
  const linesTxt=text.split("\n").map(l=>l.trimEnd()).filter(l=>l.trim().length);
  if(!linesTxt.length) return {spots:[],w:0,d:0};
  const k=EM_WORLD/CAP;              // world units per font unit
  const lineH=EM_WORLD*(1+LINE_GAP);
  const totalD=linesTxt.length*EM_WORLD+(linesTxt.length-1)*EM_WORLD*LINE_GAP;
  const glyph=ch=>STROKE_FONT[ch]||STROKE_FONT["?"];
  const widths=linesTxt.map(l=>[...l].reduce((s,ch)=>s+glyph(ch).w,0)*k);
  const maxW=Math.max(...widths);
  const spots=[];
  const CORNER=0.9;                  // rad — a joint bending less than this is
                                     // a curve facet; more is a true corner
  const wrap=a=>(a+3*Math.PI)%(2*Math.PI)-Math.PI;
  // computed widths: every brick WANTS to be WD wide, but shrinks where
  // the space across its stroke is already taken. Each side of the
  // stroke is measured independently against every placed footprint, so
  // a brick may sit asymmetrically — a bar tapers into its stem's comb
  // and threads through it as slivers; a tight curve packs like arch
  // wedges. Only a spot with no room at all (a placed brick sitting on
  // its very spine) is skipped, so nothing is ever born intersecting.
  const HX=T/2, MARGIN=0.15;
  const MINW=T*1.2;                            // drop invisible slivers
  const rC2=(Math.hypot(HX,WD/2)*2+MARGIN)**2; // quick circle reject
  const Tb=HX+MARGIN;                          // spine strip half-thickness
  const kept=[];                               // placed footprints {x,z,rot,hw}
  const clipStrip=(poly,side)=>{               // keep the part with t*side<=Tb
    const out=[];
    for(let i=0;i<poly.length;i++){
      const A=poly[i], B=poly[(i+1)%poly.length];
      const da=Tb-side*A[0], db=Tb-side*B[0];
      if(da>=0) out.push(A);
      if((da>=0)!==(db>=0)){
        const u=da/(da-db);
        out.push([A[0]+u*(B[0]-A[0]), A[1]+u*(B[1]-A[1])]);
      }
    }
    return out;
  };
  const fit=(x,z,rot)=>{           // the widest brick this spot can host
    const tx=Math.cos(rot), tz=Math.sin(rot);  // along the stroke (thin)
    const nx=-tz, nz=tx;                       // across it (wide)
    let ep=WD/2, em=WD/2;                      // extents on the ±n sides
    for(const K of kept){
      const dx=K.x-x, dz=K.z-z;
      if(dx*dx+dz*dz>rC2) continue;
      const kc=Math.cos(K.rot), ks=Math.sin(K.rot);
      let poly=[[1,1],[1,-1],[-1,-1],[-1,1]].map(([st,sn])=>{
        const px=dx+st*kc*HX-sn*ks*K.hw, pz=dz+st*ks*HX+sn*kc*K.hw;
        return [px*tx+pz*tz, px*nx+pz*nz];     // K's corner in our frame
      });
      poly=clipStrip(poly,1);
      if(poly.length) poly=clipStrip(poly,-1);
      if(!poly.length) continue;               // K clear of our spine strip
      let lo=1e9, hi=-1e9;
      for(const q of poly){ lo=Math.min(lo,q[1]); hi=Math.max(hi,q[1]); }
      if(lo<0&&hi>0) return null;              // K sits on the spine itself
      if(lo>=0) ep=Math.min(ep,lo-MARGIN);
      else em=Math.min(em,-hi-MARGIN);
    }
    if(ep+em<MINW) return null;
    const off=(ep-em)/2;                       // asymmetric: center shifts
    return {x:x+nx*off, z:z+nz*off, w:ep+em};
  };
  let letterIdx=0;                   // spots carry their letter's id
  linesTxt.forEach((line,li)=>{
    let penX=-widths[li]/2;
    const zTop=-totalD/2+li*lineH;
    for(const ch of line){
      const g=glyph(ch);
      const before=spots.length;
      for(const poly of g.p){
        const pts=poly.map(([px,py])=>[penX+px*k, zTop+(py-1)*k]);
        // curves arrive as short straight facets, so the raw facet
        // tangent is constant along each one — bricks would come out in
        // parallel packs that jump at the joints. The true tangent at a
        // gentle joint is the mid-angle of its two facets; each brick
        // blends between its facet's entering and leaving tangents by
        // arc position, fanning smoothly. True corners stay hard.
        const dirs=[];
        for(let s=0;s<pts.length-1;s++){
          const dx=pts[s+1][0]-pts[s][0], dz=pts[s+1][1]-pts[s][1];
          const L=Math.hypot(dx,dz);
          dirs.push(L<1e-6?null:{x:dx/L,z:dz/L,L,a:Math.atan2(dz,dx)});
        }
        const mid=(A,B)=>{           // joint tangent — null at a corner
          if(!A||!B) return null;
          const d=wrap(B.a-A.a);
          return Math.abs(d)<CORNER?A.a+d/2:null;
        };
        let prevIdx=-1;
        // fit the rhythm to the stroke: the step closest to SPACING that
        // divides the arc evenly, half a step of air at each tip — every
        // run reads as a symmetric, perfectly even comb
        let Ltot=0;
        for(const D of dirs) if(D) Ltot+=D.L;
        if(Ltot<1e-6) continue;
        const step=Ltot/Math.max(1,Math.round(Ltot/spacing));
        let acc=step*0.5;
        for(let s=0;s<dirs.length;s++){
          const D=dirs[s];
          if(!D) continue;
          const [x0,z0]=pts[s];
          const a0=mid(dirs[s-1],D)??D.a;    // tangent entering the facet
          const a1=mid(D,dirs[s+1])??D.a;    // tangent leaving it
          const bend=wrap(a1-a0);
          while(acc<=D.L+1e-9){
            const x=x0+D.x*acc, z=z0+D.z*acc;
            const rot=a0+bend*(acc/D.L);
            acc+=step;
            const f=fit(x,z,rot);
            if(!f) continue;              // no room at all: the chain may hop
            kept.push({x:f.x,z:f.z,rot,hw:f.w/2});
            const idx=spots.length;
            spots.push({x:f.x,z:f.z,rot,w:f.w,prev:-1,next:-1,letter:letterIdx});
            if(prevIdx>=0){
              // link along the stroke — but not around a sharp corner
              // (an L's elbow), and not across a skip-gap wider than a
              // falling brick can physically reach
              let da=Math.abs(rot-spots[prevIdx].rot);
              da=Math.min(da,2*Math.PI-da);
              const gx=f.x-spots[prevIdx].x, gz=f.z-spots[prevIdx].z;
              if(da<CORNER&&gx*gx+gz*gz<(HD*0.8)**2){
                spots[prevIdx].next=idx; spots[idx].prev=prevIdx;
              }
            }
            prevIdx=idx;
          }
          acc-=D.L;
        }
      }
      if(spots.length>before) letterIdx++;   // spaces claim no id
      penX+=g.w*k;
    }
  });
  return {spots, w:maxW, d:totalD};
}

/* ---- the brick fleet -------------------------------------------- */
let bodies=[], mesh=null, homes=[], chain=[];
let spotLetter=[];             // brick index → letter id
let curSpacing=SPACING;        // the spacing actually built (may widen)
const TIP_AT=0.22;             // rad — just past balance: ignite the neighbor early,
                               // before debris piling into joints can jam the wave
const NUDGE_W=9;               // the passed-on tip spin (rad/s) — strong enough
                               // to tip even a brick pinned by its leaning igniter
const dummy=new THREE.Object3D();
const YAXIS=new CANNON.Vec3(0,1,0);

function buildScene(text){
  sweeping=false;
  for(const b of bodies) world.removeBody(b);
  bodies=[]; homes=[];
  if(mesh){
    scene.remove(mesh);
    mesh.geometry.dispose();
    for(const m of mesh.material) m.dispose();
  }

  let spacing=SPACING;
  let plan=planDominoes(text,spacing);
  if(plan.spots.length>MAX_DOMINOES){
    spacing=SPACING*plan.spots.length/MAX_DOMINOES;
    plan=planDominoes(text,spacing);
  }
  const {spots,w,d}=plan;
  curSpacing=spacing;
  if(!spots.length){ renderer.render(scene,camera); return; }

  spotLetter=spots.map(s=>s.letter);   // the marshal stays inside a letter

  // instanced bricks: tops + thin sides in ink; the two big faces
  // (revealed by falling) in two colors — fall direction paints
  const geo=new THREE.BoxGeometry(T,HD,WD);
  const mats=[
    new THREE.MeshLambertMaterial({color:FACE_A}),   // +x big face
    new THREE.MeshLambertMaterial({color:FACE_B}),   // -x big face
    new THREE.MeshLambertMaterial({color:INK}),      // top
    new THREE.MeshLambertMaterial({color:INK}),      // bottom
    new THREE.MeshLambertMaterial({color:INK}),      // +z side
    new THREE.MeshLambertMaterial({color:INK}),      // -z side
  ];
  mesh=new THREE.InstancedMesh(geo,mats,spots.length);
  scene.add(mesh);

  spots.forEach((s,i)=>{
    const body=new CANNON.Body({
      mass:Math.max(0.2,s.w/WD),      // a sliver is light — momentum scales
      material:matBrick,
      shape:new CANNON.Box(new CANNON.Vec3(T/2,HD/2,s.w/2))});
    body.position.set(s.x,HD/2,s.z);
    // yaw −rot puts the thin axis on world (cos rot, 0, sin rot) —
    // the same axis marshal/topple compute from homes[].rot
    body.quaternion.setFromAxisAngle(YAXIS,-s.rot);
    body.allowSleep=true;
    body.sleepSpeedLimit=0.18;   // gentle enough that a slow tip-over
    body.sleepTimeLimit=0.9;     // is never frozen mid-fall by the sleeper
    body.sleep();                // stable until touched
    world.addBody(body);
    bodies.push(body);
    homes.push({x:s.x,z:s.z,rot:s.rot,sw:s.w/WD});
    dummy.position.set(s.x,HD/2,s.z);
    dummy.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),-s.rot);
    dummy.scale.set(1,1,s.w/WD);      // instance shares one geometry, scaled
    dummy.updateMatrix();
    mesh.setMatrixAt(i,dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate=true;

  // the chain links are the traced streamline order itself:
  // lean forward → ignite next, lean back → ignite prev
  chain=spots.map(s=>({plus:s.next, minus:s.prev, fired:false}));

  frameCamera(w,d);
  renderer.render(scene,camera);
}

/* bird's eye, orthographic: perfectly flat at rest (no perspective
   leaking the side faces), tilted a whisper so falls read as 3D */
function frameCamera(w,d){
  const aspect=innerWidth/innerHeight;
  const halfW=Math.max((w*1.18)/2,(d*1.35)/2*aspect,40);
  const halfH=halfW/aspect;
  camera.left=-halfW; camera.right=halfW;
  camera.top=halfH; camera.bottom=-halfH;
  camera.near=1; camera.far=4000;
  const dist=600;                       // dead-on top-down: perfectly flat at rest
  camera.position.set(0,dist,0.0001);   // epsilon keeps lookAt well-defined
  camera.lookAt(0,0,0);
  camera.updateProjectionMatrix();
}

/* ---- interaction -------------------------------------------------- */
const ray=new THREE.Raycaster();
const ptr=new THREE.Vector2();
let lastPX=null,lastPY=null;
const dragTarget={x:0,z:0};           // where the plow is headed

function setPtr(e){
  ptr.x=(e.clientX/innerWidth)*2-1;
  ptr.y=-(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(ptr,camera);
}
function groundPoint(){               // pointer ray ∩ the bricks' waist plane
  const t=(HD/2-ray.ray.origin.y)/ray.ray.direction.y;
  return {x:ray.ray.origin.x+ray.ray.direction.x*t,
          z:ray.ray.origin.z+ray.ray.direction.z*t};
}

function topple(e){
  if(!mesh||sweeping) return;
  setPtr(e);
  const dx=lastPX===null?1:e.clientX-lastPX;
  const dy=lastPY===null?0:e.clientY-lastPY;
  lastPX=e.clientX; lastPY=e.clientY;
  // the circle of push: every upright brick within BRUSH_R of the
  // cursor's ground point gets flicked — passing close beside a run
  // counts, the pointer needn't cross the bricks themselves
  const p=groundPoint();
  let woke=false;
  for(let i=0;i<bodies.length;i++){
    const body=bodies[i];
    const bx=body.position.x-p.x, bz=body.position.z-p.z;
    if(bx*bx+bz*bz>BRUSH_R*BRUSH_R) continue;
    // only kick bricks standing upright and quiet — never debris.
    // (a pure y-rotation keeps q.x=q.z=0, so this works for both orientations)
    const q=body.quaternion;
    if(Math.hypot(q.x,q.z)>0.08) continue;
    if(body.velocity.length()>1.5) continue;
    if(!woke){
      woke=true;
      // wake only the neighborhood: a sleeping neighbor acts like a wall
      // for one solver step, but waking the whole table makes every distant
      // letter twitch — the wave's own contacts wake bricks as it spreads
      const wr2=(EM_WORLD*0.8)**2;
      for(const b of bodies){
        const ox=b.position.x-p.x, oz=b.position.z-p.z;
        if(ox*ox+oz*oz<wr2) b.wakeUp();
      }
    }
    // fall away from the cursor, along the brick's own thin axis (its
    // chain direction); pointer motion breaks the tie when the cursor
    // sits dead on the spine (screen y ≈ world z, top-down)
    const rot=homes[i].rot;
    const ax=Math.cos(rot), az=Math.sin(rot);        // thin axis in world
    let d=bx*ax+bz*az;
    if(Math.abs(d)<1e-3) d=dx*ax+dy*az;
    const s=d>=0?1:-1;
    body.velocity.set(s*ax*KICK_V,0,s*az*KICK_V);
    // tip-over spin about (up × fallDir) = (az, 0, -ax)
    body.angularVelocity.set(s*az*KICK_W,0,-s*ax*KICK_W);
  }
}
canvas.addEventListener("pointermove",e=>{
  if(sweeping){ setPtr(e); Object.assign(dragTarget,groundPoint()); return; }
  topple(e);
});
canvas.addEventListener("pointerdown",e=>{     // press anywhere and sweep
  if(!mesh) return;
  setPtr(e);
  sweeping=true;
  Object.assign(dragTarget,groundPoint());
  canvas.setPointerCapture(e.pointerId);
  lastPX=e.clientX; lastPY=e.clientY;
});
const release=()=>{ sweeping=false; sweepPrev=null; };
canvas.addEventListener("pointerup",release);
canvas.addEventListener("pointercancel",release);

/* while pressed, everything inside the circle is swept along with the
   pointer: velocities are set directly, faded toward the rim, and never
   exceed SWEEP_V — bounded by construction, nothing to eject or squeeze */
let sweepPrev=null;
function stepSweep(){
  if(!sweeping) return;
  if(!sweepPrev){ sweepPrev={x:dragTarget.x,z:dragTarget.z}; return; }
  const mx=dragTarget.x-sweepPrev.x, mz=dragTarget.z-sweepPrev.z;
  sweepPrev={x:dragTarget.x,z:dragTarget.z};
  const step=Math.hypot(mx,mz);
  if(step<1e-3) return;               // a resting press pushes nothing
  const speed=Math.min(step*60,SWEEP_V);
  const ux=mx/step, uz=mz/step;
  const r2=SWEEP_R*SWEEP_R;
  for(const b of bodies){
    const dx=b.position.x-dragTarget.x, dz=b.position.z-dragTarget.z;
    const d2=dx*dx+dz*dz;
    if(d2>r2) continue;
    b.wakeUp();
    const s=speed*(1-0.6*Math.sqrt(d2)/SWEEP_R);  // full at center, 40% at rim
    b.velocity.x=ux*s; b.velocity.z=uz*s;
    // tip-over spin so standing bricks topple instead of skating
    b.angularVelocity.set(uz*s*0.12,0,-ux*s*0.12);
  }
}

/* the ghost-slide guard: a flat brick is only T tall, a standing brick
   only T thick — once one buries deeper than ~T into the other in a
   single substep, the solver's cheapest push-out flips from horizontal
   to VERTICAL and nothing opposes the slide: debris ghosts under
   standing letters. Capping debris speed (plus 1/120 substeps in the
   loop) keeps every collision in the shallow, well-behaved regime */
function capSpeeds(){
  const m2=BRICK_VMAX*BRICK_VMAX;
  for(const b of bodies){
    if(b.sleepState===CANNON.Body.SLEEPING) continue;
    const vx=b.velocity.x, vz=b.velocity.z;
    const v2=vx*vx+vz*vz;
    if(v2>m2){
      const f=BRICK_VMAX/Math.sqrt(v2);
      b.velocity.x*=f; b.velocity.z*=f;
    }
    if(b.velocity.y>250) b.velocity.y=250;         // squeeze pops
    else if(b.velocity.y<-250) b.velocity.y=-250;  // floor punches
  }
}

canvas.addEventListener("dblclick",()=>{        // stand them all up again
  release();
  bodies.forEach((b,i)=>{
    b.position.set(homes[i].x,HD/2,homes[i].z);
    b.quaternion.setFromAxisAngle(YAXIS,-homes[i].rot);
    b.velocity.set(0,0,0);
    b.angularVelocity.set(0,0,0);
    b.sleep();
    chain[i].fired=false;
  });
  syncAll();
  renderer.render(scene,camera);
});

/* ---- loop ----------------------------------------------------------- */
function syncAll(){
  bodies.forEach((b,i)=>{
    dummy.position.copy(b.position);
    dummy.quaternion.copy(b.quaternion);
    dummy.scale.set(1,1,homes[i].sw);
    dummy.updateMatrix();
    mesh.setMatrixAt(i,dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate=true;
}

/* the chain marshal: physics tumbles every brick, but the hand-off is
   guaranteed — a brick leaning past TIP_AT ignites its down-run
   neighbor with a small tip, exactly once per stand-up */
const UPV=new CANNON.Vec3();
function marshal(){
  for(let i=0;i<bodies.length;i++){
    const b=bodies[i];
    if(b.sleepState===CANNON.Body.SLEEPING||chain[i].fired) continue;
    b.quaternion.vmult(new CANNON.Vec3(0,1,0),UPV);
    const tilt=Math.acos(Math.max(-1,Math.min(1,UPV.y)));
    if(tilt<TIP_AT) continue;
    const ax=Math.cos(homes[i].rot), az=Math.sin(homes[i].rot);
    const s=(UPV.x*ax+UPV.z*az)>=0?1:-1;      // which way it leans
    chain[i].fired=true;
    const upright=n=>{
      if(n<0) return false;
      bodies[n].quaternion.vmult(new CANNON.Vec3(0,1,0),UPV);
      return UPV.y>0.96;
    };
    // the wave BRANCHES: the run neighbor plus the nearest other upright
    // brick both ignite — a tree of falls survives dead-end pockets
    const targets=[];
    const axisNb=s>0?chain[i].plus:chain[i].minus;
    if(upright(axisNb)) targets.push(axisNb);
    let best=-1, bd=1e9;
    const reach=curSpacing*2.6;   // scales with the built spacing
    for(let n=0;n<bodies.length;n++){
      if(n===i||n===axisNb) continue;
      // stay inside this letter — a fall never jumps to a neighbor word-wide
      if(spotLetter[n]!==spotLetter[i]) continue;
      const dx=homes[n].x-homes[i].x, dz=homes[n].z-homes[i].z;
      const dist=Math.hypot(dx,dz);
      if(dist>reach||dist>=bd) continue;
      if(!upright(n)) continue;
      bd=dist; best=n;
    }
    if(best>=0) targets.push(best);
    for(const j of targets){
      const nb=bodies[j];
      nb.wakeUp();
      const nax=Math.cos(homes[j].rot), naz=Math.sin(homes[j].rot);
      const ddx=homes[j].x-homes[i].x, ddz=homes[j].z-homes[i].z;
      const ns=(nax*ddx+naz*ddz)>=0?1:-1;      // the wave pushes outward
      nb.velocity.set(ns*nax*6,0,ns*naz*6);
      nb.angularVelocity.set(ns*naz*NUDGE_W,0,-ns*nax*NUDGE_W);
    }
  }
}

let prev=performance.now();
function loop(now){
  const dt=Math.min(0.05,(now-prev)/1000); prev=now;
  stepSweep();
  capSpeeds();
  world.step(1/60,dt,3);
  if(chain.length) marshal();
  let awake=false;
  if(mesh){
    bodies.forEach((b,i)=>{
      if(b.sleepState===CANNON.Body.SLEEPING) return;
      awake=true;
      dummy.position.copy(b.position);
      dummy.quaternion.copy(b.quaternion);
      dummy.scale.set(1,1,homes[i].sw);
      dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);
    });
    if(awake) mesh.instanceMatrix.needsUpdate=true;
  }
  if(awake) renderer.render(scene,camera);
  requestAnimationFrame(loop);
}

/* ---- textbox / boot -------------------------------------------------- */
function growBox(){
  textbox.style.height="auto";
  textbox.style.height=textbox.scrollHeight+"px";
}
let rebuildTimer=null;
textbox.addEventListener("input",()=>{
  growBox();
  clearTimeout(rebuildTimer);
  rebuildTimer=setTimeout(()=>buildScene(textbox.value||DEFAULT_TEXT),250);
});

/* the knob panel: brick geometry re-plans the whole word (debounced);
   friction retargets the live contact material, no rebuild needed */
const bindKnob=(id,apply,rebuild)=>{
  const el=document.getElementById("kn"+id);
  const out=document.getElementById("kv"+id);
  el.addEventListener("input",()=>{
    out.textContent=el.value;
    apply(parseFloat(el.value));
    if(rebuild){
      clearTimeout(rebuildTimer);
      rebuildTimer=setTimeout(()=>buildScene(textbox.value||DEFAULT_TEXT),150);
    }
  });
};
bindKnob("T", v=>{T=v;}, true);
bindKnob("HD",v=>{HD=v;}, true);
bindKnob("WD",v=>{WD=v;}, true);
bindKnob("SP",v=>{SPACING=v;}, true);
bindKnob("FR",v=>{cmFloor.friction=v;}, false);
bindKnob("BR",v=>{cmBricks.friction=v;}, false);

function resize(){
  renderer.setSize(innerWidth,innerHeight);
  buildScene(textbox.value||DEFAULT_TEXT);
}
window.addEventListener("resize",resize);

// the letter paths ship with the sketch — no font loading to wait for
textbox.value=DEFAULT_TEXT;
growBox();
resize();
requestAnimationFrame(loop);
