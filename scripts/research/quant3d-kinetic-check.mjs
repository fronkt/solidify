// Explicit research study; CPU self-test by default. --run starts WebGPU.
// No zero-speed beta or literature-needle acceptance follows from this run.
import puppeteer from "puppeteer-core";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {gzipSync} from "node:zlib";
import {closeBrowser} from "../browser-cleanup.mjs";
import {installQuant3KineticDriver} from "./quant3d-kinetic-driver.mjs";
import {analyzeKinetic,selfTestKinetic} from "./quant3d-kinetic-profile.mjs";

const args=process.argv.slice(2),pos=args.filter(arg=>!arg.startsWith("--"));
if(args.some(arg=>arg.startsWith("--")&&!['--run','--self-test'].includes(arg)))throw new Error("unknown kinetic option");
const OUT=resolve(pos[0]??"verify-out/quant3d-kinetic"),PORT=pos[1]??"5199";
const targetPath=new URL("./quant3d-kinetic-target.json",import.meta.url);
const target=JSON.parse(readFileSync(targetPath,"utf8")),cpu=selfTestKinetic(target);
const arms=[...target.proposal.dt.flatMap(dt=>target.proposal.cellOffsets.map(offset=>({name:`dt-${dt}-phase-${offset}`,
  dims:[1536,8,8],dx:.8,dt,offset}))),...target.proposal.dt.map(dt=>({name:`domain-dt-${dt}`,dims:[2048,8,8],dx:.8,dt,offset:0}))];
const contract={purpose:"finite-speed coupled production-WGSL cross-check against independent CPU profile",
  physical:{normal:"100",lambda:4,epsilon:.0171,tau:1,D:2.5068,noise:0,externalProgram:0,frozenT:0,alloy:0},
  duration:160,cellPeriods:8,expectedMeanVelocity:.04,arms,
  shaderScope:"FLUX3D_WGSL,phi3dWgsl(false),transport3dWgsl(false); unchanged equations, rect3dSpecialize integer geometry only",
  precondition:"9 native cube byte/hash pairs at1/17/64 steps plus nonzero state evolution before any long domain",
  clock:"physical time = exact step count * Float32 uniform dt; nominal declared time reported separately",
  comparison:"record mean mass advance and independent-frame phase/T residuals; separate modal bulk temperatures; raw profiles retained",
  verdict:"hard failures cover device errors, native-cube mismatch, nonfinite/unbounded fields, loss of plane symmetry or absent motion. Scientific discrepancies are reported without an invented pass band; no zero-beta inference."};
mkdirSync(OUT,{recursive:true});mkdirSync(resolve(OUT,"samples"),{recursive:true});
writeFileSync(resolve(OUT,"kinetic-contract.json"),JSON.stringify({contract,cpu},null,2));
console.log("QPF3-KINETIC-CPU OK",JSON.stringify({velocity:cpu.positive.meanVelocity,knotError:cpu.knotError,negative:cpu.perturbationDetected}));
if(!args.includes("--run")||args.includes("--self-test")){console.log("CPU only; use --run for the explicit GPU study");process.exit(0);}

const paths=["src/sim3d.ts","src/shaders3d.ts","src/shaders3d-quant.ts","src/quant.ts",
  "scripts/fixtures/rect3d-specialize.mjs","scripts/browser-cleanup.mjs",
  ...["driver.mjs","check.mjs","profile.mjs","target.json","reference.py","cpu.py"].map(name=>`scripts/research/quant3d-kinetic-${name}`)];
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const hashes=()=>Object.fromEntries(paths.map(path=>[path,sha(readFileSync(path))]));
const result={contract,source:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  sourceHashes:hashes(),targetSha256:sha(readFileSync(targetPath)),started:new Date().toISOString(),
  arms:[],errors:[],completed:false,scientificVerdict:"not assigned; finite-speed discrepancies recorded for independent review"};
