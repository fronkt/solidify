// Four-arm translation diagnostic. CPU controls by default; --run starts WebGPU.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {closeBrowser} from '../browser-cleanup.mjs';
import {installQuant3WulffCalibrationDriver,equilibriumFrame,equilibriumInitialFields,
  equilibriumCentroid,equilibriumFramePoints} from './quant3d-equilibrium-driver.mjs';
import {equilibriumTranslationPoints} from './quant3d-equilibrium-driver.mjs';
import {equilibriumState,selfTestWulff,surfacePoints} from '../fixtures/quant3d-wulff-analysis.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const TRANSLATION_TOLERANCE=Object.freeze({centroid:8e-5,minimumShift:.2,initialRelativeVolume:1e-4});
export const translationArms=()=>[0,.0171].flatMap(epsilon=>[0,.4].map(offset=>({
  name:`epsilon-${epsilon}-offset-${offset}`,n:96,dx:.8,radius:20,lambda:4,epsilon,
  centerOffset:[offset,offset,offset],maximumTime:1000,measurementPeriod:20,controlPeriod:4})));

export function translationClockPlan(c){
  const dt=Math.min(c.dx*c.dx/(12*.6267*c.lambda),.02*(1-3*c.epsilon)**2*Math.min(1,(c.dx/.8)**2));
  const cap=Math.max(1,Math.floor(1.6e8/c.n**3));
  let time=0,steps=0,next=c.measurementPeriod;const controls=[],samples=[{steps:0,time:0}];
  while(time<c.maximumTime){
    const count=Math.ceil(Math.min(c.controlPeriod,c.maximumTime-time)/dt);
    let left=count;while(left){const batch=Math.min(left,cap);time+=batch*dt;left-=batch;}
    steps+=count;controls.push({steps,time,count});
    if(time>=next||time>=c.maximumTime){samples.push({steps,time});while(next<=time)next+=c.measurementPeriod;}
    assert.ok(controls.length<1000,'nonterminating clock plan');
  }
  // Preserve the ORIGINAL JS-clock horizon/count. Do not add a physics step
  // because the actual Float32 uniform has a small, fully determined offset.
  return {dt,uniformDt:Math.fround(dt),controls,samples,terminalSteps:steps,terminalTime:time,
    terminalUniformTime:steps*Math.fround(dt),uniformMinusDeclared:steps*(Math.fround(dt)-dt),
    horizonDefinition:'original sequential JS simulation clock; actual uniform clock recorded exactly'};
}

export function translationClockMatches(clock,expected,dt){
  return !!clock&&clock.steps===expected.steps&&clock.simTime===expected.time&&clock.dt===dt
    &&clock.uniformDt===Math.fround(dt)&&clock.declaredTime===expected.steps*dt
    &&clock.uniformTime===expected.steps*Math.fround(dt);
}

export function translationInitialLiveness(c,setup,measurement,baseline=null){
  const t=measurement.translation,offset=c.centerOffset,isShift=offset.some(v=>v!==0);
  const same=(a,b)=>Array.isArray(a)&&a.length===3&&a.every((v,i)=>v===b[i]);
  const valid=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
  const checks={declaration:same(t?.declaredOffset,offset),adapter:same(t?.appliedOffset,offset),
    uploadedReadbackHash:typeof t?.phaseSha256==='string'&&t.phaseSha256===setup.translation?.uploadedPhaseSha256,
    finiteCentroid:valid(t?.centroidLab)&&valid(t?.centroidFrame),
    centered:valid(t?.centroidFrame)&&t.centroidFrame.every(v=>Math.abs(v)<=TRANSLATION_TOLERANCE.centroid),
    volume:Number.isFinite(t?.volume)&&Math.abs(t.volume/setup.targetVolume-1)<TRANSLATION_TOLERANCE.initialRelativeVolume};
  if(isShift){
    const b=baseline?.translation;
    checks.baselinePresent=!!b&&valid(b.centroidLab);
    checks.hashChanged=typeof b?.phaseSha256==='string'&&b.phaseSha256!==t?.phaseSha256;
    checks.translationLive=valid(t?.centroidLab)&&valid(b?.centroidLab)&&t.centroidLab.every((v,i)=>
      Math.abs(v-b.centroidLab[i])>TRANSLATION_TOLERANCE.minimumShift
      &&Math.abs(v-b.centroidLab[i]-offset[i])<=TRANSLATION_TOLERANCE.centroid);
  }
  return {passed:Object.values(checks).every(Boolean),checks};
}

