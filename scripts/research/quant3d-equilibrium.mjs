import puppeteer from 'puppeteer-core';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {closeBrowser} from '../browser-cleanup.mjs';
import {installQuant3WulffCalibrationDriver} from './quant3d-equilibrium-driver.mjs';
import {equilibriumState,selfTestWulff} from '../fixtures/quant3d-wulff-analysis.mjs';
const out=resolve(process.argv[2]??'verify-out/q3-wulff-calibration-v4'),port=process.argv[3]??'5199';
const selected=process.argv[4]?.split(',');
const matrix=JSON.parse(readFileSync('scripts/research/quant3d-equilibrium-matrix.json'));
const declaredNames=new Set([...matrix.geometries,...matrix.controls].map(c=>c.name));
if(selected&&(new Set(selected).size!==selected.length||selected.some(name=>!declaredNames.has(name))))
  throw new Error('Select distinct declared geometry/control names');
const cases=[...matrix.geometries.flatMap(g=>matrix.rawEpsilons.map(epsilon=>({...g,epsilon,lambda:matrix.lambda}))),
  ...matrix.controls.map(c=>({...c,lambda:matrix.lambda}))].filter(c=>!selected||selected.includes(c.name));
if(!cases.length)throw new Error('No declared equilibrium cases selected');
if(cases.some(c=>c.matchBaselinePhaseVolume)&&!cases.some(c=>c.name==='baseline'))
  throw new Error('Initial-shape control requires baseline in the same invocation');
const paths=['src/sim3d.ts','src/shaders3d.ts','src/shaders3d-quant.ts','scripts/fixtures/quant3d-wulff-analysis.mjs',
  'scripts/fixtures/quant3d-tip-analysis.mjs','scripts/research/quant3d-equilibrium.mjs',
  'scripts/research/quant3d-equilibrium-driver.mjs','scripts/research/quant3d-equilibrium-matrix.json'];
