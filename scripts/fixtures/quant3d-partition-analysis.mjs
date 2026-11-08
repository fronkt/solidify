// Independent one-sided Stefan design and outer-profile metrology. Neither
// routine advances a phase field or fits the requested partition coefficient.
export const A1=.8839,A2=.6267;
export function erf(x){
  const a=Math.abs(x),t=1/(1+.3275911*a);
  return Math.sign(x)*(1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a));
}
export const erfc=x=>1-erf(x);
export function partitionRegime(nominalVelocity=.08,lambda=6,travelD0=120,k=.15,c0=.3){
  const D=A2*lambda,travel=travelD0*A1/lambda,beta=Math.sqrt(nominalVelocity*travel/(2*D));
  const omega=Math.sqrt(Math.PI)*beta*Math.exp(beta*beta)*erfc(beta);
  const ci=c0/(1-(1-k)*omega),T=(1-k*ci/c0)/(1-k);
  return {nominalVelocity,lambda,travelD0,D,beta,omega,ci,T,
    equation:"Omega=sqrt(pi)*beta*exp(beta^2)*erfc(beta); V=2*D*beta^2/s"};
}
function line(points){
  let sx=0,sy=0,sxx=0,sxy=0;const n=points.length;
  for(const [x,y]of points){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
  const m=(n*sxy-sx*sy)/(n*sxx-sx*sx),b=(sy-m*sx)/n;
  return {m,b,rms:Math.sqrt(points.reduce((s,[x,y])=>s+(y-m*x-b)**2,0)/n)};
}
export function measurePartition(profile,config,window=[6,10]){
  const {dx,D,timeTau0,x0,k=.15,c0=.3}=config,front=profile.front*dx,s=front-x0,h=2*Math.sqrt(D*timeTau0);
  const solid=[],liquid=[],[inner,outer]=window;
  for(let i=0;i<profile.phi.length;i++){
    const x=(i+.5)*dx,r=x-front,p=profile.phi[i],c=profile.concentration[i],A=1-(1-k)*p;
    // The model stores mixture concentration. The outer solid/liquid
    // limits divide out A/k or A, respectively. At six widths this is only
    // a small tail correction; an incorrect k_eff control remains incorrect.
    if(r>=-outer&&r<=-inner&&p>.999&&x>x0+1)solid.push([1/(x-x0),c*k/A]);
    if(r>=inner&&r<=outer&&p<.001)liquid.push([erfc((x-x0)/h),c/A-c0]);
  }
  if(solid.length<5||liquid.length<5)throw new Error("unresolved outer partition profiles");
  // With fixed interfacial temperature, the liquid is the one-sided erfc
  // similarity profile. Leading trapping/kinetic corrections in the freshly
  // solidified concentration follow V(s) proportional to 1/s, not linear x.
  const sf=line(solid),amplitude=liquid.reduce((a,[e,c])=>a+e*c,0)/liquid.reduce((a,[e])=>a+e*e,0);
  const cs=sf.m/s+sf.b,cl=c0+amplitude*erfc(s/h),kEff=cs/cl;
  const liquidRms=Math.sqrt(liquid.reduce((a,[e,c])=>a+(c-amplitude*e)**2,0)/liquid.length);
  return {window,cs,cl,kEff,solidPoints:solid.length,liquidPoints:liquid.length,
    solidRelativeResidual:sf.rms/Math.abs(cs),liquidRelativeResidual:liquidRms/Math.abs(cl-c0),
    betaMeasured:s/h,solidVelocityCoefficient:sf.m};
}
export function selfTestPartitionMetrology(){
  const regime=partitionRegime(),rows=[];
  // Independent standard-library reference values, rather than relying only
  // on cancellation between the synthetic generator and the fit's erf call.
  const erfReferences=[[0,0],[.5,.5204998778130465],[1,.8427007929497149],[2,.9953222650189527]];
  const erfMaxError=Math.max(...erfReferences.map(([x,y])=>Math.abs(erf(x)-y)));
  if(erfMaxError>1.5e-7)throw new Error("erf reference check failed");
  let invalidProfileRefused=false;
  for(const lambda of [3,6])for(const imposedK of [.15,.18])for(const fraction of [.17,.73]){
    const dx=.4,D=A2*lambda,s=120*A1/lambda,x0=64,front=x0+s+fraction*dx,
      timeTau0=(front-x0)**2/(4*regime.beta**2*D),h=2*Math.sqrt(D*timeTau0),c0=.3,k=.15,ci=regime.ci;
    const count=1024,phi=[],concentration=[],cs=imposedK*ci;
    // Include nonconstant solid history with a known boundary value; the
    // same regression must also keep a deliberately wrong partition wrong.
    const historyCoefficient=.002*(front-x0);
    for(let i=0;i<count;i++){
      const x=(i+.5)*dx,p=.5*(1-Math.tanh((x-front)/Math.SQRT2)),A=1-(1-k)*p;
      const bulk=x<front ? cs+historyCoefficient*(1/Math.max(1,x-x0)-1/(front-x0))
        : c0+(ci-c0)*erfc((x-x0)/h)/erfc((front-x0)/h);
      phi.push(p);concentration.push(bulk*(x<front?A/k:A));
    }
    const profile={front:front/dx,phi,concentration},config={dx,D,timeTau0,x0,k,c0};
    const measured=[[5,9],[6,10],[7,11]].map(w=>measurePartition(profile,config,w));
    rows.push({lambda,imposedK,fraction,measured:measured.map(r=>r.kEff),
      maxAbsoluteError:Math.max(...measured.map(r=>Math.abs(r.kEff-imposedK))),
      wrongPartitionPreserved:imposedK===k||measured.every(r=>Math.abs(r.kEff-k)>.02)});
    if(lambda===6&&imposedK===k&&fraction===.17){
      const corrupted={...profile,concentration:concentration.map((c,i)=>{
        const r=(i+.5)*dx-front;return r>4&&r<12?c*(1+.1*Math.sin(2*r)):c;
      })};
      const bad=measurePartition(corrupted,config);invalidProfileRefused=bad.liquidRelativeResidual>.005;
    }
  }
  if(!invalidProfileRefused||rows.some(r=>r.maxAbsoluteError>1e-6||!r.wrongPartitionPreserved))throw new Error("partition metrology control failed");
  return {regime,rows,erfMaxError,invalidProfileRefused,maxAbsoluteError:Math.max(...rows.map(r=>r.maxAbsoluteError)),
    controls:"analytic erfc liquid, known inverse-displacement solid history, tanh mixture tails, deliberately incorrect partition, fractional-cell fronts"};
}