export function translationVerdict(result){
  const arms=translationArms(),names=result.cases.map(c=>c.config.name);
  const backend=!result.exception&&result.errors.length===0&&result.deviceErrorLedgerRead===true
    &&result.sourceStable===true&&names.length===4&&new Set(names).size===4
    &&arms.every(c=>names.includes(c.name))&&result.cases.every(c=>c.completed===true&&c.fieldEvolved===true
      &&c.initialLiveness?.passed===true&&c.measurements?.length===51
      &&c.controls?.length===c.clockPlan?.controls?.length
      &&(!c.config.centerOffset.some(v=>v!==0)||c.missingRecenteringControl?.passed===true));
  return {executionCompleted:backend,diagnosticPassed:backend&&result.cases.every(c=>c.equilibrium?.stationary===true
    &&c.equilibrium?.resolved===true&&c.centroidStable===true),
    fullMatrixCompleted:false,q3Accepted:false,
    scope:'four paired equilibrium translation arms only; no full14, capillary calibration, moving kinetics or Q3 acceptance'};
}

export function selfTestTranslation(){
  const c=translationArms()[0],shift=translationArms()[1],old={...c,initialAxes:[1,1,1]};delete old.centerOffset;
  const fresh=equilibriumInitialFields(old),zero=equilibriumInitialFields({...old,centerOffset:[0,0,0]});
  const legacy=new Float32Array(c.n**3*2),ids=new Uint32Array(c.n**3),temperature=1-2*(.8839/c.lambda)/c.radius;
  for(let z=0;z<c.n;z++)for(let y=0;y<c.n;y++)for(let x=0;x<c.n;x++){
    const i=(z*c.n+y)*c.n+x,r=Math.hypot((x+.5-c.n/2),(y+.5-c.n/2),(z+.5-c.n/2))*c.dx;
    legacy[2*i]=.5*(1-Math.tanh((r-c.radius)/Math.SQRT2));legacy[2*i+1]=temperature;ids[i]=legacy[2*i]>.01?1:0;
  }
  assert.deepEqual(fresh.raw,legacy);assert.deepEqual(fresh.ids,ids);assert.deepEqual(zero.raw,legacy);
  const translated=equilibriumInitialFields(shift),mom0=equilibriumCentroid(fresh.phi,fresh.frame);
  const snap=(fields,declared,actualFrame=fields.frame)=>({translation:{declaredOffset:declared,
    appliedOffset:[...actualFrame.offset],phaseSha256:sha(fields.phi),...equilibriumCentroid(fields.phi,actualFrame)}});
  const base=snap(fresh,[0,0,0]),good=snap(translated,shift.centerOffset);
  const setup={targetVolume:mom0.volume,translation:{uploadedPhaseSha256:sha(translated.phi)}};
  assert.equal(translationInitialLiveness(shift,setup,good,base).passed,true);
  assert.equal(translationInitialLiveness(shift,setup,snap(fresh,shift.centerOffset),base).passed,false);
  assert.equal(translationInitialLiveness(shift,setup,snap(translated,shift.centerOffset,fresh.frame),base).passed,false);
  const hiddenAdapterFailure=snap(translated,shift.centerOffset,fresh.frame);
  hiddenAdapterFailure.translation.appliedOffset=[...shift.centerOffset];
  const hidden=translationInitialLiveness(shift,setup,hiddenAdapterFailure,base);
  assert.equal(hidden.checks.adapter,true);assert.equal(hidden.checks.centered,false);assert.equal(hidden.passed,false);
  const original=surfacePoints(fresh.phi,c.n,c.dx,true);assert.equal(equilibriumFramePoints(original,fresh.frame),original);
  assert.deepEqual(equilibriumTranslationPoints(fresh.phi,c.n,c.dx),original);
  const translatedPoints=equilibriumTranslationPoints(translated.phi,c.n,c.dx);
  assert.ok(translatedPoints.some(p=>p.endpointRoot===0&&p.solidToLiquidSign===1),'exact forward endpoint control was not exercised');
  assert.ok(translatedPoints.some(p=>p.endpointRoot===1&&p.solidToLiquidSign===-1),'exact reversed endpoint control was not exercised');
  assert.ok(translatedPoints.filter(p=>p.endpointRoot!==undefined).every(p=>p.brackets[p.endpointRoot+2]===.5));
  const moved=equilibriumFramePoints(translatedPoints,translated.frame);
  const sphereError=Math.max(...moved.map(p=>Math.abs(Math.hypot(...p.xyz)-c.radius)));
  assert.ok(sphereError<1e-4,'known translated sphere was not recentered through the actual adapter');
  const plans=translationArms().map(translationClockPlan);
  for(const p of plans){assert.equal(p.samples.length,51);
    const end=p.samples.at(-1),clock={steps:end.steps,simTime:end.time,dt:p.dt,uniformDt:p.uniformDt,
      declaredTime:end.steps*p.dt,uniformTime:end.steps*p.uniformDt};
    assert.equal(translationClockMatches(clock,end,p.dt),true);
    assert.equal(translationClockMatches({...clock,steps:clock.steps-1},end,p.dt),false);
    assert.equal(translationClockMatches({...clock,simTime:clock.simTime+p.dt},end,p.dt),false);}
  const rows=translationArms().map((config,i)=>({config,completed:true,fieldEvolved:true,initialLiveness:{passed:true},
    measurements:Array(51).fill({}),controls:plans[i].controls,clockPlan:plans[i],missingRecenteringControl:{passed:true},
    centroidStable:true,equilibrium:{stationary:true,resolved:true}}));
  const result={cases:rows,errors:[],deviceErrorLedgerRead:true,sourceStable:true};
  assert.equal(translationVerdict(result).diagnosticPassed,true);
  for(const key of ['deviceErrorLedgerRead','sourceStable'])assert.equal(translationVerdict({...result,[key]:false}).diagnosticPassed,false);
  assert.equal(translationVerdict({...result,errors:['late cleanup failure']}).diagnosticPassed,false);
  assert.equal(translationVerdict({...result,cases:rows.slice(1)}).diagnosticPassed,false);
  assert.equal(translationVerdict({...result,cases:rows.map((r,i)=>i===1?{...r,missingRecenteringControl:{passed:false}}:r)}).diagnosticPassed,false);
  assert.equal(translationVerdict({...result,cases:rows.map((r,i)=>i===0?{...r,measurements:r.measurements.slice(1)}:r)}).diagnosticPassed,false);
  return {defaultFullStateByteParity:true,explicitZeroByteParity:true,defaultGrainByteParity:true,
    legacyStateSha256:sha(legacy),knownTranslatedSphereMaxError:sphereError,centroid:good.translation,
    missingOffsetRefused:true,missingRecenteringRefused:true,metadataOnlyRecenteringRefused:true,
    exactEndpointControl:{forward:true,reversed:true,rawValuesPreserved:true},defaultSurfaceParity:true,clockControls:true,lifecycleControls:true,
    plans:plans.map(p=>({dt:p.dt,terminalSteps:p.terminalSteps,terminalTime:p.terminalTime,samples:p.samples.length}))};
}

