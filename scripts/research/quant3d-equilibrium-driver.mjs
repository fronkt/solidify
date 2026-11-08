// Independent mesh/radius equilibrium matrix using unmodified production WGSL.
// Uniform temperature feedback holds phase volume; it does not test kinetics.
import {phaseCrossing} from '../fixtures/quant3d-tip-analysis.mjs';

// Explicit translation sampling can place psi=.5 exactly on a grid node.
// Preserve that exact endpoint root; every nonendpoint uses the original fit.
export function equilibriumTranslationPoints(phi,n,dx) {
  if(phi.length!==n**3)throw new Error("wrong phase volume shape");
  const at=c=>phi[(c[2]*n+c[1])*n+c[0]],points=[];
  for(let axis=0;axis<3;axis++)for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const c=[x,y,z];if(c[axis]<2||c[axis]+3>=n)continue;
    const a=at(c),next=[...c];next[axis]++;const b=at(next);
    if(!((a>=.5&&b<.5)||(a<.5&&b>=.5)))continue;
    const sign=a>=.5?1:-1,read=k=>{const q=[...c];q[axis]+=k;const v=at(q);return sign===1?v:1-v;};
    const brackets=[-2,-1,0,1,2,3].map(read);
    const endpoint=brackets[2]===.5?0:brackets[3]===.5?1:null;
    const root=endpoint??phaseCrossing(brackets),coarse=endpoint??phaseCrossing([-1,0,1,2].map(read),[-1,0,1,2]);
    const xyz=c.map(v=>(v+.5-n/2)*dx);xyz[axis]+=root*dx;
    points.push({xyz,error:Math.abs(root-coarse)*dx,axis,cell:c,solidToLiquidSign:sign,brackets,root,
      ...(endpoint===null?{}:{endpointRoot:endpoint})});
  }
  if(points.length<100)throw new Error("Wulff surface unresolved");
  return points;
}

export function equilibriumFrame({n,dx,centerOffset=[0,0,0]}) {
  if(!Number.isSafeInteger(n)||n<1||!(dx>0&&Number.isFinite(dx))||!Array.isArray(centerOffset)
    ||centerOffset.length!==3||centerOffset.some(v=>!Number.isFinite(v)||Math.abs(v)>dx/2))
    throw new Error("invalid declared equilibrium coordinate frame");
  const offset=Object.freeze([...centerOffset]);
  return Object.freeze({n,dx,offset,
    // The cell-unit form preserves the original initialization arithmetic.
    apply:(point,cellUnits=false)=>point.map((v,a)=>v-offset[a]/(cellUnits?dx:1))});
}

export function equilibriumInitialFields(config) {
  const {n,dx,radius,initialAxes=[1,1,1],lambda=4}=config,frame=equilibriumFrame(config);
  const temperature=1-2*(.8839/lambda)/radius;
  const raw=new Float32Array(n**3*2),ids=new Uint32Array(n**3),phi=new Float32Array(n**3);
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=frame.apply([x+.5-n/2,y+.5-n/2,z+.5-n/2],true);
    const i=(z*n+y)*n+x,r=Math.hypot(p[0]/initialAxes[0],p[1]/initialAxes[1],p[2]/initialAxes[2])*dx;
    phi[i]=.5*(1-Math.tanh((r-radius)/Math.SQRT2));raw[2*i]=phi[i];raw[2*i+1]=temperature;ids[i]=phi[i]>.01?1:0;
  }
  return {raw,ids,phi,frame,temperature};
}

export function equilibriumCentroid(phi,frame) {
  const {n,dx}=frame;if(phi.length!==n**3)throw new Error("wrong centroid volume shape");
  const weights=[new Float64Array(n),new Float64Array(n),new Float64Array(n)];let volume=0;
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=phi[(z*n+y)*n+x];if(!Number.isFinite(p)||p<0||p>1)throw new Error("invalid centroid phase");
    volume+=p;weights[0][x]+=p;weights[1][y]+=p;weights[2][z]+=p;
  }
  if(!(volume>0))throw new Error("empty centroid phase");
  const lab=[0,0,0],local=[0,0,0];
  for(let i=0;i<n;i++){
    const position=(i+.5-n/2)*dx,adapted=frame.apply([position,position,position]);
    for(let a=0;a<3;a++){lab[a]+=weights[a][i]*position;local[a]+=weights[a][i]*adapted[a];}
  }
  return {volume,centroidLab:lab.map(v=>v/volume),centroidFrame:local.map(v=>v/volume)};
}

export function equilibriumFramePoints(points,frame) {
  // Exact identity for every existing default-matrix caller.
  return frame.offset.every(v=>v===0)?points:points.map(p=>({...p,xyz:frame.apply(p.xyz)}));
}