const sha=s=>createHash('sha256').update(s).digest('hex');
const hashes=()=>Object.fromEntries(paths.map(p=>[p,sha(readFileSync(p))]));
const result={purpose:matrix.purpose,matrix,selected:cases,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceHashes:hashes(),controls:selfTestWulff(),started:new Date().toISOString(),cases:[],errors:[],completed:false};
mkdirSync(resolve(out,'samples'),{recursive:true});
const save=()=>writeFileSync(resolve(out,'calibration-result.json'),JSON.stringify(result,null,2));save();
const args=process.env.CHROME_ARGS?JSON.parse(process.env.CHROME_ARGS):[];
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,protocolTimeout:3_600_000,args:['--enable-unsafe-webgpu','--enable-gpu',...args]});
let page;
try{
  const warm=await browser.newPage();await warm.setRequestInterception(true);
  warm.once('request',r=>r.respond({status:200,contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,"><title>GPU admission</title>'}));
  await warm.goto(`http://localhost:${port}/__calibration_gpu_admission__`,{waitUntil:'domcontentloaded'});
  await warm.setRequestInterception(false);
  await warm.waitForFunction(async()=>{try{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!a||a.info.isFallbackAdapter!==false)return false;window.__calibWarmAdapter=a;window.__calibWarmDevice=await a.requestDevice();return true}catch{return false}},
    {timeout:60000,polling:500});
  page=await browser.newPage();page.on('pageerror',e=>result.errors.push({kind:'page',message:e.message}));
  page.on('console',m=>{if(m.type()==='error')result.errors.push({kind:'console',message:m.text()})});
  await page.goto(`http://localhost:${port}/app/`,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>!!window.__solidify,{timeout:60000});
  await page.evaluate(installQuant3WulffCalibrationDriver);
  result.metadata=await page.evaluate(()=>window.__q3wulffCalib.metadata());
  if(result.metadata.hardware?.isFallbackAdapter!==false)throw new Error('Actual app hardware admission failed');
  const measure=async c=>{
    const {raw,...measurement}=await page.evaluate(()=>window.__q3wulffCalib.measure());
    const filename=`samples/${c.config.name}-epsilon-${c.config.epsilon}-${String(c.measurements.length+c.unresolved.length).padStart(3,'0')}.json.gz`;
    const bytes=Buffer.from(JSON.stringify({config:c.config,...raw})),compressed=gzipSync(bytes);
    writeFileSync(resolve(out,filename),compressed);
    measurement.raw={path:filename,sha256:sha(compressed),uncompressedSha256:sha(bytes),points:raw.points.length};
    if(measurement.measurementError)c.unresolved.push(measurement);else c.measurements.push(measurement);
    c.equilibrium=equilibriumState(c.measurements,c.setup.targetVolume);
    return measurement;
  };
  for(const declared of cases){
    const c={config:{...declared},measurements:[],unresolved:[],controls:[]};result.cases.push(c);save();
    if(declared.matchBaselinePhaseVolume){
      const baseline=result.cases.find(b=>b.config.name==='baseline'&&b.config.epsilon===declared.epsilon&&b.setup);
      if(!baseline)throw new Error('Initial-shape control requires the declared baseline in this invocation');
      c.config.targetVolume=baseline.setup.targetVolume;
    }
    try{
      c.setup=await page.evaluate(config=>window.__q3wulffCalib.stage(config),c.config);
      await measure(c);let time=0,next=declared.measurementPeriod;
      const wall=performance.now();
      while(time<declared.maximumTime){
        const before=performance.now();
        const control=await page.evaluate(remaining=>window.__q3wulffCalib.control(remaining),declared.maximumTime-time);
        control.wallMilliseconds=performance.now()-before;c.controls.push(control);time=control.time;
        if(time>=next||time>=declared.maximumTime){
          const measured=await measure(c);save();
          console.log('WULFF-CALIBRATION',JSON.stringify({name:declared.name,epsilon:declared.epsilon,time,
            effective:measured.epsilon,error:measured.epsilonError,d0:measured.d0Effective,equilibrium:c.equilibrium}));
          while(next<=time)next+=declared.measurementPeriod;
        }
      }
      c.wallMilliseconds=performance.now()-wall;c.finalTime=time;
      c.completed=!!(c.measurements.at(-1)?.time===time&&c.equilibrium.stationary&&c.equilibrium.resolved);
    }catch(error){c.error=error.stack??String(error);c.completed=false;}
    finally{await page.evaluate(()=>window.__q3wulffCalib.destroy())}
    const last=c.measurements.at(-1);
    c.summary=last?{epsilon: last.epsilon,epsilonError:last.epsilonError,d0Effective:last.d0Effective,
      a1Effective:last.a1Effective,support100:last.h100,support110:last.h110,
      heldOut111RelativeResidual:last.heldOut111RelativeResidual}:null;
    save();console.log('WULFF-CALIBRATION-CASE',JSON.stringify({config:c.config,completed:c.completed,summary:c.summary,error:c.error}));
  }
}catch(error){result.exception=error.stack??String(error)}
finally{
  if(page){result.errors.push(...await page.evaluate(()=>window.__q3wulffCalib?.errors()??[]).catch(e=>[{kind:'read-errors',message:e.message}]));
    await page.evaluate(()=>window.__q3wulffCalib?.dispose()).catch(e=>result.errors.push({kind:'cleanup',message:e.message}));}
  result.finalHashes=hashes();result.sourceStable=JSON.stringify(result.sourceHashes)===JSON.stringify(result.finalHashes);
  result.finished=new Date().toISOString();result.completed=!result.exception&&result.errors.length===0&&result.sourceStable
    &&result.cases.length===cases.length&&result.cases.every(c=>c.completed);
  save();await closeBrowser(browser);
}
console.log('WULFF-CALIBRATION-FINAL',JSON.stringify({completed:result.completed,sourceStable:result.sourceStable,
  cases:result.cases.map(c=>({config:c.config,completed:c.completed,summary:c.summary,error:c.error})),errors:result.errors,exception:result.exception}));
process.exitCode=result.completed?0:1;
