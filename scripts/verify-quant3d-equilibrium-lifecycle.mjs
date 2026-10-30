// Exercise the actual equilibrium CLI/artifact lifecycle under an explicit
// CPU-only synthetic browser. These cases are not physical validation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const repo=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(process.argv[2]??'verify-out/q3-equilibrium-lifecycle');
mkdirSync(out,{recursive:true});
const cases=[
  ['positive',null],
  ['ledger-fail','GPU error ledger read failed'],
  ['ledger-missing','GPU error ledger is unavailable'],
  ['ledger-nonarray','GPU error ledger is unavailable'],
  ['fixture-destroy-fail','fixture cleanup failed'],
  ['fixture-dispose-fail','fixture cleanup failed'],
  ['warm-cleanup-fail','warm device cleanup failed'],
  ['browser-cleanup-fail','browser cleanup failed'],
  ['gpu-error','manufactured GPU error'],
  ['page-error','manufactured late page exception'],
  ['console-error','manufactured console error'],
  ['launch-fail','manufactured launch failure'],
  ['newpage-fail','manufactured newPage failure'],
  ['source-change','benchmark source changed during execution'],
  ['invalid-chrome-options','CHROME_ARGS'],
  ['control-fail','manufactured control failure'],
  ['control-no-progress','Control clock failed its finite bounded progress contract'],
  ['late-overshoot','Control clock failed its finite bounded progress contract'],
  ['late-infinite','Control clock failed its finite bounded progress contract'],
];
function invoke(mode,directory,selection='baseline'){
  const env={...process.env,Q3_EQUIL_MOCK_MODE:mode};delete env.CHROME_ARGS;
  if(mode==='invalid-chrome-options')env.CHROME_ARGS='{}';
  const args=['--import','./scripts/fixtures/quant3d-equilibrium-lifecycle-preload.mjs',
    'scripts/research/quant3d-equilibrium.mjs',directory,'5199'];
  if(selection!==null)args.push(selection);
  const child=spawnSync(process.execPath,args,{cwd:repo,env,encoding:'utf8',
    timeout:60_000,maxBuffer:16*1024**2});
  assert.ifError(child.error);
  writeFileSync(`${directory}.log`,child.stdout+child.stderr);
  const result=JSON.parse(readFileSync(resolve(directory,'calibration-result.json')));
  return {child,result};
}
const rows=[],failures=[];
for(const [mode,expectedError]of cases){
  const directory=resolve(out,mode);
  try{
    // A complete synthetic matrix tests the all14 selection flag. Faults use
    // a declared two-case subset to keep CPU CI work small.
    const {child,result}=invoke(mode,directory,mode==='positive'?null:'baseline');
    if(expectedError){
      assert.equal(child.status,1,`${mode}: fault must set exit1`);
      assert.equal(result.completed,false,`${mode}: fault must refuse completion`);
      assert.equal(result.fullMatrixCompleted,false,`${mode}: fault must refuse full-matrix completion`);
      const evidence=JSON.stringify({errors:result.errors,exception:result.exception,
        caseErrors:result.cases.map(c=>c.error)});
      assert(evidence.includes(expectedError),`${mode}: failed on wrong clause; expected ${expectedError}`);
      assert.notEqual(result.status,'full declared equilibrium matrix complete');
    }else{
      assert.equal(child.status,0);assert.equal(result.completed,true);
      assert.equal(result.fullMatrixCompleted,true);assert.equal(result.cases.length,14);
      assert.equal(result.deviceErrorLedgerRead,true);assert.equal(result.sourceStable,true);
      assert(result.cases.every(c=>c.completed&&Number.isFinite(c.finalTime)&&c.finalTime===c.config.maximumTime));
    }
    rows.push({mode,passed:true,exitCode:child.status,completed:result.completed,
      fullMatrixCompleted:result.fullMatrixCompleted,status:result.status,expectedError});
  }catch(error){failures.push({mode,message:error.message});rows.push({mode,passed:false,message:error.message});}
}
for(const [name,test]of [
  ['subset',()=>{
    const {child,result}=invoke('positive',resolve(out,'subset'));
    assert.equal(child.status,0);assert.equal(result.completed,true);
    assert.equal(result.fullMatrixCompleted,false);assert.equal(result.cases.length,2);
    assert.match(result.status,/full matrix not evaluated/);
  }],
  ['failed-retry',()=>{
    const directory=resolve(out,'stale-retry');
    assert.equal(invoke('positive',directory).result.completed,true);
    const {child,result}=invoke('launch-fail',directory);
    assert.equal(child.status,1);assert.equal(result.completed,false);
    assert.equal(result.fullMatrixCompleted,false);assert.equal(result.cases.length,0);
    assert(result.exception.includes('manufactured launch failure'));
  }],
  ['invalid-selection-retry',()=>{
    const directory=resolve(out,'stale-selection-retry');
    assert.equal(invoke('positive',directory).result.completed,true);
    const {child,result}=invoke('positive',directory,'baseline,baseline');
    assert.equal(child.status,1);assert.equal(result.completed,false);
    assert.equal(result.fullMatrixCompleted,false);assert.equal(result.cases.length,0);
    assert(result.exception.includes('Select distinct declared geometry/control names'));
  }],
]){
  try{test();rows.push({mode:name,passed:true});}
  catch(error){failures.push({mode:name,message:error.message});rows.push({mode:name,passed:false,message:error.message});}
}
writeFileSync(resolve(out,'lifecycle-controls.json'),JSON.stringify({
  purpose:'CPU-only synthetic execution-evidence plumbing, no GPU or scientific validation',
  passed:failures.length===0,rows,failures,
  passingSubsetCannotCompleteFullMatrix:!failures.some(c=>c.mode==='subset'),
  failedRetryReplacedSuccess:!failures.some(c=>c.mode==='failed-retry'),
  invalidSelectionRetryReplacedSuccess:!failures.some(c=>c.mode==='invalid-selection-retry'),
},null,2)+'\n');
if(failures.length){console.error('QPF3-EQUILIBRIUM-LIFECYCLE FAIL',JSON.stringify(failures));process.exitCode=1;}
else console.log('QPF3-EQUILIBRIUM-LIFECYCLE OK',JSON.stringify({cases:cases.length,
  passingSubsetCannotCompleteFullMatrix:true,failedRetryReplacedSuccess:true,invalidSelectionRetryReplacedSuccess:true}));
