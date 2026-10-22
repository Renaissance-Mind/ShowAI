#include "native-parity-stdio.hpp"

int main() {
  sa_test_binary_stdio();
  unsigned char bytes[4096];
  for (;;) {
    const auto count = std::fread(bytes, 1, sizeof(bytes), stdin);
    if (count && std::fwrite(bytes, 1, count, stdout) != count)
      return 1;
    if (count < sizeof(bytes))
      return std::ferror(stdin) || std::fflush(stdout) ? 2 : 0;
  }
}
