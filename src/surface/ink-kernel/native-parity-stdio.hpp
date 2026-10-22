// Test executable transport only; never compiled into the freestanding kernel.
#pragma once
#include <cstdio>
#include <cstdlib>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

static void sa_test_binary_stdio() {
#ifdef _WIN32
  // CRT text mode rewrites CR/LF and treats Ctrl-Z as EOF on input. Native/WASM
  // parity exchanges raw structs, so configure both streams before any I/O.
  if (_setmode(_fileno(stdin), _O_BINARY) == -1 ||
      _setmode(_fileno(stdout), _O_BINARY) == -1) {
    std::perror("Cannot configure binary ink parity transport");
    std::exit(EXIT_FAILURE);
  }
#endif
}
