// Explicit frozen research experiment. CPU controls are the default; --run is
// required to launch a browser. No needle or zero-speed acceptance follows.
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { closeBrowser } from "../browser-cleanup.mjs";
import { installQuant3LatticeKineticDriver } from "./quant3d-lattice-kinetic-driver.mjs";
import { kineticProfile, kineticLine } from "./quant3d-kinetic-profile.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const D=2.5068,DX=.8,EPSILON=.0171,LAMBDA=4;
const R=(47/75)*LAMBDA/D;
export const ANALYTIC_TAU_SCALE=R*(1-(1321/9870)*DX**2/(1+EPSILON)**2);
export const LATTICE_TOLERANCES=Object.freeze({
  relativeMeanVelocity:.01,phaseRms:.002,phaseMax:.01,
  temperatureRms:.0002,temperatureMax:.001,
  phaseWindow:12,temperatureWindow:24,negativeEarlyRelativeResponse:.03,
  lateCellPeriods:8,samplesPerPeriod:8,minimumThermalTimes:5,
});
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const sum=values=>values.reduce((a,b)=>a+b,0);
const finite=value=>typeof value==="number"&&Number.isFinite(value);

export function validateLatticeTarget(target,velocity){
  const c=target.config;
  assert.equal(target.format,"solidify-coupled-kinetic-target-v1");
  for(const [key,value] of Object.entries({velocity,normal:"100",physicalDx:DX,h:DX,lambda_:LAMBDA,epsilon:EPSILON,D}))
    assert.equal(c?.[key],value,`unexpected target ${key}`);
  assert.ok(Math.abs(c.tauScale-ANALYTIC_TAU_SCALE)<1e-13,"target tau must come only from the analytic formula");
  assert.ok(Math.abs(c.a-(1+EPSILON))<1e-13);
  const names=["x","phi","u","phiDerivative","uDerivative"],n=target.x?.length;
  assert.ok(Number.isSafeInteger(n)&&n>1000);
  for(const name of names)assert.ok(Array.isArray(target[name])&&target[name].length===n&&target[name].every(finite),`invalid ${name}`);
  const step=target.x[1]-target.x[0];assert.ok(step>0);
  for(let i=1;i<n;i++)assert.ok(Math.abs(target.x[i]-target.x[i-1]-step)<1e-10,"nonuniform target coordinates");
  assert.ok(target.phi[0]>.999&&target.phi.at(-1)<-.999);
  assert.ok(Math.abs(target.measurement.modalLatentJump-1)<1e-8,"free latent-jump control failed");
  assert.ok(Array.isArray(target.measurement.modalOuterFits)&&target.measurement.modalOuterFits.length>0);
  assert.ok(target.measurement.metrologyHeatRoots.every(root=>finite(root.real)&&finite(root.imaginary)));
  const bytes=Buffer.alloc(3*n*8);let offset=0;
  for(const name of ["x","phi","u"])for(const value of target[name]){bytes.writeDoubleLE(value,offset);offset+=8;}
  assert.equal(sha(bytes),target.rawFloat64Sha256,"target Float64 profile checksum mismatch");
  return {velocity,points:n,coordinateStep:step,tauScale:c.tauScale,rawFloat64Sha256:target.rawFloat64Sha256};
}

export function latticeArms(targets){
  const base=(name,velocity,extra={})=>{
    const config={name,targetKey:String(velocity),velocity,dims:[1536,8,8],dx:DX,dt:.016,offset:0,
      widthScale:1,temperatureKick:0,tauScale:targets[String(velocity)].config.tauScale,negativeControl:false,...extra};
    config.minimumDuration=LATTICE_TOLERANCES.minimumThermalTimes*D/velocity**2;
    config.uniformDt=Math.fround(config.dt);
    config.terminalSteps=Math.ceil(config.minimumDuration/config.uniformDt);
    config.terminalTime=config.terminalSteps*config.uniformDt;
    config.cellPeriod=DX/velocity;
    const lateSpan=LATTICE_TOLERANCES.lateCellPeriods*config.cellPeriod;
    config.lateStartSteps=Math.floor((config.terminalTime-lateSpan)/config.uniformDt);
    const late=Array.from({length:65},(_,i)=>Math.round(config.lateStartSteps+(config.terminalSteps-config.lateStartSteps)*i/64));
    config.sampleSteps=[...new Set([8,...[.25,.5,.75,.9].map(f=>Math.round(config.terminalSteps*f)),...late])].sort((a,b)=>a-b);
    return config;
  };
  return [base("v-0.1",.1),base("v-0.125",.125),base("v-0.15",.15),
    base("v-0.125-width-1.1",.125,{widthScale:1.1}),
    base("v-0.125-temperature-kick",.125,{temperatureKick:.002}),
    base("v-0.125-dt-0.008",.125,{dt:.008}),
    base("v-0.125-wrong-tau",.125,{tauScale:1,negativeControl:true})];
}

