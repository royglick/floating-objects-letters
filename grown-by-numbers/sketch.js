/* ============================================================
   GROWN BY NUMBERS — the bench
   Builds one section per system: a paragraph, the live canvas,
   its knobs, and the system's own source shown right beside it.
   The code you read is pulled off the function with .toString(),
   so it can never drift out of sync with what's running.
   The systems themselves live in systems.js.
   ============================================================ */
'use strict';

/* ---- a small syntax highlighter for the code panels ---------------- */
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* strip the shared leading indentation so the source reads flush-left */
function dedent(src){
  const lines = src.split('\n');
  let min = Infinity;
  for (let i = 1; i < lines.length; i++){
    if (!lines[i].trim()) continue;
    const m = lines[i].match(/^ */)[0].length;
    if (m < min) min = m;
  }
  if (!isFinite(min)) min = 0;
  return lines.map((l, i) => i === 0 ? l : l.slice(min)).join('\n');
}

const KW = /\b(const|let|var|function|return|for|if|else|while|new|of|in|this|break|continue|true|false|null|Math|document|window)\b/g;
function paintPlain(s){
  s = esc(s);
  s = s.replace(KW, '<span class="kw">$1</span>');
  s = s.replace(/\b\d+\.?\d*(?:e-?\d+)?\b/g, '<span class="num">$&</span>');
  return s;
}
function highlight(src){
  src = dedent(src);
  // walk the string, pulling out comments and quoted strings whole so we
  // never colour a keyword that lives inside them
  const re = /\/\/[^\n]*|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))){
    out += paintPlain(src.slice(last, m.index));
    const t = m[0], cls = t[0] === '/' ? 'com' : 'str';
    out += '<span class="' + cls + '">' + esc(t) + '</span>';
    last = re.lastIndex;
  }
  out += paintPlain(src.slice(last));
  return out;
}

/* ---- build the page ------------------------------------------------ */
const bench = document.getElementById('bench');
const insts = [];

SYSTEMS.forEach((sys, idx) => {
  const P = {};
  sys.knobs.forEach(k => P[k.k] = k.v);

  const num = String(idx + 1).padStart(2, '0');
  const presetRow = sys.presets
    ? `<div class="presets">${sys.presets.map((p, i) => `<button data-pre="${i}" class="${i === 0 ? 'on' : ''}">${p.n}</button>`).join('')}</div>`
    : '';
  const knobRows = sys.knobs.map(k =>
    `<div class="knob"><label for="${sys.id}-${k.k}">${k.l}</label>
       <input type="range" id="${sys.id}-${k.k}" data-k="${k.k}" min="${k.min}" max="${k.max}" step="${k.step}" value="${k.v}">
       <output>${k.f(k.v)}</output></div>`).join('');

  const sec = document.createElement('section');
  sec.className = 'sys';
  sec.innerHTML = `
    <header class="sys-head">
      <span class="idx">${num}</span>
      <div class="names">
        <span class="latin">${sys.latin}</span>
        <span class="common">${sys.common}</span>
      </div>
      <code class="eq">${sys.eq}</code>
    </header>
    <p class="blurb">${sys.blurb}</p>
    <div class="grid">
      <div class="left">
        <div class="stage"><canvas></canvas><div class="scan"></div></div>
        <div class="knobs">${presetRow}${knobRows}</div>
      </div>
      <figure class="code">
        <figcaption>systems.js — <span>${sys.build.name}()</span>
          <button class="copy" type="button">copy</button></figcaption>
        <pre><code>${highlight(sys.build.toString())}</code></pre>
      </figure>
    </div>`;
  bench.appendChild(sec);

  // wire the live canvas
  const cv = sec.querySelector('canvas');
  const ctrl = sys.build(cv, P);
  const inst = { ctrl, visible: false, drawn: false, warmed: !sys.warmup };
  insts.push(inst);

  // knobs
  sec.querySelectorAll('input[type=range]').forEach(inp => {
    const out = inp.nextElementSibling, kd = sys.knobs.find(k => k.k === inp.dataset.k);
    inp.addEventListener('input', () => {
      P[inp.dataset.k] = parseFloat(inp.value);
      out.textContent = kd.f(parseFloat(inp.value));
      inst.drawn = false;
    });
  });

  // presets (reaction–diffusion)
  if (sys.presets){
    const btns = sec.querySelectorAll('[data-pre]');
    btns.forEach(b => b.addEventListener('click', () => {
      const pr = sys.presets[+b.dataset.pre];
      P.f = pr.f; P.k = pr.k;
      const fi = sec.querySelector('[data-k="f"]'), ki = sec.querySelector('[data-k="k"]');
      fi.value = pr.f; fi.nextElementSibling.textContent = pr.f.toFixed(4);
      ki.value = pr.k; ki.nextElementSibling.textContent = pr.k.toFixed(4);
      if (ctrl.reset) ctrl.reset();
      btns.forEach(x => x.classList.remove('on')); b.classList.add('on');
      inst.drawn = false;
    }));
  }

  // copy button
  sec.querySelector('.copy').addEventListener('click', e => {
    navigator.clipboard && navigator.clipboard.writeText(sys.build.toString());
    e.target.textContent = 'copied'; setTimeout(() => e.target.textContent = 'copy', 1200);
  });
});

/* only animate the canvases that are actually on screen */
const io = new IntersectionObserver(es => es.forEach(e => {
  const i = [...bench.children].indexOf(e.target);
  if (i >= 0) insts[i].visible = e.isIntersecting;
}), { threshold: 0.08 });
[...bench.children].forEach(c => io.observe(c));

/* motion toggle — respects the OS "reduce motion" preference */
let MOTION = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mbtn = document.getElementById('motion');
mbtn.setAttribute('aria-pressed', MOTION);
mbtn.addEventListener('click', () => { MOTION = !MOTION; mbtn.setAttribute('aria-pressed', MOTION); });

/* the slow growers (reaction–diffusion, differential growth) need a few
   hundred steps before they show anything — warm them up when first seen */
function warm(inst){
  inst.warmed = true;
  if (inst.ctrl.reset) inst.ctrl.reset();
  for (let i = 0; i < 220; i++) inst.ctrl.step();
}

let last = 0;
function loop(ts){
  requestAnimationFrame(loop);
  if (ts - last < 1000/45) return;              // cap ~45fps
  last = ts;
  insts.forEach(inst => {
    if (!inst.visible) return;
    if (!inst.warmed) warm(inst);
    if (MOTION || !inst.drawn){ inst.ctrl.step(); inst.drawn = true; }
  });
}
requestAnimationFrame(loop);

let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => insts.forEach(i => { i.ctrl.resize(); i.drawn = false; }), 180);
});
