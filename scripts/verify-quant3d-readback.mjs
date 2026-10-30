// Layout/stride controls are synthetic data; --gpu additionally checks actual
// device copies and the original reader on aligned grids. No PDE is evolved.
import assert from 'node:assert/strict';
import { stateVolumeLayout, unpackStateVolume } from './research/quant3d-readback.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const positional=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const out = resolve(positional[0] ?? 'verify-out/q3-readback');
mkdirSync(out, { recursive:true });
const report = { scope:'Research readback, not physical validation', checks:[], errors:[], passed:false };
const cpu = n => {
  const layout = stateVolumeLayout(n), raw = new Float32Array(layout.size / 4); raw.fill(NaN);
  for (let z=0;z<n;z++) for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
    const at=(z*n+y)*layout.bytesPerRow/4+2*x;
    raw[at]=Math.fround(x/1024+y/1048576+z/1073741824);
    raw[at+1]=Math.fround(-10-z-y/1024-x/1048576);
  }
  const state=unpackStateVolume(raw.buffer,n);
  for (let z=0;z<n;z++) for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
    const i=(z*n+y)*n+x;
    assert.equal(state.phi[i],Math.fround(x/1024+y/1048576+z/1073741824));
    assert.equal(state.T[i],Math.fround(-10-z-y/1024-x/1048576));
  }
  assert.throws(()=>unpackStateVolume(new ArrayBuffer(layout.size-4),n));
  return {...layout,voxels:state.phi.length};
};
for (const n of [1,32,96,128,144,160,192]) report.checks.push({ kind:'cpu-coordinate-stride',...cpu(n) });
assert.throws(()=>stateVolumeLayout(1.5)); assert.throws(()=>stateVolumeLayout(0));
if (process.argv.includes('--gpu')) {
  const {default:puppeteer}=await import('puppeteer-core');
  const {closeBrowser}=await import('./browser-cleanup.mjs');
  const port=positional[1]??process.env.Q3_READBACK_PORT??'5199';
  const paths=['src/sim3d.ts','src/shaders3d.ts','src/shaders3d-quant.ts',
    'scripts/research/quant3d-readback.mjs','scripts/verify-quant3d-readback.mjs'];
  const hashes=()=>Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
  report.sourceHashes=hashes(); let browser=null,page=null;
  try {
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless:true,args:['--enable-unsafe-webgpu','--enable-gpu',...JSON.parse(process.env.CHROME_ARGS??'[]')],protocolTimeout:180000});
    page=await browser.newPage(); page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(`http://localhost:${port}/app/`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>!!window.__solidify,{timeout:60000});
    report.hardware=await page.evaluate(()=>{
      const S=window.__solidify; S.app.setRun(false); const device=S.sim().device,info=device.adapterInfo;
      window.__q3ReadbackErrors=[];
      device.addEventListener('uncapturederror',e=>window.__q3ReadbackErrors.push(e.error.message));
      device.lost.then(e=>window.__q3ReadbackErrors.push(`device lost: ${e.reason} ${e.message}`));
      return {vendor:info.vendor,architecture:info.architecture,isFallbackAdapter:info.isFallbackAdapter};
    });
    assert.equal(report.hardware.isFallbackAdapter,false);
    for (const n of [96,144]) report.checks.push(await page.evaluate(async n=>{
      const {Sim3D}=await import('/src/sim3d.ts');
      const {readStateVolumeAligned,stateVolumeLayout}=await import('/scripts/research/quant3d-readback.mjs');
      const device=window.__solidify.sim().device,sim=new Sim3D(device,n); sim.build();
      const hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),v=>v.toString(16).padStart(2,'0')).join('');
      const pairs=[];
      try {
        for (const dir of [0,1]) {
          const raw=new Float32Array(n**3*2);
          for (let z=0;z<n;z++) for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
            const i=(z*n+y)*n+x; raw[2*i]=x/1024+y/1048576+z/1073741824;
            raw[2*i+1]=-10-z-y/1024-x/1048576-dir;
          }
          device.queue.writeTexture({texture:sim.stateTexture(dir)},raw,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
          sim.dir=dir;
          const read=await readStateVolumeAligned(sim);
          for (let i=0;i<n**3;i++) if(read.phi[i]!==raw[2*i]||read.T[i]!==raw[2*i+1]) throw new Error(`Coordinate data mismatch n=${n}, dir=${dir}, i=${i}`);
          const sha=await hash(read.phi.buffer),tempSha=await hash(read.T.buffer);
          if(n===96) {
            const legacy=await sim.readStateVolume();
            if(!legacy||sha!==await hash(legacy.phi.buffer)||tempSha!==await hash(legacy.T.buffer)) throw new Error('Aligned original/padded readback mismatch');
          }
          pairs.push({dir,phiSha256:sha,temperatureSha256:tempSha,legacyParity:n===96});
        }
        return {kind:'gpu-coordinate-copy',n,layout:stateVolumeLayout(n),pairs};
      } finally { await device.queue.onSubmittedWorkDone(); sim.destroy(); }
    },n));
    report.errors.push(...await page.evaluate(()=>{
      if(!Array.isArray(window.__q3ReadbackErrors))throw new Error('Missing GPU error ledger');
      return window.__q3ReadbackErrors;
    })); report.deviceErrorLedgerRead=true;
  } catch(error) { report.exception=error.stack??String(error); }
  finally {
    if(browser)try{await closeBrowser(browser)}catch(error){report.errors.push(`cleanup: ${error.message}`)}
    report.finalHashes=hashes(); report.sourceStable=JSON.stringify(report.sourceHashes)===JSON.stringify(report.finalHashes);
  }
}
report.passed=!report.exception&&!report.errors.length&&(!process.argv.includes('--gpu')||(report.deviceErrorLedgerRead&&report.sourceStable&&report.checks.length===9));
writeFileSync(resolve(out,'readback-result.json'),JSON.stringify(report,null,2));
console.log('Q3-READBACK',JSON.stringify(report)); process.exitCode=report.passed?0:1;