async function main(out){
  const args=process.argv.slice(2),pos=args.filter(a=>!a.startsWith('--'));
  for(const arg of args.filter(a=>a.startsWith('--')))if(!['--run','--self-test'].includes(arg))throw new Error(`unknown option ${arg}`);
  if(pos.length>2)throw new Error('usage: node scripts/research/quant3d-equilibrium-translation.mjs <out> <port> [--run|--self-test]');
  const port=pos[1]??'5201',run=args.includes('--run')&&!args.includes('--self-test');
  const paths=['src/sim3d.ts','src/shaders3d.ts','src/shaders3d-quant.ts','scripts/fixtures/quant3d-wulff-analysis.mjs',
    'scripts/fixtures/quant3d-tip-analysis.mjs','scripts/research/quant3d-equilibrium-driver.mjs',
    'scripts/research/quant3d-equilibrium-translation.mjs','scripts/research/quant3d-equilibrium-translation.md',
    'scripts/research/quant3d-readback.mjs','scripts/browser-cleanup.mjs'];
  const hashes=()=>Object.fromEntries(paths.map(path=>[path,sha(readFileSync(resolve(ROOT,path)))]));
  const result={format:'solidify-equilibrium-translation-diagnostic-v1',started:new Date().toISOString(),
    completed:false,diagnosticPassed:false,accepted:false,fullMatrixCompleted:false,q3Accepted:false,
    cases:[],errors:[],deviceErrorLedgerRead:false,sourceStable:false,status:'CPU preflight',
    contract:{arms:translationArms(),tolerances:TRANSLATION_TOLERANCE,physics:'unchanged default pure3D; latticeKinetics=false',
      coordinates:'shared actual adapter: (cell+.5-n/2)*dx-declaredCenterOffset; observed centroid never changes origin',
      volume:'translated arm shares its baseline phase-volume target; unchanged radius',
      clock:'original controlPeriod4; original integer step cap and JS horizon/count; 50 requested periods,51 observed checkpoints; exact Float32 uniform time reported separately',
      negativeControl:'actual translated GPU field, unchanged declaration, bypass fit/centroid adapter at t0; must refuse',
      scope:'four-arm diagnostic only; never full14/Q3 acceptance'}};
  const save=()=>writeFileSync(resolve(out,'translation-result.json'),JSON.stringify(result,null,2));
  save();result.source=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  result.sourceHashes=hashes();result.cpuControls=selfTestTranslation();result.wulffControls=selfTestWulff();save();
  console.log('Q3-TRANSLATION-CPU OK',JSON.stringify(result.cpuControls));
  if(!run){result.cpuOnly=true;result.status='CPU controls complete; GPU diagnostic not run';result.finished=new Date().toISOString();save();return;}
  let browser,page,warm;
  const fail=(kind,error)=>result.errors.push({kind,message:error?.message??String(error)});
  mkdirSync(resolve(out,'samples'),{recursive:true});
  const retain=(label,measurement,config)=>{const {raw,...m}=measurement,bytes=Buffer.from(JSON.stringify({config,...raw})),compressed=gzipSync(bytes);
    const path=`samples/${label}.json.gz`;writeFileSync(resolve(out,path),compressed);
    return {...m,raw:{path,sha256:sha(compressed),uncompressedSha256:sha(bytes),points:raw.points.length}};};
  try{
    const extra=process.env.CHROME_ARGS?JSON.parse(process.env.CHROME_ARGS):[];
    if(!Array.isArray(extra)||extra.some(a=>typeof a!=='string'))throw new Error('CHROME_ARGS must be a string array');
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless:true,protocolTimeout:3_600_000,args:['--enable-unsafe-webgpu','--enable-gpu',...extra]});
    warm=await browser.newPage();await warm.setRequestInterception(true);
    warm.once('request',r=>r.respond({status:200,contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,"><title>Translation admission</title>'}));
    await warm.goto(`http://localhost:${port}/__translation_gpu_admission__`,{waitUntil:'domcontentloaded'});await warm.setRequestInterception(false);
    await warm.waitForFunction(async()=>{try{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      if(!a||a.info.isFallbackAdapter!==false)return false;window.__translationWarmDevice=await a.requestDevice();return true;}catch{return false;}},{timeout:60000,polling:500});
    page=await browser.newPage();page.on('pageerror',e=>fail('page',e));page.on('console',m=>{if(m.type()==='error')fail('console',m.text());});
    await page.goto(`http://localhost:${port}/app/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.__solidify,{timeout:60000});
    await page.evaluate(installQuant3WulffCalibrationDriver);result.metadata=await page.evaluate(()=>window.__q3wulffCalib.metadata());
    if(result.metadata.hardware?.isFallbackAdapter!==false)throw new Error('actual application hardware admission failed');
    for(const declared of translationArms()){
      const row={config:{...declared},measurements:[],controls:[],completed:false};result.cases.push(row);save();
      const baseline=result.cases.find(r=>r.config.epsilon===declared.epsilon&&r.config.centerOffset.every(v=>v===0));
      if(declared.centerOffset.some(v=>v!==0)){
        if(!baseline?.completed)throw new Error('translated arm requires its completed same-invocation baseline');
        row.config.targetVolume=baseline.setup.targetVolume;
      }
      const plan=translationClockPlan(declared);row.clockPlan=plan;
      try{
        row.setup=await page.evaluate(c=>window.__q3wulffCalib.stage(c),row.config);
        assert.equal(row.setup.params.dt,plan.dt);assert.equal(row.setup.params.tau,1);assert.equal(row.setup.params.frozenT,1);
        const initial=await page.evaluate(()=>window.__q3wulffCalib.measure());
        assert.ok(translationClockMatches(initial.clock,plan.samples[0],plan.dt));
        row.initialLiveness=translationInitialLiveness(declared,row.setup,initial,baseline?.measurements[0]);
        row.measurements.push(retain(`${declared.name}-000`,initial,row.config));
        if(!row.initialLiveness.passed)throw new Error('actual initial hash/centroid/volume/adapter liveness failed');
        if(declared.centerOffset.some(v=>v!==0)){
          const bad=await page.evaluate(()=>window.__q3wulffCalib.measure({omitRecentering:true}));
          const rejection=translationInitialLiveness(declared,row.setup,bad,baseline.measurements[0]);
          row.missingRecenteringControl={measurement:retain(`${declared.name}-missing-recentering`,bad,row.config),rejection,
            passed:!rejection.passed&&rejection.checks.adapter===false&&rejection.checks.centered===false
              &&bad.translation.phaseSha256===initial.translation.phaseSha256&&bad.clock.steps===0
              &&JSON.stringify(bad.translation.declaredOffset)===JSON.stringify(declared.centerOffset)};
          if(!row.missingRecenteringControl.passed)throw new Error('actual shared-adapter bypass control did not refuse');
        }
        let sampleIndex=1;
        for(const expected of plan.controls){
          const remaining=declared.maximumTime-(row.controls.at(-1)?.time??0);
          const control=await page.evaluate(t=>window.__q3wulffCalib.control(t),remaining);
          if(control.executedSteps!==expected.count||!translationClockMatches(control.clock,expected,plan.dt)
            ||control.time!==expected.time||control.quantitativeStatus?.flags!==0||control.quantitativeStatus?.issue)
            throw new Error('actual integer physics/control clock or GPU status failed');
          row.controls.push(control);
          if(expected.steps===plan.samples[sampleIndex]?.steps){
            const measured=await page.evaluate(()=>window.__q3wulffCalib.measure());
            if(!translationClockMatches(measured.clock,plan.samples[sampleIndex],plan.dt)||measured.measurementError)
              throw new Error('checkpoint clock or surface reconstruction failed');
            row.measurements.push(retain(`${declared.name}-${String(sampleIndex).padStart(3,'0')}`,measured,row.config));sampleIndex++;save();
            console.log('Q3-TRANSLATION-PROGRESS',JSON.stringify({arm:declared.name,time:measured.time,sample:sampleIndex-1}));
          }
        }
        assert.equal(row.measurements.length,plan.samples.length);assert.equal(row.controls.length,plan.controls.length);
        row.equilibrium=equilibriumState(row.measurements,row.setup.targetVolume);
        row.centroidStable=row.measurements.every(m=>m.translation?.centroidFrame?.every(v=>Number.isFinite(v)&&Math.abs(v)<=TRANSLATION_TOLERANCE.centroid)
          &&JSON.stringify(m.translation.appliedOffset)===JSON.stringify(declared.centerOffset));
        row.fieldEvolved=row.measurements.at(-1).translation.phaseSha256!==initial.translation.phaseSha256;
        row.completed=row.fieldEvolved&&row.initialLiveness.passed&&(!declared.centerOffset.some(v=>v!==0)||row.missingRecenteringControl.passed);
      }catch(error){row.error=error.stack??String(error);throw error;}
      finally{try{await page.evaluate(()=>window.__q3wulffCalib.destroy());}catch(error){row.completed=false;fail('arm cleanup',error);}save();}
      console.log('Q3-TRANSLATION-ARM',JSON.stringify({config:row.config,completed:row.completed,equilibrium:row.equilibrium,centroidStable:row.centroidStable}));
    }
    result.comparisons=[0,.0171].map(epsilon=>{const a=result.cases.find(c=>c.config.epsilon===epsilon&&c.config.centerOffset[0]===0).measurements.at(-1);
      const b=result.cases.find(c=>c.config.epsilon===epsilon&&c.config.centerOffset[0]===.4).measurements.at(-1);
      return {epsilon,epsilonEffectiveDifference:b.epsilon-a.epsilon,temperatureDifference:b.temperature-a.temperature,
        relativeD0Difference:b.d0Effective/a.d0Effective-1,relativeSupport100Difference:b.h100/a.h100-1,
        relativeSupport110Difference:b.h110/a.h110-1,note:'paired diagnostic differences, no new fitted coefficient or acceptance band'};});
  }catch(error){result.exception=error.stack??String(error);}
  finally{
    if(page){
      try{await page.evaluate(async()=>{if(!window.__q3wulffCalib)throw new Error('fixture unavailable');await window.__q3wulffCalib.dispose();});}catch(error){fail('fixture cleanup',error);}
      try{const ledger=await page.evaluate(()=>{const e=window.__q3wulffCalib?.errors();if(!Array.isArray(e))throw new Error('GPU ledger unavailable');return e;});
        if(!Array.isArray(ledger))throw new Error('GPU ledger not an array');result.errors.push(...ledger);result.deviceErrorLedgerRead=true;}catch(error){fail('GPU ledger',error);}
      try{await page.evaluate(()=>{const d=window.__solidify?.sim()?.device;if(!d)throw new Error('application device unavailable');d.destroy();});}catch(error){fail('application device cleanup',error);}
    }
    if(warm)try{await warm.evaluate(()=>{if(!window.__translationWarmDevice)throw new Error('warm device unavailable');window.__translationWarmDevice.destroy();});}catch(error){fail('warm device cleanup',error);}
    if(browser)try{await closeBrowser(browser);}catch(error){fail('browser cleanup',error);}
    try{result.finalHashes=hashes();result.sourceStable=JSON.stringify(result.sourceHashes)===JSON.stringify(result.finalHashes);
      if(!result.sourceStable)fail('source stability','source changed during diagnostic');}catch(error){fail('source stability',error);}
    Object.assign(result,translationVerdict(result));result.completed=result.executionCompleted;
    result.status=!result.completed?'four-arm execution evidence failed':result.diagnosticPassed
      ?'four-arm translation diagnostic complete':'four arms completed with equilibrium or centroid discrepancy';
    result.finished=new Date().toISOString();save();
  }
  console.log('Q3-TRANSLATION-FINAL',JSON.stringify({completed:result.completed,diagnosticPassed:result.diagnosticPassed,
    fullMatrixCompleted:false,q3Accepted:false,status:result.status,errors:result.errors,exception:result.exception}));
  process.exitCode=result.diagnosticPassed?0:1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pos=process.argv.slice(2).filter(a=>!a.startsWith('--')),out=resolve(pos[0]??'verify-out/q3-equilibrium-translation');
  const path=resolve(out,'translation-result.json');
  try{mkdirSync(out,{recursive:true});writeFileSync(path,JSON.stringify({completed:false,accepted:false,diagnosticPassed:false,
    fullMatrixCompleted:false,q3Accepted:false,status:'preflight pending'},null,2));await main(out);}
  catch(error){let result={};try{result=JSON.parse(readFileSync(path,'utf8'));}catch{}
    Object.assign(result,{completed:false,accepted:false,diagnosticPassed:false,fullMatrixCompleted:false,q3Accepted:false,
      status:'preflight or artifact failure',exception:error.stack??String(error),finished:new Date().toISOString()});
    try{writeFileSync(path,JSON.stringify(result,null,2));}catch(writeError){console.error(writeError.stack??String(writeError));}
    console.error(result.exception);process.exitCode=1;}
}
