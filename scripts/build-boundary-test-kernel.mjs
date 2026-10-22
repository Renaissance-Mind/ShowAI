import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'src/surface/ink-kernel');
const clang=process.env.SHOWAI_INK_CLANG||'clang++';
const linker=process.env.SHOWAI_INK_WASM_LD||'wasm-ld';
const output=process.env.SHOWAI_BOUNDARY_TEST_OUTPUT;
if(!output)throw new Error('SHOWAI_BOUNDARY_TEST_OUTPUT must name a private test output directory');
const files=['include/showai_ink.h','boundary/number.hpp','boundary/vector.hpp','boundary/record.hpp','boundary/polynomial.hpp','boundary/algebra.hpp','boundary/number-test-api.cpp','include/boundary-kernel.h','boundary/graph.hpp','boundary/graph-test-api.hpp'];
const flags=['--target=wasm32-unknown-unknown','-mbulk-memory','-std=c++17','-O2','-ffp-contract=off','-fno-exceptions','-fno-rtti','-fno-builtin','-nostdlib'];
const tmp=await mkdtemp(join(tmpdir(),'showai-boundary-test-'));
try{
 const object=join(tmp,'boundary.o'),wasm=join(tmp,'boundary.wasm');
 execFileSync(clang,[...flags,'-c',join(source,'boundary/number-test-api.cpp'),'-o',object],{stdio:'inherit'});
 execFileSync(linker,['--no-entry','--export-all','--stack-first','-z','stack-size=2097152','--initial-memory=4194304','--max-memory=268435456',object,'-o',wasm],{stdio:'inherit'});
 const bytes=await readFile(wasm),imports=WebAssembly.Module.imports(new WebAssembly.Module(bytes));
 if(imports.length)throw new Error(`Boundary test kernel is not freestanding: ${JSON.stringify(imports)}`);
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const manifest={testOnly:true,abiVersion:1,files:Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(join(source,f)))]))),sha256:hash(bytes),flags,imports,compiler:execFileSync(clang,['--version'],{encoding:'utf8'}).split('\n')[0]};
 await mkdir(output,{recursive:true});await writeFile(join(output,'boundary-test.wasm'),bytes);await writeFile(join(output,'boundary-test-manifest.json'),JSON.stringify(manifest,null,2)+'\n');process.stdout.write(JSON.stringify(manifest)+'\n');
}finally{await rm(tmp,{recursive:true,force:true});}
