import {readFile,writeFile,mkdir,mkdtemp,rm}from'node:fs/promises';import{resolve,join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';import{tmpdir}from'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),source=join(root,'src/surface/ink-kernel/boundary'),output=process.env.SHOWAI_BOUNDARY_QUANTIZATION_OUTPUT;if(!output)throw Error('SHOWAI_BOUNDARY_QUANTIZATION_OUTPUT must be private test output');
const clang=process.env.SHOWAI_INK_CLANG||'clang++',linker=process.env.SHOWAI_INK_WASM_LD||'wasm-ld',tmp=await mkdtemp(join(tmpdir(),'showai-boundary-quantization-'));
try{
 const object=join(tmp,'quantization.o'),wasm=join(tmp,'quantization.wasm'),flags=['--target=wasm32-unknown-unknown','-mbulk-memory','-std=c++17','-O2','-ffp-contract=off','-fno-fast-math','-fno-exceptions','-fno-rtti','-fno-builtin','-nostdlib'];
 execFileSync(clang,[...flags,'-c',join(source,'quantization-test-api.cpp'),'-o',object],{stdio:'inherit'});
 execFileSync(linker,['--no-entry','--export-all','--stack-first','-z','stack-size=2097152','--initial-memory=4194304','--max-memory=268435456',object,'-o',wasm],{stdio:'inherit'});
 const bytes=await readFile(wasm),imports=WebAssembly.Module.imports(new WebAssembly.Module(bytes));if(imports.length)throw Error('Actual quantization test module imports host functions: '+JSON.stringify(imports));
 await mkdir(output,{recursive:true});await writeFile(join(output,'quantization.wasm'),bytes);
 execFileSync(clang,['-std=c++17','-O2','-ffp-contract=off','-fno-fast-math',join(source,'quantization-native-contract.cpp'),'-o',join(output,'quantization-native-contract')],{stdio:'inherit'});
 execFileSync(join(output,'quantization-native-contract'),[join(output,'quantization-native.bin')],{stdio:'inherit'});
 const hash=v=>createHash('sha256').update(v).digest('hex'),files=['quantization.hpp','quantization-test-api.cpp','quantization-native-contract.cpp','graph.hpp','owner.hpp','algebra.hpp','polynomial.hpp','number.hpp','vector.hpp','record.hpp','paged-vector.hpp','wasm-runtime.cpp'];
 const manifest={testOnly:true,imports,sha256:hash(bytes),flags,compiler:execFileSync(clang,['--version'],{encoding:'utf8'}).split('\n')[0],files:Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await readFile(join(source,p)))])))};
 await writeFile(join(output,'quantization-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}finally{await rm(tmp,{recursive:true,force:true})}
