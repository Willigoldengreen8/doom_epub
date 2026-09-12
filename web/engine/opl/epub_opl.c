//
// Copyright(C) 2005-2014 Simon Howard
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// DESCRIPTION:
//     OPL software-emulation backend for the EPUB build.
//
//     Adapted from Chocolate Doom's opl/opl_sdl.c for the single-
//     threaded Emscripten environment: there are no audio threads or
//     mutexes here.  The OPL chip is rendered synchronously inside
//     SDL_mixer's music hook (Mix_HookMusic) so that it shares the one
//     AudioContext already opened for sound effects.
//

#include <stdio.h>
#include <string.h>
#include <assert.h>

#include "SDL.h"
#include "SDL_mixer.h"

#include "opl3.h"

#include "opl.h"
#include "opl_internal.h"
#include "opl_queue.h"

#define MAX_SOUND_SLICE_TIME 100 /* ms */

typedef struct
{
    unsigned int rate;        // Number of times the timer is advanced per sec.
    unsigned int enabled;     // Non-zero if timer is enabled.
    unsigned int value;       // Last value that was set.
    uint64_t expire_time;     // Calculated time that timer will expire.
} opl_timer_t;

// Queue of callbacks waiting to be invoked.

static opl_callback_queue_t *callback_queue;

// Current time, in us since startup:

static uint64_t current_time;

// If non-zero, playback is currently paused.

static int opl_paused;

// Time offset (in us) due to the fact that callbacks
// were previously paused.

static uint64_t pause_offset;

// OPL software emulator structure.

static opl3_chip opl_chip;
static int opl_opl3mode;

// Register number that was written.

static int register_num = 0;

// Timers; DBOPL does not do timer stuff itself.

static opl_timer_t timer1 = { 12500, 0, 0, 0 };
static opl_timer_t timer2 = { 3125, 0, 0, 0 };

// Mixer parameters.

static int mixing_freq, mixing_channels;
static Uint16 mixing_format;

static int MixerIsInitialized(void)
{
    int freq, channels;
    Uint16 format;

    return Mix_QuerySpec(&freq, &format, &channels);
}

// Advance time by the specified number of samples, invoking any
// callback functions as appropriate.

static void AdvanceTime(unsigned int nsamples)
{
    opl_callback_t callback;
    void *callback_data;
    uint64_t us;

    // Advance time.

    us = ((uint64_t) nsamples * OPL_SECOND) / mixing_freq;
    current_time += us;

    if (opl_paused)
    {
        pause_offset += us;
    }

    // Are there callbacks to invoke now?  Keep invoking them
    // until there are no more left.

    while (!OPL_Queue_IsEmpty(callback_queue)
        && current_time >= OPL_Queue_Peek(callback_queue) + pause_offset)
    {
        // Pop the callback from the queue to invoke it.

        if (!OPL_Queue_Pop(callback_queue, &callback, &callback_data))
        {
            break;
        }

        callback(callback_data);
    }
}

// Call the OPL emulator code to fill the specified buffer.

static void FillBuffer(int16_t *buffer, unsigned int nsamples)
{
    assert(nsamples < (unsigned int) mixing_freq);

    OPL3_GenerateStream(&opl_chip, buffer, nsamples);
}

// Callback function to fill a new sound buffer:

static void OPL_Mix_Callback(void *udata,
                             Uint8 *byte_buffer,
                             int buffer_bytes)
{
    int16_t *buffer;
    unsigned int buffer_len;
    unsigned int filled = 0;

    // Buffer length in samples (quadrupled, because of 16-bit and stereo)

    buffer = (int16_t *) byte_buffer;
    buffer_len = buffer_bytes / 4;

    // Repeatedly call the OPL emulator update function until the buffer is
    // full.

    while (filled < buffer_len)
    {
        uint64_t next_callback_time;
        uint64_t nsamples;

        // Work out the time until the next callback waiting in
        // the callback queue must be invoked.  We can then fill the
        // buffer with this many samples.

        if (opl_paused || OPL_Queue_IsEmpty(callback_queue))
        {
            nsamples = buffer_len - filled;
        }
        else
        {
            next_callback_time = OPL_Queue_Peek(callback_queue) + pause_offset;

            nsamples = (next_callback_time - current_time) * mixing_freq;
            nsamples = (nsamples + OPL_SECOND - 1) / OPL_SECOND;

            if (nsamples > buffer_len - filled)
            {
                nsamples = buffer_len - filled;
            }
        }

        // Add emulator output to buffer.

        FillBuffer(buffer + filled * 2, nsamples);
        filled += nsamples;

        // Invoke callbacks for this point in time.

        AdvanceTime(nsamples);
    }
}

static void OPL_Epub_Shutdown(void)
{
    Mix_HookMusic(NULL, NULL);

    if (callback_queue != NULL)
    {
        OPL_Queue_Destroy(callback_queue);
        callback_queue = NULL;
    }
}

// Advance the emulator synchronously by the specified number of
// microseconds.  Used by OPL_Delay() during chip detection: there is
// only one thread in the EPUB build, so the emulator cannot wait for
// an audio callback to run.

void OPL_Epub_AdvanceTime(uint64_t us)
{
    static int16_t scratch[4096];
    uint64_t nsamples_total;
    uint64_t done = 0;

    if (callback_queue == NULL || mixing_freq <= 0)
    {
        return;
    }

    nsamples_total = (us * (uint64_t) mixing_freq) / OPL_SECOND;

    while (done < nsamples_total)
    {
        uint64_t chunk = nsamples_total - done;

        if (chunk > 4096)
        {
            chunk = 4096;
        }

        OPL3_GenerateStream(&opl_chip, scratch, (uint32_t) chunk);
        AdvanceTime((unsigned int) chunk);
        done += chunk;
    }
}

