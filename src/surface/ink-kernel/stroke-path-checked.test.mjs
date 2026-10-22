import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('actual stroke factory binds immutable inputs and removes only the duplicate count on Native/WASM', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'showai-stroke-plan-'));
  const source = resolve('src/surface/ink-kernel');
  const clang = process.env.SHOWAI_INK_CLANG || 'clang++';
  const linker = process.env.SHOWAI_INK_WASM_LD || 'wasm-ld';
  const common = ['-std=c++17', '-O2', '-ffp-contract=off', '-fno-fast-math', '-DSHOWAI_STROKE_WALK_COUNTERS'];
  try {
    const executable = join(temporary, 'native');
    const files = ['stroke-path-checked-contract.cpp', 'ink-stroke-kernel.cpp', 'analytic-path.cpp'];
    execFileSync(clang, [...common, '-Wall', '-Wextra', '-Werror', '-DSHOWAI_STROKE_NATIVE_MAIN', ...files.map(file => join(source, file)), '-o', executable]);
    assert.match(execFileSync(executable, { encoding: 'utf8' }), /status=0 new=count1\+emit1 old=count2\+emit1 public=count1\+emit1/);
    const flags = [...common, '--target=wasm32-unknown-unknown', '-mbulk-memory', '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-nostdlib'];
    const objects = [...files, 'boundary/wasm-runtime.cpp'].map((file, i) => {
      const object = join(temporary, `${i}.o`);
      execFileSync(clang, [...flags, '-c', join(source, file), '-o', object]);
      return object;
    });
    const wasm = join(temporary, 'contract.wasm');
    execFileSync(linker, ['--no-entry', '--stack-first', '-z', 'stack-size=2097152', '--initial-memory=8388608', '--max-memory=8388608', '--strip-all', '--export-memory', '--export=checked_stroke_contract', ...objects, '-o', wasm]);
    const module = new WebAssembly.Module(readFileSync(wasm));
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    assert.equal(new WebAssembly.Instance(module).exports.checked_stroke_contract(), 0);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

const appleSDKsAvailable = process.platform === 'darwin' && ['iphonesimulator', 'iphoneos'].every(sdk => spawnSync('xcrun', ['--sdk', sdk, '--show-sdk-path']).status === 0);
test('actual private Swift submodule and Apple partial-link resolve the factory on both SDKs', { skip: appleSDKsAvailable ? false : 'requires macOS with Xcode iOS and Simulator SDKs' }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'showai-stroke-partial-'));
  const source = resolve('src/surface/ink-kernel');
  try {
    const swift = join(temporary, 'consumer.swift');
    const bridge = join(temporary, 'bridge.cpp');
    writeFileSync(bridge, '#include "include/stroke-plan-private.h"\nextern "C" void actualBridge(void*p,const SAInkStrokeSegment*s,const SAInkStrokeOptions*o,SAInkPathCommand*c,SAInkStrokeResult*r){showai_private_stroke_plan_initialize(p,showai_private_stroke_plan_bytes(),s,1,o);showai_private_stroke_plan_counts(p,r);showai_private_stroke_plan_build(p,c,1,r);showai_private_stroke_plan_destroy(p); }\n');
    writeFileSync(swift, 'import ShowAIInkKernel.PrivateStrokePlan\nfunc actualFactorySize() -> UInt32 { showai_private_stroke_plan_bytes() }\n');
    // Compile the real Swift import to object: a syntax-only C test misses a
    // missing explicit submodule, and a direct link misses ld-r localization.
    for (const [sdk, target, platform] of [['iphonesimulator', 'arm64-apple-ios17.0-simulator', 'ios-simulator'], ['iphoneos', 'arm64-apple-ios17.0', 'ios']]) {
      const sysroot = execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-path'], { encoding: 'utf8' }).trim();
      const version = execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-version'], { encoding: 'utf8' }).trim();
      const consumer = join(temporary, `${sdk}-consumer.o`);
      execFileSync('xcrun', ['swiftc', '-c', '-parse-as-library', '-target', target, '-sdk', sysroot, '-I', join(source, 'include'), '-module-cache-path', join(temporary, 'modules'), swift, '-o', consumer]);
      const flags = ['--sdk', sdk, 'clang++', '-target', target, '-isysroot', sysroot, '-std=c++17', '-O2', '-fvisibility=hidden', '-ffp-contract=off', '-fno-fast-math', '-fno-exceptions', '-fno-rtti'];
      const objects = ['analytic-path.cpp', 'ink-stroke-kernel.cpp'].map((file, i) => {
        const object = join(temporary, `${sdk}-${i}.o`);
        execFileSync('xcrun', [...flags, '-c', join(source, file), '-o', object]); return object;
      });
      const bridgeObject = join(temporary, `${sdk}-bridge.o`);
      execFileSync('xcrun', [...flags, '-I', source, '-c', bridge, '-o', bridgeObject]);
      const partial = join(temporary, `${sdk}-InkKernel.o`);
      execFileSync('xcrun', ['ld', '-r', '-arch', 'arm64', '-syslibroot', sysroot, '-platform_version', platform, '17.0', version, ...objects, '-o', partial]);
      execFileSync('xcrun', [...flags, '-dynamiclib', '-Wl,-undefined,error', partial, consumer, bridgeObject, '-o', join(temporary, `${sdk}.dylib`)]);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
