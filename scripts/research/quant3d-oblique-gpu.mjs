import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {planeGeometry,plane3dSpecialize} from '../fixtures/plane3d-specialize.mjs';
import {installObliqueGpuDriver,manufacturedPlaneLine} from './quant3d-oblique-gpu-driver.mjs';
import {closeBrowser} from '../browser-cleanup.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const NORMALS=[[1,0,0],[1,1,0],[1,1,1],[2,1,0],[2,1,1],[3,2,1]];
const sha=b=>createHash('sha256').update(b).digest('hex');
export const nativeCases=()=>NORMALS.flatMap(normal=>[false,true].flatMap(candidate=>[0,.5].map(phase=>({normal,candidate,phase,dx:.8,dt:.004,epsilon:.0171}))))
  .concat([false,true].map(candidate=>({normal:[1,-2,0],candidate,phase:.5,dx:.8,dt:.004,epsilon:.0171})));

export async function obliqueGpuCpuControls(){
  const compiled=await build({entryPoints:[resolve(ROOT,'src/shaders3d.ts')],bundle:true,write:false,platform:'node',format:'esm'});
  const M=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const sources=[M.FLUX3D_WGSL,M.phi3dWgsl(false),M.transport3dWgsl(false),M.phi3dWgsl(false,true)];
  let roundtrips=0,neighbours=0;
  for(const normal of [...NORMALS,[1,-2,0]])for(const boundary of ['clamp','periodic']){
    const g=planeGeometry([128,4,4],normal,{count:257,boundary});
    for(const j of [0,1,16,128,255,256])for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1]){
      const delta=[x,y,z];let expected=j+normal.reduce((s,m,a)=>s+m*delta[a],0);
      expected=boundary==='periodic'?((expected%257)+257)%257:Math.max(0,Math.min(256,expected));
      assert.equal(g.index(g.neighbour(g.coordinate(j),delta)),expected);neighbours++;
    }
    for(const source of sources){assert.equal(plane3dSpecialize(source,g.dims,normal,{count:257,boundary}).geometryOnlyRoundtrip,true);roundtrips++;}
  }
  assert.throws(()=>planeGeometry([128,4,4],[2,2,0]));assert.throws(()=>planeGeometry([128,4,4],[0,0,0]));
  assert.throws(()=>planeGeometry([2048,2048,2048],[1,0,0]));
  assert.throws(()=>plane3dSpecialize('unreviewed source',[128,4,4],[1,0,0]));
  for(const c of nativeCases()){
    const line=manufacturedPlaneLine(2048,c.normal,c.dx,c.phase,c.epsilon);
    assert.ok(line.every(Number.isFinite));assert.ok(line.filter((v,i)=>i%2===0).every(v=>v>=0&&v<=1));
  }
  return {roundtrips,neighbours,nativeCases:nativeCases().length,invalidGeometryRefused:true,productionShaderHashes:sources.map(sha)};
}

function assessNative(data){
  assert.equal(data.comparisons.length,9);assert.equal(data.initialChecks.length,4);
  assert.ok(data.initialChecks.every(c=>c.exact&&c.expectedSha256===c.observedSha256));
  let mismatches=0;
  for(const c of data.comparisons){
    const a=Buffer.from(c.nativeBase64,'base64'),b=Buffer.from(c.quotientBase64,'base64'),bpp=c.field==='grain'?4:8;
    assert.equal(a.length,c.interiorCells*bpp);assert.equal(b.length,a.length);
    assert.equal(sha(a),c.nativeSha256);assert.equal(sha(b),c.quotientSha256);
    let count=0;for(let i=0;i<a.length;i++)count+=a[i]!==b[i];assert.equal(count,c.mismatches);mismatches+=count;
    assert.equal(c.margin,2*c.target);assert.equal(c.clock.steps,c.target);
    assert.equal(c.clock.time,c.target*Math.fround(data.config.dt));
  }
  assert.ok(data.changedStateBytes>0&&data.changedPhaseValues>0,'actual phase and state evolution required');
  assert.ok(data.quotientPhaseChanged>0&&data.quotientFiniteAndInRange===true,'quotient must evolve its own valid phase');
  return {mismatches,exact:mismatches===0,phaseLive:data.changedPhaseValues>0,quotientPhaseLive:true,ageLive:data.changedAgeBytes>0};
}