export async function installQuant3WulffCalibrationDriver() {
  const {Sim3D,DEFAULTS3D}=await import("/src/sim3d.ts");
  const M=await import("/scripts/fixtures/quant3d-wulff-analysis.mjs");
  const {readStateVolumeAligned}=await import("/scripts/research/quant3d-readback.mjs");
  const H=await import("/scripts/research/quant3d-equilibrium-driver.mjs");
  const S=window.__solidify,device=S.sim().device;S.app.setRun(false);
  const errors=[];
  const onError=event=>errors.push({kind:"uncaptured",message:event.error.message});
  device.addEventListener("uncapturederror",onError);
  let disposed=false;
  device.lost.then(info=>{if(!disposed)errors.push({kind:"device-lost",reason:info.reason,message:info.message});});
  let sim=null,temperature=1,targetVolume=0,previousVolume=0,lastTime=0,config=null,frame=null;
  let evidence=false,physicsSteps=0,uploadedPhaseSha256=null;
  const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
  const clock=()=>({steps:physicsSteps,dt:sim.params.dt,uniformDt:Math.fround(sim.params.dt),
    declaredTime:physicsSteps*sim.params.dt,uniformTime:physicsSteps*Math.fround(sim.params.dt),simTime:sim.simTime});
  window.__q3wulffCalib={
    async metadata() {
      const {FLUX3D_WGSL,phi3dWgsl,transport3dWgsl}=await import("/src/shaders3d.ts");
      const sha=async source=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(source))),v=>v.toString(16).padStart(2,"0")).join("");
      const info=device.adapterInfo;
      return {hardware:info?{vendor:info.vendor,architecture:info.architecture,device:info.device,
        description:info.description,isFallbackAdapter:info.isFallbackAdapter??null}:null,
        deviceLimits:{maxBufferSize:device.limits.maxBufferSize,maxTextureDimension3D:device.limits.maxTextureDimension3D},
        compiledSourceHashes:Object.fromEntries(await Promise.all([
          ["flux",FLUX3D_WGSL],["purePhase",phi3dWgsl(false)],["pureTransport",transport3dWgsl(false)]
        ].map(async([name,source])=>[name,await sha(source)]))),
        build:S.app.meta().build};
    },
    errors(){return [...errors];},
    async stage(c={}) {
      if(sim){await device.queue.onSubmittedWorkDone();sim.destroy();}
      config={n:96,dx:.8,radius:20,initialAxes:[1,1,1],lambda:4,epsilon:0,controlPeriod:4,maximumTime:1000,...c};
      frame=H.equilibriumFrame(config);evidence=Object.hasOwn(c,"centerOffset");physicsSteps=0;
      const {n,dx,radius,lambda,epsilon}=config,D=.6267*lambda;
      if(!Number.isSafeInteger(n)||n<64||n>192||!(dx>0&&radius>0&&radius<.35*n*dx)
        ||lambda!==4||![0,.0171].includes(epsilon)||!(config.maximumTime>0&&Number.isFinite(config.maximumTime))
        ||![.5,1].includes(config.dtScale??1)||config.initialAxes.length!==3
        ||config.initialAxes.some(v=>!(v>0&&Number.isFinite(v)))
        ||(config.targetVolume!=null&&!(config.targetVolume>0&&Number.isFinite(config.targetVolume))))
        throw new Error("research Wulff geometry is outside the declared matrix");
      sim=new Sim3D(device,n);sim.build();if(!await sim.enableQuant())throw new Error("quant allocation refused");
      const dt=Math.min(dx*dx/(12*D),.02*(1-3*epsilon)**2*Math.min(1,(dx/.8)**2))*(config.dtScale??1);
      Object.assign(sim.params,{...DEFAULTS3D,solver:1,dx,dt,epsBar:1,tau:1,lambda,delta:epsilon,aniMode3:1,
        deltaZ:0,latent:1,dTherm:D,dSol:D,frozenT:1,noiseAmp:0,pPore:0,twinProb:0,facet:0,
        scen:0,coolRate:0,heatIn:0,alloyOn:0});
      temperature=1-2*(.8839/lambda)/radius;sim.reset(temperature);
      const {raw,ids,phi}=H.equilibriumInitialFields(config);
      uploadedPhaseSha256=evidence?await sha(phi):null;
      const quats=new Float32Array(4096*4);for(let i=0;i<4096;i++)quats[4*i+3]=1;
      device.queue.writeBuffer(sim.quatBuffer,0,quats);
      for(const dir of [0,1]){
        device.queue.writeTexture({texture:sim.stateTexture(dir)},raw,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
        device.queue.writeTexture({texture:sim.grainTexture(dir)},ids,{bytesPerRow:n*4,rowsPerImage:n},[n,n,n]);
      }
      targetVolume=config.targetVolume??M.phaseMoments(phi,lambda).volume;previousVolume=targetVolume;lastTime=0;
      await device.queue.onSubmittedWorkDone();
      return {config,params:{...sim.params},targetVolume,temperature,
        ...(evidence?{translation:{declaredOffset:[...frame.offset],uploadedPhaseSha256},clock:clock()}:{}),
        note:"identity cubic, production stencil; temperature feedback is fixture control, not a fitted physical coefficient"};
    },
    async control(remaining=config?.maximumTime-sim?.simTime) {
      if(!sim)throw new Error("not staged");
      if(!(remaining>0&&Number.isFinite(remaining)))throw new Error("invalid remaining horizon");
      const steps=Math.ceil(Math.min(config.controlPeriod,remaining)/sim.params.dt),got=await sim.stepSync(steps);
      if(got!==steps)throw new Error("short physics budget");
      physicsSteps+=got;
      const status=await sim.readQuantitativeStatus();if(!status||status.flags||status.issue)throw new Error(JSON.stringify(status));
      const state=await readStateVolumeAligned(sim);if(!state)throw new Error("state readback failed");
      temperature=state.T[0];
      const moments=M.phaseMoments(state.phi,config.lambda),elapsed=sim.simTime-lastTime;
      const next=M.nextUniformTemperature({temperature,volume:moments.volume,previousVolume,targetVolume,mobility:moments.mobility,elapsed});
      // Stamp with no seeds changes uniform T and flips fields without changing
      // phi/grain/age. This reuses the production API rather than another PDE.
      sim.quench(temperature-next);await sim.stepSync(0);temperature=next;
      previousVolume=moments.volume;lastTime=sim.simTime;
      return {time:sim.simTime,temperature,volume:moments.volume,relativeVolumeError:(moments.volume-targetVolume)/targetVolume,
        quantitativeStatus:status,...(evidence?{clock:clock(),executedSteps:got}:{})};
    },
    async measure(options={}) {
      if(!sim)throw new Error("not staged");
      if(options.omitRecentering&&!evidence)throw new Error("recentring control requires explicit translation evidence");
      const state=await readStateVolumeAligned(sim);if(!state)throw new Error("readback failed");
      let tmin=Infinity,tmax=-Infinity;
      for(const t of state.T){tmin=Math.min(tmin,t);tmax=Math.max(tmax,t);}
      if(evidence&&(!Number.isFinite(tmin)||!Number.isFinite(tmax)))throw new Error("nonfinite translation temperature readback");
      if(tmax-tmin>1e-6)throw new Error("feedback temperature is not uniform");
      const observedTemperature=state.T[0];
      // This SAME adapter produces fit coordinates and the recentered centroid.
      // The negative control changes the adapter while declaration stays intact.
      const actualFrame=options.omitRecentering?H.equilibriumFrame({...config,centerOffset:[0,0,0]}):frame;
      const sampled=evidence?H.equilibriumTranslationPoints(state.phi,config.n,config.dx)
        :M.surfacePoints(state.phi,config.n,config.dx,true);
      const points=H.equilibriumFramePoints(sampled,actualFrame);
      const endpointHandling=evidence?{policy:"exact psi=.5 grid node: root0 or root1; original polynomial otherwise",
        root0:sampled.filter(p=>p.endpointRoot===0).length,root1:sampled.filter(p=>p.endpointRoot===1).length}:null;
      const translation=evidence?{declaredOffset:[...frame.offset],appliedOffset:[...actualFrame.offset],
        uploadedPhaseSha256,phaseSha256:await sha(state.phi),...H.equilibriumCentroid(state.phi,actualFrame)}:null;
      let measured;
      try{measured=M.measureWulff(points,config.radius,observedTemperature,config.lambda);}
      catch(error){measured={measurementError:error.message};}
      return {time:sim.simTime,temperature:observedTemperature,temperatureRange:[tmin,tmax],
        ...M.phaseMoments(state.phi,config.lambda),
        ...measured,
        ...(evidence?{translation,clock:clock(),endpointHandling}:{}),
        raw:{format:"Wulff surface brackets v1",n:config.n,dx:config.dx,centerConvention:"(cell+.5-n/2)*dx",
          ...(evidence?{declaredCenterOffset:[...frame.offset],appliedCenterOffset:[...actualFrame.offset],
            centerConvention:"(cell+.5-n/2)*dx-appliedCenterOffset",clock:clock(),translation,endpointHandling}:{}),
          phase:"psi in [0,1]; bracket values oriented from solid to liquid; sign records reversal",
          temperature:observedTemperature,time:sim.simTime,points}};
    },
    async destroy(){const old=sim;sim=null;if(old)try{await device.queue.onSubmittedWorkDone();}finally{old.destroy();}},
    async dispose(){try{await this.destroy();}finally{disposed=true;device.removeEventListener("uncapturederror",onError);}}
  };
}
