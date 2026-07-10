/* string wobble — a loose chain of N points. Each point is a damped
   harmonic oscillator around the rest line (y=0), weakly coupled to its
   neighbors so disturbances ripple outward. The ENDS ARE FREE (no pins).
   The pointer injects velocity into nearby points as it moves across.

   Kept deliberately cheap: fixed N=48, one flat Float32 pass per frame,
   a single polyline attribute write, and each sim sleeps (writes nothing,
   integrates nothing) once its chain settles and the pointer is away.

   Every <svg class="string"> on the page gets its own independent chain. */
function initString(svg){
  const line=svg.querySelector("polyline");
  const N=48, X0=10, X1=590, REST=32;
  const K=1000;       // spring stiffness (1/s²) — sets the wobble frequency
  const DAMP=4;       // damping (1/s) — how fast it rings down
  const SPREAD=400;   // neighbor coupling (1/s²) — how far a pluck travels
  const y=new Float32Array(N), v=new Float32Array(N);
  const xs=Array.from({length:N},(_,i)=>X0+(X1-X0)*i/(N-1));

  let awake=false, prev=performance.now();

  function render(){
    let pts="";
    for(let i=0;i<N;i++) pts+=xs[i]+","+(REST+y[i]).toFixed(1)+" ";
    line.setAttribute("points",pts);
  }
  render();

  svg.addEventListener("pointermove",e=>{
    const r=svg.getBoundingClientRect();
    const px=(e.clientX-r.left)/r.width*(X1-X0)+X0;       // pointer in sim coords
    const kick=Math.max(-2.2,Math.min(2.2,e.movementY))*90; // brushing speed → impulse
    for(let i=0;i<N;i++){
      const d=(xs[i]-px)/36;                              // ~36px influence radius
      v[i]+=kick*Math.exp(-d*d);                          // gaussian falloff
    }
    if(!awake){ awake=true; prev=performance.now(); requestAnimationFrame(step); }
  });

  function step(now){
    const dt=Math.min(0.032,(now-prev)/1000); prev=now;
    let energy=0;
    for(let i=0;i<N;i++){
      const left=i>0?y[i-1]:y[i], right=i<N-1?y[i+1]:y[i];   // free ends
      const a=-K*y[i] - DAMP*v[i] + SPREAD*(left+right-2*y[i]);
      v[i]+=a*dt;
    }
    for(let i=0;i<N;i++){
      y[i]+=v[i]*dt;
      energy+=y[i]*y[i]+v[i]*v[i];
    }
    render();
    if(energy<0.05){ awake=false; y.fill(0); v.fill(0); render(); return; }  // settled — sleep
    requestAnimationFrame(step);
  }
}

document.querySelectorAll("svg.string").forEach(initString);
