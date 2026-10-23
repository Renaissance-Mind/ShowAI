import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'showai-vector-capacity-'));
try {
  const source = join(directory, 'capacity.cpp'), binary = join(directory, 'capacity');
  await writeFile(source, `#include "boundary/vector.hpp"
#include <cassert>
#include <cstdlib>
using namespace showai_boundary;
struct Entry { uint64_t words[4]{}; };
int main(){
 void*arena=nullptr;assert(!posix_memalign(&arena,16,8388608));Context context;assert(context.initialize(arena,8388608,100000000));
 {
  Vector<Entry> first(context);assert(first.resize(37080));assert(context.live_bytes==2097152);
  first[123].words[0]=123456;Vector<Entry> second(first);second[123].words[0]=654321;
  assert(static_cast<const Vector<Entry>&>(first)[123].words[0]==123456);assert(context.live_bytes==4194304);
  Entry value{};value.words[1]=42;while(second.size()<65536)assert(second.push_back(value));
  assert(static_cast<const Vector<Entry>&>(second)[65535].words[1]==42);assert(context.live_bytes==6291456);assert(context.peak_bytes==8388608);
 }
 assert(context.live_bytes==0);free(arena);
 alignas(16) unsigned char tiny[64];Context bounded;assert(bounded.initialize(tiny,64,100));
 {Vector<Entry> value(bounded);assert(value.resize(4));value[0].words[0]=17;assert(!value.resize(5));assert(bounded.status==SA_INK_CAPACITY);assert(value.size()==4);assert(static_cast<const Vector<Entry>&>(value)[0].words[0]==17);}
 assert(bounded.live_bytes==0);
}`);
  execFileSync(process.env.SHOWAI_INK_NATIVE_CLANG || 'clang++', ['-std=c++17', '-O1', '-g', '-fsanitize=' + (process.env.SHOWAI_INK_SANITIZERS || 'undefined'), '-fno-omit-frame-pointer', '-I', resolve('src/surface/ink-kernel'), source, '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit', timeout: 30000 });
  console.log('Actual arena vector capacity, growth, copy-on-write, release and bounded failure passed with the requested runtime sanitizer.');
} finally { await rm(directory, { recursive: true, force: true }); }
