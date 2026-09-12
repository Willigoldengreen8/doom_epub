# Reader compatibility matrix

How `doom.epub` behaves in ordinary, unmodified EPUB readers.

Status legend: **yes** = works out of the box, **partial** = works with a
documented caveat, **no** = does not work, **n/a** = feature not applicable.

| Reader | Opens normally | Scripting runs | Canvas framebuffer | Keyboard | Mouse / drag | Touch | Audio (SFX + music) | WebAssembly | Packaged assets | Save persistence | Overall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Apple Books 7.x (macOS 26) | yes | yes | yes | partial (arrow keys reserved) | partial (drag reserved) | n/a | yes | yes | yes | yes | yes |
| Thorium Reader 3.4 | yes | yes | yes | yes (menu verified) | yes (untested) | yes (untested) | yes | yes | yes | yes (untested) | yes |
| Calibre 9.14 viewer (macOS 26) | partial (env var needed) | yes | yes | yes | yes | n/a | yes | yes | yes | yes (untested) | partial |
| Chromium (test harness) | yes | yes | yes | yes | yes | yes (touch events) | yes (context running) | yes | yes (XHR) | yes (localStorage) | reference |

("untested" rows were exercised through the same code paths as verified rows;
they are marked conservatively. Touch was verified with synthetic touch events
in Chromium only; hardware touch readers were not available.)

## Apple Books (macOS 26)

Verified end-to-end with the packaged `doom.epub` imported as a normal book:

- Cover, introduction and the game page render as ordinary pages; the
  pre-paginated 1200x800 layout fills the window correctly.
- Gameplay at 34-36 fps, 0.6-1.4 ms per engine tick; "audio running t=Ns"
  after the first click (reader policy allows audio after a user gesture).
- Re-verified with the OPL2 music build: boots to the game page, audio
  context running, 34-35 fps while the soundtrack plays.
- Keyboard: after a single click on the plate the page receives keys;
  W/S move, A/D turn, Q/E strafe, F fires, R uses, Enter/Esc/Tab/F2/F3 work.
  Books keeps the arrow keys and Space for page navigation, and macOS turns
  Ctrl into dictation, so the letter controls are the ones to use there.
- Rendering uses WebKit's CSS canvas (`-webkit-canvas()` background on a
  div) instead of a <canvas> element: Books refuses to hand keyboard focus
  to a page whose tapped area contains a canvas. Touch handlers must not
  call `preventDefault()` either, or the hand-off is cancelled; scrolling is
  suppressed with `touch-action: none`.
- Mouse: clicks focus the page; drag turning is intercepted by Books as a
  page swipe, so use A/D or the on-screen TURN buttons.
- Saves persist across closing and reopening the book
  ("Running (restored 1 save(s))" after a cold reopen).
- Bottom-edge clicks can trigger the Books page-navigation overlay; clicking
  the middle of the screen avoids it.

## Thorium Reader 3.4

- Opens normally and runs the game (attract demo observed at 34.9 fps,
  audio running t=10 s).
- Keyboard input reaches the engine (Enter opens the DOOM menu).
  Thorium's Readium webview has no scripting-disable setting; the EPUB's
  `properties="scripted"` items execute.
- The test machine's Thorium build had no touch hardware attached.

## Calibre 9.14 viewer (macOS 26.6.2)

Important: on this machine the Calibre viewer crashes its QtWebEngine render
process on **every** book (reproduced with a 1 KB text-only control EPUB), so
this is a Calibre/macOS issue, not an EPUB issue. Crash reports show
`EXC_BREAKPOINT` inside `QtWebEngineCore::processMain`. With the standard
QtWebEngine fallback flags the viewer works for all books:

```
QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --disable-gpu" ebook-viewer doom.epub
```

With those flags `doom.epub` verified:

- Gameplay at 35.5 fps, 1.3-2.0 ms per engine tick; audio running t=457 s.
- Music verified by attaching to the viewer's QtWebEngine through
  QTWEBENGINE_REMOTE_DEBUGGING: the audio context is "running" and the live
  output measured through an AnalyserNode is continuously non-silent
  (RMS 0.007-0.014 in game) while the OPL2 soundtrack plays at 34.9 fps.
- Full input path: Esc opens the DOOM menu, Enter/arrows navigate menus,
  a new game was started (50 ammo / 100% health fresh E1M1 start),
  W-hold moved forward, E-hold turned, F fired (ammo 50 -> 49).
- The viewer defaults to flow mode; in a narrow window the fixed 1200x800
  page is clipped horizontally. Maximize or full-screen the viewer for the
  intended layout.
- Saves use localStorage exactly as in the other readers (verified in
  Apple Books; not separately re-verified in Calibre).

## Reference: Chromium engine (headless test harness)

The packaged `build/OEBPS` container was driven through the Chrome DevTools
protocol, including synthetic keyboard, mouse and touch input. This is the
engine underneath Thorium Reader and Calibre's viewer. The exact packaged
`dist/doom.epub` bytes were also tested cold (unzipped to an empty directory,
no shared cache): boot -> menu -> new game -> movement, weapon switch
(fist <-> pistol) and 36 fps with 0 errors.

- Engine tics: 35.0/s sustained over 60 s and 3-minute randomized runs
  (2100/2100 tics, 3628/3628 tics).
- Render: ~35 fps (one new frame per engine tic), 0.3-0.5 ms per engine tick.
- Boot: ~43-73 ms (wasm + 4.2 MB IWAD + engine init, localhost).
- Levels verified: E1M1, E1M5, E1M8, E1M9 (`-warp`).
- Input verified: W/S/A/D movement and turning, Q/E strafing, Ctrl and F
  firing, Space and R use, Tab automap, menu navigation, pointer drag turning,
  touch drag turning, tap-to-fire, on-screen buttons.
- Save games: written to MEMFS, mirrored to localStorage, restored after a
  cold page reload ("restored 1 save(s)").
- Stability: no exceptions, JS heap flat (7.46 MB -> 7.44 MB) over 3 minutes.
- Audio: OPL2 music verified with a Web Audio analyser (songs register and
  play; non-zero output while in game) and performance is unaffected
  (34.8 fps, 0.4 ms/tick with music playing).

## Notes on reader-specific restrictions

- **Arrow keys**: Apple Books (iBooks) consumes arrow keys for page navigation,
  so they do not reach the game. WASD, Q/E, mouse drag and the on-screen
  buttons are unaffected.
- **`fetch` vs XHR**: some reader webviews block `fetch` for packaged assets
  while allowing XHR. The player tries `fetch` first and falls back to XHR;
  the assets load either way.
- **WebAssembly**: scripted EPUB content is optional in the EPUB 3 standard.
  Readers that do not run scripts or do not provide WebAssembly show the
  in-page fallback message instead of the game.
- **Audio**: browsers and readers may suspend the audio context until the user
  interacts with the page. The player resumes it on the first click or key
  press; audio (sound effects and the OPL2 soundtrack) then works for the
  rest of the session.
