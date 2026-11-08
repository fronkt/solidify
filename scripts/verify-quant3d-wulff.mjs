// Fixed-input equilibrium regression, independent of the moving needle test.
// node scripts/verify-quant3d-wulff.mjs [output-directory] [port] [--self-test]
// Default uses production WGSL. No research shader replacement or retuning.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { closeBrowser } from "./browser-cleanup.mjs";
import { installQuant3WulffDriver } from "./fixtures/quant3d-wulff-driver.mjs";
import { assessWulffCase, selfTestWulff, WULFF_REGRESSION } from "./fixtures/quant3d-wulff-analysis.mjs";

const args=process.argv.slice(2),positions=args.filter(arg=>!arg.startsWith("--"));
if(args.some(arg=>arg.startsWith("--")&&arg!=="--self-test"))throw new Error("Unknown Wulff argument");
const OUT=resolve(positions[0]??"verify-out/q3-wulff"),PORT=positions[1]??"5199";
mkdirSync(OUT,{recursive:true});mkdirSync(resolve(OUT,"samples"),{recursive:true});
const contract={
  version:1,purpose:"fixed-radius equilibrium regression; not coupled kinetic cancellation or needle acceptance",
  inputs:{n:96,dx:.8,radius:20,lambda:4,initialAxes:[1,1,1],epsilon:[0,.0171],controlPeriod:4,maximumTime:1000},
  horizon:"fixed 1000 tau0; final control is capped to remaining horizon then rounded up by at most one time step",
  source:"unmodified production Sim3D quantitative pure phase/transport/anisotropic-flux shaders",
  geometry:"centered full cube, identity crystal, scalar reflection at all cube faces; far faces about 18 W0 beyond the radius-20 seed",
  temperature:"uniform external feedback holds initial phase volume; intentionally frozen heat, suitable only for equilibrium energy",
  controller:"original volume/rate feedback, period4, gain.75, temperature-change clamp.002; no physical coefficient feedback",
  metrology:"psi=.5 interface from monotone-coordinate quintic roots; cubic-root sensitivity; high-symmetry support fits at .12/.16/.20 reference radius; [111] held out",
  equilibriumJudge:"unchanged exploratory judge: last5 measurements spanning>=75 tau0 after100; volume error<1e-4, epsilon span<5e-5, T span<5e-6, supports relative spans<2e-4; epsilon uncertainty<5e-4 and held-out residual<1e-3",
  guards:{...WULFF_REGRESSION,uncertainty:"absolute discrepancy plus measured epsilon uncertainty for both cases"},
  registration:"NEW regression guards following an independent stencil comparison, not retrospectively preregistered literature acceptance",
  capillary:"finite-radius effective scalar d0 and continuum discrepancy reported only; no scalar d0 acceptance gate",
  references:["https://arxiv.org/pdf/patt-sol/9607005","https://doi.org/10.1103/PhysRevE.57.4323"],
};
const controls=selfTestWulff();
writeFileSync(resolve(OUT,"wulff-contract.json"),JSON.stringify({contract,controls},null,2));
console.log("QPF3-WULFF-CPU OK",JSON.stringify({known:controls.geometry.map(row=>({input:row.input,
  effective:row.epsilon,uncertainty:row.epsilonError})),driftRefused:!controls.drifting.accepted,
  unfinishedRefused:!controls.unfinished.accepted,wrongEnergyRefused:!controls.wrongEnergy.accepted,
  scalarIsReportOnly:controls.scalarOnly.accepted}));
if(args.includes("--self-test"))process.exit(0);

const paths=["src/sim3d.ts","src/shaders3d.ts","src/shaders3d-quant.ts","src/quant.ts",
  "scripts/verify-quant3d-wulff.mjs","scripts/fixtures/quant3d-wulff-driver.mjs",
  "scripts/fixtures/quant3d-wulff-analysis.mjs","scripts/fixtures/quant3d-tip-analysis.mjs","scripts/browser-cleanup.mjs"];
