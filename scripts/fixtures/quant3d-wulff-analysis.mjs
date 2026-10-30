// Equilibrium metrology, not a moving-interface kinetic or needle test.
// Support windows and equilibrium judge preserve the original research study.
import { phaseCrossing } from "./quant3d-tip-analysis.mjs";

const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const unit = a => {const m=Math.hypot(...a);return a.map(v=>v/m);};
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function solve(A,b) {
  const a=A.map((r,i)=>[...r,b[i]]),n=b.length;
  for(let j=0;j<n;j++) {
    let k=j;for(let i=j+1;i<n;i++)if(Math.abs(a[i][j])>Math.abs(a[k][j]))k=i;
    if(Math.abs(a[k][j])<1e-12)throw new Error("unresolved support fit");
    [a[j],a[k]]=[a[k],a[j]];
    const q=a[j][j];for(let c=j;c<=n;c++)a[j][c]/=q;
    for(let i=0;i<n;i++)if(i!==j){const v=a[i][j];for(let c=j;c<=n;c++)a[i][c]-=v*a[j][c];}
  }
  return a.map(r=>r[n]);
}
const powers=[[0,0],...[2,3,4].flatMap(d=>Array.from({length:d+1},(_,j)=>[j,d-j]))];
// At the three cubic high-symmetry normals, the support point lies on the
// normal through the origin. Include cubic terms: a [111] patch has threefold,
// rather than separate u/v reflection, symmetry. Do not reuse this constraint
// for arbitrary rotated crystals or arbitrary normals.
function fitSupport(points,normal,radius) {
  const n=unit(normal),e1=unit(cross(n,Math.abs(n[0])<.8?[1,0,0]:[0,1,0])),e2=cross(n,e1);
  const peak=Math.max(...points.map(p=>dot(p.xyz,n)));
  const rows=points.map(p=>({u:dot(p.xyz,e1),v:dot(p.xyz,e2),w:dot(p.xyz,n),error:p.error??0}))
    .filter(p=>p.u*p.u+p.v*p.v<=radius*radius&&p.w>peak-2*radius);
  if(rows.length<25)return null;
  const feature=p=>powers.map(([a,b])=>(p.u/radius)**a*(p.v/radius)**b),m=powers.length;
  const A=Array.from({length:m},()=>Array(m).fill(0)),b=Array(m).fill(0);
  for(const p of rows){const f=feature(p);for(let i=0;i<m;i++){b[i]+=f[i]*(p.w-peak);for(let j=0;j<m;j++)A[i][j]+=f[i]*f[j];}}
  const c=solve(A,b),rms=Math.sqrt(rows.reduce((s,p)=>s+(feature(p).reduce((v,f,i)=>v+f*c[i],peak)-p.w)**2,0)/(rows.length-m));
  return {support:peak+c[0],radius,points:rows.length,rms,interpolationError:Math.max(...rows.map(p=>p.error))};
}

export function surfacePoints(phi,n,dx,retainBrackets=false) {
  if(phi.length!==n**3)throw new Error("wrong phase volume shape");
  const at=v=>phi[(v[2]*n+v[1])*n+v[0]],points=[];
  for(let axis=0;axis<3;axis++)for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const c=[x,y,z];if(c[axis]<2||c[axis]+3>=n)continue;
    const a=at(c),bpos=[...c];bpos[axis]++;const b=at(bpos);
    if(!((a>=.5&&b<.5)||(a<.5&&b>=.5)))continue;
    const sign=a>=.5?1:-1,read=k=>{const q=[...c];q[axis]+=k;const v=at(q);return sign===1?v:1-v;};
    const brackets=[-2,-1,0,1,2,3].map(read),root=phaseCrossing(brackets);
    const coarse=phaseCrossing([-1,0,1,2].map(read),[-1,0,1,2]);
    const xyz=c.map(v=>(v+.5-n/2)*dx);xyz[axis]+=root*dx;
    points.push({xyz,error:Math.abs(root-coarse)*dx,
      ...(retainBrackets?{axis,cell:c,solidToLiquidSign:sign,brackets,root}: {})});
  }
  if(points.length<100)throw new Error("Wulff surface unresolved");
  return points;
}