export function freeInterceptVelocity(samples){
  assert.ok(samples.length>=3,"three late samples required");
  const mt=sum(samples.map(s=>s.time))/samples.length,mx=sum(samples.map(s=>s.massPosition))/samples.length;
  const denominator=sum(samples.map(s=>(s.time-mt)**2));assert.ok(denominator>0);
  const velocity=sum(samples.map(s=>(s.time-mt)*(s.massPosition-mx)))/denominator;
  const intercept=mx-velocity*mt;
  const residuals=samples.map(s=>s.massPosition-intercept-velocity*s.time);
  return {velocity,intercept,points:samples.length,startTime:samples[0].time,endTime:samples.at(-1).time,
    displacement:samples.at(-1).massPosition-samples[0].massPosition,
    residualRms:Math.sqrt(sum(residuals.map(v=>v*v))/residuals.length),
    residualMax:Math.max(...residuals.map(Math.abs)),
    note:"free intercept permits a neutral translation; residuals are not independent statistical errors"};
}

export function analyzeLatticeSample(target,config,sample,initial){
  assert.equal(sample.psi.length,config.dims[0]);assert.equal(sample.T.length,config.dims[0]);
  assert.ok(sample.psi.every(finite)&&sample.T.every(finite),"nonfinite sampled field");
  const baseline=kineticLine(target,config),dx=config.dx,n=config.dims[0];
  const massPosition=(sum(sample.psi)-sum(baseline.psi))*dx;
  const phasePoints=[],temperaturePoints=[];
  for(let i=0;i<n;i++){
    const x=(i+.5-n/2)*dx-(config.offset??0);
    if(Math.abs(x-massPosition)<=LATTICE_TOLERANCES.phaseWindow)phasePoints.push({i,x});
    if(Math.abs(x-massPosition)<=LATTICE_TOLERANCES.temperatureWindow)temperaturePoints.push({i,x});
  }
  assert.ok(phasePoints.length>=20&&temperaturePoints.length>=40,"resolved wave windows required");
  const phaseLoss=shift=>sum(phasePoints.map(({i,x})=>(sample.psi[i]-kineticProfile(target,x-shift).psi)**2))/phasePoints.length;
  // Mass determines a physical alignment neighborhood; a bounded local phase
  // registration removes the neutral translation without fitting speed or tau.
  let left=massPosition-dx,right=massPosition+dx;
  const ratio=(Math.sqrt(5)-1)/2;
  let a=right-ratio*(right-left),b=left+ratio*(right-left),fa=phaseLoss(a),fb=phaseLoss(b);
  for(let i=0;i<48;i++){
    if(fa<fb){right=b;b=a;fb=fa;a=right-ratio*(right-left);fa=phaseLoss(a);}
    else{left=a;a=b;fa=fb;b=left+ratio*(right-left);fb=phaseLoss(b);}
  }
  const alignedShift=(left+right)/2;
  const p=phasePoints.map(({i,x})=>sample.psi[i]-kineticProfile(target,x-alignedShift).psi);
  const t=temperaturePoints.map(({i,x})=>sample.T[i]-kineticProfile(target,x-alignedShift).T);
  const rms=values=>Math.sqrt(sum(values.map(v=>v*v))/values.length);
  return {steps:sample.steps,time:sample.time,declaredTime:sample.declaredTime,uniformDt:sample.uniformDt,
    massPosition,massDisplacement:(sum(sample.psi)-sum(initial.psi))*dx,alignedShift,
    phaseRegistrationMinusMass:alignedShift-massPosition,
    alignedWave:{phaseRms:rms(p),phaseMax:Math.max(...p.map(Math.abs)),temperatureRms:rms(t),temperatureMax:Math.max(...t.map(Math.abs)),
      phasePoints:phasePoints.length,temperaturePoints:temperaturePoints.length,
      frame:"observed mass phase with a bounded local phase registration; no prescribed V*t position"},
    energyChange:(sum(sample.T)-sum(sample.psi)-sum(initial.T)+sum(initial.psi))*dx};
}

