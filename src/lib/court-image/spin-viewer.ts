// Builds a single, fully self-contained HTML file that lets the customer
// drag to rotate the court through a full 360°. Everything — the frames,
// the styling, the interaction code — is inlined; the file makes ZERO
// network requests, so it works offline in any phone browser with no
// hosting (no Vercel), no CDN, and no third-party viewer.
//
// Technique: an "object movie" spinner. We embed N pre-rendered frames
// (one per angle) as JPEG data URLs and swap the visible frame as the
// user drags. No 3D engine, no WebGL, no ES modules — so it loads on
// even old phones. Delivered over WhatsApp as a Document.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSpinViewerHtml(input: {
  title: string;
  subtitle?: string;
  // JPEG data URLs, ordered around a 360° horizontal spin.
  frames: string[];
}): string {
  const title = esc(input.title || "Court design");
  const subtitle = esc(input.subtitle ?? "");
  // Embed frames as a JSON array. They're data: URLs, already safe to
  // sit inside a <script> as a JSON string literal.
  const framesJson = JSON.stringify(input.frames);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${title} — Fitoverse 3D</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
  html,body { height:100%; background:#0b1220; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; overflow:hidden; }
  #stage { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; touch-action:none; cursor:grab; }
  #stage.grabbing { cursor:grabbing; }
  canvas { max-width:100%; max-height:100%; display:block; }
  .bar { position:fixed; left:0; right:0; padding:12px 16px; color:#fff; pointer-events:none; z-index:2; }
  .top { top:0; background:linear-gradient(#0b1220e6,#0b122000); }
  .brand { font-weight:700; font-size:16px; color:#25d366; letter-spacing:.2px; }
  .ttl { font-size:13px; opacity:.92; margin-top:2px; }
  .sub { font-size:11px; opacity:.6; margin-top:1px; }
  .hint { position:fixed; left:50%; bottom:26px; transform:translateX(-50%); z-index:3;
    background:#ffffff14; border:1px solid #ffffff2e; color:#fff; font-size:12.5px;
    padding:8px 16px; border-radius:999px; backdrop-filter:blur(6px);
    transition:opacity .5s; display:flex; gap:8px; align-items:center; }
  .hint.gone { opacity:0; }
  .dot { width:6px; height:6px; border-radius:50%; background:#25d366; }
  .load { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; color:#8aa; font-size:13px; z-index:5; background:#0b1220; }
</style>
</head>
<body>
  <div id="load" class="load">Loading 3D view…</div>
  <div id="stage"><canvas id="cv"></canvas></div>
  <div class="bar top">
    <div class="brand">Fitoverse</div>
    <div class="ttl">${title}</div>
    ${subtitle ? `<div class="sub">${subtitle}</div>` : ""}
  </div>
  <div id="hint" class="hint"><span>◄</span><span class="dot"></span>Drag to rotate<span class="dot"></span><span>►</span></div>
<script>
(function(){
  var FRAMES = ${framesJson};
  var n = FRAMES.length;
  var imgs = new Array(n), loaded = 0, ready = false;
  var idx = 0;
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var stage = document.getElementById('stage');
  var hint = document.getElementById('hint');
  var w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

  function fit(){
    var im = imgs[0]; if(!im) return;
    var availW = window.innerWidth, availH = window.innerHeight;
    var ar = im.naturalWidth / im.naturalHeight;
    var cw = availW, ch = cw / ar;
    if(ch > availH){ ch = availH; cw = ch * ar; }
    w = cw; h = ch;
    cv.style.width = cw+'px'; cv.style.height = ch+'px';
    cv.width = Math.round(cw*dpr); cv.height = Math.round(ch*dpr);
    draw();
  }
  function draw(){
    var im = imgs[idx]; if(!im) return;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.drawImage(im,0,0,cv.width,cv.height);
  }
  function setIdx(i){ idx = ((i % n) + n) % n; draw(); }

  // Preload every frame, then reveal + start a short auto-spin teaser.
  for(var i=0;i<n;i++){
    (function(k){
      var im = new Image();
      im.onload = im.onerror = function(){
        loaded++;
        if(loaded===n){ ready=true; document.getElementById('load').style.display='none'; fit(); teaser(); }
      };
      im.src = FRAMES[k];
      imgs[k]=im;
    })(i);
  }

  // Auto-spin a little so the customer sees it's interactive; cancel on
  // first touch/drag.
  var teaserTimer=null, teased=false;
  function teaser(){
    var step=0;
    teaserTimer=setInterval(function(){
      if(teased){ clearInterval(teaserTimer); return; }
      setIdx(idx+1); step++;
      if(step>=Math.round(n*0.5)){ clearInterval(teaserTimer); }
    }, 60);
  }
  function stopTeaser(){ teased=true; if(teaserTimer) clearInterval(teaserTimer); if(hint && !hint.classList.contains('gone')) hint.classList.add('gone'); }

  // Drag to rotate. A full screen-width drag ≈ full 360°.
  var dragging=false, startX=0, startIdx=0;
  function pxPerFrame(){ return Math.max(6, (window.innerWidth) / n); }
  function down(x){ dragging=true; startX=x; startIdx=idx; stage.classList.add('grabbing'); stopTeaser(); }
  function move(x){ if(!dragging) return; var d = x - startX; setIdx(startIdx - Math.round(d / pxPerFrame())); }
  function up(){ dragging=false; stage.classList.remove('grabbing'); }

  stage.addEventListener('pointerdown', function(e){ down(e.clientX); e.preventDefault(); });
  window.addEventListener('pointermove', function(e){ move(e.clientX); });
  window.addEventListener('pointerup', up);
  // Touch fallback for browsers without Pointer Events.
  stage.addEventListener('touchstart', function(e){ down(e.touches[0].clientX); }, {passive:true});
  stage.addEventListener('touchmove', function(e){ move(e.touches[0].clientX); e.preventDefault(); }, {passive:false});
  stage.addEventListener('touchend', up);

  window.addEventListener('resize', fit);
})();
</script>
</body>
</html>`;
}
