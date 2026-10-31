// Prospective physical-volume/geometry contract for the twelve grid arms.
// CPU-only helpers. No evolved measurements determine this target.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {equilibriumInitialFields,equilibriumCentroid} from './quant3d-equilibrium-driver.mjs';

export const CAPILLARY_GRIDS=Object.freeze([{dx:.8,n:96},{dx:.6,n:128},{dx:.4,n:192}].map(Object.freeze));
export const CAPILLARY_BOX=76.8;
// Recorded prospectively using the driver's sequential JS Float64 sum over
// the finest-grid Float32 field in z/y/x order. Keep it identical across hosts.
export const CAPILLARY_TARGET_PHYSICAL_VOLUME=33923.7386779148;
export const CAPILLARY_CANONICAL_PHASE_SHA256='e792064d5695f1402a661cb48990d441e32eaa53874bfd24a419969cdcffcf6e';
export const CANONICAL_VOLUME_CONTROL_TOLERANCE=1e-6; // CPU known-truth check only.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export const gridPairKey=c=>`dx=${c.dx},n=${c.n},epsilon=${c.epsilon}`;
export const capillaryGridArms=()=>CAPILLARY_GRIDS.flatMap(({dx,n})=>[0,.0171].flatMap(epsilon=>[0,dx/2].map(offset=>({
  name:`dx-${dx}-epsilon-${epsilon}-offset-${offset}`,n,dx,radius:20,lambda:4,epsilon,
  centerOffset:[offset,offset,offset],maximumTime:1000,measurementPeriod:20,controlPeriod:4,gridRefinement:true}))));

// Independent Float64 logistic formula and compensated sum; it does not call
// the tanh/Math.hypot/Float32 initialization or its coordinate adapter.
export function independentSphereIntegral(c){
  let total=0,compensation=0;
  for(let z=0;z<c.n;z++)for(let y=0;y<c.n;y++)for(let x=0;x<c.n;x++){
    const xx=(x+.5)*c.dx-CAPILLARY_BOX/2-c.centerOffset[0];
    const yy=(y+.5)*c.dx-CAPILLARY_BOX/2-c.centerOffset[1];
    const zz=(z+.5)*c.dx-CAPILLARY_BOX/2-c.centerOffset[2];
    const exponent=Math.SQRT2*(Math.sqrt(xx*xx+yy*yy+zz*zz)-c.radius);
    const q=exponent>=0?Math.exp(-exponent):Math.exp(exponent);
    const value=exponent>=0?q/(1+q):1/(1+q);
    const corrected=value-compensation,next=total+corrected;
    compensation=(next-total)-corrected;total=next;
  }
  const R=c.radius,k=Math.SQRT2,a=CAPILLARY_BOX/2-Math.max(...c.centerOffset.map(Math.abs));
  const analytic=4*Math.PI*R**3/3+2*Math.PI**3*R/3;
  const originCorrectionBound=8*Math.PI*(1/Math.SQRT2)**3*Math.exp(-Math.SQRT2*R);
  const omittedBoxTailBound=4*Math.PI*Math.exp(-k*(a-R))*(a*a/k+2*a/(k*k)+2/(k*k*k));
  return {float64MidpointPhysicalVolume:total*c.dx**3,infiniteDomainMoment:analytic,
    originCorrectionBound,omittedBoxTailBound};
}

function initialEvidence(c){
  const fields=equilibriumInitialFields(c),moments=equilibriumCentroid(fields.phi,fields.frame);
  const independent=independentSphereIntegral(c),physicalVolume=moments.volume*c.dx**3;
  assert.ok(Math.abs(c.n*c.dx-CAPILLARY_BOX)<=32*Number.EPSILON*CAPILLARY_BOX);
  assert.ok(Math.abs(independent.float64MidpointPhysicalVolume/independent.infiniteDomainMoment-1)<CANONICAL_VOLUME_CONTROL_TOLERANCE);
  assert.ok(Math.abs(physicalVolume/independent.float64MidpointPhysicalVolume-1)<CANONICAL_VOLUME_CONTROL_TOLERANCE);
  return {config:c,phaseSha256:sha(fields.phi),...moments,physicalVolume,independent};
}

let canonical=null;
export function canonicalPhysicalPhaseVolume(){
  if(canonical)return canonical;
  const config=capillaryGridArms().find(c=>c.dx===.4&&c.epsilon===0&&c.centerOffset[0]===0);
  const evidence=initialEvidence(config);
  assert.ok(Math.abs(evidence.physicalVolume/CAPILLARY_TARGET_PHYSICAL_VOLUME-1)<1e-10,
    'local canonical Float32 integral differs from the prospective target');
  canonical={definition:'fixed n192 dx.4 R20 center0 Float32 tanh field; sequential JS Float64 phase sum in z/y/x order; no evolved output',
    physicalVolume:CAPILLARY_TARGET_PHYSICAL_VOLUME,canonicalPhaseSha256:CAPILLARY_CANONICAL_PHASE_SHA256,
    localCanonicalPhaseSha256:evidence.phaseSha256,localCanonicalPhysicalVolume:evidence.physicalVolume,evidence};
  return canonical;
}

export function physicalTargetMatches(c,targetVolume,physicalVolume){
  return Number.isFinite(targetVolume)&&targetVolume>0&&Number.isFinite(physicalVolume)&&physicalVolume>0
    &&Math.abs(targetVolume*c.dx**3/physicalVolume-1)<=64*Number.EPSILON;
}

export function selfTestGridVolumes(target=canonicalPhysicalPhaseVolume()){
  const results=[];
  for(const {dx,n} of CAPILLARY_GRIDS)for(const offset of [0,dx/2]){
    const c=capillaryGridArms().find(c=>c.dx===dx&&c.epsilon===0&&c.centerOffset[0]===offset);
    const evidence=dx===.4&&offset===0?target.evidence:initialEvidence(c);
    const targetVolume=target.physicalVolume/dx**3;
    assert.ok(physicalTargetMatches(c,targetVolume,target.physicalVolume));
    assert.ok(Math.abs(evidence.physicalVolume/target.physicalVolume-1)<1e-4);
    assert.ok(evidence.centroidFrame.every(v=>Math.abs(v)<8e-5));
    results.push({...evidence,targetVolume,initialRelativePhysicalVolumeError:evidence.physicalVolume/target.physicalVolume-1});
  }
  const wrongMeshTarget=target.physicalVolume/.8**3;
  assert.equal(physicalTargetMatches({dx:.4},wrongMeshTarget,target.physicalVolume),false);
  assert.equal(physicalTargetMatches({dx:.6},wrongMeshTarget,target.physicalVolume),false);
  assert.equal(capillaryGridArms().length,12);
  assert.equal(new Set(capillaryGridArms().map(c=>c.name)).size,12);
  return {canonical:target,meshes:results,wrongMeshCellTargetRefused:true,
    independentFormula:'4*pi*R^3/3+2*pi^3*R/3 plus bounded exponentially small origin correction',
    consistencyRelativeTolerance:CANONICAL_VOLUME_CONTROL_TOLERANCE};
}