static unsigned int GetSliceSize(void)
{
    int limit;
    int n;

    limit = (opl_sample_rate * MAX_SOUND_SLICE_TIME) / 1000;

    // Try all powers of two, not exceeding the limit.

    for (n=0;; ++n)
    {
        // 2^n <= limit < 2^n+1 ?

        if ((1 << (n + 1)) > limit)
        {
            return (1 << n);
        }
    }

    // Should never happen?

    return 1024;
}

static int OPL_Epub_Init(unsigned int port_base)
{
    // The sound effects module opens SDL_mixer first; music hooks into
    // that same device.  If it has not been opened (music-only build),
    // open it here.

    if (!MixerIsInitialized())
    {
        if (SDL_Init(SDL_INIT_AUDIO) < 0)
        {
            fprintf(stderr, "Unable to set up sound.\n");
            return 0;
        }

        if (Mix_OpenAudio(opl_sample_rate, AUDIO_S16SYS, 2, GetSliceSize()) < 0)
        {
            fprintf(stderr, "Error initialising SDL_mixer: %s\n", Mix_GetError());
            SDL_QuitSubSystem(SDL_INIT_AUDIO);
            return 0;
        }
    }

    opl_paused = 0;
    pause_offset = 0;

    // Queue structure of callbacks to invoke.

    callback_queue = OPL_Queue_Create();
    current_time = 0;

    // Get the mixer frequency, format and number of channels.

    Mix_QuerySpec(&mixing_freq, &mixing_format, &mixing_channels);

    // Only supports AUDIO_S16SYS

    if (mixing_format != AUDIO_S16SYS || mixing_channels != 2)
    {
        fprintf(stderr,
                "OPL_Epub only supports native signed 16-bit LSB, "
                "stereo format!\n");

        OPL_Epub_Shutdown();
        return 0;
    }

    // Create the emulator structure:

    OPL3_Reset(&opl_chip, mixing_freq);
    opl_opl3mode = 0;

    Mix_HookMusic(OPL_Mix_Callback, NULL);

    return 1;
}

static unsigned int OPL_Epub_PortRead(opl_port_t port)
{
    unsigned int result = 0;

    if (port == OPL_REGISTER_PORT_OPL3)
    {
        return 0xff;
    }

    if (timer1.enabled && current_time > timer1.expire_time)
    {
        result |= 0x80;   // Either have expired
        result |= 0x40;   // Timer 1 has expired
    }

    if (timer2.enabled && current_time > timer2.expire_time)
    {
        result |= 0x80;   // Either have expired
        result |= 0x20;   // Timer 2 has expired
    }

    return result;
}

static void OPLTimer_CalculateEndTime(opl_timer_t *timer)
{
    int tics;

    // If the timer is enabled, calculate the time when the timer
    // will expire.

    if (timer->enabled)
    {
        tics = 0x100 - timer->value;
        timer->expire_time = current_time
                           + ((uint64_t) tics * OPL_SECOND) / timer->rate;
    }
}

static void WriteRegister(unsigned int reg_num, unsigned int value)
{
    switch (reg_num)
    {
        case OPL_REG_TIMER1:
            timer1.value = value;
            OPLTimer_CalculateEndTime(&timer1);
            break;

        case OPL_REG_TIMER2:
            timer2.value = value;
            OPLTimer_CalculateEndTime(&timer2);
            break;

        case OPL_REG_TIMER_CTRL:
            if (value & 0x80)
            {
                timer1.enabled = 0;
                timer2.enabled = 0;
            }
            else
            {
                if ((value & 0x40) == 0)
                {
                    timer1.enabled = (value & 0x01) != 0;
                    OPLTimer_CalculateEndTime(&timer1);
                }

                if ((value & 0x20) == 0)
                {
                    timer1.enabled = (value & 0x02) != 0;
                    OPLTimer_CalculateEndTime(&timer2);
                }
            }

            break;

        case OPL_REG_NEW:
            opl_opl3mode = value & 0x01;

        default:
            OPL3_WriteRegBuffered(&opl_chip, reg_num, value);
            break;
    }
}

static void OPL_Epub_PortWrite(opl_port_t port, unsigned int value)
{
    if (port == OPL_REGISTER_PORT)
    {
        register_num = value;
    }
    else if (port == OPL_REGISTER_PORT_OPL3)
    {
        register_num = value | 0x100;
    }
    else if (port == OPL_DATA_PORT)
    {
        WriteRegister(register_num, value);
    }
}

static void OPL_Epub_SetCallback(uint64_t us, opl_callback_t callback,
                                 void *data)
{
    OPL_Queue_Push(callback_queue, callback, data,
                   current_time - pause_offset + us);
}

static void OPL_Epub_ClearCallbacks(void)
{
    OPL_Queue_Clear(callback_queue);
}

static void OPL_Epub_Lock(void)
{
}

static void OPL_Epub_Unlock(void)
{
}

static void OPL_Epub_SetPaused(int paused)
{
    opl_paused = paused;
}

static void OPL_Epub_AdjustCallbacks(float factor)
{
    OPL_Queue_AdjustCallbacks(callback_queue, current_time, factor);
}

opl_driver_t opl_epub_driver =
{
    "EPUB",
    OPL_Epub_Init,
    OPL_Epub_Shutdown,
    OPL_Epub_PortRead,
    OPL_Epub_PortWrite,
    OPL_Epub_SetCallback,
    OPL_Epub_ClearCallbacks,
    OPL_Epub_Lock,
    OPL_Epub_Unlock,
    OPL_Epub_SetPaused,
    OPL_Epub_AdjustCallbacks,
};