const save=()=>writeFileSync(resolve(OUT,"kinetic-result.json"),JSON.stringify(result,null,2));
const saveRaw=(name,sample)=>{
  const path=`samples/${name}-${String(sample.steps).padStart(6,"0")}.json.gz`,bytes=gzipSync(Buffer.from(JSON.stringify(sample)));
  writeFileSync(resolve(OUT,path),bytes);return {path,sha256:sha(bytes)};
};
save();
const extra=process.env.CHROME_ARGS?JSON.parse(process.env.CHROME_ARGS):[];
if(!Array.isArray(extra)||extra.some(arg=>typeof arg!=="string"))throw new Error("CHROME_ARGS must be a JSON string array");
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless:true,protocolTimeout:3_600_000,args:["--enable-unsafe-webgpu","--enable-gpu",...extra]});
let page;
try{
  const warm=await browser.newPage();await warm.setRequestInterception(true);
  warm.once("request",request=>request.respond({status:200,contentType:"text/html",body:'<!doctype html><link rel="icon" href="data:,"><title>GPU admission</title>'}));
  await warm.goto(`http://localhost:${PORT}/__kinetic_gpu_admission__`,{waitUntil:"domcontentloaded"});await warm.setRequestInterception(false);
  await warm.waitForFunction(async()=>{try{const a=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
    if(!a||a.info.isFallbackAdapter!==false)return false;window.__kineticWarmAdapter=a;window.__kineticWarmDevice=await a.requestDevice();return true;}catch{return false;}
  },{polling:500,timeout:60_000});
  page=await browser.newPage();page.on("pageerror",error=>result.errors.push({kind:"page",message:error.message}));
  page.on("console",message=>{if(message.type()==="error")result.errors.push({kind:"console",message:message.text()});});
  await page.goto(`http://localhost:${PORT}/app/`,{waitUntil:"networkidle0"});await page.waitForFunction(()=>!!window.__solidify,{timeout:60_000});
  await page.evaluate(installQuant3KineticDriver,target);
  result.metadata=await page.evaluate(()=>window.__q3kinetic.metadata());
  if(result.metadata.hardware.isFallbackAdapter!==false)throw new Error("application did not admit actual hardware");
  result.equivalence=await page.evaluate(()=>window.__q3kinetic.equivalence());
  const pairs=result.equivalence.comparisons;
  if(pairs.length!==9||!pairs.every(pair=>pair.mismatches===0&&pair.productionHash===pair.specializedHash)
    ||result.equivalence.stateByteChanges===0)throw new Error("native production equivalence or evolution failed");
  console.log("QPF3-KINETIC-NATIVE OK",JSON.stringify({pairs:pairs.length,changedBytes:result.equivalence.stateByteChanges}));save();
  for(const config of arms){
    const row={config,samples:[],completed:false};result.arms.push(row);save();
    try{
      row.setup=await page.evaluate(c=>window.__q3kinetic.stage(c),config);
      const initial=await page.evaluate(()=>window.__q3kinetic.sample());row.initialRaw=saveRaw(config.name,initial);
      let previous=0;
      for(let period=1;period<=8;period++){
        const steps=Math.round(period*20/config.dt),advance=await page.evaluate(count=>window.__q3kinetic.advance(count),steps-previous);previous=steps;
        if(advance.steps!==steps||advance.minTauFactor!==1)throw new Error("short physics step budget or invalid pure-interface factor");
        const sample=await page.evaluate(()=>window.__q3kinetic.sample()),raw=saveRaw(config.name,sample);
        row.samples.push({time:sample.time,declaredTime:sample.declaredTime,steps:sample.steps,uniformDt:sample.uniformDt,
          ...analyzeKinetic(target,config,sample,initial),raw});save();
      }
      row.census=await page.evaluate(()=>window.__q3kinetic.census());
      const last=row.samples.at(-1);
      row.completed=last.steps===Math.round(160/config.dt)&&last.meanVelocity>0
        &&row.census.nonFinite===0&&row.census.outOfRange===0&&row.census.transverseError===0;
      if(!row.completed)throw new Error("physical liveness, finiteness, plane symmetry, or terminal-step check failed");
      console.log("QPF3-KINETIC-ARM",JSON.stringify({arm:config.name,time:last.time,velocity:last.meanVelocity,
        relativeDifference:last.relativeVelocityDifference,profileResidual:last.profileResidual,outer:last.outerTemperature}));
    }catch(error){row.error=error.stack??String(error);throw error;}
    finally{await page.evaluate(()=>window.__q3kinetic.destroy());save();}
  }
}catch(error){result.exception=error.stack??String(error);}
finally{
  if(page){result.errors.push(...await page.evaluate(()=>window.__q3kinetic?.errors()??[]).catch(error=>[{kind:"error-readback",message:error.message}]));
    await page.evaluate(()=>window.__q3kinetic?.dispose()).catch(error=>result.errors.push({kind:"cleanup",message:error.message}));}
  result.finalHashes=hashes();result.sourceStable=JSON.stringify(result.sourceHashes)===JSON.stringify(result.finalHashes);
  result.completed=!result.exception&&result.errors.length===0&&result.sourceStable&&result.arms.length===arms.length&&result.arms.every(row=>row.completed);
  result.finished=new Date().toISOString();save();await closeBrowser(browser);
}
console.log("QPF3-KINETIC",result.completed?"RECORDED":"FAILED",JSON.stringify({completed:result.completed,sourceStable:result.sourceStable,
  exception:result.exception,errors:result.errors,scientificVerdict:result.scientificVerdict}));
process.exitCode=result.completed?0:1;
