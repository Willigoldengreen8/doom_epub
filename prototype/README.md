# Prototype: can an EPUB run an interactive application?

This directory is the original feasibility test that led to the DOOM port. It is
kept as project history; the real deliverable is `dist/doom.epub`.

`test.epub` (build with `python3 build.py`) is a minimal, standards-valid EPUB 3
with a cover and one fixed-layout interactive page containing an integrated
capability test:

- Canvas 2D framebuffer with a small raycaster, FPS counter and a sustained
  benchmark at 160x120, 320x200, 320x240, 640x400 and 800x600
- keyboard, pointer and touch input
- WebAssembly (with a plain-JS fallback), packaged binary asset loading,
  audio via WebAudio and `<audio>`, localStorage/sessionStorage, focus events
- per-capability status indicators and `navigator.epubReadingSystem` probing

Measurements from this prototype are recorded in `../docs/COMPATIBILITY.md`.
It establishes that ordinary scripted fixed-layout EPUB readers provide a
capable enough runtime for a game, which is what made `doom.epub` possible.
