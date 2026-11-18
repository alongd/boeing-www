/* SAF process animation: CO2 + H2 -> catalysis -> chain growth -> jet fuel -> aircraft.
   Canvas 2D, no dependencies, no network, no storage. Mounts into #saf-anim. */
(function () {
  try {
    var host = document.getElementById('saf-anim');
    if (!host || !host.appendChild) return;
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;

    var N = 72, STAGES = 4, STAGE_T = 3, LOOP_T = 12, MORPH_T = 1.2, D = 3.5;
    var STILL_T = 8.4; // Synthesis stage, morph finished, caption visible
    var CAPTIONS = ['Capture: CO₂ and H₂', 'Catalysis', 'Chain Growth to Jet Fuel (e-SAF)', 'Jet Fuel'];
    var BLUE = [207, 227, 255], WHITE = [255, 255, 255], GREEN = [47, 191, 113];
    var TYPE = { C: { c: BLUE, r: 5.5 }, O: { c: WHITE, r: 6.5 }, H: { c: GREEN, r: 3.8 } };

    function rng(seed) {
      return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    var rand = rng(7);

    // ---- per-stage targets: P (xyz), A (alpha), T (type), B (explicit bonds [i,j,order]) ----
    var P = [[], [], [], []], A = [[], [], [], []], T = [[], [], [], []], B = [[], [], [], []];
    var grp = [];
    var i, s;
    for (i = 0; i < N; i++) { A[0][i] = A[1][i] = A[2][i] = A[3][i] = 0; grp[i] = i; }

    // Stage 0: 6 CO2 (O=C=O) + 9 H2 floating on a loose 5x3 grid.
    var cell = 0, idx = 0, m;
    for (m = 0; m < 15; m++) {
      var gx = (m % 5 - 2) * 0.42 + (rand() - 0.5) * 0.12;
      var gy = (Math.floor(m / 5) - 1) * 0.5 + (rand() - 0.5) * 0.12;
      var gz = (rand() - 0.5) * 0.5;
      var th = rand() * Math.PI, dz = (rand() - 0.5) * 0.3;
      var dx = Math.cos(th), dy = Math.sin(th);
      var isCO2 = (m % 5 + Math.floor(m / 5)) % 5 === 0 || m === 6 || m === 8 || m === 13;
      if (m === 0 || m === 4) isCO2 = true;
      var offs = isCO2 ? [-0.15, 0, 0.15] : [-0.055, 0.055];
      var types = isCO2 ? ['O', 'C', 'O'] : ['H', 'H'];
      var first = idx;
      for (var k = 0; k < offs.length; k++) {
        P[0][idx] = [gx + dx * offs[k], gy + dy * offs[k], gz + dz * offs[k]];
        A[0][idx] = 1; T[0][idx] = types[k]; grp[idx] = m; idx++;
      }
      if (isCO2) { B[0].push([first, first + 1, 2], [first + 1, first + 2, 2]); } else { B[0].push([first, first + 1, 1]); }
    }
    var n0 = idx; // visible atoms in stage 0

    // Stage 1: loose cloud, dynamic transient bonds.
    var n1 = 58;
    for (i = 0; i < N; i++) {
      var u = rand() * 2 - 1, ph = rand() * Math.PI * 2, rr = Math.cbrt(rand()), q = Math.sqrt(1 - u * u);
      P[1][i] = [rr * q * Math.cos(ph) * 1.0, rr * u * 0.8, rr * q * Math.sin(ph) * 0.5];
      A[1][i] = i < n1 ? 1 : 0;
      T[1][i] = i < n0 ? T[0][i] : (i % 3 === 0 ? 'H' : (i % 3 === 1 ? 'C' : 'O'));
    }

    // Stage 2: n-dodecane C12H26 zig-zag, C at 0..11, H at 12..37.
    var hi = 12, cs = 0.19, amp = 0.1, ci;
    for (ci = 0; ci < 12; ci++) {
      var sg = ci % 2 ? 1 : -1, cx0 = (ci - 5.5) * cs, cy0 = sg * amp;
      P[2][ci] = [cx0, cy0, 0]; A[2][ci] = 1; T[2][ci] = 'C';
      if (ci > 0) B[2].push([ci - 1, ci, 1]);
      var hs = [[0, sg * 0.13, 0.14], [0, sg * 0.13, -0.14]];
      if (ci === 0 || ci === 11) hs.push([(ci === 0 ? -1 : 1) * 0.13, -sg * 0.04, 0]);
      for (var h = 0; h < hs.length; h++, hi++) {
        P[2][hi] = [cx0 + hs[h][0], cy0 + hs[h][1], hs[h][2]];
        A[2][hi] = 1; T[2][hi] = 'H'; B[2].push([ci, hi, 1]);
      }
    }
    for (i = 0; i < N; i++) if (!A[2][i]) { P[2][i] = P[1][i].slice(); T[2][i] = T[1][i]; }

    // Stage 3: top-down aircraft outline (nose up), N points evenly along the perimeter.
    var half = [[0, -1], [0.06, -0.85], [0.07, -0.3], [0.07, -0.2], [0.95, 0.18], [0.95, 0.28], [0.07, 0.12],
      [0.07, 0.5], [0.38, 0.78], [0.38, 0.88], [0.05, 0.8], [0.04, 0.95], [0, 1]];
    var poly = half.slice(), j;
    for (j = half.length - 2; j >= 1; j--) poly.push([-half[j][0], half[j][1]]);
    var segs = [], total = 0;
    for (j = 0; j < poly.length; j++) {
      var p0 = poly[j], p1 = poly[(j + 1) % poly.length], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      segs.push(L); total += L;
    }
    for (i = 0; i < N; i++) {
      var d = (i + 0.5) / N * total, sj = 0;
      while (sj < segs.length - 1 && d > segs[sj]) { d -= segs[sj]; sj++; }
      var a = poly[sj], b = poly[(sj + 1) % poly.length], f = d / segs[sj];
      P[3][i] = [(a[0] + (b[0] - a[0]) * f) * 0.95, (a[1] + (b[1] - a[1]) * f) * 0.92, 0];
      A[3][i] = 1; T[3][i] = 'A';
      B[3].push([i, (i + 1) % N, 1]);
    }
    for (i = 0; i < N; i++) if (!A[0][i]) { P[0][i] = P[3][i].slice(); T[0][i] = T[3][i]; }
    TYPE.A = { c: GREEN, r: 4.4 };

    var JIT = [0.008, 0.075, 0.006, 0.003]; // per-stage jitter
    var DRIFT = [1, 0.35, 0, 0];             // rigid per-group float
    var SWAY = [0.85, 0.85, 0.5, 0.0];       // rotation amplitude (rad)
    var BOND_DYN = [0, 1, 0, 0];

    var ph1 = [], ph2 = [], phg = [];
    for (i = 0; i < N; i++) { ph1[i] = rand() * 6.28; ph2[i] = rand() * 6.28; phg[i] = rand() * 6.28; }

    // ---- state ----
    var t = 0, playing = true, visible = true, raf = 0, last = 0;
    var W = 0, H = 0, dpr = 1;
    var scr = []; for (i = 0; i < N; i++) scr[i] = { x: 0, y: 0, a: 0, r: 0, c: [0, 0, 0], z: 0 };
    var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    // ---- DOM ----
    var caption = document.createElement('figcaption');
    caption.className = 'saf-anim__caption';
    caption.setAttribute('aria-hidden', 'true');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'saf-anim__btn';
    btn.setAttribute('aria-pressed', 'true');
    btn.setAttribute('aria-label', 'Pause animation');
    btn.textContent = 'Pause';
    canvas.className = 'saf-anim__canvas';
    host.appendChild(canvas); host.appendChild(caption); host.appendChild(btn);

    function ease(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    function smooth(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
    function lerp(a, b, e) { return a + (b - a) * e; }

    var capStage = -1, capOp = -1;
    function setCaption(stage, op) {
      if (stage !== capStage) { caption.textContent = CAPTIONS[stage]; capStage = stage; }
      if (Math.abs(op - capOp) > 0.01) { caption.style.opacity = op.toFixed(2); capOp = op; }
    }

    function glow(x, y, r, c, a) {
      var col = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
      ctx.fillStyle = col;
      ctx.globalAlpha = a * 0.10; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = a * 0.18; ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = a * 0.95; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    function line(p, q, c, a, w, off) {
      if (a < 0.02) return;
      var ox = 0, oy = 0;
      if (off) { var dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1; ox = -dy / l * off; oy = dx / l * off; }
      ctx.globalAlpha = a; ctx.strokeStyle = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p.x + ox, p.y + oy); ctx.lineTo(q.x + ox, q.y + oy); ctx.stroke();
    }
    function bond(bd, wgt, sc) {
      var p = scr[bd[0]], q = scr[bd[1]], a = Math.min(p.a, q.a) * wgt * 0.5;
      var c = [(p.c[0] + q.c[0]) / 2, (p.c[1] + q.c[1]) / 2, (p.c[2] + q.c[2]) / 2];
      if (bd[2] === 2) { line(p, q, c, a, 1, 2.2 * sc); line(p, q, c, a, 1, -2.2 * sc); } else line(p, q, c, a, 1.1, 0);
    }

    function draw() {
      if (!W || !H) return;
      var tt = ((t % LOOP_T) + LOOP_T) % LOOP_T;
      var st = Math.floor(tt / STAGE_T) % STAGES, ts = tt - st * STAGE_T, pv = (st + STAGES - 1) % STAGES;
      var e = ease(ts / MORPH_T);
      var S = Math.min(W * 0.46, H * 0.38), sc = Math.max(0.7, Math.min(1.3, S / 200));
      var cx = W / 2, cy = H * 0.46;
      var jit = lerp(JIT[pv], JIT[st], e), drf = lerp(DRIFT[pv], DRIFT[st], e), sw = lerp(SWAY[pv], SWAY[st], e);
      var ya = sw * Math.sin(t * 0.4), pa = 0.3 * sw * Math.sin(t * 0.27 + 1);
      var cy_ = Math.cos(ya), sy_ = Math.sin(ya), cp = Math.cos(pa), sp = Math.sin(pa);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      for (i = 0; i < N; i++) {
        var p0 = P[pv][i], p1 = P[st][i];
        var x = lerp(p0[0], p1[0], e), y = lerp(p0[1], p1[1], e), z = lerp(p0[2], p1[2], e);
        x += jit * Math.sin(t * 1.9 + ph1[i]) + drf * 0.03 * Math.sin(t * 0.7 + phg[grp[i]]);
        y += jit * Math.sin(t * 2.3 + ph2[i]) + drf * 0.03 * Math.cos(t * 0.6 + phg[grp[i]]);
        z += jit * Math.sin(t * 1.7 + ph1[i] * 2);
        var x1 = x * cy_ + z * sy_, z1 = -x * sy_ + z * cy_;
        var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        var fp = D / (D + z2), o = scr[i];
        o.x = cx + x1 * fp * S; o.y = cy + y2 * fp * S; o.z = z2;
        o.a = lerp(A[pv][i], A[st][i], e) * Math.max(0.45, Math.min(1, 0.8 - z2 * 0.35));
        var c0 = TYPE[T[pv][i]], c1 = TYPE[T[st][i]];
        o.c = [lerp(c0.c[0], c1.c[0], e), lerp(c0.c[1], c1.c[1], e), lerp(c0.c[2], c1.c[2], e)];
        o.r = lerp(c0.r, c1.r, e) * fp * sc;
      }

      // explicit bonds of previous and current stage, cross-faded
      var bs;
      for (bs = 0; bs < STAGES; bs++) {
        var wgt = bs === st ? e : (bs === pv ? 1 - e : 0);
        if (bs === pv && pv === st) wgt = 1;
        if (wgt <= 0.01) continue;
        for (j = 0; j < B[bs].length; j++) bond(B[bs][j], wgt, sc);
      }
      // dynamic transient bonds (catalysis)
      var dw = st === 1 ? e : (pv === 1 ? 1 - e : 0);
      if (dw > 0.01) {
        var thr = S * 0.3;
        for (i = 0; i < N; i++) {
          if (scr[i].a < 0.3) continue;
          for (j = i + 1; j < N; j++) {
            if (scr[j].a < 0.3) continue;
            var dd = Math.hypot(scr[i].x - scr[j].x, scr[i].y - scr[j].y);
            if (dd > thr) continue;
            var fl = 0.5 + 0.5 * Math.sin(t * 3.1 + i * 1.7 + j * 0.9);
            if (fl < 0.35) continue;
            var pp = scr[i], qq = scr[j], aa = (1 - dd / thr) * fl * dw * Math.min(pp.a, qq.a) * 0.95;
            line(pp, qq, [(pp.c[0] + qq.c[0]) / 2, (pp.c[1] + qq.c[1]) / 2, (pp.c[2] + qq.c[2]) / 2], aa, 1, 0);
          }
        }
      }
      for (i = 0; i < N; i++) { var q = scr[i]; if (q.a > 0.02) glow(q.x, q.y, q.r, q.c, q.a); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

      var cap = smooth(ts / 0.7) * (1 - smooth((ts - 2.5) / 0.5));
      setCaption(st, cap);
    }

    function resize() {
      var r = host.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      draw();
    }

    function frame(now) {
      raf = 0;
      if (!(playing && visible && !document.hidden)) { last = 0; return; }
      if (last) t += Math.min(0.05, (now - last) / 1000);
      last = now;
      draw();
      raf = requestAnimationFrame(frame);
    }
    function update() {
      if (playing && visible && !document.hidden) { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    }
    function setPlaying(on) {
      playing = on;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Pause animation' : 'Play animation');
      btn.textContent = on ? 'Pause' : 'Play';
      update();
    }

    btn.addEventListener('click', function () { setPlaying(!playing); });
    document.addEventListener('visibilitychange', update);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[en.length - 1].isIntersecting; update(); }).observe(host);
    }
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host);
    else window.addEventListener('resize', resize);

    function onMotion() {
      if (reduceMQ && reduceMQ.matches) { t = STILL_T; setPlaying(false); draw(); }
      else setPlaying(true);
    }
    if (reduceMQ) {
      if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotion);
      else if (reduceMQ.addListener) reduceMQ.addListener(onMotion);
    }
    if (reduceMQ && reduceMQ.matches) { t = STILL_T; setPlaying(false); }
    resize();
    update();
  } catch (err) { /* decorative only: fail silently */ }
})();
