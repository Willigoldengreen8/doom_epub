/*
 * doomgeneric EPUB/platform shim.
 *
 * Replaces the SDL / X11 platform layers with a minimal JavaScript bridge:
 *  - the host drives frames by calling epub_tick() once per animation frame
 *  - epub_push_key() feeds DOOM key events from the host
 *  - epub_screen_ptr() exposes the RGBA8888 framebuffer for zero-copy blitting
 *
 * Copyright (C) 2026 doom.epub experiment contributors
 * GPL-2.0-or-later (same license as doomgeneric).
 */

#include <stdint.h>
#include <stddef.h>

#include <emscripten.h>

#include "doomgeneric.h"
#include "doomkeys.h"
#include "d_loop.h"

#define KEYQUEUE_SIZE 512

static unsigned short s_KeyQueue[KEYQUEUE_SIZE];
static unsigned int s_KeyQueueWriteIndex = 0;
static unsigned int s_KeyQueueReadIndex = 0;

EMSCRIPTEN_KEEPALIVE
void epub_push_key(int pressed, int doomKey)
{
    unsigned int next = (s_KeyQueueWriteIndex + 1) % KEYQUEUE_SIZE;
    if (next == s_KeyQueueReadIndex) {
        return;
    }
    s_KeyQueue[s_KeyQueueWriteIndex] =
        (unsigned short)(((pressed ? 1u : 0u) << 8) | (unsigned int)(doomKey & 0xff));
    s_KeyQueueWriteIndex = next;
}

EMSCRIPTEN_KEEPALIVE
void epub_clear_keys(void)
{
    s_KeyQueueReadIndex = 0;
    s_KeyQueueWriteIndex = 0;
}

EMSCRIPTEN_KEEPALIVE
uint32_t epub_screen_ptr(void)
{
    return (uint32_t)(uintptr_t)DG_ScreenBuffer;
}

EMSCRIPTEN_KEEPALIVE
int epub_gametic(void)
{
    return gametic;
}

EMSCRIPTEN_KEEPALIVE
uint32_t epub_screen_bytes(void)
{
    return (uint32_t)(DOOMGENERIC_RESX * DOOMGENERIC_RESY * 4);
}

EMSCRIPTEN_KEEPALIVE
void epub_tick(void)
{
    doomgeneric_Tick();
}

void DG_Init(void)
{
}

void DG_DrawFrame(void)
{
    /* Host copies the framebuffer after epub_tick() returns. */
}

void DG_SleepMs(uint32_t ms)
{
    /* Frames are paced by the browser; never block the JS thread. */
    (void)ms;
}

uint32_t DG_GetTicksMs(void)
{
    return (uint32_t)emscripten_get_now();
}

int DG_GetKey(int* pressed, unsigned char* doomKey)
{
    if (s_KeyQueueReadIndex == s_KeyQueueWriteIndex) {
        return 0;
    }
    unsigned short keyData = s_KeyQueue[s_KeyQueueReadIndex];
    s_KeyQueueReadIndex = (s_KeyQueueReadIndex + 1) % KEYQUEUE_SIZE;
    *pressed = keyData >> 8;
    *doomKey = keyData & 0xff;
    return 1;
}

void DG_SetWindowTitle(const char* title)
{
    (void)title;
}