const sha=data=>createHash("sha256").update(data).digest("hex");
const sourceHashes=()=>Object.fromEntries(paths.map(path=>[path,sha(readFileSync(path))]));
const result={contract,source:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  hashes:sourceHashes(),started:new Date().toISOString(),hardware:null,cases:[],errors:[],accepted:false};
const save=()=>writeFileSync(resolve(OUT,"wulff-result.json"),JSON.stringify(result,null,2));
const saveMeasurement=(c,measurement)=>{
  const {raw,...summary}=measurement;
  if(raw){
    const path=`samples/epsilon-${c.config.epsilon}-checkpoint-${String(c.sampleCount++).padStart(3,"0")}.json.gz`;
    const encoded=Buffer.from(JSON.stringify({config:c.config,...raw})),compressed=gzipSync(encoded);
    writeFileSync(resolve(OUT,path),compressed);
    summary.raw={path,sha256:sha(compressed),uncompressedSha256:sha(encoded),points:raw.points.length,
      source:"direct Float32 phase samples at six adjacent cell centers; derived positions included for replay"};
  }
  if(summary.measurementError){c.unresolved.push(summary);return false;}
  c.measurements.push(summary);return true;
};
const extra=process.env.CHROME_ARGS?JSON.parse(process.env.CHROME_ARGS):[];
if(!Array.isArray(extra)||extra.some(arg=>typeof arg!=="string"))throw new Error("CHROME_ARGS must be a JSON string array");
save();
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless:true,protocolTimeout:3_600_000,args:["--enable-unsafe-webgpu","--enable-gpu",...extra]});
let page;
try{
  // Chrome156 on a freshly started Linux host can initially return no adapter.
  // Hold an idle device in THIS browser before the real app admission; no API
  // override, software fallback, or mock device is installed in the application.
  const warm=await browser.newPage();
  await warm.setRequestInterception(true);
  warm.once("request",request=>request.respond({status:200,contentType:"text/html",
    body:'<!doctype html><link rel="icon" href="data:,"><title>GPU admission warmup</title>'}));
  await warm.goto(`http://localhost:${PORT}/__wulff_gpu_warmup__`,{waitUntil:"domcontentloaded"});
  await warm.setRequestInterception(false);
  await warm.waitForFunction(async()=>{
    try{
      const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
      if(!adapter||adapter.info.isFallbackAdapter!==false)return false;
      window.__wulffWarmAdapter=adapter;window.__wulffWarmDevice=await adapter.requestDevice();return true;
    }catch{return false;}
  },{polling:500,timeout:60_000});
  page=await browser.newPage();
  page.on("pageerror",error=>result.errors.push({kind:"page",message:error.message}));
  page.on("console",message=>{if(message.type()==="error")result.errors.push({kind:"console",message:message.text()});});
  await page.goto(`http://localhost:${PORT}/app/`,{waitUntil:"networkidle0"});
  await page.waitForFunction(()=>!!window.__solidify,{timeout:60_000});
  await page.evaluate(installQuant3WulffDriver);
  result.metadata=await page.evaluate(()=>window.__q3wulff.metadata());
  result.hardware=result.metadata.hardware;
  if(result.hardware?.isFallbackAdapter!==false)throw new Error("Actual application hardware admission failed");
  for(const epsilon of contract.inputs.epsilon){
    const c={config:{...contract.inputs,epsilon},sampleCount:0,controls:[],measurements:[],unresolved:[]};
    result.cases.push(c);save();
    try{
      c.setup=await page.evaluate(config=>window.__q3wulff.stage(config),c.config);
      if(!saveMeasurement(c,await page.evaluate(()=>window.__q3wulff.measure())))throw new Error("initial geometry unresolved");
      let time=0,nextMeasure=20;
      while(time<c.config.maximumTime){
        const step=await page.evaluate(remaining=>window.__q3wulff.control(remaining),c.config.maximumTime-time);
        time=step.time;c.controls.push(step);
        if(time>=nextMeasure||time>=c.config.maximumTime){
          try{saveMeasurement(c,await page.evaluate(()=>window.__q3wulff.measure()));}
          catch(error){c.unresolved.push({time,error:error.stack??String(error)});}
          c.assessment=assessWulffCase(c);save();
          const last=c.measurements.at(-1);
          console.log("QPF3-WULFF-PROGRESS",JSON.stringify({epsilon,time,effective:last?.epsilon,
            uncertainty:last?.epsilonError,stationary:c.assessment.equilibrium.stationary}));
          while(nextMeasure<=time)nextMeasure+=20;
        }
      }
      c.actualFinalTime=time;
    }catch(error){c.error=error.stack??String(error);}
    finally{await page.evaluate(()=>window.__q3wulff.destroy());}
    c.assessment=assessWulffCase(c);save();
    console.log("QPF3-WULFF-CASE",c.assessment.accepted?"OK":"FAIL",JSON.stringify({epsilon,
      assessment:c.assessment,error:c.error}));
  }
}catch(error){result.exception=error.stack??String(error);}
finally{
  if(page){
    result.errors.push(...await page.evaluate(()=>window.__q3wulff?.errors()??[]).catch(error=>[{kind:"read-errors",message:error.message}]));
    await page.evaluate(()=>window.__q3wulff?.dispose()).catch(error=>result.errors.push({kind:"cleanup",message:error.message}));
  }
  result.finalHashes=sourceHashes();result.sourceStable=JSON.stringify(result.hashes)===JSON.stringify(result.finalHashes);
  result.accepted=!result.exception&&result.errors.length===0&&result.sourceStable
    &&result.cases.length===2&&result.cases.every(c=>c.assessment?.accepted);
  result.finished=new Date().toISOString();save();
  await closeBrowser(browser);
}
console.log("QPF3-WULFF",result.accepted?"OK":"FAIL",JSON.stringify({accepted:result.accepted,
  cases:result.cases.map(c=>({epsilon:c.config.epsilon,assessment:c.assessment})),errors:result.errors,
  exception:result.exception,sourceStable:result.sourceStable}));
process.exitCode=result.accepted?0:1;
