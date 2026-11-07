// CPU reference interpolation and readback metrology. No GPU or app imports.
export function kineticProfile(target, x) {
  const grid=target.x,n=grid.length,dx=grid[1]-grid[0];
  if(x>=grid[0]&&x<=grid[n-1]){
    const i=Math.min(n-2,Math.max(0,Math.floor((x-grid[0])/dx))),t=(x-grid[i])/dx;
    const interpolate=(values,derivatives)=>(2*t**3-3*t*t+1)*values[i]
      +(t**3-2*t*t+t)*dx*derivatives[i]+(-2*t**3+3*t*t)*values[i+1]
      +(t**3-t*t)*dx*derivatives[i+1];
    return {psi:.5*(1+interpolate(target.phi,target.phiDerivative)),T:1+interpolate(target.u,target.uDerivative)};
  }
  const solid=x<grid[0],m=target.measurement,last=m.modalOuterFits.at(-1);
  const coefficients=solid?last.solidCoefficients:last.liquidCoefficients;
  const basis=[1];if(!solid)basis.push(Math.exp(-m.kappa*x));
  for(const root of m.metrologyHeatRoots){
    if(root.side!==(solid?"solid":"liquid"))continue;
    const amplitude=Math.exp(root.real*x);basis.push(amplitude*Math.cos(root.imaginary*x),amplitude*Math.sin(root.imaginary*x));
  }
  return {psi:solid?1:0,T:1+basis.reduce((sum,value,i)=>sum+value*coefficients[i],0)};
}

export function kineticLine(target,{dims,dx,offset=0},time=0){
  const psi=[],T=[];
  for(let i=0;i<dims[0];i++){
    const p=kineticProfile(target,(i+.5-dims[0]/2)*dx-offset-target.config.velocity*time);
    psi.push(p.psi);T.push(p.T);
  }
  return {psi,T};
}

function leastSquares(rows,values){
  if(rows.length<rows[0].length+2)return null;
  const n=rows[0].length,scales=Array.from({length:n},(_,j)=>Math.hypot(...rows.map(row=>row[j])));
  const columns=Array.from({length:n},(_,j)=>rows.map(row=>row[j]/scales[j]));
  const q=[],R=Array.from({length:n},()=>Array(n).fill(0));
  for(let j=0;j<n;j++){
    const v=[...columns[j]];
    for(let repeat=0;repeat<2;repeat++)for(let k=0;k<j;k++){
      const projection=v.reduce((sum,value,i)=>sum+value*q[k][i],0);R[k][j]+=projection;
      for(let i=0;i<v.length;i++)v[i]-=projection*q[k][i];
    }
    R[j][j]=Math.hypot(...v);if(R[j][j]<1e-10)return null;q.push(v.map(value=>value/R[j][j]));
  }
  const b=q.map(column=>column.reduce((sum,value,i)=>sum+value*values[i],0)),c=Array(n).fill(0);
  for(let j=n-1;j>=0;j--)c[j]=(b[j]-R[j].reduce((sum,value,k)=>sum+(k>j?value*c[k]:0),0))/R[j][j];
  const coefficients=c.map((value,i)=>value/scales[i]);
  const rms=Math.sqrt(rows.reduce((sum,row,i)=>sum+(row.reduce((v,x,j)=>v+x*coefficients[j],0)-values[i])**2,0)/rows.length);
  return {coefficients,rms,points:rows.length};
}

