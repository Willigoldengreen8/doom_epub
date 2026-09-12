//
// Small compatibility shim for Chocolate Doom source files vendored in
// web/engine/opl/ against DoomGeneric's trimmed headers.
//
// This file is part of doom.epub and is distributed under the GNU GPL,
// version 2 or later.
//

#ifndef EPUB_COMPAT_H
#define EPUB_COMPAT_H

#include <stdlib.h>

#include "SDL_endian.h"

#include "doomtype.h"
#include "i_system.h"

// Chocolate Doom's doomtype.h defines this; DoomGeneric's does not.

#ifndef PACKED_STRUCT
#define PACKED_STRUCT(name) struct __attribute__((packed)) name
#endif

// Chocolate Doom's i_system.h provides I_Realloc; DoomGeneric's does not.

#ifndef I_REALLOC_DEFINED
#define I_REALLOC_DEFINED

static void *I_Realloc(void *ptr, size_t size)
{
    void *result = realloc(ptr, size);

    if (result == NULL && size > 0)
    {
        I_Error("I_Realloc: failure to allocate %u bytes", (unsigned int) size);
    }

    return result;
}

#endif

#endif /* #ifndef EPUB_COMPAT_H */
