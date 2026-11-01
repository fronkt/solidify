// CPU/filesystem controls only. No browser/server/GPU is started.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {captureTranslationSources,translationSourcePaths} from './quant3d-equilibrium-translation.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.argv[2]??'verify-out/q3-startup-source-capture-controls');
assert.ok(!existsSync(out),'choose a fresh controls directory to retain prior evidence');mkdirSync(out,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const load=path=>JSON.parse(readFileSync(path,'utf8'));
const hashes=grid=>Object.fromEntries(translationSourcePaths(grid).map(path=>[path,sha(readFileSync(resolve(ROOT,path)))]));
const source=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
const options=(directory,grid=false)=>({root:ROOT,out:directory,sourceHashes:hashes(grid),source,started:new Date().toISOString()});
const readback=(directory,expected)=>{
  const ledger=load(resolve(directory,'source-capture.json'));
  assert.equal(ledger.completed,true);assert.equal(ledger.capturedAtStartup,true);
  assert.equal(ledger.verifiedBeforeBrowserAdmission,true);assert.equal(ledger.allStartupHashesMatched,true);
  assert.equal(ledger.files.length,Object.keys(expected).length);
  for(const row of ledger.files){const bytes=readFileSync(resolve(directory,'exact-source',row.path));
    assert.deepEqual(bytes,readFileSync(resolve(ROOT,row.path)));assert.equal(bytes.length,row.bytes);
    assert.equal(sha(bytes),expected[row.path]);assert.equal(row.startupSha256,row.copySha256);
    assert.equal(row.startupHashMatched,true);}
  return ledger;
};
const records=[];
for(const grid of [false,true]){
  const directory=resolve(out,grid?'copies-grid':'copies-four');mkdirSync(directory,{recursive:true});
  const input=options(directory,grid),result=captureTranslationSources(input),ledger=readback(directory,input.sourceHashes);
  assert.equal(result.sha256,sha(readFileSync(resolve(directory,result.path))));
  assert.equal(ledger.files.length,grid?14:11);assert.ok(ledger.files.every(row=>row.writtenAtThisStartup&&!row.existingCopyMatched));
  captureTranslationSources(input);const reused=readback(directory,input.sourceHashes);
  assert.ok(reused.files.every(row=>!row.writtenAtThisStartup&&row.existingCopyMatched));
  records.push({mode:grid?'twelve':'four',actualCopiesVerified:ledger.files.length,matchingExistingCopiesVerified:true});
}
const first=translationSourcePaths(false)[0],bad=Buffer.from('existing mismatched bytes must remain unchanged');
for(const kind of ['mismatch','source-hash','copy-writer','ledger-writer']){
  const directory=resolve(out,'component-'+kind);mkdirSync(directory,{recursive:true});const input=options(directory);
  if(kind==='mismatch'){const copy=resolve(directory,'exact-source',first);mkdirSync(dirname(copy),{recursive:true});writeFileSync(copy,bad);}
  if(kind==='source-hash')input.sourceHashes[first]='0'.repeat(64);
  if(kind==='copy-writer')writeFileSync(resolve(directory,'exact-source'),'blocking regular file');
  if(kind==='ledger-writer')mkdirSync(resolve(directory,'source-capture.json'));
  assert.throws(()=>captureTranslationSources(input),kind==='mismatch'?/existing source copy differs/:
    kind==='source-hash'?/source changed since startup hash/:/EISDIR|ENOTDIR|EEXIST|illegal operation/i);
  if(kind==='mismatch')assert.deepEqual(readFileSync(resolve(directory,'exact-source',first)),bad);
  if(kind!=='ledger-writer'){const refused=load(resolve(directory,'source-capture.json'));
    assert.equal(refused.completed,false);assert.equal(refused.refused,true);assert.equal(refused.verifiedBeforeBrowserAdmission,false);}
  records.push({componentRefusal:kind,passed:true});
}
// Actual CLI retries start with a stale positive artifact. An invalid CHROME_ARGS
// sentinel also prevents a browser call if any refusal accidentally falls through.
const cli=resolve(ROOT,'scripts/research/quant3d-equilibrium-translation.mjs');
for(const grid of [false,true])for(const kind of ['mismatch','copy-writer','ledger-writer']){
  const directory=resolve(out,`cli-${grid?'grid':'four'}-${kind}`);mkdirSync(directory,{recursive:true});
  const artifact=resolve(directory,grid?'capillary-grid-result.json':'translation-result.json');
  writeFileSync(artifact,JSON.stringify({completed:true,executionCompleted:true,diagnosticPassed:true,accepted:true,
    fullMatrixCompleted:true,q3Accepted:true,cases:[{stale:true}]}));
  if(kind==='mismatch'){const copy=resolve(directory,'exact-source',first);mkdirSync(dirname(copy),{recursive:true});writeFileSync(copy,bad);}
  if(kind==='copy-writer')writeFileSync(resolve(directory,'exact-source'),'blocking regular file');
  if(kind==='ledger-writer')mkdirSync(resolve(directory,'source-capture.json'));
  const child=spawnSync(process.execPath,[cli,directory,'5201','--run',...(grid?['--grid-refinement']:[])],{
    cwd:ROOT,encoding:'utf8',timeout:60_000,env:{...process.env,CHROME_ARGS:'invalid JSON blocks browser admission',
      CHROME_PATH:resolve(out,'no-browser-executable')}});
  assert.equal(child.error,undefined);assert.equal(child.status,1);
  const refused=load(artifact);for(const key of ['completed','executionCompleted','diagnosticPassed','accepted','fullMatrixCompleted','q3Accepted'])assert.equal(refused[key],false);
  assert.deepEqual(refused.cases,[]);assert.equal(refused.sourceCapture.completed,false);
  assert.equal(refused.sourceCapture.verifiedBeforeBrowserAdmission,false);assert.equal(refused.metadata,undefined);
  assert.match(refused.exception,kind==='mismatch'?/existing source copy differs/:/source-capture\.json|exact-source/);
  assert.equal(child.stdout.includes('Q3-TRANSLATION-CPU OK'),false,'copy failure must precede CPU and browser admission');
  if(kind==='mismatch')assert.deepEqual(readFileSync(resolve(directory,'exact-source',first)),bad);
  records.push({cliRefusal:kind,mode:grid?'twelve':'four',freshFalseArtifact:true,preflightStoppedBeforeBrowser:true});
}
for(const grid of [false,true]){
  const directory=resolve(out,grid?'cpu-grid':'cpu-four');
  const child=spawnSync(process.execPath,[cli,directory,'5201','--self-test',...(grid?['--grid-refinement']:[])],{
    cwd:ROOT,encoding:'utf8',timeout:180_000});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
  const result=load(resolve(directory,grid?'capillary-grid-result.json':'translation-result.json'));
  assert.equal(result.cpuOnly,true);assert.equal(result.completed,false);assert.equal(result.executionCompleted,false);
  assert.equal(result.sourceCapture.completed,true);assert.equal(result.sourceCapture.verifiedBeforeBrowserAdmission,true);
  assert.equal(result.sourceCapture.sha256,sha(readFileSync(resolve(directory,result.sourceCapture.path))));
  readback(directory,result.sourceHashes);assert.deepEqual(result.cases,[]);assert.equal(result.metadata,undefined);
  if(grid){assert.equal(result.gridControls.strictTwelveCases,true);assert.equal(result.gridControls.clockAndLifecycleControls,true);}
  records.push({mode:grid?'twelve':'four',cpuCliPassed:true,actualCopiesVerified:Object.keys(result.sourceHashes).length,
    legacyStateSha256:result.cpuControls.legacyStateSha256,plans:grid?result.gridControls.plans:result.cpuControls.plans});
}
const path='scripts/research/quant3d-equilibrium-translation.mjs';
const before=execFileSync('git',['show',`6d409780576a937af64e6817199fb6341f9088c3:${path}`],{cwd:ROOT,encoding:'utf8'}).replaceAll('\r\n','\n');
const after=readFileSync(resolve(ROOT,path),'utf8').replaceAll('\r\n','\n');
const section=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
const scienceStart='export const TRANSLATION_TOLERANCE',scienceEnd='async function main(out)';
assert.deepEqual(section(after,scienceStart,scienceEnd),section(before,scienceStart,scienceEnd));
const gpuStart='  let browser,page,warm;',gpuEnd='\nif(process.argv[1]';
assert.deepEqual(section(after,gpuStart,gpuEnd),section(before,gpuStart,gpuEnd));
const oldPathText=section(before,'  const paths=[','  const hashes=');
const oldPaths=[...oldPathText.matchAll(/'((?:src|scripts)\/[^']+)'/g)].map(match=>match[1]);
assert.deepEqual(translationSourcePaths(true),oldPaths);assert.deepEqual(translationSourcePaths(false),oldPaths.slice(0,11));
const report={scope:'isolated CPU/filesystem controls; no browser/server/GPU execution',passed:true,
  base:'6d409780576a937af64e6817199fb6341f9088c3',scientificAndClockFunctionsUnchanged:true,
  gpuLoopAndCleanupSourceUnchanged:true,measuredSourcePathListsUnchanged:true,
  scientificBlockSha256:sha(Buffer.from(section(after,scienceStart,scienceEnd))),
  gpuAndCleanupBlockSha256:sha(Buffer.from(section(after,gpuStart,gpuEnd))),records};
writeFileSync(resolve(out,'controls.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,controls:records.length,scientificAndClockFunctionsUnchanged:true,
  gpuLoopAndCleanupSourceUnchanged:true,report:resolve(out,'controls.json')}));