export function measureWulff(points,referenceRadius,temperature,lambda) {
  const normals100=[[1,0,0],[0,1,0],[0,0,1]],normals110=[[1,1,0],[1,0,1],[0,1,1]];
  const measure=normal=>{
    const fits=[.12,.16,.20].map(f=>fitSupport(points,normal,referenceRadius*f)).filter(Boolean);
    if(fits.length<3)throw new Error("need three resolved support windows");
    const support=fits[0].support,error=Math.max(...fits.map(f=>Math.abs(f.support-support)+2*f.rms+f.interpolationError));
    return {normal:unit(normal),support,error,fits};
  };
  const axes=normals100.map(measure),diagonals=normals110.map(measure),heldOut=measure([1,1,1]);
  const mean=a=>a.reduce((s,p)=>s+p.support,0)/a.length,h100=mean(axes),h110=mean(diagonals);
  const e100=Math.max(...axes.map(p=>p.error+Math.abs(p.support-h100))),e110=Math.max(...diagonals.map(p=>p.error+Math.abs(p.support-h110)));
  const epsilon=(h100-h110)/(h100+h110),epsilonLo=(h100-e100-h110-e110)/(h100-e100+h110+e110);
  const epsilonHi=(h100+e100-h110+e110)/(h100+e100+h110-e110),scale=(h100+h110)/2;
  const d0Effective=(1-temperature)*scale/2;
  return {h100,h110,epsilon,epsilonError:Math.max(epsilon-epsilonLo,epsilonHi-epsilon),scale,
    d0Effective,a1Effective:lambda*d0Effective,heldOut111:heldOut,
    heldOut111RelativeResidual:(heldOut.support-scale*(1-5*epsilon/3))/scale,axes,diagonals};
}

export function phaseMoments(phi,lambda) {
  let volume=0,mobility=0;
  for(const p of phi){if(!Number.isFinite(p)||p<0||p>1)throw new Error("invalid phase field");volume+=p;const q=2*p-1;mobility+=.5*lambda*(1-q*q)**2;}
  return {volume,mobility};
}

export function nextUniformTemperature({temperature,volume,previousVolume,targetVolume,mobility,elapsed}) {
  if(!(mobility>0&&elapsed>0))throw new Error("feedback lacks a live interface");
  // Approximate sensitivity is used only for controller gain, never to infer
  // energy or anisotropy. Rate feedback damps the volume/temperature oscillator.
  const rate=(volume-previousVolume)/elapsed,error=volume-targetVolume;
  const change=.75*(rate+error/(4*elapsed))/mobility;
  return Math.max(.8,Math.min(1.1,temperature+Math.max(-.002,Math.min(.002,change))));
}

export function equilibriumState(history,targetVolume) {
  const rows=history.slice(-5),span=field=>Math.max(...rows.map(r=>r[field]))-Math.min(...rows.map(r=>r[field]));
  if(rows.length<5||rows.at(-1).time<100||rows.at(-1).time-rows[0].time<75)return {ready:false};
  const volumeError=Math.max(...rows.map(r=>Math.abs(r.volume/targetVolume-1)));
  const mean=field=>rows.reduce((s,r)=>s+r[field],0)/rows.length;
  const checks={volumeError,epsilonSpan:span("epsilon"),temperatureSpan:span("temperature"),
    support100Span:span("h100")/mean("h100"),support110Span:span("h110")/mean("h110"),
    epsilonError:Math.max(...rows.map(r=>r.epsilonError)),
    heldOut111Residual:Math.max(...rows.map(r=>Math.abs(r.heldOut111RelativeResidual)))};
  return {ready:true,stationary:volumeError<1e-4&&checks.epsilonSpan<5e-5&&checks.temperatureSpan<5e-6
    &&checks.support100Span<2e-4&&checks.support110Span<2e-4,
    resolved:checks.epsilonError<5e-4&&checks.heldOut111Residual<1e-3,checks};
}