export function initialPerturbationLiveness(config,metrics){
  const initialPhaseMax=metrics.alignedWave.phaseMax,initialTemperatureMax=metrics.alignedWave.temperatureMax;
  const widthApplied=config.widthScale===1||initialPhaseMax>LATTICE_TOLERANCES.phaseMax;
  const temperatureKickApplied=config.temperatureKick===0||initialTemperatureMax>LATTICE_TOLERANCES.temperatureMax;
  return {widthApplied,temperatureKickApplied,initialPhaseMax,initialTemperatureMax,
    passed:widthApplied&&temperatureKickApplied,
    note:"declared perturbations must exceed their late acceptance maxima in actual initial GPU fields"};
}

function uniformPlaneStateHash(sample,dims){
  const line=Buffer.alloc(dims[0]*8);
  for(let i=0;i<dims[0];i++){line.writeFloatLE(sample.psi[i],8*i);line.writeFloatLE(sample.T[i],8*i+4);}
  const hash=createHash("sha256");for(let i=0;i<dims[1]*dims[2];i++)hash.update(line);
  return hash.digest("hex");
}

export function assessLatticeArm(row){
  const c=row.config,late=row.samples.filter(s=>s.steps>=c.lateStartSteps),fit=freeInterceptVelocity(late);
  const maxima=Object.fromEntries(["phaseRms","phaseMax","temperatureRms","temperatureMax"].map(key=>[key,Math.max(...late.map(s=>s.alignedWave[key]))]));
  const relativeVelocityError=fit.velocity/c.velocity-1;
  const early=row.samples.find(s=>s.steps===8);
  const earlyRelativeResponse=early.massDisplacement/(early.time*c.velocity)-1;
  const targetClauses={velocity:Math.abs(relativeVelocityError)<=LATTICE_TOLERANCES.relativeMeanVelocity,
    ...Object.fromEntries(Object.keys(maxima).map(key=>[key,maxima[key]<=LATTICE_TOLERANCES[key]]))};
  const exactDeclaredSamples=row.samples.length===c.sampleSteps.length&&row.samples.every((s,i)=>s.steps===c.sampleSteps[i]);
  const backendValid=exactDeclaredSamples&&row.perturbationLiveness?.passed===true&&row.readbackHashVerified===true
    &&row.census.nonFinite===0&&row.census.outOfRange===0&&row.census.transverseError===0
    &&row.samples.at(-1).steps===c.terminalSteps&&row.samples.at(-1).time>=c.minimumDuration&&fit.velocity>0
    &&row.samples.every(s=>s.time===s.steps*Math.fround(c.dt)&&s.uniformDt===Math.fround(c.dt)&&s.declaredTime===s.steps*c.dt);
  const targetMatched=Object.values(targetClauses).every(Boolean);
  const earlyResponseRejected=Math.abs(earlyRelativeResponse)>LATTICE_TOLERANCES.negativeEarlyRelativeResponse;
  return {backendValid,exactDeclaredSamples,targetMatched,targetClauses,fit,relativeVelocityError,lateMaxima:maxima,earlyRelativeResponse,
    lateSpanCellPeriods:(late.at(-1).time-late[0].time)/c.cellPeriod,
    expectedOutcome:c.negativeControl?"valid dynamics detect initial mobility mismatch; late recovery assessed separately":"recover corrected target",
    lateTargetRejected:!targetMatched,earlyResponseRejected,
    targetRejectedByActualResponse:!targetMatched||earlyResponseRejected};
}

export function latticeFinalAcceptance(result){
  const positive=result.arms.filter(row=>!row.config.negativeControl),negative=result.arms.find(row=>row.config.negativeControl);
  const base=positive.find(row=>row.config.name==="v-0.125");
  const earlyContrast=negative?.assessment&&base?.assessment
    ?Math.abs(negative.assessment.earlyRelativeResponse-base.assessment.earlyRelativeResponse):null;
  const negativeControlValid=negative?.assessment?.backendValid===true&&negative.assessment.targetRejectedByActualResponse
    &&earlyContrast>=LATTICE_TOLERANCES.negativeEarlyRelativeResponse;
  const negativeLateTargetRejected=negative?.assessment?.targetMatched===false;
  const negativeEarlyOnly=!!negativeControlValid&&!negativeLateTargetRejected;
  const accepted=!result.exception&&result.errors.length===0&&result.deviceErrorLedgerRead===true
    &&result.sourceStable===true&&result.inputsStable===true&&result.nativeEquivalent===true
    &&(!result.contract?.experimentalLatticeKinetics||result.candidateSafety?.passed===true)
    &&positive.length===6&&positive.every(row=>row.completed&&row.assessment?.backendValid&&row.assessment.targetMatched)
    &&negative?.completed===true&&negativeControlValid;
  return {accepted,positiveArms:positive.length,positiveMatched:positive.filter(row=>row.assessment?.targetMatched).length,
    negativeControlValid,earlyContrast,negativeLateTargetRejected,negativeEarlyOnly,
    negativeRejectionBasis:!negativeControlValid?"control not established":negativeEarlyOnly
      ?"early mobility response rejected; late target recovery matched"
      :"late target response rejected; early mobility contrast also measured",
    scope:"fixed finite-speed [100] production-WGSL recovery only; no zero-speed, all-angle, needle or Q3 acceptance"};
}

