static unsigned char g_buf[65536];
static unsigned int g_state = 12345u;

__attribute__((export_name("bufptr"))) unsigned char* bufptr(void) { return g_buf; }

__attribute__((export_name("checksum"))) unsigned int checksum(const unsigned char* p, unsigned int n) {
  unsigned int h = 2166136261u;
  for (unsigned int i = 0; i < n; i++) { h ^= p[i]; h *= 16777619u; }
  return h;
}

__attribute__((export_name("bench"))) unsigned int bench(unsigned int iters) {
  unsigned int h = g_state;
  for (unsigned int i = 0; i < iters; i++) { h = h * 1664525u + 1013904223u; }
  g_state = h;
  return h;
}
