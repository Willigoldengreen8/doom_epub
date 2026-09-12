/*
 * Entry point for the EPUB build: creates the DOOM runtime and returns so the
 * host page can drive frames via epub_tick().
 */

#include "doomgeneric.h"

int main(int argc, char** argv)
{
    doomgeneric_Create(argc, argv);
    return 0;
}