export function selfTestLattice(targets){
  const target=targets["0.125"],config=latticeArms(targets).find(c=>c.name==="v-0.125"),initial=kineticLine(target,config);
  const synthetic=(time,shift)=>({...kineticLine(target,{...config,offset:shift},0),time,steps:Math.round(time/config.uniformDt),uniformDt:config.uniformDt,declaredTime:time});
  const positive=analyzeLatticeSample(target,config,synthetic(100,12.5+.37),initial);
  assert.ok(positive.alignedWave.phaseRms<1e-9&&positive.alignedWave.temperatureRms<1e-8,"neutral translation was not removed");
  const fit=freeInterceptVelocity([0,100,200].map(time=>({time,massPosition:.37+.125*time})));
  assert.ok(Math.abs(fit.velocity-.125)<1e-12&&Math.abs(fit.intercept-.37)<1e-12);
  const speedControl=freeInterceptVelocity([0,100,200].map(time=>({time,massPosition:.37+.13*time})));
  assert.ok(Math.abs(speedControl.velocity/.125-1)>LATTICE_TOLERANCES.relativeMeanVelocity);
  const bad=synthetic(100,12.5+.37),index=bad.psi.findIndex(v=>v<.5);bad.psi[index]+=.05;
  const perturbed=analyzeLatticeSample(target,config,bad,initial);
  assert.ok(perturbed.alignedWave.phaseMax>LATTICE_TOLERANCES.phaseMax,"shape control was aligned away");
  const arms=latticeArms(targets);
  assert.equal(arms.length,7);assert.ok(arms.every(c=>c.terminalTime>=5*D/c.velocity**2));
  assert.equal(arms.find(c=>c.negativeControl).tauScale,1);
  assert.equal(latticeFinalAcceptance({arms:[],errors:[],deviceErrorLedgerRead:true,sourceStable:true,inputsStable:true,nativeEquivalent:true}).accepted,false);
  const manufactured=arms.map(c=>({config:c,completed:true,assessment:{backendValid:true,targetMatched:!c.negativeControl,
    earlyRelativeResponse:c.negativeControl?-.08:0,targetRejectedByActualResponse:c.negativeControl}}));
  const plumbing={arms:manufactured,errors:[],deviceErrorLedgerRead:true,sourceStable:true,inputsStable:true,nativeEquivalent:true};
  assert.equal(latticeFinalAcceptance(plumbing).accepted,true);
  for(const key of ["deviceErrorLedgerRead","sourceStable","inputsStable","nativeEquivalent"])
    assert.equal(latticeFinalAcceptance({...plumbing,[key]:false}).accepted,false,`${key} failure did not refuse`);
  assert.equal(latticeFinalAcceptance({...plumbing,errors:["manufactured late cleanup error"]}).accepted,false);
  assert.equal(latticeFinalAcceptance({...plumbing,exception:"manufactured launch failure"}).accepted,false);
  const wrongWithoutResponse=manufactured.map(row=>row.config.negativeControl?{...row,assessment:{...row.assessment,
    earlyRelativeResponse:0,targetRejectedByActualResponse:false}}:row);
  assert.equal(latticeFinalAcceptance({...plumbing,arms:wrongWithoutResponse}).accepted,false,"parameter-label-only negative control was accepted");
  const initialSample={...initial,time:0,steps:0,declaredTime:0,uniformDt:config.uniformDt};
  const broad={...initialSample,psi:initial.psi.map((_,i)=>kineticProfile(target,(i+.5-config.dims[0]/2)*config.dx/1.1).psi)};
  const heated={...initialSample,T:initial.T.map((value,i)=>value+.002*Math.exp(-.5*((i+.5-config.dims[0]/2)*config.dx/4)**2))};
  const broadMetrics=analyzeLatticeSample(target,config,broad,initial),heatedMetrics=analyzeLatticeSample(target,config,heated,initial);
  assert.equal(initialPerturbationLiveness({...config,widthScale:1.1},broadMetrics).passed,true);
  assert.equal(initialPerturbationLiveness({...config,temperatureKick:.002},heatedMetrics).passed,true);
  const plainMetrics=analyzeLatticeSample(target,config,initialSample,initial);
  assert.equal(initialPerturbationLiveness({...config,widthScale:1.1},plainMetrics).passed,false);
  assert.equal(initialPerturbationLiveness({...config,temperatureKick:.002},plainMetrics).passed,false);
  const syntheticRow={config,perturbationLiveness:{passed:true},readbackHashVerified:true,
    census:{nonFinite:0,outOfRange:0,transverseError:0},samples:config.sampleSteps.map(steps=>({steps,time:steps*config.uniformDt,
      declaredTime:steps*config.dt,uniformDt:config.uniformDt,massPosition:.125*steps*config.uniformDt,
      massDisplacement:.125*steps*config.uniformDt,alignedWave:{phaseRms:0,phaseMax:0,temperatureRms:0,temperatureMax:0}}))};
  assert.equal(assessLatticeArm(syntheticRow).backendValid,true);
  assert.equal(assessLatticeArm({...syntheticRow,samples:syntheticRow.samples.filter((_,i)=>i!==1)}).backendValid,false,"missing declared sample was accepted");
  return {neutralTranslationPhaseRms:positive.alignedWave.phaseRms,neutralTranslationTemperatureRms:positive.alignedWave.temperatureRms,
    freeInterceptFit:fit,speedControl:speedControl.velocity,shapeControlMax:perturbed.alignedWave.phaseMax,
    arms:arms.length,allThermalDurationsValid:true,finalEvidenceFailureControls:7,parameterLabelOnlyControlRefused:true,
    initialWidthPhaseMax:broadMetrics.alignedWave.phaseMax,initialKickTemperatureMax:heatedMetrics.alignedWave.temperatureMax,
    missingPerturbationsRefused:true,missingDeclaredSampleRefused:true};
}

