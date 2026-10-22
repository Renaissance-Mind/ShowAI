import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('actual private capture binds inputs, preserves public validation, and walks exactly count+emit on Native/WASM', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'showai-checked-emission-'));
  const source = resolve('src/surface/ink-kernel');
  const clang = process.env.SHOWAI_INK_CLANG || 'clang++';
  const linker = process.env.SHOWAI_INK_WASM_LD || 'wasm-ld';
  const common = ['-std=c++17', '-O2', '-ffp-contract=off', '-fno-fast-math', '-DSHOWAI_ANALYTIC_WALK_COUNTERS'];
  try {
    const executable = join(temporary, 'native');
    execFileSync(clang, [...common, '-Wall', '-Wextra', '-Werror', '-DSHOWAI_CHECKED_NATIVE_MAIN', join(source, 'boundary/checked-emission-contract.cpp'), join(source, 'analytic-path.cpp'), '-o', executable]);
    assert.match(execFileSync(executable, { encoding: 'utf8' }), /status=0 raw=count1\+emit1 public=count1\+emit1/);
    const flags = [...common, '--target=wasm32-unknown-unknown', '-mbulk-memory', '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-nostdlib'];
    const objects = ['boundary/checked-emission-contract.cpp', 'analytic-path.cpp', 'boundary/wasm-runtime.cpp'].map((file, i) => {
      const object = join(temporary, `${i}.o`);
      execFileSync(clang, [...flags, '-c', join(source, file), '-o', object]);
      return object;
    });
    const wasm = join(temporary, 'contract.wasm');
    execFileSync(linker, ['--no-entry', '--stack-first', '-z', 'stack-size=2097152', '--initial-memory=16777216', '--max-memory=16777216', '--strip-all', '--export-memory', '--export=checked_emission_contract', ...objects, '-o', wasm]);
    const module = new WebAssembly.Module(readFileSync(wasm));
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const instance = new WebAssembly.Instance(module);
    assert.equal(instance.exports.checked_emission_contract(), 0);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

const appleSDKsAvailable = process.platform === 'darwin' && ['iphonesimulator', 'iphoneos'].every(sdk => spawnSync('xcrun', ['--sdk', sdk, '--show-sdk-path']).status === 0);
test('actual Apple partial-link keeps implementation symbols resolvable across ink and coverage targets', { skip: appleSDKsAvailable ? false : 'requires macOS with Xcode iOS and Simulator SDKs' }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'showai-checked-partial-link-'));
  const source = resolve('src/surface/ink-kernel');
  try {
    for (const [sdk, target, platform] of [['iphonesimulator', 'arm64-apple-ios17.0-simulator', 'ios-simulator'], ['iphoneos', 'arm64-apple-ios17.0', 'ios']]) {
      const sysroot = execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-path'], { encoding: 'utf8' }).trim();
      const version = execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-version'], { encoding: 'utf8' }).trim();
      const flags = ['--sdk', sdk, 'clang++', '-target', target, '-isysroot', sysroot, '-std=c++17', '-O2', '-fvisibility=hidden', '-ffp-contract=off', '-fno-fast-math', '-fno-exceptions', '-fno-rtti'];
      const analytic = join(temporary, `${sdk}-analytic.o`), coverage = join(temporary, `${sdk}-coverage.o`), partial = join(temporary, `${sdk}-InkKernel.o`);
      execFileSync('xcrun', [...flags, '-c', join(source, 'analytic-path.cpp'), '-o', analytic]);
      execFileSync('xcrun', [...flags, '-c', join(source, 'coverage-kernel.cpp'), '-o', coverage]);
      // Xcode's SPM static-target partial link localizes hidden private externs.
      // A direct object-to-object executable link alone misses this boundary.
      execFileSync('xcrun', ['ld', '-r', '-arch', 'arm64', '-syslibroot', sysroot, '-platform_version', platform, '17.0', version, analytic, '-o', partial]);
      execFileSync('xcrun', [...flags, '-dynamiclib', '-Wl,-undefined,error', partial, coverage, '-o', join(temporary, `${sdk}.dylib`)]);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