async function main(out){
  const args=process.argv.slice(2),pos=args.filter(a=>!a.startsWith('--'));
  for(const a of args.filter(a=>a.startsWith('--')))if(!['--run','--self-test'].includes(a)&&!a.startsWith('--fixtures='))throw new Error('unknown option '+a);
  if(pos.length>2)throw new Error('usage: quant3d-oblique-gpu.mjs OUT PORT --fixtures=PATH [--run]');
  const port=pos[1]??'5209',run=args.includes('--run')&&!args.includes('--self-test');
  const cpu=await obliqueGpuCpuControls();
  writeFileSync(resolve(out,'cpu-controls.json'),JSON.stringify(cpu,null,2));
  if(!run){writeFileSync(resolve(out,'oblique-result.json'),JSON.stringify({completed:true,cpuOnly:true,accepted:false,q3Accepted:false,status:'CPU controls complete; GPU not run',cpu},null,2));console.log('Q3-OBLIQUE-CPU',JSON.stringify(cpu));return;}
  const option=args.find(a=>a.startsWith('--fixtures='));assert.ok(option,'explicit FP32 CPU fixture path is required');
  const inputPath=resolve(option.slice(11)),inputBytes=readFileSync(inputPath),input=JSON.parse(inputBytes);
  assert.equal(input.format,'solidify-oblique-fp32-input-fixtures-v1');assert.equal(input.period,257);assert.equal(input.wgslIntermediateRoundingEmulated,false);
  assert.deepEqual(input.fixtures.map(f=>f.geometry.normal),NORMALS,'exact six distinct registered normals required');
  for(const [key,value] of Object.entries({dx:.8,dt:.004,delta:.0171,lambda:4,dTherm:2.5068,tau:1,epsBar:1}))
    assert.equal(input.uniforms[key],Math.fround(value),'unexpected CPU/GPU uniform '+key);
  const vector=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
  assert.ok(vector(input.psiStored,257)&&input.psiStored.every(v=>v===Math.fround(v)&&v>=0&&v<=1));
  assert.ok(vector(input.temperatureStored,257)&&input.temperatureStored.every(v=>v===Math.fround(v)&&v>=-1&&v<=2));
  for(const f of input.fixtures){
    assert.equal(f.geometry.sub,1);assert.equal(f.geometry.physicalDx,input.uniforms.dx);
    assert.equal(f.geometry.normalPlaneSpacing,input.uniforms.dx/Math.sqrt(f.geometry.normal.reduce((s,v)=>s+v*v,0)));
    assert.ok(vector(f.fields.w,257)&&f.fields.correctionQ.length===257&&f.fields.correctionQ.every(v=>vector(v,3)));
    for(const mode of ['False','True'])assert.ok(vector(f.controls[mode].eulerPsiReal,257)&&vector(f.controls[mode].eulerTemperatureReal,257));
  }
  const sourcePaths=['src/sim3d.ts','src/shaders3d.ts','src/shaders3d-quant.ts','scripts/browser-cleanup.mjs',
    'scripts/fixtures/rect3d-specialize.mjs','scripts/fixtures/plane3d-specialize.mjs',
    'scripts/research/quant3d-oblique-gpu-driver.mjs','scripts/research/quant3d-oblique-gpu.mjs','scripts/research/quant3d-oblique-gpu.md'];
  for(const [path,checksum] of Object.entries(input.sourceHashes)){
    const full=resolve(ROOT,path.includes('/')?path:'scripts/research/'+path);assert.equal(sha(readFileSync(full)),checksum,'CPU fixture source changed');
    sourcePaths.push(path.includes('/')?path:'scripts/research/'+path);
  }
  const paths=[...new Set(sourcePaths)],hashes=()=>Object.fromEntries(paths.map(p=>[p,sha(readFileSync(resolve(ROOT,p)))]));
  const result={purpose:'production-WGSL rational-plane operator controls, not kinetic or Q3 acceptance',source:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    started:new Date().toISOString(),completed:false,accepted:false,q3Accepted:false,sourceStable:false,inputsStable:false,deviceErrorLedgerRead:false,
    sourceHashes:hashes(),inputSha256:sha(inputBytes),cpu,native:[],periodic:[],errors:[],status:'running; final evidence pending',
    contract:{normalOrder:NORMALS,heldOutNormal:[3,2,1],native:nativeCases(),targets:[1,2,4],marginPerStep:2,
      allNativeInteriorFieldBytesMustMatch:true,periodicAbsoluteTolerance:2e-6,scope:'pure identity cubic, no external program/noise; default and existing principal-correction options',
      negative:'wrong normal must evolve valid phase and fail native state comparison'}};
  mkdirSync(resolve(out,'raw'),{recursive:true});mkdirSync(resolve(out,'exact-source'),{recursive:true});
  for(const p of paths){mkdirSync(resolve(out,'exact-source',p,'..'),{recursive:true});writeFileSync(resolve(out,'exact-source',p),readFileSync(resolve(ROOT,p)));}
  writeFileSync(resolve(out,'cpu-input.json'),inputBytes);
  const save=()=>writeFileSync(resolve(out,'oblique-result.json'),JSON.stringify(result,null,2));
  const retain=(name,data)=>{const raw=Buffer.from(JSON.stringify(data)),compressed=gzipSync(raw),path='raw/'+name+'.json.gz';writeFileSync(resolve(out,path),compressed);return {path,sha256:sha(compressed),uncompressedSha256:sha(raw)};};
  const fail=(kind,e)=>result.errors.push({kind,message:e?.message??String(e)});
  let browser,page,warm;save();
  try{
    const extra=process.env.CHROME_ARGS?JSON.parse(process.env.CHROME_ARGS):[];assert.ok(Array.isArray(extra)&&extra.every(v=>typeof v==='string'));
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
      protocolTimeout:3_600_000,args:['--enable-unsafe-webgpu','--enable-gpu',...extra]});
    warm=await browser.newPage();await warm.setRequestInterception(true);warm.once('request',r=>r.respond({status:200,contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,"><title>Oblique admission</title>'}));
    await warm.goto(`http://localhost:${port}/__oblique_admission__`,{waitUntil:'domcontentloaded'});await warm.setRequestInterception(false);
    await warm.waitForFunction(async()=>{try{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!a||a.info.isFallbackAdapter!==false)return false;
      window.__obliqueWarm=await a.requestDevice();return true;}catch{return false;}},{timeout:60000,polling:500});
    page=await browser.newPage();page.on('pageerror',e=>fail('page',e));page.on('console',m=>{if(m.type()==='error')fail('console',m.text());});
    await page.goto(`http://localhost:${port}/app/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.__solidify,{timeout:60000});
    await page.evaluate(installObliqueGpuDriver);result.metadata=await page.evaluate(()=>window.__q3oblique.metadata());
    assert.equal(result.metadata.hardware.isFallbackAdapter,false);
    assert.deepEqual(result.metadata.shaderHashes,cpu.productionShaderHashes,'actual production WGSL differs from the CPU source-roundtrip controls');
    for(const [i,c] of nativeCases().entries()){
      const data=await page.evaluate(config=>window.__q3oblique.nativeControl(config),c),assessment=assessNative(data);
      result.native.push({config:c,assessment,raw:retain('native-'+String(i).padStart(2,'0'),data)});save();
      assert.ok(assessment.exact,'native interior parity failed');console.log('Q3-OBLIQUE-NATIVE',JSON.stringify({i,...assessment}));
    }
    assert.ok(result.native.some(r=>r.assessment.ageLive),'age evolution was vacuous');
    const wrong=await page.evaluate(c=>window.__q3oblique.nativeControl(c),{normal:[2,1,0],wrongNormal:[1,0,0],candidate:false,phase:.5,dx:.8,dt:.004,epsilon:.0171});
    result.wrongNormal={assessment:assessNative(wrong),raw:retain('wrong-normal',wrong)};
    assert.ok(!result.wrongNormal.assessment.exact&&result.wrongNormal.assessment.mismatches>0);
    const packed=new Float32Array(input.period*2);for(let i=0;i<input.period;i++){packed[2*i]=input.psiStored[i];packed[2*i+1]=input.temperatureStored[i];}
    for(const [i,fixture] of input.fixtures.entries())for(const candidate of [false,true]){
      const data=await page.evaluate((v,f,c)=>window.__q3oblique.periodicControl(v,f,c),input,fixture,candidate),reference=fixture.controls[candidate?'True':'False'];
      assert.equal(data.actualInitialInputSha256,sha(Buffer.from(packed.buffer)));assert.equal(data.clock.steps,1);
      assert.equal(data.clock.time,input.uniforms.dt);assert.equal(data.clock.uniformDt,input.uniforms.dt);
      assert.equal(data.clock.declaredTime,input.uniforms.dt);
      const error=(a,b)=>Math.max(...a.map((v,j)=>{assert.ok(Number.isFinite(v));return Math.abs(v-b[j]);}));
      const phaseError=error(data.psi,reference.eulerPsiReal),temperatureError=error(data.temperature,reference.eulerTemperatureReal);
      const expectedFlux=[];for(let j=0;j<input.period;j++)expectedFlux.push(...fixture.fields.correctionQ[j].map(v=>v/2),fixture.fields.w[j]);
      const fluxError=error(data.flux,expectedFlux),passed=Math.max(phaseError,temperatureError,fluxError)<=2e-6;
      result.periodic.push({normal:fixture.geometry.normal,candidate,phaseError,temperatureError,fluxError,passed,raw:retain(`periodic-${i}-${candidate}`,data)});save();
      assert.ok(passed,'independent periodic CPU/GPU response differs');
    }
  }catch(error){result.exception=error.stack??String(error);}
  finally{
    if(page){
      try{await page.evaluate(async()=>{if(!window.__q3oblique)throw new Error('fixture missing');await window.__q3oblique.dispose();});}catch(e){fail('fixture cleanup',e);}
      try{const e=await page.evaluate(()=>window.__q3oblique?.errors());if(!Array.isArray(e))throw new Error('GPU ledger missing');result.errors.push(...e);result.deviceErrorLedgerRead=true;}catch(e){fail('GPU ledger',e);}
      try{await page.evaluate(()=>{const d=window.__solidify?.sim()?.device;if(!d)throw new Error('application device missing');d.destroy();});}catch(e){fail('application cleanup',e);}
    }
    if(warm)try{await warm.evaluate(()=>{if(!window.__obliqueWarm)throw new Error('warm device missing');window.__obliqueWarm.destroy();});}catch(e){fail('warm cleanup',e);}
    if(browser)try{await closeBrowser(browser);}catch(e){fail('browser cleanup',e);}
    try{result.finalHashes=hashes();result.sourceStable=JSON.stringify(result.finalHashes)===JSON.stringify(result.sourceHashes);if(!result.sourceStable)fail('source','source changed');}catch(e){fail('source',e);}
    try{result.inputsStable=sha(readFileSync(inputPath))===result.inputSha256;if(!result.inputsStable)fail('input','input changed');}catch(e){fail('input',e);}
    result.completed=!result.exception&&!result.errors.length&&result.deviceErrorLedgerRead&&result.sourceStable&&result.inputsStable
      &&result.native.length===nativeCases().length&&result.native.every(r=>r.assessment.exact)&&result.wrongNormal?.assessment.exact===false
      &&result.periodic.length===12&&result.periodic.every(r=>r.passed);
    result.status=result.completed?'oblique production operator controls complete; kinetic acceptance not evaluated':'oblique execution or operator control refused';
    result.finished=new Date().toISOString();save();
  }
  console.log('Q3-OBLIQUE-FINAL',JSON.stringify({completed:result.completed,status:result.status,errors:result.errors,exception:result.exception}));
  process.exitCode=result.completed?0:1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pos=process.argv.slice(2).filter(a=>!a.startsWith('--')),out=resolve(pos[0]??'verify-out/q3-oblique-gpu'),path=resolve(out,'oblique-result.json');
  try{mkdirSync(out,{recursive:true});writeFileSync(path,JSON.stringify({completed:false,accepted:false,q3Accepted:false,status:'preflight pending'}));await main(out);}
  catch(error){let d={};try{d=JSON.parse(readFileSync(path,'utf8'));}catch{}
    Object.assign(d,{completed:false,accepted:false,q3Accepted:false,status:'preflight or artifact failure',exception:error.stack??String(error)});
    try{writeFileSync(path,JSON.stringify(d,null,2));}catch{}console.error(d.exception);process.exitCode=1;}
}
