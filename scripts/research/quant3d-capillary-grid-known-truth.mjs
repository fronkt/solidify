// CPU-only full-sphere fixtures for all three grids and both subcell phases.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {equilibriumInitialFields,equilibriumCentroid,equilibriumTranslationPoints,
  equilibriumFramePoints} from './quant3d-equilibrium-driver.mjs';
import {capillaryGridArms,canonicalPhysicalPhaseVolume} from './quant3d-capillary-grid.mjs';
import {translationClockPlan} from './quant3d-equilibrium-translation.mjs';
import {measureWulff} from '../fixtures/quant3d-wulff-analysis.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.argv[2]??'verify-out/q3-capillary-grid-known-truth');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths=['src/sim3d.ts','src/shaders3d.ts','src/shaders3d-quant.ts','scripts/fixtures/quant3d-wulff-analysis.mjs',
  'scripts/fixtures/quant3d-tip-analysis.mjs','scripts/research/quant3d-equilibrium-driver.mjs',
  'scripts/research/quant3d-equilibrium-translation.mjs','scripts/research/quant3d-equilibrium-translation.md',
  'scripts/research/quant3d-readback.mjs','scripts/browser-cleanup.mjs','scripts/research/quant3d-capillary-grid.mjs',
  'scripts/research/quant3d-capillary-grid.md','scripts/research/quant3d-capillary-grid-known-truth.mjs',
  'scripts/research/quant3d-capillary-grid-replay.py'];
const variants=path=>{const raw=readFileSync(resolve(ROOT,path)),lf=Buffer.from(raw.toString('utf8').replace(/\r\n/g,'\n'));
  return {raw:sha(raw),lf:sha(lf),crlf:sha(Buffer.from(lf.toString('utf8').replace(/\n/g,'\r\n')))};};
mkdirSync(resolve(out,'samples'),{recursive:true});
const target=canonicalPhysicalPhaseVolume();
const result={format:'solidify-capillary-grid-known-truth-v1',scope:'CPU sphere fixtures only; no GPU/evolved result opened',
  physicalVolumeTarget:target,sourceHashVariants:Object.fromEntries(paths.map(path=>[path,variants(path)])),
  clockPlans:Object.fromEntries(capillaryGridArms().map(c=>[c.name,translationClockPlan(c)])),cases:[]};
for(const arm of capillaryGridArms().filter(c=>c.epsilon===0)){
  const config={...arm,targetPhysicalVolume:target.physicalVolume,targetVolume:target.physicalVolume/arm.dx**3};
  const fields=equilibriumInitialFields(config),temperature=fields.raw[1];
  const points=equilibriumFramePoints(equilibriumTranslationPoints(fields.phi,config.n,config.dx),fields.frame);
  const measurement={temperature,...measureWulff(points,20,temperature,4)};
  const raw={format:'CPU capillary grid known-truth sphere brackets v1',config,n:config.n,dx:config.dx,
    declaredCenterOffset:config.centerOffset,appliedCenterOffset:config.centerOffset,
    centerConvention:'(cell+.5-n/2)*dx-appliedCenterOffset',temperature,time:0,points};
  const bytes=Buffer.from(JSON.stringify(raw)),encoded=gzipSync(bytes),path=`samples/${arm.name}.json.gz`;
  writeFileSync(resolve(out,path),encoded);
  result.cases.push({config,measurement,centroid:equilibriumCentroid(fields.phi,fields.frame),phaseSha256:sha(fields.phi),
    raw:{path,sha256:sha(encoded),uncompressedSha256:sha(bytes),points:points.length}});
  console.log('CAPILLARY-GRID-KNOWN-TRUTH',JSON.stringify({dx:arm.dx,offset:arm.centerOffset[0],points:points.length,sha256:sha(encoded)}));
}
writeFileSync(resolve(out,'known-truth-manifest.json'),JSON.stringify(result,null,2));
console.log('CAPILLARY-GRID-KNOWN-TRUTH COMPLETE',JSON.stringify({cases:result.cases.length,physicalVolume:target.physicalVolume}));