export function wulffGeometryControl(epsilon=.0171,scale=20,count=60000) {
  const points=[],golden=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<count;i++){
    const z=1-2*(i+.5)/count,r=Math.sqrt(1-z*z),n=[r*Math.cos(i*golden),r*Math.sin(i*golden),z];
    const s4=n.reduce((v,x)=>v+x**4,0),a=1-3*epsilon+4*epsilon*s4;
    points.push({xyz:n.map(x=>scale*((a-16*epsilon*s4)*x+16*epsilon*x**3)),error:0});
  }
  return measureWulff(points,scale,1-.02,4);
}

// NEW regression guards for an independently selected stencil. These bands
// were chosen after the exploratory comparison; they are not a retrospective
// preregistration of literature agreement. Scalar d0 is always report only.
export const WULFF_REGRESSION = Object.freeze({
  isotropicAbsoluteEpsilon: .0004,
  anisotropicRelativeEpsilon: .05,
  description: "new equilibrium regression guards, not literature needle acceptance",
});

export function assessWulffCase(c) {
  const final=c.measurements?.at(-1),equilibrium=equilibriumState(c.measurements??[],c.setup?.targetVolume);
  const finalMeasurementResolved=!!final && final.time>=c.config.maximumTime
    &&final.time<=c.config.maximumTime+(c.setup?.params?.dt??0)+1e-6;
  const effectiveError=final ? Math.abs(final.epsilon-c.config.epsilon)+final.epsilonError : Infinity;
  const allowed=c.config.epsilon===0 ? WULFF_REGRESSION.isotropicAbsoluteEpsilon
    : Math.abs(c.config.epsilon)*WULFF_REGRESSION.anisotropicRelativeEpsilon;
  const regression=Number.isFinite(effectiveError)&&effectiveError<allowed;
  const d0Continuum=.8839/c.config.lambda;
  return {equilibrium,finalMeasurementResolved,regression,
    uncertaintyInclusiveEpsilonError:effectiveError,allowedEpsilonError:allowed,
    accepted:!c.error&&finalMeasurementResolved&&equilibrium.stationary===true&&equilibrium.resolved===true&&regression,
    capillaryReportOnly:final ? {continuumD0:d0Continuum,measuredFiniteRadiusD0:final.d0Effective,
      relativeDifference:(final.d0Effective-d0Continuum)/d0Continuum,
      interpretation:"finite-radius equilibrium result includes width, mesh, curvature and metrology effects; no scalar d0 gate"}:null};
}

export function selfTestWulff() {
  const geometry=[0,.0171].map(input=>({input,...wulffGeometryControl(input)}));
  if(geometry.some(row=>Math.abs(row.epsilon-row.input)>row.epsilonError
    ||Math.abs(row.epsilon-row.input)>1e-5||Math.abs(row.heldOut111RelativeResidual)>1e-4)) {
    throw new Error("known analytic Wulff support was not recovered");
  }
  const c={config:{epsilon:.0171,lambda:4,maximumTime:1000},setup:{targetVolume:1000},
    measurements:Array.from({length:5},(_,i)=>({...geometry[1],volume:1000,temperature:.98,time:920+20*i}))};
  const positive=assessWulffCase(c);
  const drifting=assessWulffCase({...c,measurements:c.measurements.map((row,i)=>({...row,
    epsilon:row.epsilon+1e-4*i,h100:row.h100*(1+.001*i)}))});
  const unfinished=assessWulffCase({...c,measurements:c.measurements.slice(0,-1)});
  const wrongEnergy=assessWulffCase({...c,measurements:c.measurements.map(row=>({...row,epsilon:.01357}))});
  const scalarOnly=assessWulffCase({...c,measurements:c.measurements.map(row=>({...row,d0Effective:.5}))});
  if(!positive.accepted||drifting.accepted||drifting.equilibrium.stationary||unfinished.accepted
    ||wrongEnergy.accepted||!scalarOnly.accepted)throw new Error("Wulff verdict controls failed");
  return {geometry,positive,drifting,unfinished,wrongEnergy,scalarOnly};
}