export function analyzeKinetic(target,config,sample,initial){
  const sum=values=>values.reduce((a,b)=>a+b,0),mean=values=>sum(values)/values.length;
  const reference=kineticLine(target,config,sample.time),n=config.dims[0],dx=config.dx;
  const massDisplacement=(sum(sample.psi)-sum(initial.psi))*dx;
  const rows={solid:[],liquid:[]},values={solid:[],liquid:[]},bulk={solid:[],liquid:[]};
  const residuals={phase:[],temperature:[]};
  for(let i=0;i<n;i++){
    const coordinate=(i+.5-n/2)*dx-(config.offset??0)-massDisplacement;
    if(Math.abs(coordinate)<24){residuals.phase.push(sample.psi[i]-reference.psi[i]);residuals.temperature.push(sample.T[i]-reference.T[i]);}
    if(Math.abs(coordinate)<40||Math.abs(coordinate)>56)continue;
    const side=coordinate<0?"solid":"liquid",row=[1];
    if(side==="liquid")row.push(Math.exp(-target.measurement.kappa*coordinate));
    for(const root of target.measurement.metrologyHeatRoots){
      if(root.side!==side)continue;
      const amplitude=Math.exp(root.real*coordinate);row.push(amplitude*Math.cos(root.imaginary*coordinate),amplitude*Math.sin(root.imaginary*coordinate));
    }
    rows[side].push(row);values[side].push(sample.T[i]-1);bulk[side].push(sample.T[i]);
  }
  const rms=values=>Math.sqrt(mean(values.map(value=>value*value)));
  const solid=rows.solid.length?leastSquares(rows.solid,values.solid):null;
  const liquid=rows.liquid.length?leastSquares(rows.liquid,values.liquid):null;
  const uS=solid?.coefficients[0],uL=liquid?liquid.coefficients[0]+liquid.coefficients[1]:null;
  return {massDisplacement,expectedDisplacement:target.config.velocity*sample.time,
    meanVelocity:sample.time>0?massDisplacement/sample.time:null,
    relativeVelocityDifference:sample.time>0?massDisplacement/(target.config.velocity*sample.time)-1:null,
    profileResidual:{frame:"independent CPU mean-velocity frame",phaseRms:rms(residuals.phase),temperatureRms:rms(residuals.temperature),
      phaseMax:Math.max(...residuals.phase.map(Math.abs)),temperatureMax:Math.max(...residuals.temperature.map(Math.abs))},
    energyChange:(sum(sample.T)-sum(sample.psi)-sum(initial.T)+sum(initial.psi))*dx,
    outerTemperature:{windowW0:[40,56],solidMean:bulk.solid.length?mean(bulk.solid):null,liquidMean:bulk.liquid.length?mean(bulk.liquid):null,
      solidFit:solid,liquidFit:liquid,uSolidExtrapolated:uS??null,uLiquidExtrapolated:uL,
      jump:uS!=null&&uL!=null?uL-uS:null,
      latentJump:uS!=null&&liquid?uS-liquid.coefficients[0]:null,
      note:"separate free bulk fits with independent CPU characteristic exponents; residuals retained; no zero-beta inference"}};
}

export function selfTestKinetic(target){
  if(target.format!=="solidify-coupled-kinetic-target-v1"||target.config.velocity!==.04||target.config.physicalDx!==.8
    ||target.config.normal!=="100"||target.config.lambda_!==4||target.config.epsilon!==.0171)throw new Error("unexpected independent target");
  const config={dims:[1536,8,8],dx:.8,offset:0},initial=kineticLine(target,config),final={...kineticLine(target,config,160),time:160};
  const positive=analyzeKinetic(target,config,final,initial);
  const perturbed={...final,psi:final.psi.map((value,i)=>i===768?value+.05:value)};
  const negative=analyzeKinetic(target,config,perturbed,initial);
  if(Math.abs(positive.meanVelocity-.04)>1e-12||positive.profileResidual.phaseRms!==0||negative.profileResidual.phaseMax<.04)throw new Error("profile metrology controls failed");
  const knotError=Math.max(...target.x.filter((_,i)=>i%64===0).map(x=>{
    const i=Math.round((x-target.x[0])/.0125),p=kineticProfile(target,x);
    return Math.max(Math.abs(p.psi-.5*(target.phi[i]+1)),Math.abs(p.T-(target.u[i]+1)));
  }));
  if(knotError>1e-12)throw new Error("Hermite reference did not preserve knots");
  return {positive,perturbationDetected:negative.profileResidual.phaseMax,knotError};
}
