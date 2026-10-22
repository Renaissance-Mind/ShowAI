#if defined(__wasm__)
#include <stdint.h>
#include <stddef.h>
// Freestanding aggregate-copy support. No allocator or platform imports.
extern "C" void*memcpy(void*d,const void*s,size_t n){auto*a=(uint8_t*)d;auto*b=(const uint8_t*)s;for(size_t i=0;i<n;i++)a[i]=b[i];return d;}
extern "C" void*memset(void*d,int value,size_t n){auto*a=(uint8_t*)d;for(size_t i=0;i<n;i++)a[i]=(uint8_t)value;return d;}
extern "C" void*memmove(void*d,const void*s,size_t n){auto*a=(uint8_t*)d;auto*b=(const uint8_t*)s;if((uintptr_t)a<(uintptr_t)b){for(size_t i=0;i<n;i++)a[i]=b[i];}else if(a!=b){for(size_t i=n;i;i--)a[i-1]=b[i-1];}return d;}
#endif