async function main(){
  const args=process.argv.slice(2),pos=[],options={};
  for(const arg of args){
    if(arg==="--run"||arg==="--self-test"||arg==="--lattice-kinetics")options[arg.slice(2)]=true;
    else if(arg.startsWith("--targets="))options.targets=arg.slice(10);
    else if(arg.startsWith("--"))throw new Error(`unknown option ${arg}`);
    else pos.push(arg);
  }
  if(!options.targets)throw new Error("explicit --targets=<target-manifest.json> is required; CPU self-test is default, --run starts WebGPU");
  if(pos.length>2)throw new Error("usage: node scripts/research/quant3d-lattice-kinetic-gpu.mjs <out> <port> --targets=<manifest> [--run|--self-test]");
  const out=resolve(pos[0]??"verify-out/q3-lattice-kinetic"),port=pos[1]??"5199",manifestPath=resolve(options.targets);
  mkdirSync(out,{recursive:true});mkdirSync(resolve(out,"samples"),{recursive:true});mkdirSync(resolve(out,"inputs"),{recursive:true});
  const inputPaths=[manifestPath],manifestBytes=readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
  assert.equal(manifest.format,"solidify-lattice-kinetic-target-manifest-v1");assert.equal(manifest.complete,true);
  const targets={},targetChecks={};
  for(const velocity of [.1,.125,.15]){
    const key=String(velocity),entry=manifest.targets[key];assert.ok(entry&&typeof entry.path==="string");
    assert.ok(/^[-\w.]+\.json$/.test(entry.path),"manifest targets must be adjacent portable JSON files");
    const path=resolve(dirname(manifestPath),entry.path),bytes=readFileSync(path);
    assert.equal(sha(bytes),entry.sha256,`input hash mismatch ${key}`);inputPaths.push(path);
    targets[key]=JSON.parse(bytes);targetChecks[key]=validateLatticeTarget(targets[key],velocity);
    writeFileSync(resolve(out,"inputs",entry.path),bytes);
  }
  writeFileSync(resolve(out,"inputs","target-manifest.json"),manifestBytes);
  for(const [path,checksum] of Object.entries(manifest.sourceHashes??{}))assert.equal(sha(readFileSync(resolve(ROOT,path))),checksum,`CPU input source changed: ${path}`);
  const arms=latticeArms(targets),cpu=selfTestLattice(targets);
  const latticeKinetics=options["lattice-kinetics"]===true;
  if(latticeKinetics)for(const arm of arms)arm.tauScale=arm.negativeControl?1/ANALYTIC_TAU_SCALE:1;
  const contract={format:"solidify-lattice-kinetic-contract-v1",purpose:"frozen analytic-only finite-speed production-WGSL recovery experiment",
    physical:{normal:"100",lambda:LAMBDA,epsilon:EPSILON,dx:DX,D,analyticTauScale:ANALYTIC_TAU_SCALE,
      formula:"tauScale=(47/75)*lambda/D*[1-(1321/9870)*dx_physical^2/a100^2]",noise:0,externalProgram:0,alloy:0},
    tolerances:LATTICE_TOLERANCES,arms,experimentalLatticeKinetics:latticeKinetics,
    perturbations:{phaseWidth:"psi target evaluated at x/1.1; temperature unchanged",temperature:"add .002*exp[-x^2/(2*4^2)] to Ttilde only"},
    clock:"exact substeps times Float32 uniform dt; terminal rounded upward beyond 5D/V^2",
    metrology:"late free-intercept mass-position regression; observed-position aligned phase/T windows; all raw profiles retained",
    negativeControl:`same corrected target, ${latticeKinetics?"P.tau=1/analyticTauScale cancels the candidate for [100]":"P.tau=1 is the uncorrected model"}; require valid backend, actual target rejection and >=3% initial-response contrast to corrected .125 arm`,
    nativePrecondition:"nine exact production/specialized state/grain/age hashes at steps1/17/64 and nonzero state evolution",
    sourceScope:latticeKinetics?"explicit opt-in additive local-tau research candidate; P.tau=1 positive arms; unchanged default and alloy models"
      :"unchanged default production WGSL; rectangular integer geometry only; declared uniform tau input",
    limitations:"formal principal-plane leading correction; coarse-grid pinning, all-angle kinetics and Q3 needle acceptance remain unproved"};
  const contractBytes=Buffer.from(JSON.stringify({contract,targetChecks,cpu},null,2));
  writeFileSync(resolve(out,"lattice-kinetic-contract.json"),contractBytes);
  console.log("QPF3-LATTICE-CPU OK",JSON.stringify(cpu));
  if(!options.run||options["self-test"]){
    writeFileSync(resolve(out,"lattice-kinetic-result.json"),JSON.stringify({contract,cpu,targetChecks,
      contractSha256:sha(contractBytes),completed:true,accepted:false,cpuOnly:true,
      status:"CPU input and metrology controls complete; GPU experiment not run",errors:[],finished:new Date().toISOString()},null,2));
    console.log("REFROZEN CPU ONLY",sha(contractBytes));return;
  }

  const paths=["src/sim3d.ts","src/shaders3d.ts","src/shaders3d-quant.ts","src/quant.ts",
    "scripts/fixtures/rect3d-specialize.mjs","scripts/browser-cleanup.mjs",
    ...["driver.mjs","gpu.mjs","targets.py","md"].map(name=>name==="md"?"scripts/research/quant3d-lattice-kinetic.md":`scripts/research/quant3d-lattice-kinetic-${name}`),
    "scripts/research/quant3d-kinetic-profile.mjs","scripts/research/quant3d-kinetic-reference.py"];
  const hashes=()=>Object.fromEntries(paths.map(path=>[path,sha(readFileSync(resolve(ROOT,path)))]));
  const inputHashes=()=>Object.fromEntries(inputPaths.map(path=>[path,sha(readFileSync(path))]));
  const result={contract,contractSha256:sha(contractBytes),source:execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim(),
    sourceHashes:hashes(),inputHashes:inputHashes(),started:new Date().toISOString(),arms:[],errors:[],completed:false,accepted:false,
    deviceErrorLedgerRead:false,nativeEquivalent:false,sourceStable:false,inputsStable:false,status:"running; final evidence pending"};
  const save=()=>writeFileSync(resolve(out,"lattice-kinetic-result.json"),JSON.stringify(result,null,2));
  const saveRaw=(name,sample)=>{
    const path=`samples/${name}-${String(sample.steps).padStart(7,"0")}.json.gz`,bytes=gzipSync(Buffer.from(JSON.stringify(sample)));
    writeFileSync(resolve(out,path),bytes);return {path,sha256:sha(bytes)};
  };
  save();let browser,page,warm;
  const evidenceError=(label,error)=>result.errors.push({kind:label,message:error?.message??String(error)});
  try{
    const extra=process.env.CHROME_ARGS?JSON.parse(process.env.CHROME_ARGS):[];
    if(!Array.isArray(extra)||extra.some(arg=>typeof arg!=="string"))throw new Error("CHROME_ARGS must be a JSON string array");
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless:true,protocolTimeout:3_600_000,args:["--enable-unsafe-webgpu","--enable-gpu",...extra]});
    warm=await browser.newPage();await warm.setRequestInterception(true);
    warm.once("request",request=>request.respond({status:200,contentType:"text/html",body:'<!doctype html><link rel="icon" href="data:,"><title>Lattice GPU admission</title>'}));
    await warm.goto(`http://localhost:${port}/__lattice_gpu_admission__`,{waitUntil:"domcontentloaded"});await warm.setRequestInterception(false);
    await warm.waitForFunction(async()=>{try{const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
      if(!adapter||adapter.info.isFallbackAdapter!==false)return false;
      window.__latticeWarmDevice=await adapter.requestDevice();return true;}catch{return false;}
    },{polling:500,timeout:60_000});
    page=await browser.newPage();page.on("pageerror",error=>evidenceError("page",error));
    page.on("console",message=>{if(message.type()==="error")evidenceError("console",message.text());});
    await page.goto(`http://localhost:${port}/app/`,{waitUntil:"networkidle0"});
    await page.waitForFunction(()=>!!window.__solidify,{timeout:60_000});
    await page.evaluate(installQuant3LatticeKineticDriver,targets,{latticeKinetics});
    result.metadata=await page.evaluate(()=>window.__q3lattice.metadata());
    if(result.metadata.hardware.isFallbackAdapter!==false)throw new Error("actual application hardware adapter was not admitted");
    result.equivalence=await page.evaluate(()=>window.__q3lattice.equivalence());
    const pairs=result.equivalence.comparisons;
    result.nativeEquivalent=pairs.length===9&&pairs.every(pair=>pair.mismatches===0&&pair.productionHash===pair.specializedHash)
      &&result.equivalence.stateByteChanges>0;
    if(!result.nativeEquivalent)throw new Error("native production hash equivalence or evolution failed");
    if(latticeKinetics){result.candidateSafety=await page.evaluate(()=>window.__q3lattice.safety());
      if(!result.candidateSafety.passed)throw new Error("candidate safety controls failed");}
    console.log("QPF3-LATTICE-NATIVE OK",JSON.stringify({pairs:pairs.length,stateByteChanges:result.equivalence.stateByteChanges}));save();
    for(const config of arms){
      const row={config,samples:[],completed:false};result.arms.push(row);save();
      try{
        row.setup=await page.evaluate(c=>window.__q3lattice.stage(c),config);
        const initial=await page.evaluate(()=>window.__q3lattice.sample());row.initialRaw=saveRaw(config.name,initial);
        row.initialMetrics=analyzeLatticeSample(targets[config.targetKey],config,initial,initial);
        row.perturbationLiveness=initialPerturbationLiveness(config,row.initialMetrics);
        if(!row.perturbationLiveness.passed)throw new Error("actual initial GPU fields did not contain the declared perturbation");
        let previous=0,lastSample;
        for(const steps of config.sampleSteps){
          const advance=await page.evaluate(count=>window.__q3lattice.advance(count),steps-previous);previous=steps;
          if(advance.steps!==steps||advance.minTauFactor!==1)throw new Error("short physics budget or invalid pure-interface factor");
          const sample=await page.evaluate(()=>window.__q3lattice.sample());
          lastSample=sample;
          if(sample.steps!==steps||sample.time!==steps*Math.fround(config.dt))throw new Error("actual readback clock does not match exact uniform steps");
          row.samples.push({...analyzeLatticeSample(targets[config.targetKey],config,sample,initial),advance,raw:saveRaw(config.name,sample)});save();
          if(steps<config.lateStartSteps||steps===config.terminalSteps)console.log("QPF3-LATTICE-PROGRESS",JSON.stringify({arm:config.name,steps,time:sample.time,terminalSteps:config.terminalSteps}));
        }
        row.census=await page.evaluate(()=>window.__q3lattice.census());
        const reconstructedStateSha256=uniformPlaneStateHash(lastSample,config.dims);
        row.readbackHashVerified=reconstructedStateSha256===row.census.stateSha256&&row.census.steps===lastSample.steps&&row.census.time===lastSample.time;
        row.readbackVerification={reconstructedStateSha256,fullGPUStateSha256:row.census.stateSha256,verified:row.readbackHashVerified,
          note:"final raw line reproduces every byte of the independently read full planar state"};
        row.assessment=assessLatticeArm(row);row.completed=row.assessment.backendValid;
        if(!row.completed)throw new Error("terminal clock, field census, symmetry or physical liveness failed");
        console.log("QPF3-LATTICE-ARM",JSON.stringify({name:config.name,assessment:row.assessment}));
      }catch(error){row.error=error.stack??String(error);throw error;}
      finally{await page.evaluate(()=>window.__q3lattice.destroy());save();}
    }
    const a=result.arms.find(row=>row.config.name==="v-0.125"),b=result.arms.find(row=>row.config.name==="v-0.125-dt-0.008");
    result.dtComparison={relativeVelocityChange:b.assessment.fit.velocity/a.assessment.fit.velocity-1,
      phaseRmsChange:b.assessment.lateMaxima.phaseRms-a.assessment.lateMaxima.phaseRms,
      temperatureRmsChange:b.assessment.lateMaxima.temperatureRms-a.assessment.lateMaxima.temperatureRms,
      note:"both steps must meet the same frozen target clauses; no favorable-step selection"};
  }catch(error){result.exception=error.stack??String(error);}
  finally{
    if(page){
      try{await page.evaluate(async()=>{if(!window.__q3lattice)throw new Error("lattice fixture is unavailable");await window.__q3lattice.dispose();});}
      catch(error){evidenceError("fixture cleanup failed",error);}
      try{
        const errors=await page.evaluate(()=>{if(!window.__q3lattice)throw new Error("GPU error ledger is unavailable");const e=window.__q3lattice.errors();
          if(!Array.isArray(e))throw new Error("GPU error ledger is unavailable");return e;});
        if(!Array.isArray(errors))throw new Error("GPU error ledger did not return an array");
        result.errors.push(...errors);result.deviceErrorLedgerRead=true;
      }catch(error){evidenceError("GPU error ledger read failed",error);}
      try{await page.evaluate(()=>{const device=window.__solidify?.sim()?.device;if(!device)throw new Error("application GPU device is unavailable");device.destroy();});}
      catch(error){evidenceError("application device cleanup failed",error);}
    }
    if(warm)try{await warm.evaluate(()=>{if(!window.__latticeWarmDevice)throw new Error("warm GPU device is unavailable");window.__latticeWarmDevice.destroy();});}
    catch(error){evidenceError("warm device cleanup failed",error);}
    if(browser)try{await closeBrowser(browser);}catch(error){evidenceError("browser cleanup failed",error);}
    try{result.finalHashes=hashes();result.sourceStable=JSON.stringify(result.sourceHashes)===JSON.stringify(result.finalHashes);
      if(!result.sourceStable)evidenceError("source verification","benchmark source changed during execution");}
    catch(error){evidenceError("final source verification failed",error);}
    try{result.finalInputHashes=inputHashes();result.inputsStable=JSON.stringify(result.inputHashes)===JSON.stringify(result.finalInputHashes);
      if(!result.inputsStable)evidenceError("input verification","frozen target input changed during execution");}
    catch(error){evidenceError("final input verification failed",error);}
    result.completed=!result.exception&&result.errors.length===0&&result.deviceErrorLedgerRead&&result.sourceStable&&result.inputsStable
      &&result.nativeEquivalent&&result.arms.length===7&&result.arms.every(row=>row.completed);
    result.overall=latticeFinalAcceptance(result);result.accepted=result.overall.accepted;
    result.status=!result.completed?"execution evidence failed":result.accepted?"fixed finite-speed recovery protocol passed":"completed with scientific discrepancy";
    result.finished=new Date().toISOString();save();
  }
  console.log("QPF3-LATTICE",result.accepted?"PASSED":"REFUSED",JSON.stringify({completed:result.completed,accepted:result.accepted,
    status:result.status,errors:result.errors,exception:result.exception,overall:result.overall}));
  process.exitCode=result.accepted?0:1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // Replace any previous verdict before option/manifest/source/profile checks.
  // A refused retry and a CPU-only invocation must never leave accepted:true.
  const positional=process.argv.slice(2).filter(arg=>!arg.startsWith("--"));
  const out=resolve(positional[0]??"verify-out/q3-lattice-kinetic"),path=resolve(out,"lattice-kinetic-result.json");
  try{
    mkdirSync(out,{recursive:true});
    writeFileSync(path,JSON.stringify({completed:false,accepted:false,status:"preflight pending",errors:[],started:new Date().toISOString()},null,2));
    await main();
  }catch(error){
    let result={};try{result=JSON.parse(readFileSync(path,"utf8"));}catch{}
    Object.assign(result,{completed:false,accepted:false,status:"preflight or artifact failure",
      exception:error.stack??String(error),finished:new Date().toISOString()});
    try{writeFileSync(path,JSON.stringify(result,null,2));}catch(writeError){console.error(writeError.stack??String(writeError));}
    console.error(result.exception);process.exitCode=1;
  }
}
