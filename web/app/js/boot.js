/* Boot the DOOM player for the EPUB game page. ES5-compatible. */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  var statusEl = byId('status');
  var stateEl = byId('state');
  var fpsEl = byId('fps');
  var tickEl = byId('tickms');
  var ticEl = byId('gametic');
  var audioEl = byId('audio');
  var hintEl = byId('focushint');
  var fallbackEl = byId('fallback');

  function hideFallback() {
    if (fallbackEl) { fallbackEl.style.display = 'none'; }
  }

  function failFallback(text) {
    if (fallbackEl) {
      fallbackEl.style.display = 'block';
      fallbackEl.textContent = text;
    }
  }

  // Scripting is running, so the static fallback is no longer relevant.
  hideFallback();

  function setStatus(text, kind) {
    if (!statusEl) { return; }
    statusEl.textContent = text;
    statusEl.className = kind || '';
  }

  function setState(s) {
    if (stateEl) { stateEl.textContent = s; }
  }

  if (typeof window.WebAssembly === 'undefined') {
    setStatus('This reader does not support WebAssembly, which this DOOM build needs. Try Apple Books, Thorium or Calibre on desktop.', 'err');
    failFallback('This reader does not support WebAssembly, which this DOOM build needs. Try Apple Books, Thorium or Calibre on desktop.');
    setState('unsupported');
    return;
  }
  if (!window.DoomPlayer || !window.DoomModule) {
    setStatus('The DOOM runtime did not load. Some readers block scripted content; check the reader settings.', 'err');
    failFallback('The DOOM runtime did not load. Some readers block scripted content; check the reader settings.');
    setState('unsupported');
    return;
  }

  var storage = null;
  try {
    var probe = '__doom_epub_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    storage = window.localStorage;
  } catch (e) {
    storage = null;
  }

  var player = window.DoomPlayer.create({
    canvas: byId('doom'),
    surface: byId('platesurface'),
    wasmUrl: 'assets/doom.wasm',
    wadUrl: 'assets/doom1.wad',
    status: setStatus,
    onState: setState,
    syncStorage: storage,
    onFps: function (fps, tickMs, tics) {
      if (fpsEl) { fpsEl.textContent = fps.toFixed(1); }
      if (tickEl) { tickEl.textContent = tickMs.toFixed(1); }
      if (ticEl) { ticEl.textContent = tics; }
      if (audioEl) { audioEl.textContent = 'audio ' + player.getAudioState(); }
    },
    onFocus: function () {
      if (hintEl) { hintEl.style.display = 'none'; }
    }
  });

  var bigBtn = byId('bigbtn');
  if (bigBtn) {
    bigBtn.addEventListener('click', function (e) {
      if (e && e.preventDefault) { e.preventDefault(); }
      var on = document.body.className.indexOf('wide') < 0;
      document.body.className = on ? 'wide' : '';
      bigBtn.textContent = on ? 'PANEL' : 'BIG';
    }, false);
  }

  // Expose the running player for reader diagnostics and automation.
  window.doomPlayer = player;

  player.start();
}());
