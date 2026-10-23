import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const source=dirname(fileURLToPath(import.meta.url)),temp=await mkdtemp(join(tmpdir(),'showai-coverage-interval-'));
try {
 const binary=join(temp,'contract');
 execFileSync(process.env.SHOWAI_INK_CLANG||'clang++',['-std=c++17','-O2','-ffp-contract=off','-fno-fast-math','-frounding-math',join(source,'coverage-interval-native-contract.cpp'),'-o',binary],{stdio:'inherit'});
 execFileSync(binary,[],{stdio:'inherit'});
} finally {await rm(temp,{recursive:true,force:true});}
