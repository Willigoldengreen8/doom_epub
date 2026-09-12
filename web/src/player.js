/*
 * doom.epub player core.
 *
 * Loads a DoomGeneric build (doom.js + doom.wasm), the shareware WAD, and
 * drives the engine from requestAnimationFrame. Designed for the constrained
 * EPUB sandbox: no network, no workers, no eval, XHR-first asset loading,
 * zero-copy blit of the engine RGBA framebuffer.
 *
 * ES5-compatible on purpose (Apple Books' WebKit is modern, but older
 * mainstream readers are not).
 */
(function (global) {
  'use strict';

  var W = 320, H = 200;

  var K = {
    RIGHT: 0xae, LEFT: 0xac, UP: 0xad, DOWN: 0xaf,
    STRAFE_L: 0xa0, STRAFE_R: 0xa1,
    USE: 0xa2, FIRE: 0xa3,
    ESC: 27, ENTER: 13, TAB: 9,
    F2: 0x80 + 0x3c, F3: 0x80 + 0x3d, F4: 0x80 + 0x3e,
    RSHIFT: 0x80 + 0x36
  };

  function now() {
    if (global.performance && typeof global.performance.now === 'function') {
      return global.performance.now();
    }
    return (new Date()).getTime();
  }

  function getBinary(url, cb) {
    var called = false;
    function finish(err, buf, via) { if (called) { return; } called = true; cb(err, buf, via); }
    function xhr() {
      try {
        var x = new XMLHttpRequest();
        x.open('GET', url, true);
        try { x.responseType = 'arraybuffer'; } catch (e0) { }
        x.onload = function () {
          var ok = (x.status === 0 || (x.status >= 200 && x.status < 300));
          if (ok && x.response) { finish(null, x.response, 'xhr'); }
          else { finish(new Error('xhr status ' + x.status + ' for ' + url), null, 'xhr'); }
        };
        x.onerror = function () { finish(new Error('xhr error for ' + url), null, 'xhr'); };
        x.send();
      } catch (e1) { finish(e1, null, 'xhr'); }
    }
    if (typeof global.fetch === 'function') {
      try {
        global.fetch(url).then(function (r) {
          if (!r || !r.ok) { throw new Error('http ' + (r ? r.status : '?') + ' for ' + url); }
          return r.arrayBuffer();
        }).then(function (b) { finish(null, b, 'fetch'); })['catch'](function () { xhr(); });
        return;
      } catch (e2) { }
    }
    xhr();
  }

  function loadScript(url, cb) {
    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.src = url;
    s.onload = function () { cb(null); };
    s.onerror = function () { cb(new Error('script load failed: ' + url)); };
    (document.head || document.body).appendChild(s);
  }

  /*
   * cfg = {
   *   canvas:        HTMLCanvasElement (required)
   *   status:        function(text, kind)   (optional)
   *   moduleScript:  URL of doom.js
   *   wasmUrl:       URL of doom.wasm
   *   wadUrl:        URL of the IWAD
   *   wadPath:       MEMFS path (default /doom1.wad)
   *   argv:          extra engine args (array)
   *   onState:       function(stateName)     (optional)
   *   syncPrefix:    'doom'  -> enable savegame localStorage sync
   * }
   */
  function create(cfg) {
    var canvas = cfg.canvas;
    // WebKit (Apple Books) grants the page keyboard input after a click on
    // the reading content.  A plain marker element laid over the plate is
    // the click target that triggers that hand-off.
    var surface = cfg.surface || canvas;
    if (surface.tagName === 'INPUT') {
      // Keep the catcher empty however the reader dispatches input.
      surface.addEventListener('input', function () { surface.value = ''; }, false);
    }
    var ctx = null, fbCtx = null, cssCanvasName = null;
    try {
      if (document.getCSSCanvasContext) {
        cssCanvasName = 'doomfb' + Date.now().toString(36) +
          Math.floor(Math.random() * 1e6).toString(36);
        fbCtx = document.getCSSCanvasContext('2d', cssCanvasName, W, H);
      }
    } catch (eCss) { fbCtx = null; }
    if (fbCtx) {
      // Apple Books refuses keyboard input while a tapped area belongs to a
      // <canvas> element.  WebKit's CSS canvas paints the same framebuffer
      // from a plain <div>, which keeps keyboard hand-off working.
      var plate = document.createElement('div');
      plate.id = canvas.id;
      plate.className = canvas.className;
      plate.setAttribute('style',
        'background-image:-webkit-canvas(' + cssCanvasName + ');' +
        'background-size:100% 100%;background-repeat:no-repeat;');
      if (canvas.parentNode) { canvas.parentNode.replaceChild(plate, canvas); }
    } else {
      ctx = canvas.getContext('2d');
      canvas.width = W;
      canvas.height = H;
    }
    var status = cfg.status || function () { };
    var onState = cfg.onState || function () { };
    var wadPath = cfg.wadPath || '/doom1.wad';
    var syncPrefix = cfg.syncPrefix || 'doom_epub';

    var Module = null;
    var ptr = 0, imageData = null, direct = false, heapView = null;
    var running = false, frame = 0, fps = 0, fpsFrames = 0, fpsStart = 0;
    var lastTickMs = 0, avgTickMs = 0;
    var started = false;
    var destroyed = false;
    var engineInfo = { wadBytes: 0, wasmBytes: 0, tics: 0, bootMs: -1 };

    var held = {};       // doomKey -> true
    var turnKey = 0;

    function pushKey(pressed, doomKey) {
      if (!Module) { return; }
      try { Module._epub_push_key(pressed ? 1 : 0, doomKey); } catch (e) { }
    }

    function press(doomKey) {
      if (held[doomKey]) { return; }
      held[doomKey] = true;
      pushKey(true, doomKey);
    }

    function release(doomKey) {
      if (!held[doomKey]) { return; }
      held[doomKey] = false;
      pushKey(false, doomKey);
    }

    function releaseAll() {
      for (var k in held) {
        if (held.hasOwnProperty(k) && held[k]) { release(parseInt(k, 10)); }
      }
      if (turnKey) { release(turnKey); turnKey = 0; }
    }

    // ---- keyboard ------------------------------------------------------

    function codeToDoom(code, key) {
      switch (code) {
        case 'KeyW': return K.UP;
        case 'KeyS': return K.DOWN;
        case 'KeyA': return K.LEFT;
        case 'KeyD': return K.RIGHT;
        case 'KeyQ': return K.STRAFE_L;
        case 'KeyE': return K.STRAFE_R;
        case 'ArrowUp': return K.UP;
        case 'ArrowDown': return K.DOWN;
        case 'ArrowLeft': return K.LEFT;
        case 'ArrowRight': return K.RIGHT;
        case 'Space': return K.USE;
        case 'KeyR': return K.USE;
        case 'Enter': case 'NumpadEnter': return K.ENTER;
        case 'Escape': return K.ESC;
        case 'Tab': return K.TAB;
        case 'ControlLeft': case 'ControlRight': case 'KeyF': return K.FIRE;
        case 'ShiftLeft': case 'ShiftRight': return K.RSHIFT;
        case 'F2': return K.F2;
        case 'F3': return K.F3;
        case 'F4': return K.F4;
        case 'Digit1': return 0x31;
        case 'Digit2': return 0x32;
        case 'Digit3': return 0x33;
        case 'Digit4': return 0x34;
        case 'Digit5': return 0x35;
        case 'Digit6': return 0x36;
        case 'Digit7': return 0x37;
        case 'Minus': return 0x2d;
        case 'Equal': return 0x3d;
        default: break;
      }
      // Fallback for engines without KeyboardEvent.code.
      var k = key || '';
      if (k === ' ') { return K.USE; }
      switch (k.toLowerCase()) {
        case 'w': return K.UP;
        case 's': return K.DOWN;
        case 'a': return K.LEFT;
        case 'd': return K.RIGHT;
        case 'q': return K.STRAFE_L;
        case 'e': return K.STRAFE_R;
        case 'r': return K.USE;
        case 'f': return K.FIRE;
        default: break;
      }
      if (k.length === 1) {
        var c = k.toUpperCase().charCodeAt(0);
        if (c >= 0x31 && c <= 0x39) { return c; }
        return c;
      }
      switch (k) {
        case 'ArrowUp': return K.UP;
        case 'ArrowDown': return K.DOWN;
        case 'ArrowLeft': return K.LEFT;
        case 'ArrowRight': return K.RIGHT;
        case 'Enter': return K.ENTER;
        case 'Escape': case 'Esc': return K.ESC;
        case 'Tab': return K.TAB;
        case 'Control': return K.FIRE;
        case 'Shift': return K.RSHIFT;
        case ' ': return K.USE;
        default: return 0;
      }
    }

    function onKeyDown(e) {
      if (e.__doomHandled) { return; }
      resumeAudio();
      var dk = codeToDoom(e.code, e.key);
      if (!dk) { return; }
      e.__doomHandled = true;
      if (e.preventDefault) { e.preventDefault(); }
      press(dk);
      // Release modified duplicate (e.g. Space also fires in some engines).
      if (dk === K.USE) { /* keep */ }
    }

    function onKeyUp(e) {
      var dk = codeToDoom(e.code, e.key);
      if (!dk) { return; }
      if (e.preventDefault) { e.preventDefault(); }
      release(dk);
    }

    // ---- pointer / touch ----------------------------------------------

    var dragging = false, dragLastX = 0, dragDist = 0, dragStart = 0;
    var pointerDown = false;

    function startDrag(x) {
      dragging = true; dragLastX = x; dragDist = 0; dragStart = now();
      resumeAudio();
    }

    function moveDrag(x) {
      if (!dragging) { return; }
      var dx = x - dragLastX;
      dragLastX = x;
      dragDist += Math.abs(dx);
      var want = 0;
      if (dx > 1.2) { want = K.RIGHT; }
      else if (dx < -1.2) { want = K.LEFT; }
      if (want !== turnKey) {
        if (turnKey) { release(turnKey); turnKey = 0; }
        if (want) { press(want); turnKey = want; }
      }
    }

    function endDrag(fireIfTap, useIfLong) {
      if (!dragging) { return; }
      dragging = false;
      if (turnKey) { release(turnKey); turnKey = 0; }
      var dt = now() - dragStart;
      if (fireIfTap && dragDist < 8 && dt < 400) {
        press(K.FIRE);
        global.setTimeout(function () { release(K.FIRE); }, 140);
      } else if (useIfLong && dragDist < 8) {
        press(K.USE);
        global.setTimeout(function () { release(K.USE); }, 140);
      }
    }

    function bindInput() {
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);

      // Readers such as Apple Books deliver keyboard events only once the
      // book content itself has received focus.  Clicking anywhere in the
      // page should be enough, not just the game plate.
      if (global.PointerEvent) {
        global.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'touch') { return; }
          stringFocus();
        }, false);
      } else {
        global.addEventListener('mousedown', function () { stringFocus(); }, false);
      }

      if (global.PointerEvent) {
        surface.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'touch') { return; } // handled by touch listeners
          if (e.pointerType === 'mouse' && e.button === 2) {
            press(K.USE);
            global.setTimeout(function () { release(K.USE); }, 140);
            e.preventDefault();
            return;
          }
          stringFocus();
          pointerDown = true;
          startDrag(e.clientX);
          // No preventDefault() here: WebKit needs the default mousedown
          // action to move keyboard focus into the book content.
        }, false);
        global.addEventListener('pointermove', function (e) {
          if (e.pointerType === 'touch') { return; }
          moveDrag(e.clientX);
        }, false);
        global.addEventListener('pointerup', function (e) {
          if (e.pointerType === 'touch') { return; }
          pointerDown = false;
          endDrag(true, false);
        }, false);
        global.addEventListener('pointercancel', function (e) {
          if (e.pointerType === 'touch') { return; }
          endDrag(false, false);
        }, false);
      } else {
        surface.addEventListener('mousedown', function (e) {
          if (e.button === 2) {
            press(K.USE);
            global.setTimeout(function () { release(K.USE); }, 140);
            e.preventDefault();
            return;
          }
          startDrag(e.clientX);
        }, false);
        global.addEventListener('mousemove', function (e) { moveDrag(e.clientX); }, false);
        global.addEventListener('mouseup', function () { endDrag(true, false); }, false);
      }

      // Touch is bound separately so it works even when the engine exposes
      // PointerEvent but the reader only synthesises touch events.
      surface.addEventListener('contextmenu', function (e) { e.preventDefault(); }, false);
      // No preventDefault() on touch: Apple Books stops granting the page
      // keyboard input when a touch sequence is cancelled.  Scrolling is
      // suppressed with touch-action in CSS instead.
      surface.addEventListener('touchstart', function (e) {
        stringFocus();
        if (e.touches && e.touches.length) { startDrag(e.touches[0].clientX); }
      }, false);
      surface.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length) { moveDrag(e.touches[0].clientX); }
      }, false);
      surface.addEventListener('touchend', function (e) { endDrag(true, false); }, false);
      surface.addEventListener('touchcancel', function (e) { endDrag(false, false); }, false);

      // Focus: readers need a click before key events are delivered.
      function stringFocus() {
        // Do NOT call element.focus() here.  WebKit readers (Apple Books)
        // grant the page keyboard input after a click on their own; a
        // programmatic focus() during the click interrupts that hand-off
        // and leaves the reader's chrome with the keyboard.
        if (cfg.onFocus) {
          var ae = document.activeElement;
          var where = (ae && ae.id) ? ae.id : (ae ? ae.tagName : 'none');
          cfg.onFocus(where + (global.top === global ? ' top' : ' frame'));
        }
      }
      global.addEventListener('focus', function () {
        if (cfg.onFocus) { cfg.onFocus('win-focus'); }
      }, false);
      global.addEventListener('blur', function () {
        if (cfg.onFocus) { cfg.onFocus('win-blur'); }
      }, false);
      bind(document);

      function bind(root) {
        var els = root.querySelectorAll ? root.querySelectorAll('[data-doomkey]') : [];
        for (var i = 0; i < els.length; i++) {
          bindKeyButton(els[i]);
        }
      }

      function bindKeyButton(el) {
        var dk = parseInt(el.getAttribute('data-doomkey'), 10);
        if (!dk) { return; }
        var momentary = el.getAttribute('data-momentary') !== 'false';
        var pressTime = 0, releaseTimer = 0;
        function down(e) {
          if (releaseTimer) { global.clearTimeout(releaseTimer); releaseTimer = 0; }
          if (momentary) {
            pressTime = now();
            press(dk);
          } else {
            pushKey(true, dk); pushKey(false, dk);
          }
          stringFocus();
          if (e && e.preventDefault) { e.preventDefault(); }
        }
        function up(e) {
          if (momentary) {
            // DOOM samples held keys once per 35 Hz tic; guarantee the engine
            // sees even the quickest click or tap.
            var heldFor = now() - pressTime;
            if (heldFor < 120) {
              releaseTimer = global.setTimeout(function () {
                releaseTimer = 0;
                release(dk);
              }, 120 - heldFor);
            } else {
              release(dk);
            }
          }
          if (e && e.preventDefault) { e.preventDefault(); }
        }
        if (global.PointerEvent) {
          el.addEventListener('pointerdown', down, false);
          el.addEventListener('pointerup', up, false);
          el.addEventListener('pointerleave', up, false);
          el.addEventListener('pointercancel', up, false);
        } else {
          el.addEventListener('mousedown', down, false);
          el.addEventListener('mouseup', up, false);
          el.addEventListener('mouseleave', up, false);
          el.addEventListener('touchstart', down, false);
          el.addEventListener('touchend', up, false);
          el.addEventListener('touchcancel', up, false);
        }
      }
    }

    // ---- audio unlock ------------------------------------------------

    function resumeAudio() {
      try {
        var SDL2 = Module && Module.SDL2;
        if (SDL2 && SDL2.audioContext && SDL2.audioContext.state === 'suspended' &&
            SDL2.audioContext.resume) {
          SDL2.audioContext.resume();
        }
      } catch (e) { }
    }

    // ---- savegame sync ------------------------------------------------

    var SAVE_DIRS = ['/', '/.savegame', '/savegame'];

    function fsListSaves() {
      if (!Module || !Module.FS) { return []; }
      var out = [];
      for (var d = 0; d < SAVE_DIRS.length; d++) {
        var dir = SAVE_DIRS[d];
        try {
          var files = Module.FS.readdir(dir);
          for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (/^(doomsav|save)\d+\.dsg$/.test(f)) {
              out.push(dir === '/' ? '/' + f : dir + '/' + f);
            }
          }
        } catch (e) { }
      }
      return out;
    }

    function syncSavesToStorage() {
      if (!cfg.syncStorage) { return; }
      var saves = fsListSaves();
      for (var i = 0; i < saves.length; i++) {
        try {
          var data = Module.FS.readFile(saves[i]);
          var b64 = base64Encode(data);
          cfg.syncStorage.setItem(syncPrefix + '_save_' + saves[i].replace(/\//g, '_'), b64);
        } catch (e) { }
      }
      if (saves.length) {
        try { cfg.syncStorage.setItem(syncPrefix + '_saves', saves.join(',')); } catch (e2) { }
      }
    }

    function ensureDir(path) {
      var parts = path.split('/');
      var cur = '';
      for (var i = 1; i < parts.length - 1; i++) {
        cur += '/' + parts[i];
        try { Module.FS.mkdir(cur); } catch (e) { }
      }
    }

    function restoreSavesFromStorage() {
      if (!cfg.syncStorage) { return 0; }
      var list = '';
      try { list = cfg.syncStorage.getItem(syncPrefix + '_saves') || ''; } catch (e) { return 0; }
      if (!list) { return 0; }
      var names = list.split(',');
      var n = 0;
      for (var i = 0; i < names.length; i++) {
        var path = names[i];
        try {
          var b64 = cfg.syncStorage.getItem(syncPrefix + '_save_' + path.replace(/\//g, '_'));
          if (!b64) { continue; }
          ensureDir(path);
          Module.FS.writeFile(path, base64Decode(b64));
          n++;
        } catch (e2) { }
      }
      return n;
    }

    function base64Encode(u8) {
      var s = '';
      var chunk = 0x8000;
      for (var i = 0; i < u8.length; i += chunk) {
        s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunk, u8.length)));
      }
      return global.btoa(s);
    }

    function base64Decode(b64) {
      var s = global.atob(b64);
      var u8 = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) { u8[i] = s.charCodeAt(i); }
      return u8;
    }

    // ---- blit / loop ---------------------------------------------------

    function setupFramebuffer() {
      ptr = Module._epub_screen_ptr();
      var bytes = Module._epub_screen_bytes();
      var heap = Module.HEAPU8;
      try {
        var view = new Uint8ClampedArray(heap.buffer, ptr, bytes);
        imageData = new ImageData(view, W, H);
        direct = true;
      } catch (e) {
        imageData = (ctx || fbCtx).createImageData(W, H);
        direct = false;
      }
      heapView = heap;
    }

    function blit() {
      if (!imageData) { return; }
      if (fbCtx) {
        try { fbCtx.putImageData(imageData, 0, 0); } catch (e0) { }
        return;
      }
      if (!direct) {
        var src = heapView.subarray(ptr, ptr + W * H * 4);
        imageData.data.set(src);
      }
      try { ctx.putImageData(imageData, 0, 0); } catch (e) { }
    }

    var TIC_MS = 1000 / 35;
    var nextEngineTick = 0;

    function loop() {
      if (destroyed || !running) { return; }
      var t = now();
      if (nextEngineTick === 0) { nextEngineTick = t; }
      var ran = 0;
      while (t >= nextEngineTick && ran < 3) {
        var t0 = now();
        try {
          Module._epub_tick();
          engineInfo.tics++;
        } catch (e) {
          running = false;
          status('Engine stopped: ' + (e && e.message ? e.message : e), 'err');
          onState('error');
          return;
        } finally {
          var dtTick = now() - t0;
          avgTickMs = avgTickMs === 0 ? dtTick : avgTickMs * 0.9 + dtTick * 0.1;
          lastTickMs = dtTick;
        }
        nextEngineTick += TIC_MS;
        ran++;
      }
      if (t - nextEngineTick > 250) { nextEngineTick = t; }
      if (ran > 0 || !imageData) {
        blit();
      }
      frame += ran;
      var nowT = now();
      if (fpsStart === 0) { fpsStart = nowT; }
      if (nowT - fpsStart >= 500) {
        fps = frame * 1000 / (nowT - fpsStart);
        frame = 0; fpsStart = nowT;
        if (cfg.onFps) { cfg.onFps(fps, avgTickMs, engineInfo.tics); }
      }
      global.requestAnimationFrame(loop);
    }

    // ---- boot ----------------------------------------------------------

    function start() {
      if (started) { return; }
      started = true;
      var bootStart = now();
      onState('loading-wasm');
      status('Loading engine...', 'info');
      getBinary(cfg.wasmUrl, function (err, wasmBuf) {
        if (destroyed) { return; }
        if (err || !wasmBuf) {
          status('Could not load engine wasm. ' + (err ? err.message : ''), 'err');
          onState('error');
          return;
        }
        engineInfo.wasmBytes = wasmBuf.byteLength;
        onState('loading-module');
        if (!global.DoomModule) {
          status('Engine script missing.', 'err');
          onState('error');
          return;
        }
        var modCfg = {
          instantiateWasm: function (imports, success) {
            var module = new WebAssembly.Module(new Uint8Array(wasmBuf));
            var instance = new WebAssembly.Instance(module, imports);
            success(instance, module);
            return instance.exports;
          },
          print: function (t) { if (cfg.onPrint) { cfg.onPrint(t); } else if (global.console && global.console.log) { global.console.log('[doom] ' + t); } },
          printErr: function (t) { if (cfg.onPrintErr) { cfg.onPrintErr(t); } }
        };
        global.DoomModule(modCfg).then(function (mod) {
          if (destroyed) { return; }
          Module = mod;
          onState('loading-wad');
          status('Loading DOOM data...', 'info');
          getBinary(cfg.wadUrl, function (werr, wadBuf) {
            if (destroyed) { return; }
            if (werr || !wadBuf) {
              status('Could not load game data. ' + (werr ? werr.message : ''), 'err');
              onState('error');
              return;
            }
            engineInfo.wadBytes = wadBuf.byteLength;
            engineInfo.bootMs = now() - bootStart;
            onState('starting');
            try {
              Module.FS.writeFile(wadPath, new Uint8Array(wadBuf));
              var restored = restoreSavesFromStorage();
              var argv = ['doom', '-iwad', wadPath].concat(cfg.argv || []);
              Module.callMain(argv);
              setupFramebuffer();
            } catch (e) {
              status('DOOM failed to start: ' + (e && e.message ? e.message : e), 'err');
              onState('error');
              return;
            }
            bindInput();
            // The engine only samples tick time while ticks run; reset the
            // baseline so frame pacing starts from zero.
            running = true;
            resumeAudio();
            onState('running');
            status('Running' + (restored ? ' (restored ' + restored + ' save(s))' : ''), 'ok');
            if (cfg.onReady) { cfg.onReady(engineInfo); }
            global.requestAnimationFrame(loop);

            if (cfg.saveSyncInterval !== 0) {
              global.setInterval(function () {
                if (running) { syncSavesToStorage(); }
              }, cfg.saveSyncInterval || 4000);
            }
            // Persist saves when the page is hidden or unloaded.
            global.addEventListener('pagehide', syncSavesToStorage, false);
            global.addEventListener('visibilitychange', function () {
              if (document.visibilityState === 'hidden') {
                releaseAll();
                syncSavesToStorage();
              }
            }, false);
          });
        }, function (e) {
          status('Engine init failed: ' + (e && e.message ? e.message : e), 'err');
          onState('error');
        });
      });
    }

    function destroy() {
      destroyed = true;
      running = false;
      releaseAll();
    }

    return {
      start: start,
      destroy: destroy,
      pressKey: function (dk) { press(dk); },
      releaseKey: function (dk) { release(dk); },
      getFPS: function () { return fps; },
      getGametic: function () { return (Module && Module._epub_gametic) ? Module._epub_gametic() : -1; },
      listSaves: function () { return fsListSaves(); },
      getAudioState: function () {
        try {
          var SDL2 = Module && Module.SDL2;
          if (!SDL2 || !SDL2.audioContext) { return 'none'; }
          return SDL2.audioContext.state + ' t=' + SDL2.audioContext.currentTime.toFixed(0) + 's';
        } catch (e) { return 'error'; }
      },
      getModule: function () { return Module || null; },
      hasStorage: function () { return !!cfg.syncStorage; },
      getInfo: function () { return engineInfo; }
    };
  }

  global.DoomPlayer = { create: create, keys: K, res: { w: W, h: H } };
}(window));
