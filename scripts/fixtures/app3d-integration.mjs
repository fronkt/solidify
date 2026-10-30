// Deterministic application ownership checks. The intercepted module only delays
// real allocations; it never changes GPU equations, completion values or fields.
// Each share is minted by the actual app and restored through its normal boot path.
import assert from 'node:assert/strict';

export async function app3DIntegrationChecks(browser, root) {
  const errors=[],pages=[];
  const newPage=async()=>{const page=await browser.newPage();pages.push(page);return page};
  const watched=page=>page.on('pageerror',error=>errors.push(error.message));
  let result;
try{
  const probe=await newPage();watched(probe);
  await probe.goto(`${root}/app/`,{waitUntil:'networkidle0'});
  await probe.waitForFunction(()=>!!window.__solidify);
  const pitch=await probe.evaluate(async()=>{
    const S=window.__solidify,{Sim3D}=await import('/src/sim3d.ts');S.app.setRun(false);
    S.app.setUmPerCell(1.25);S.app.setGrid3(96);await S.app.setMode('3d');S.app.setRun(false);S.app.setUmPerCell(2.5);
    const create=Sim3D.create;
    let release,entered=false;Sim3D.create=async function(...args){entered=true;await new Promise(resolve=>release=resolve);return create.apply(this,args)};
    try{
      S.app.setGrid3(128);
      if(!entered)throw new Error('Grid allocation was not intercepted');
      await S.app.setMode('2d');release();
      while(!S.app.canSwitchMode())await new Promise(requestAnimationFrame);
      return {mode:S.mode(),host:S.app.getUmPerCell(),two:S.sim().umPerCell,three:S.sim3d().umPerCell,
        healthy:S.mode()==='2d'&&S.app.getUmPerCell()===1.25&&S.sim().umPerCell===1.25&&S.sim3d().umPerCell===2.5};
    }finally{Sim3D.create=create}
  });
  await probe.close();
  const runtime=await newPage();watched(runtime);
  await runtime.goto(`${root}/app/`,{waitUntil:'networkidle0'});
  await runtime.waitForFunction(()=>!!window.__solidify);
  await runtime.evaluate(async()=>{
    const S=window.__solidify;S.app.setRun(false);S.app.setMaterial('al');S.app.setGrid3(96);
    await S.app.setMode('3d');S.app.setRun(false);S.app.setAlloyOn(false);S.sim3d().params.coolRate=.2;
    await S.app.setCalibrated(true);
    const sim=S.sim3d(),read=sim.readQuantitativeStatus;let sent=false;
    window.__restoreStatus=()=>sim.readQuantitativeStatus=read;
    sim.readQuantitativeStatus=async function(){if(!sent){sent=true;return {flags:16,issue:'controlled temperature-range refusal',minTauFactor:1}}return read.call(this)};
  });
  await runtime.waitForFunction(()=>window.__solidify.sim3d().params.solver===0&&window.__solidify.app.calibrationIssue()?.includes('Calibration stopped'));
  const retry=await runtime.evaluate(()=>{
    const S=window.__solidify;window.__restoreStatus();const before=S.app.calibrationIssue();
    S.sim3d().params.coolRate=0;S.app.setUndercool(.2);S.app.resetArmed();
    return {before,after:S.app.calibrationIssue(),canCalibrate:S.app.canCalibrate(),
      healthy:S.app.canCalibrate()&&!S.app.calibrationIssue()};
  });
  await runtime.close();
  const mint=await newPage();watched(mint);
  await mint.goto(`${root}/app/`,{waitUntil:'networkidle0'});
  await mint.waitForFunction(()=>!!window.__solidify);
  const setup=await mint.evaluate(async()=>{
    const S=window.__solidify;S.app.setRun(false);S.composer.applyHash('#alloy=al:Si7,Mg0.35');S.app.setGrid3(96);
    await S.app.setMode('3d');S.app.setRun(false);await S.app.setAlloyOn(true);
    S.sim3d().params.coolRate=0;S.app.setUndercool(.2);
    const baseline={...S.sim3d().params};await S.app.setCalibrated(true);
    if(S.sim3d().params.solver!==1||!S.sim3d().alloyActive)throw new Error('Could not mint real calibrated alloy share');
    return {url:S.app.shareLink(),params:{...S.sim3d().params},q:S.app.calibration(),baseline};
  });
  await mint.close();
  const page=await newPage();watched(page);page.setDefaultTimeout(60000);
  const hook=`\n;(()=>{
    const p=globalThis.__shareProbe={entered:false,alloyFinished:false,quantCalls:0,baseline:null};
    const reset=Sim3D.prototype.reset,alloy=Sim3D.prototype.enableAlloy,quant=Sim3D.prototype.enableQuant;
    Sim3D.prototype.reset=function(...args){if(!p.entered)p.baseline={params:{...this.params},pitch:this.umPerCell};return reset.apply(this,args)};
    Sim3D.prototype.enableAlloy=async function(...args){
      if(!p.entered){p.entered=true;await new Promise(resolve=>p.release=resolve);
        try{return await alloy.apply(this,args)}finally{p.alloyFinished=true}}
      return alloy.apply(this,args);
    };
    Sim3D.prototype.enableQuant=function(...args){p.quantCalls++;return p.quantPromise=quant.apply(this,args)};
  })();\n`;
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    if(new URL(request.url()).pathname==='/src/sim3d.ts'){
      try{
        const response=await fetch(request.url()),source=await response.text();
        await request.respond({status:response.status,contentType:'application/javascript',body:source+hook});
      }catch(error){errors.push(error.message);await request.abort()}
    }else await request.continue();
  });
  await page.goto(setup.url,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.__shareProbe?.entered&&!!window.__shareProbe.release&&window.__solidify?.mode()==='3d');
  const before=await page.evaluate(()=>({mode:window.__solidify.mode(),baseline:window.__shareProbe.baseline,
    staged:{...window.__solidify.sim3d().params}}));
  await page.evaluate(()=>{window.__solidify.app.setMode('2d');window.__shareProbe.release()});
  await page.waitForFunction(()=>window.__shareProbe.alloyFinished);
  await page.evaluate(async()=>{if(window.__shareProbe.quantPromise)await window.__shareProbe.quantPromise;await new Promise(requestAnimationFrame)});
  const canceled=await page.evaluate(()=>({mode:window.__solidify.mode(),quantCalls:window.__shareProbe.quantCalls,
    params:{...window.__solidify.sim3d().params}}));
  const returned=await page.evaluate(async()=>{
    const S=window.__solidify;await S.app.setMode('3d');S.app.setRun(false);await new Promise(requestAnimationFrame);
    return {mode:S.mode(),reason:S.app.calibrationIssue(),canCalibrate:S.app.canCalibrate(),params:{...S.sim3d().params}};
  });
  const keys=['dx','dt','epsBar','tau','latent','delta','dTherm','dSol','lambda','atCoef','frozenT','kPart','noiseAmp','twinProb','pPore'];
  const mismatches=keys.filter(key=>returned.params[key]!==before.baseline.params[key]).map(key=>({key,expected:before.baseline.params[key],actual:returned.params[key]}));
  const edits=[];
  for(const action of ['material','composition','none']){
    await page.goto('about:blank');
    await page.goto(setup.url,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>window.__shareProbe?.entered&&!!window.__shareProbe.release&&window.__solidify?.mode()==='3d');
    const intended=await page.evaluate(action=>{
      const S=window.__solidify;
      if(action==='material')S.app.setMaterial('ni');
      if(action==='composition')S.sim3d().params.c0=.41;
      const out={material:S.app.getMaterial(),c0:S.sim3d().params.c0};window.__shareProbe.release();return out;
    },action);
    await page.waitForFunction(()=>window.__shareProbe.alloyFinished);
    await page.evaluate(async()=>{if(window.__shareProbe.quantPromise)await window.__shareProbe.quantPromise;await new Promise(requestAnimationFrame)});
    const got=await page.evaluate(()=>({mode:window.__solidify.mode(),material:window.__solidify.app.getMaterial(),
      quantCalls:window.__shareProbe.quantCalls,reason:window.__solidify.app.calibrationIssue(),
      q:window.__solidify.app.calibration(),params:{...window.__solidify.sim3d().params}}));
    let restoredBaseline=null;
    if(action==='none')restoredBaseline=await page.evaluate(()=>{const S=window.__solidify;S.app.setCalibrated(false);return {...S.sim3d().params}});
    const healthy=action==='none'?got.params.solver===1&&got.q?.dT0===setup.q.dT0
      &&!got.q.coefficientSource.includes('dials have moved')&&got.params.kPart===setup.params.kPart
      &&restoredBaseline.kPart===setup.baseline.kPart&&restoredBaseline.dSol===setup.baseline.dSol
      :got.quantCalls===0&&got.params.solver===0&&got.material===intended.material&&got.params.c0===intended.c0
        &&!got.reason?.includes('Preparing');
    edits.push({action,intended,got,restoredBaseline,healthy});
  }
  result={pitch,retry,before,canceled,returned,mismatches,edits,errors,
    healthy:canceled.mode==='2d'&&canceled.quantCalls===0&&returned.mode==='3d'&&returned.params.solver===0
      &&returned.canCalibrate&&!returned.reason&&mismatches.length===0};
  assert.equal(errors.length,0);
  assert.equal(result.healthy,true);
  assert.equal(pitch.healthy,true);assert.equal(retry.healthy,true);
  for(const edit of edits)assert(edit.healthy,JSON.stringify(edit));
  return result;
} finally {
  for(const page of pages)if(!page.isClosed())await page.close();
}
}
