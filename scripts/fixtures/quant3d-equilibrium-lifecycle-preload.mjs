// CPU-only process fixture for the real equilibrium CLI. No browser, GPU,
// evolution, physical calibration, or scientific acceptance is supplied here.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const mode=process.env.Q3_EQUIL_MOCK_MODE??'positive';
const modes=['positive','ledger-fail','ledger-missing','ledger-nonarray',
  'fixture-destroy-fail','fixture-dispose-fail','warm-cleanup-fail','browser-cleanup-fail',
  'gpu-error','page-error','console-error','launch-fail','newpage-fail','source-change',
  'invalid-chrome-options','control-fail','control-no-progress','late-overshoot','late-infinite'];
if(!modes.includes(mode))throw new Error(`Unknown equilibrium lifecycle fixture mode: ${mode}`);
let config=null,time=0,ledgerReads=0;
const handlers={};
const fixture={
  metadata(){return {hardware:{vendor:'CPU-only lifecycle fixture',isFallbackAdapter:false},
    note:'Synthetic admission/verdict plumbing; no actual hardware or numerical evidence'};},
  stage(c){
    config={controlPeriod:4,...c};time=0;
    return {config:{...config},params:{dt:.01,solver:1},targetVolume:1000,
      note:'Synthetic state values exercise real CLI lifecycle; not evolved fields'};
  },
  control(remaining){
    if(mode==='control-fail')throw new Error('manufactured control failure');
    if(mode==='control-no-progress')return {time};
    const step=Math.min(config.controlPeriod,remaining);
    if(remaining<=config.controlPeriod&&mode==='late-overshoot')time=config.maximumTime+100;
    else if(remaining<=config.controlPeriod&&mode==='late-infinite')time=Infinity;
    else time+=step;
    return {time};
  },
  measure(){
    return {time,volume:1000,temperature:.98,epsilon:config.epsilon,epsilonError:1e-6,
      d0Effective:.8839/config.lambda,a1Effective:.8839,h100:20,h110:20,
      heldOut111RelativeResidual:0,
      raw:{source:'CPU-only synthetic lifecycle fixture; no sampled production field',points:[],time}};
  },
  destroy(){if(mode==='fixture-destroy-fail')throw new Error('manufactured fixture destroy failure');},
  dispose(){if(mode==='fixture-dispose-fail')throw new Error('manufactured fixture dispose failure');},
  errors(){
    ledgerReads++;
    if(mode==='ledger-fail')throw new Error('manufactured ledger read failure');
    if(mode==='ledger-missing')return undefined;
    if(mode==='ledger-nonarray')return {not:'a ledger array'};
    if(mode==='page-error')handlers.pageerror?.(new Error('manufactured late page exception'));
    if(mode==='console-error')handlers.console?.({type:()=> 'error',text:()=> 'manufactured console error'});
    return mode==='gpu-error'?[{kind:'manufactured',message:'manufactured GPU error'}]:[];
  },
};
globalThis.window={__q3wulffCalib:fixture,__calibWarmDevice:{
  destroy(){if(mode==='warm-cleanup-fail')throw new Error('manufactured warm device destroy failure');},
}};
if(mode==='source-change'){
  const original=fs.readFileSync;
  fs.readFileSync=function(path,...args){
    const bytes=original.call(this,path,...args);
    return ledgerReads&&String(path).replaceAll('\\','/').endsWith('src/shaders3d-quant.ts')
      ?Buffer.concat([bytes,Buffer.from('\n// manufactured source verification change\n')]):bytes;
  };
  syncBuiltinESMExports();
}
const page={
  on(event,handler){handlers[event]=handler;},once(){},
  async goto(){},async setRequestInterception(){},async waitForFunction(){},
  async evaluate(fn,arg){
    if(fn.name==='installQuant3WulffCalibrationDriver')return;
    // Real page.evaluate serializes its argument; don't permit fixture mutation
    // of the runner's config to weaken clock/selection checks.
    return await fn(arg===undefined?undefined:structuredClone(arg));
  },
};
puppeteer.launch=async()=>{
  if(mode==='launch-fail')throw new Error('manufactured launch failure');
  return {
    async newPage(){if(mode==='newpage-fail')throw new Error('manufactured newPage failure');return page;},
    process(){if(mode==='browser-cleanup-fail')throw new Error('manufactured browser cleanup failure');return null;},
    async close(){},async disconnect(){},
  };
};
process.on('exit',code=>console.log('CPU-EQUIL-LIFECYCLE-END',JSON.stringify({mode,code,ledgerReads})));
