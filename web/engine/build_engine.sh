#!/bin/sh
# Build the DOOM engine (DoomGeneric) to JavaScript + WebAssembly for EPUB use.
# Requires: emscripten (emcc), git submodule/clone of ozkl/doomgeneric.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="$ROOT/engine/doomgeneric/doomgeneric"
OUT="$ROOT/web/engine"
PATCHES="$ROOT/engine/patches"

if [ ! -f "$SRC/doomgeneric.c" ]; then
  echo "error: doomgeneric sources missing at $SRC" >&2
  echo "run: git clone https://github.com/ozkl/doomgeneric engine/doomgeneric" >&2
  exit 1
fi

# Apply pinned local patches (if any) to the vendored engine.
if [ -d "$PATCHES" ]; then
  for p in "$PATCHES"/*.patch; do
    [ -e "$p" ] || continue
    if git -C "$ROOT/engine/doomgeneric" apply --check "$p" 2>/dev/null; then
      git -C "$ROOT/engine/doomgeneric" apply "$p"
      echo "applied patch: $(basename "$p")"
    fi
  done
fi

COMMON="-O3 -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE \
  -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 \
  -I$SRC"

EXTRA_CFLAGS=""
EXTRA_SRCS=""
EXTRA_LDFLAGS=""
EXTRA_INCS=""
if [ "${WITH_SOUND:-1}" = "1" ]; then
  # Sound effects through SDL2 + SDL_mixer (emscripten WebAudio ports).
  # Music uses Chocolate Doom's GPL-2.0 OPL2 player (vendored in opl/)
  # with the Nuked OPL3 emulator, rendered through Mix_HookMusic.
  EXTRA_CFLAGS="-DFEATURE_SOUND -I$HERE/opl"
  EXTRA_SRCS="$SRC/i_sdlsound.c \
    $HERE/opl/opl.c $HERE/opl/opl_queue.c $HERE/opl/opl3.c \
    $HERE/opl/midifile.c $HERE/opl/i_oplmusic.c $HERE/opl/epub_opl.c"
  EXTRA_LDFLAGS="-sUSE_SDL=2 -sUSE_SDL_MIXER=2"
fi

OUT="${OUT:-$ROOT/web/engine}"
mkdir -p "$OUT"

SRCS="dummy.c am_map.c doomdef.c doomstat.c dstrings.c d_event.c d_items.c \
d_iwad.c d_loop.c d_main.c d_mode.c d_net.c f_finale.c f_wipe.c g_game.c \
hu_lib.c hu_stuff.c info.c i_cdmus.c i_endoom.c i_joystick.c i_scale.c \
i_sound.c i_system.c i_timer.c memio.c m_argv.c m_bbox.c m_cheat.c \
m_config.c m_controls.c m_fixed.c m_menu.c m_misc.c m_random.c p_ceilng.c \
p_doors.c p_enemy.c p_floor.c p_inter.c p_lights.c p_map.c p_maputl.c \
p_mobj.c p_plats.c p_pspr.c p_saveg.c p_setup.c p_sight.c p_spec.c \
p_switch.c p_telept.c p_tick.c p_user.c r_bsp.c r_data.c r_draw.c \
r_main.c r_plane.c r_segs.c r_sky.c r_things.c sha1.c sounds.c statdump.c \
st_lib.c st_stuff.c s_sound.c tables.c v_video.c wi_stuff.c w_checksum.c \
w_file.c w_main.c w_wad.c z_zone.c w_file_stdc.c i_input.c i_video.c \
doomgeneric.c mus2mid.c"

INCS="-I$SRC"

emcc $COMMON $EXTRA_CFLAGS $INCS \
  $(for f in $SRCS; do printf '%s ' "$SRC/$f"; done) \
  $EXTRA_SRCS \
  "$HERE/epub_platform.c" "$HERE/epub_main.c" \
  -o "$OUT/doom.js" \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=DoomModule \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=0 \
  -sFORCE_FILESYSTEM=1 \
  -sENVIRONMENT=web \
  -sASSERTIONS=0 \
  -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=67108864 \
  -sSTACK_SIZE=1048576 \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain,HEAPU8 \
  $EXTRA_LDFLAGS \
  -sEXPORTED_FUNCTIONS=_epub_tick,_epub_push_key,_epub_clear_keys,_epub_screen_ptr,_epub_screen_bytes,_epub_gametic,_main,_malloc,_free

echo "built: $OUT/doom.js $OUT/doom.wasm"
ls -la "$OUT"/doom.js "$OUT"/doom.wasm
