/*
 * DOOM in EPUB - integrated interactive capability test.
 * ES5-compatible, no network, no external dependencies.
 * Exercises: JS, rAF/timers, Canvas2D framebuffer + ImageData, keyboard,
 * pointer, touch, focus, WebAudio, HTMLAudio, WASM (with JS fallback),
 * packaged binary assets and in-session persistent state.
 */
(function () {
  'use strict';

  var doc = document;

  function byId(id) { return doc.getElementById(id); }

  function now() {
    if (typeof window.performance !== 'undefined' && window.performance && typeof window.performance.now === 'function') {
      return window.performance.now();
    }
    return (new Date()).getTime();
  }

  var requestFrame =
    window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    function (cb) { return window.setTimeout(function () { cb(now()); }, 16); };

  var LE = (function () {
    var b = new ArrayBuffer(4);
    new Uint32Array(b)[0] = 1;
    return new Uint8Array(b)[0] === 1;
  }());

  function rgb(r, g, b) {
    r = r | 0; g = g | 0; b = b | 0;
    if (r < 0) { r = 0; } else if (r > 255) { r = 255; }
    if (g < 0) { g = 0; } else if (g > 255) { g = 255; }
    if (b < 0) { b = 0; } else if (b > 255) { b = 255; }
    if (LE) { return (((255 << 24) | (b << 16) | (g << 8) | r) >>> 0); }
    return (((r << 24) | (g << 16) | (b << 8) | 255) >>> 0);
  }

  function hash2(x, y) {
    var h = (Math.imul ? Math.imul(x | 0, 374761393) : (x | 0) * 374761393) + (y | 0) * 668265263;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul ? Math.imul(h, 1274126177) : h * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }

  var CAPS = {
    js: true,
    raf: typeof window.requestAnimationFrame === 'function' || typeof window.webkitRequestAnimationFrame === 'function',
    canvas: false, imagedata: false,
    pointer: !!window.PointerEvent, touch: ('ontouchstart' in window),
    keyboard: true, focus: true,
    webAudio: false, audioEl: false, audioM4a: '', audioPlay: 'not tried',
    wasmApi: (typeof window.WebAssembly !== 'undefined' && typeof window.WebAssembly.instantiate === 'function'),
    wasmReal: false, wasmStatus: 'checking', wasmBenchMs: -1, wasmHash: 0,
    fetchApi: (typeof window.fetch === 'function'),
    xhrApi: (typeof window.XMLHttpRequest === 'function'),
    localStorage: false, sessionStorage: false,
    epubRS: false, rsFeatures: {}, userAgent: ''
  };

  var state = {
    fw: 320, fh: 200,
    sizes: [[160, 120], [320, 200], [320, 240], [640, 400], [800, 600]],
    sizeIndex: 1,
    x: 1.5, y: 7.5, ang: 0.0,
    keys: {},
    keyEvents: 0, pointerEvents: 0, pointerDowns: 0, touchEvents: 0, touchStarts: 0,
    focusEvents: 0, blurEvents: 0,
    shots: 0, flash: 0,
    fps: 0, lastFrameMs: 0,
    lastT: 0, keyActive: false,
    benchRunning: false, benchDone: false, benchIndex: -1,
    benchWarmUntil: 0, benchMeasureStart: 0, benchFrames: 0, benchResults: [],
    autoTurn: false,
    restored: false, saves: 0, errors: 0, lastError: '',
    wasm: null, wasmFallback: null
  };

  var map = null;
  var sprites = [];
  var MAPW = 16, MAPH = 16;

  var asset = { loaded: false, via: 'none', bytes: 0, checksumOk: false, count: 0 };

  var disp, dctx, off, octx, img = null, u32 = null, zbuf = null;

  /* ---------------- capability detection ---------------- */

  function detect() {
    try {
      var c = doc.createElement('canvas');
      if (c && c.getContext) {
        var cx = c.getContext('2d');
        CAPS.canvas = !!cx;
        if (cx) { CAPS.imagedata = !!(cx.createImageData || cx.getImageData); }
      }
    } catch (e) { CAPS.canvas = false; }
    try {
      CAPS.localStorage = storageOk('localStorage');
      CAPS.sessionStorage = storageOk('sessionStorage');
    } catch (e) { }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      CAPS.webAudio = !!AC;
    } catch (e) { CAPS.webAudio = false; }
    try {
      var rs = navigator.epubReadingSystem;
      CAPS.epubRS = !!rs;
      if (rs && typeof rs.hasFeature === 'function') {
        var feats = ['dom-manipulation', 'layout-changes', 'touch-events', 'mouse-events', 'keyboard-events', 'spine-scripting'];
        for (var i = 0; i < feats.length; i++) {
          try { CAPS.rsFeatures[feats[i]] = !!rs.hasFeature(feats[i]); } catch (e2) { CAPS.rsFeatures[feats[i]] = null; }
        }
      }
      if (rs && rs.name) { CAPS.rsFeatures.name = String(rs.name) + ' ' + (rs.version || ''); }
    } catch (e3) { }
    try { CAPS.userAgent = String(navigator.userAgent || ''); } catch (e4) { }
  }

  function storageOk(kind) {
    try {
      var s = window[kind];
      if (!s) { return false; }
      s.setItem('__doom_probe__', '1');
      s.removeItem('__doom_probe__');
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- asset loading (fetch then XHR) ---------------- */

  function getBinary(url, cb) {
    var called = false;
    function finish(err, buf, via) { if (called) { return; } called = true; cb(err, buf, via); }
    if (CAPS.fetchApi) {
      try {
        window.fetch(url).then(function (r) {
          if (!r || !r.ok) { throw new Error('http ' + (r ? r.status : '?')); }
          return r.arrayBuffer();
        }).then(function (b) { finish(null, b, 'fetch'); })['catch'](function (e) { xhr(); });
        return;
      } catch (e) { }
    }
    xhr();
    function xhr() {
      try {
        var x = new XMLHttpRequest();
        x.open('GET', url, true);
        try { x.responseType = 'arraybuffer'; } catch (e2) { }
        x.onload = function () {
          var ok = (x.status === 0 || (x.status >= 200 && x.status < 300));
          if (ok && x.response) { finish(null, x.response, 'xhr'); }
          else { finish(new Error('xhr status ' + x.status), null, 'xhr'); }
        };
        x.onerror = function () { finish(new Error('xhr error'), null, 'xhr'); };
        x.send();
      } catch (e3) { finish(e3, null, 'xhr'); }
    }
  }

  function parseData(ab) {
    var u8 = new Uint8Array(ab);
    if (u8.length < 262) { throw new Error('asset too small'); }
    var m = new Uint8Array(256);
    for (var i = 0; i < 256; i++) { m[i] = u8[i]; }
    var n = u8[256] | (u8[257] << 8);
    var sp = [];
    var off = 258;
    for (var j = 0; j < n; j++) {
      sp.push({
        x: (u8[off] | (u8[off + 1] << 8)) / 256,
        y: (u8[off + 2] | (u8[off + 3] << 8)) / 256,
        t: (u8[off + 4] | (u8[off + 5] << 8))
      });
      off += 6;
    }
    var expect = (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0;
    var h = 2166136261;
    for (var k = 0; k < off; k++) {
      h = h ^ u8[k];
      h = (Math.imul ? Math.imul(h, 16777619) : h * 16777619) >>> 0;
    }
    return { map: m, sprites: sp, bytes: u8.length, count: n, checksumOk: (h >>> 0) === expect };
  }

  var FALLBACK_MAP = [
    '################',
    '#..............#',
    '#..##..##..##..#',
    '#..#....#..#...#',
    '#..#....#..#...#',
    '#....##....#...#',
    '#....##....#...#',
    '#..............#',
    '#..###..###....#',
    '#..............#',
    '#..#..##..#....#',
    '#..#..##..#....#',
    '#..............#',
    '#......##......#',
    '#..............#',
    '################'];

  function fallbackMap() {
    var m = new Uint8Array(256);
    for (var y = 0; y < 16; y++) {
      for (var x = 0; x < 16; x++) {
        m[y * 16 + x] = FALLBACK_MAP[y].charAt(x) === '#' ? (1 + ((x * 7 + y * 3) % 4)) : 0;
      }
    }
    return m;
  }

  /* ---------------- WASM with JS fallback ---------------- */

  function loadWasm(cb) {
    if (!CAPS.wasmApi) { CAPS.wasmStatus = 'API absent'; cb(false); return; }
    getBinary('assets/tiny.wasm', function (err, buf) {
      if (err || !buf) { CAPS.wasmStatus = 'load failed'; cb(false); return; }
      try {
        var p = window.WebAssembly.instantiate(buf, {});
        if (p && typeof p.then === 'function') {
          p.then(function (res) {
            state.wasm = res.instance.exports;
            CAPS.wasmReal = true; CAPS.wasmStatus = 'loaded';
            wasmBench();
            cb(true);
          }, function () { CAPS.wasmStatus = 'instantiate failed'; cb(false); });
        } else {
          state.wasm = p.instance.exports;
          CAPS.wasmReal = true; CAPS.wasmStatus = 'loaded (sync)';
          wasmBench();
          cb(true);
        }
      } catch (e) { CAPS.wasmStatus = 'error: ' + e.message; cb(false); }
    });
  }

  function jsChecksum(p, n) {
    var h = 2166136261;
    for (var i = 0; i < n; i++) {
      h = h ^ (p[i] & 255);
      h = (Math.imul ? Math.imul(h, 16777619) : h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function initJsFallback() {
    var mem = new Uint8Array(65536);
    state.wasmFallback = {
      bufptr: function () { return 0; },
      memory: { buffer: mem.buffer },
      checksum: function (ptr, n) { return jsChecksum(mem, n); },
      bench: function (iters) {
        var h = 12345;
        for (var i = 0; i < iters; i++) { h = (h * 1664525 + 1013904223) >>> 0; }
        return h;
      }
    };
  }

  function wasmBench() {
    try {
      var t0 = now();
      if (state.wasm && state.wasm.bench) { state.wasm.bench(20000000); }
      CAPS.wasmBenchMs = now() - t0;
    } catch (e) { CAPS.wasmBenchMs = -1; }
  }

  function wasmFrameHash() {
    try {
      if (state.wasm && img) {
        var ptr = state.wasm.bufptr();
        var mem = new Uint8Array(state.wasm.memory.buffer);
        var n = state.fw * state.fh * 4;
        if (n > 65536) { n = 65536; }
        if (n > mem.length - ptr) { n = mem.length - ptr; }
        mem.set(img.data.subarray(0, n), ptr);
        return state.wasm.checksum(ptr, n) >>> 0;
      }
      if (state.wasmFallback && img) {
        var m2 = state.wasmFallback.memory.buffer;
        var u = new Uint8Array(m2);
        var n2 = Math.min(img.data.length, 65536);
        u.set(img.data.subarray(0, n2), 0);
        return state.wasmFallback.checksum(0, n2);
      }
    } catch (e) { state.errors++; state.lastError = 'wasmhash: ' + e.message; }
    return 0;
  }

  /* ---------------- renderer ---------------- */

  function allocFrame() {
    off.width = state.fw;
    off.height = state.fh;
    try {
      img = octx.createImageData(state.fw, state.fh);
    } catch (e) {
      img = octx.getImageData(0, 0, state.fw, state.fh);
    }
    u32 = new Uint32Array(img.data.buffer);
    zbuf = new Float32Array(state.fw);
  }

  function texel(type, tx, ty) {
    var h;
    if (type === 1) {
      var bx = tx & 15, by = ty & 15;
      var row = (ty >> 4) & 3;
      var mortar = (bx === 0) || (by === 0);
      h = mortar ? 42 : 118 + ((row * 17 + (tx >> 4) * 23) & 31);
      return [h + 28, h, h - 8];
    }
    if (type === 2) {
      h = 88 + ((hash2(tx, ty) >>> 8) & 63);
      return [h, h, h + 14];
    }
    if (type === 3) {
      h = (tx & 7) < 2 ? 70 : 138;
      if (((tx >> 3) & 1) === 1) { h += 18; }
      if (ty === 8 || ty === 40) { h = 205; }
      return [h, h, h + 22];
    }
    h = hash2(tx, ty) & 255;
    return [118 + (h >> 2), 32, 22 + (h >> 3)];
  }

  function demonTexel(x, y) {
    var dx = x - 15.5, dy = y - 15.5;
    var r = (dx * dx) / (13 * 13) + (dy * dy) / (14 * 14);
    if (r > 1) { return 0; }
    if (y >= 8 && y <= 11 && (x === 9 || x === 10 || x === 21 || x === 22)) {
      return rgb(255, 220, 40);
    }
    if (y === 12 && (x === 14 || x === 17)) { return rgb(40, 20, 20); }
    var base = 140 + ((hash2(x * 3, y * 3) >>> 8) & 45);
    var g = 28 + ((hash2(y, x) >>> 9) & 18);
    return rgb(base, g, 24);
  }

  function isWall(x, y) {
    var mx = x | 0, my = y | 0;
    if (mx < 0 || my < 0 || mx >= MAPW || my >= MAPH) { return true; }
    return map[my * MAPW + mx] > 0;
  }

  function render() {
    var fw = state.fw, fh = state.fh;
    var px = state.x, py = state.y;
    var dirX = Math.cos(state.ang), dirY = Math.sin(state.ang);
    var planeX = -dirY * 0.66, planeY = dirX * 0.66;
    var horizon = fh >> 1;
    var y, x;

    for (y = 0; y < horizon; y++) {
      var tc = y / horizon;
      u32.fill(rgb(18 + 22 * tc, 18 + 20 * tc, 34 + 28 * tc), y * fw, (y + 1) * fw);
    }
    for (y = horizon; y < fh; y++) {
      var tf = (y - horizon) / (fh - horizon);
      u32.fill(rgb(66 + 54 * tf, 46 + 34 * tf, 34 + 20 * tf), y * fw, (y + 1) * fw);
    }

    for (x = 0; x < fw; x++) {
      var camX = 2 * x / fw - 1;
      var rdx = dirX + planeX * camX;
      var rdy = dirY + planeY * camX;
      var mx = px | 0, my = py | 0;
      var ddx = Math.abs(1 / (rdx === 0 ? 1e-9 : rdx));
      var ddy = Math.abs(1 / (rdy === 0 ? 1e-9 : rdy));
      var sdx, sdy, stx, sty;
      if (rdx < 0) { stx = -1; sdx = (px - mx) * ddx; } else { stx = 1; sdx = (mx + 1 - px) * ddx; }
      if (rdy < 0) { sty = -1; sdy = (py - my) * ddy; } else { sty = 1; sdy = (my + 1 - py) * ddy; }
      var side = 0, tile = 0, dist = 64, guard = 0;
      while (guard++ < 80) {
        if (sdx < sdy) { sdx += ddx; mx += stx; side = 0; }
        else { sdy += ddy; my += sty; side = 1; }
        if (mx < 0 || my < 0 || mx >= MAPW || my >= MAPH) { tile = 1; dist = 24; break; }
        tile = map[my * MAPW + mx];
        if (tile > 0) { dist = side === 0 ? (sdx - ddx) : (sdy - ddy); break; }
      }
      if (dist < 0.01) { dist = 0.01; }
      var lineH = (fh / dist) | 0;
      var y0 = horizon - (lineH >> 1);
      var y1 = y0 + lineH;
      var wallX = side === 0 ? py + dist * rdy : px + dist * rdx;
      wallX -= Math.floor(wallX);
      var texX = (wallX * 64) | 0;
      if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) { texX = 63 - texX; }
      var step = 64 / lineH;
      var startY = y0 < 0 ? 0 : y0;
      var endY = y1 > fh ? fh : y1;
      var texPos = (startY - y0) * step;
      var shade = 1 - dist / 14;
      if (shade < 0.12) { shade = 0.12; }
      if (side === 1) { shade *= 0.72; }
      var idx = startY * fw + x;
      for (y = startY; y < endY; y++) {
        var c = texel(tile, texX, (texPos | 0) & 63);
        u32[idx] = rgb(c[0] * shade, c[1] * shade, c[2] * shade);
        texPos += step;
        idx += fw;
      }
      zbuf[x] = dist;
    }

    var invDet = 1 / (planeX * dirY - dirX * planeY);
    for (var s = 0; s < sprites.length; s++) {
      var sp = sprites[s];
      var sx = sp.x - px, sy = sp.y - py;
      var tx = invDet * (dirY * sx - dirX * sy);
      var ty = invDet * (-planeY * sx + planeX * sy);
      if (ty <= 0.25) { continue; }
      var screenX = ((fw / 2) * (1 + tx / ty)) | 0;
      var sprH = Math.abs((fh / ty) | 0);
      if (sprH <= 0) { continue; }
      var drawY = horizon - (sprH >> 1);
      var sprW = sprH;
      var x0 = screenX - (sprW >> 1);
      for (x = x0; x < x0 + sprW; x++) {
        if (x < 0 || x >= fw) { continue; }
        if (zbuf[x] <= ty) { continue; }
        var stx = (((x - x0) * 32) / sprW) | 0;
        for (y = drawY; y < drawY + sprH; y++) {
          if (y < 0 || y >= fh) { continue; }
          var sty = (((y - drawY) * 32) / sprH) | 0;
          var dc = demonTexel(stx, sty);
          if (dc) {
            var dd = 1 - ty / 16;
            if (dd < 0.25) { dd = 0.25; }
            var cr = (dc & 255) * dd, cg = ((dc >>> 8) & 255) * dd, cb = ((dc >>> 16) & 255) * dd;
            u32[y * fw + x] = rgb(cr, cg, cb);
          }
        }
      }
    }
  }

  function present() {
    try {
      octx.putImageData(img, 0, 0);
    } catch (e) { state.errors++; state.lastError = 'putImageData: ' + e.message; }
    var dw = disp.width, dh = disp.height;
    try { dctx.imageSmoothingEnabled = false; } catch (e) { }
    try { dctx.webkitImageSmoothingEnabled = false; } catch (e) { }
    var scale = Math.min(dw / state.fw, dh / state.fh);
    var w = Math.round(state.fw * scale), h = Math.round(state.fh * scale);
    var ox = ((dw - w) / 2) | 0, oy = ((dh - h) / 2) | 0;
    dctx.fillStyle = '#000';
    dctx.fillRect(0, 0, dw, dh);
    dctx.drawImage(off, ox, oy, w, h);
    dctx.textBaseline = 'top';
    dctx.font = 'bold 26px monospace';
    dctx.fillStyle = 'rgba(0,0,0,0.65)';
    dctx.fillRect(ox + 8, oy + 8, 268, 66);
    dctx.fillStyle = '#40ff60';
    dctx.fillText(state.fps.toFixed(1) + ' FPS', ox + 14, oy + 12);
    dctx.font = 'bold 15px monospace';
    dctx.fillStyle = '#e0b000';
    dctx.fillText(state.fw + 'x' + state.fh + '  frame ' + state.lastFrameMs.toFixed(1) + 'ms', ox + 14, oy + 44);
    dctx.fillStyle = '#b0b8ff';
    dctx.fillText('keys ' + state.keyEvents + '  ptr ' + state.pointerEvents + '  touch ' + state.touchEvents + '  fire ' + state.shots, ox + 14, oy + 62);
    if (!state.keyActive) {
      dctx.fillStyle = 'rgba(0,0,0,0.6)';
      dctx.fillRect(ox, oy + h / 2 - 34, w, 68);
      dctx.fillStyle = '#e0b000';
      dctx.font = 'bold 24px monospace';
      dctx.textAlign = 'center';
      dctx.fillText('CLICK / TAP, THEN PRESS W A S D', ox + w / 2, oy + h / 2 - 14);
      dctx.textAlign = 'left';
    }
    var dt = now();
    if (state.shots > 0 && dt - state.flash < 100) {
      dctx.fillStyle = 'rgba(255,220,80,0.30)';
      dctx.fillRect(ox, oy, w, h);
    }
  }

  /* ---------------- main loop ---------------- */

  var last = 0, fpsFrames = 0, fpsStart = 0;

  function loop(t) {
    try {
      if (typeof t !== 'number' || isNaN(t)) { t = now(); }
      var dt = state.lastT ? Math.min(0.06, (t - state.lastT) / 1000) : 0.016;
      state.lastT = t;
      move(dt);
      var f0 = now();
      render();
      present();
      state.lastFrameMs = state.lastFrameMs * 0.9 + (now() - f0) * 0.1;
      fpsFrames++;
      if (fpsStart === 0) { fpsStart = t; }
      if (t - fpsStart >= 500) {
        var inst = fpsFrames * 1000 / (t - fpsStart);
        state.fps = state.fps === 0 ? inst : state.fps * 0.6 + inst * 0.4;
        fpsFrames = 0; fpsStart = t;
      }
      benchTick(t);
      requestFrame(loop);
    } catch (e) {
      state.errors++;
      state.lastError = 'loop: ' + e.message;
      try { byId('hint').textContent = 'JS ERROR: ' + e.message; } catch (e2) { }
      requestFrame(loop);
    }
  }

  function move(dt) {
    var mx = 0, mz = 0, turn = 0;
    if (state.keys.fwd) { mx += 1; }
    if (state.keys.back) { mx -= 1; }
    if (state.keys.left) { mz -= 1; }
    if (state.keys.right) { mz += 1; }
    if (state.keys.turnl) { turn -= 1; }
    if (state.keys.turnr) { turn += 1; }
    if (state.autoTurn) { turn += 0.7; }
    state.ang += turn * 2.2 * dt;
    var sp = 2.8 * dt;
    var nx = state.x + (Math.cos(state.ang) * mx - Math.sin(state.ang) * mz) * sp;
    var ny = state.y + (Math.sin(state.ang) * mx + Math.cos(state.ang) * mz) * sp;
    if (!isWall(nx, state.y)) { state.x = nx; }
    if (!isWall(state.x, ny)) { state.y = ny; }
  }

  /* ---------------- benchmarking ---------------- */

  function startBenchStep() {
    var s = state.sizes[state.benchIndex];
    setSize(state.benchIndex, true);
    state.benchWarmUntil = now() + 700;
    state.benchMeasureStart = 0;
    state.benchFrames = 0;
    state.autoTurn = true;
    renderBenchTable();
  }

  function startBenchmark() {
    state.benchRunning = true;
    state.benchDone = false;
    state.benchIndex = 0;
    state.benchResults = [];
    startBenchStep();
  }

  function benchTick(t) {
    if (!state.benchRunning) { return; }
    if (t < state.benchWarmUntil) { return; }
    if (state.benchMeasureStart === 0) { state.benchMeasureStart = t; }
    state.benchFrames++;
    var elapsed = t - state.benchMeasureStart;
    if (elapsed >= 2500) {
      state.benchResults[state.benchIndex] = state.benchFrames / (elapsed / 1000);
      state.benchIndex++;
      if (state.benchIndex >= state.sizes.length) {
        state.benchRunning = false;
        state.benchDone = true;
        state.autoTurn = false;
        setSize(1, true);
      } else {
        startBenchStep();
      }
      renderBenchTable();
    }
  }

  function setSize(index, force) {
    if (index < 0 || index >= state.sizes.length) { return; }
    state.sizeIndex = index;
    var s = state.sizes[index];
    if (state.fw !== s[0] || state.fh !== s[1] || force) {
      state.fw = s[0]; state.fh = s[1];
      allocFrame();
    }
  }

  /* ---------------- input ---------------- */

  var dragging = false, dragLast = 0, dragDist = 0;

  function keyOf(e) {
    if (e.key) { return String(e.key); }
    return e.keyCode || 0;
  }

  function actionFor(k) {
    var key = String(k).toLowerCase();
    if (key === 'w' || k === 'ArrowUp') { return 'fwd'; }
    if (key === 's' || k === 'ArrowDown') { return 'back'; }
    if (key === 'a') { return 'left'; }
    if (key === 'd') { return 'right'; }
    if (key === 'q' || k === 'ArrowLeft') { return 'turnl'; }
    if (key === 'e' || k === 'ArrowRight') { return 'turnr'; }
    if (k === ' ' || key === 'spacebar' || key === 'space') { return 'fire'; }
    return null;
  }

  function onKeyDown(e) {
    state.keyEvents++;
    state.keyActive = true;
    var k = keyOf(e);
    var a = actionFor(k);
    if (a === 'fire') {
      e.preventDefault && e.preventDefault();
      if (!state.keys.fire) { state.keys.fire = true; fire(); }
      return;
    }
    if (a) {
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') {
        e.preventDefault && e.preventDefault();
      }
      state.keys[a] = true;
      return;
    }
    var ks = String(k);
    if (ks >= '1' && ks <= '5') { setSize((ks.charCodeAt(0) - 49), false); }
    if (ks.toLowerCase() === 'b') { startBenchmark(); }
  }

  function onKeyUp(e) {
    var a = actionFor(keyOf(e));
    if (a) { state.keys[a] = false; }
  }

  function fire() {
    state.shots++;
    state.flash = now();
    playBeep();
    saveState();
  }

  function bindInput() {
    doc.addEventListener('keydown', onKeyDown, false);
    doc.addEventListener('keyup', onKeyUp, false);

    function focusCanvas() { try { disp.focus(); } catch (e) { } }
    doc.addEventListener('mousedown', focusCanvas, false);

    disp.addEventListener('focus', function () { state.focusEvents++; }, false);
    disp.addEventListener('blur', function () { state.blurEvents++; }, false);

    function down(x, y, isTouch) {
      dragging = true; dragLast = x; dragDist = 0;
      state.pointerEvents++;
      state.pointerDowns++;
      if (isTouch) { state.touchEvents++; state.touchStarts++; }
      focusCanvas();
    }
    function moveF(x) {
      if (!dragging) { return; }
      var dx = x - dragLast;
      dragLast = x;
      dragDist += Math.abs(dx);
      state.ang += dx * 0.006;
    }
    function up() {
      if (dragging && dragDist < 6) { fire(); }
      dragging = false;
    }

    if (window.PointerEvent) {
      disp.addEventListener('pointerdown', function (e) { down(e.clientX, e.clientY, e.pointerType === 'touch'); }, false);
      window.addEventListener('pointermove', function (e) { moveF(e.clientX); }, false);
      window.addEventListener('pointerup', up, false);
      window.addEventListener('pointercancel', up, false);
    } else {
      disp.addEventListener('mousedown', function (e) { down(e.clientX, e.clientY, false); }, false);
      window.addEventListener('mousemove', function (e) { moveF(e.clientX); }, false);
      window.addEventListener('mouseup', up, false);
      disp.addEventListener('touchstart', function (e) {
        if (e.touches && e.touches.length) { down(e.touches[0].clientX, e.touches[0].clientY, true); }
      }, false);
      disp.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length) { moveF(e.touches[0].clientX); e.preventDefault(); }
      }, false);
      disp.addEventListener('touchend', up, false);
      disp.addEventListener('touchcancel', up, false);
    }

    var btns = [
      ['b-left', 'turnl'], ['b-fwd', 'fwd'], ['b-back', 'back'], ['b-right', 'turnr'], ['b-fire', 'fire']
    ];
    for (var i = 0; i < btns.length; i++) {
      bindButton(btns[i][0], btns[i][1]);
    }
  }

  function bindButton(id, action) {
    var el = byId(id);
    if (!el) { return; }
    function down(e) {
      if (action === 'fire') { fire(); if (!state.keys.fire) { state.keys.fire = true; } }
      else { state.keys[action] = true; }
      state.pointerEvents++;
      if (e && e.preventDefault) { e.preventDefault(); }
      try { disp.focus(); } catch (e2) { }
      return false;
    }
    function up(e) {
      if (action !== 'fire') { state.keys[action] = false; }
      else { state.keys.fire = false; }
      if (e && e.preventDefault) { e.preventDefault(); }
      return false;
    }
    if (window.PointerEvent) {
      el.addEventListener('pointerdown', down, false);
      el.addEventListener('pointerup', up, false);
      el.addEventListener('pointerleave', up, false);
    } else {
      el.addEventListener('mousedown', down, false);
      el.addEventListener('mouseup', up, false);
      el.addEventListener('mouseleave', up, false);
      el.addEventListener('touchstart', down, false);
      el.addEventListener('touchend', up, false);
      el.addEventListener('touchcancel', up, false);
    }
  }

  /* ---------------- audio ---------------- */

  var audioEl = null, audioCtx = null;

  function initAudio() {
    try {
      audioEl = new Audio('assets/beep.m4a');
      audioEl.preload = 'auto';
      CAPS.audioEl = true;
      if (audioEl.canPlayType) {
        CAPS.audioM4a = audioEl.canPlayType('audio/mp4; codecs="mp4a.40.2"') || audioEl.canPlayType('audio/mp4') || '';
        if (!CAPS.audioM4a) { CAPS.audioM4a = 'no'; }
      }
    } catch (e) { CAPS.audioEl = false; }
  }

  function ensureAudioCtx() {
    if (audioCtx || !CAPS.webAudio) { return; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      if (audioCtx.state === 'suspended' && audioCtx.resume) { audioCtx.resume(); }
    } catch (e) { audioCtx = null; }
  }

  function playBeep() {
    if (audioEl) {
      try {
        audioEl.currentTime = 0;
        var p = audioEl.play();
        if (p && typeof p.then === 'function') {
          p.then(function () { CAPS.audioPlay = 'played'; }, function (err) {
            CAPS.audioPlay = 'blocked (' + (err && err.name ? err.name : 'error') + ')';
          });
        } else {
          CAPS.audioPlay = 'played';
        }
      } catch (e) { CAPS.audioPlay = 'error: ' + e.message; }
    }
    ensureAudioCtx();
    if (audioCtx) {
      try {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.type = 'square';
        o.frequency.value = 180 + (state.shots % 4) * 60;
        g.gain.setValueAtTime(0.08, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + 0.2);
        CAPS.webAudio = true;
      } catch (e) { }
    }
  }

  /* ---------------- persistence ---------------- */

  function saveState() {
    if (!CAPS.localStorage && !CAPS.sessionStorage) { return; }
    var data = JSON.stringify({
      x: state.x, y: state.y, ang: state.ang,
      shots: state.shots, saves: state.saves, t: now()
    });
    state.saves++;
    try { if (CAPS.localStorage) { window.localStorage.setItem('doom_epub_state', data); } } catch (e) { }
    try { if (CAPS.sessionStorage) { window.sessionStorage.setItem('doom_epub_state', data); } } catch (e) { }
  }

  function restoreState() {
    var raw = null;
    try { if (CAPS.sessionStorage) { raw = window.sessionStorage.getItem('doom_epub_state'); } } catch (e) { }
    if (!raw) { try { if (CAPS.localStorage) { raw = window.localStorage.getItem('doom_epub_state'); } } catch (e) { } }
    if (!raw) { return; }
    try {
      var d = JSON.parse(raw);
      if (d && typeof d.x === 'number') {
        state.x = d.x; state.y = d.y; state.ang = d.ang;
        state.shots = d.shots || 0;
        state.restored = true;
      }
    } catch (e) { }
  }

  /* ---------------- HUD ---------------- */

  var capCells = {};
  var benchCells = [];

  function addCapRow(label) {
    var table = byId('caps');
    var tr = doc.createElement('tr');
    var td1 = doc.createElement('td');
    td1.className = 'k';
    td1.textContent = label;
    var td2 = doc.createElement('td');
    td2.textContent = '...';
    tr.appendChild(td1); tr.appendChild(td2);
    table.appendChild(tr);
    capCells[label] = td2;
    return td2;
  }

  function setCap(label, text, cls) {
    var td = capCells[label];
    if (!td) { return; }
    td.textContent = text;
    td.className = cls || '';
  }

  function yn(ok, yes, no) { return ok ? [yes || 'yes', 'yes'] : [no || 'NO', 'no']; }

  function buildCaps() {
    var labels = [
      'JavaScript', 'requestAnimationFrame', 'Canvas 2D', 'ImageData framebuffer',
      'Keyboard input', 'Pointer input', 'Touch input', 'Focus events',
      'WebAudio', 'Audio element (m4a)', 'WebAssembly', 'WASM compute 20M',
      'Binary asset data.bin', 'localStorage', 'sessionStorage', 'epubReadingSystem'
    ];
    for (var i = 0; i < labels.length; i++) { addCapRow(labels[i]); }
  }

  function updateCaps() {
    setCap('JavaScript', 'YES', 'yes');
    var v = yn(CAPS.raf, 'yes (rAF)', 'no (timer fallback)');
    setCap('requestAnimationFrame', v[0], v[1]);
    v = yn(CAPS.canvas); setCap('Canvas 2D', v[0], v[1]);
    v = yn(CAPS.imagedata); setCap('ImageData framebuffer', v[0], v[1]);
    if (state.keyEvents > 0) { setCap('Keyboard input', 'yes (' + state.keyEvents + ' events)', 'yes'); }
    else { setCap('Keyboard input', 'supported, waiting', 'wait'); }
    if (CAPS.pointer) { setCap('Pointer input', state.pointerEvents > 0 ? 'yes (' + state.pointerEvents + ')' : 'supported, waiting', state.pointerEvents > 0 ? 'yes' : 'wait'); }
    else { setCap('Pointer input', 'NO PointerEvent', 'no'); }
    if (CAPS.touch) { setCap('Touch input', state.touchEvents > 0 ? 'yes (' + state.touchEvents + ')' : 'touch device, waiting', state.touchEvents > 0 ? 'yes' : 'wait'); }
    else { setCap('Touch input', 'no touch events', 'wait'); }
    setCap('Focus events', 'in ' + state.focusEvents + ' / out ' + state.blurEvents, state.focusEvents > 0 ? 'yes' : 'wait');
    if (CAPS.webAudio) { setCap('WebAudio', state.shots > 0 ? 'yes (played on fire)' : 'API yes, fire to test', state.shots > 0 ? 'yes' : 'wait'); }
    else { setCap('WebAudio', 'NO', 'no'); }
    setCap('Audio element (m4a)', 'canPlay: ' + (CAPS.audioM4a || '?') + ' / ' + CAPS.audioPlay, CAPS.audioPlay === 'played' ? 'yes' : 'wait');
    if (CAPS.wasmReal) { setCap('WebAssembly', CAPS.wasmStatus, 'yes'); }
    else if (state.wasmFallback) { setCap('WebAssembly', CAPS.wasmStatus + ' - JS fallback active', 'wait'); }
    else { setCap('WebAssembly', CAPS.wasmStatus, 'no'); }
    setCap('WASM compute 20M', CAPS.wasmBenchMs >= 0 ? CAPS.wasmBenchMs.toFixed(1) + ' ms' : 'n/a', CAPS.wasmBenchMs >= 0 ? 'yes' : 'wait');
    if (asset.loaded) { setCap('Binary asset data.bin', asset.bytes + ' B via ' + asset.via + (asset.checksumOk ? ' OK' : ' BADSUM'), asset.checksumOk ? 'yes' : 'wait'); }
    else { setCap('Binary asset data.bin', 'fallback map (' + asset.via + ')', 'wait'); }
    v = yn(CAPS.localStorage, 'yes' + (state.restored ? ' (restored)' : ''), 'NO');
    setCap('localStorage', v[0], v[1] ? v[1] : 'no');
    v = yn(CAPS.sessionStorage, 'yes' + (state.restored ? ' (restored)' : ''), 'NO');
    setCap('sessionStorage', v[0], v[1]);
    if (CAPS.epubRS) {
      var f = [];
      for (var k in CAPS.rsFeatures) {
        if (k !== 'name' && CAPS.rsFeatures.hasOwnProperty(k)) { f.push(k.replace('-events', '') + ':' + (CAPS.rsFeatures[k] ? 'y' : 'n')); }
      }
      setCap('epubReadingSystem', (CAPS.rsFeatures.name ? CAPS.rsFeatures.name + ' ' : '') + f.join(' '), 'yes');
    } else { setCap('epubReadingSystem', 'not exposed', 'no'); }
  }

  function buildBench() {
    var table = byId('bench');
    benchCells = [];
    for (var i = 0; i < state.sizes.length; i++) {
      var tr = doc.createElement('tr');
      var td1 = doc.createElement('td');
      td1.textContent = state.sizes[i][0] + ' x ' + state.sizes[i][1];
      var td2 = doc.createElement('td');
      td2.className = 'r';
      td2.textContent = '--';
      tr.appendChild(td1); tr.appendChild(td2);
      table.appendChild(tr);
      benchCells.push({ row: tr, val: td2 });
    }
  }

  function renderBenchTable() {
    for (var i = 0; i < benchCells.length; i++) {
      var c = benchCells[i];
      var r = state.benchResults[i];
      if (typeof r === 'number') { c.val.textContent = r.toFixed(1) + ' fps'; c.val.className = 'r yes'; }
      else if (state.benchRunning && i === state.benchIndex) { c.val.textContent = 'measuring...'; c.val.className = 'r wait'; }
      else if (state.benchRunning && i < state.benchIndex) { c.val.textContent = ''; c.val.className = 'r'; }
      else { c.val.textContent = '--'; c.val.className = 'r'; }
    }
  }

  function updateHud() {
    try { updateCaps(); } catch (e) { }
    byId('fps').textContent = state.fps.toFixed(1) + ' FPS';
    byId('sub').textContent = 'framebuffer ' + state.fw + 'x' + state.fh + ' \u00b7 frame ' + state.lastFrameMs.toFixed(1) + ' ms';
    var inp = 'keys ' + state.keyEvents + ' (active: ' + (state.keyActive ? 'yes' : 'no') +
      ') \u00b7 pointer ' + state.pointerEvents + ' \u00b7 touch ' + state.touchEvents +
      ' \u00b7 shots ' + state.shots + ' \u00b7 errors ' + state.errors + (state.lastError ? ' [' + state.lastError + ']' : '');
    byId('inputline').textContent = inp;
    var wl = 'wasm: ' + (CAPS.wasmReal ? 'REAL' : (state.wasmFallback ? 'JS fallback' : 'none')) +
      ' \u00b7 frame hash ' + (wasmFrameHash() >>> 0).toString(16) +
      ' \u00b7 asset ' + (asset.loaded ? asset.bytes + 'B/' + asset.via : 'fallback') +
      ' \u00b7 restored ' + (state.restored ? 'yes' : 'no');
    byId('wasmline').textContent = wl;
  }

  /* ---------------- boot ---------------- */

  function boot() {
    disp = byId('display');
    dctx = disp.getContext('2d');
    off = doc.createElement('canvas');
    octx = off.getContext('2d');
    detect();
    buildCaps();
    buildBench();
    renderBenchTable();
    allocFrame();
    initAudio();
    initJsFallback();
    map = fallbackMap();
    sprites = [{ x: 5.5, y: 5.5, t: 1 }, { x: 10.4, y: 8.6, t: 2 }, { x: 2.8, y: 12.4, t: 1 }];
    restoreState();
    bindInput();
    updateCaps();

    getBinary('assets/data.bin', function (err, buf, via) {
      if (!err && buf) {
        try {
          var parsed = parseData(buf);
          map = parsed.map;
          sprites = parsed.sprites.length ? parsed.sprites : sprites;
          asset.loaded = true; asset.via = via; asset.bytes = parsed.bytes;
          asset.checksumOk = parsed.checksumOk; asset.count = parsed.count;
        } catch (e) { asset.via = 'parse-error'; }
      } else { asset.via = via || 'failed'; }
      updateCaps();
    });

    loadWasm(function () { updateCaps(); setTimeout(wasmBench, 300); });

    requestFrame(loop);
    window.setInterval(updateHud, 400);
    window.setInterval(saveState, 3000);
    window.setTimeout(function () {
      if (!state.benchRunning && !state.benchDone) { startBenchmark(); }
    }, 2500);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
}());
