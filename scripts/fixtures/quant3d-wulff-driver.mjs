// Fixed-radius equilibrium experiment. Uniform temperature feedback is fixture
// control and intentionally does not test coupled moving-interface kinetics.
export async function installQuant3WulffDriver() {
  const {Sim3D,DEFAULTS3D}=await import("/src/sim3d.ts");
  const M=await import("/scripts/fixtures/quant3d-wulff-analysis.mjs");
  const S=window.__solidify,device=S.sim().device;S.app.setRun(false);
  const errors=[];
  const onError=event=>errors.push({kind:"uncaptured",message:event.error.message});
  device.addEventListener("uncapturederror",onError);
  device.lost.then(info=>errors.push({kind:"device-lost",reason:info.reason,message:info.message}));
  let sim=null,temperature=1,targetVolume=0,previousVolume=0,lastTime=0,config=null;
  window.__q3wulff={
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
      const {n,dx,radius,lambda,epsilon}=config,D=.6267*lambda;
      if(n!==96||dx!==.8||radius!==20||lambda!==4||![0,.0171].includes(epsilon)
        ||config.maximumTime!==1000)throw new Error("fixed Wulff regression inputs changed");
      sim=new Sim3D(device,n);sim.build();if(!await sim.enableQuant())throw new Error("quant allocation refused");
      const dt=Math.min(dx*dx/(12*D),.02*(1-3*epsilon)**2*Math.min(1,(dx/.8)**2));
      Object.assign(sim.params,{...DEFAULTS3D,solver:1,dx,dt,epsBar:1,tau:1,lambda,delta:epsilon,aniMode3:1,
        deltaZ:0,latent:1,dTherm:D,dSol:D,frozenT:1,noiseAmp:0,pPore:0,twinProb:0,facet:0,
        scen:0,coolRate:0,heatIn:0,alloyOn:0});
      temperature=1-2*(.8839/lambda)/radius;sim.reset(temperature);
      const raw=new Float32Array(n**3*2),ids=new Uint32Array(n**3),phi=new Float32Array(n**3);
      for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
        const i=(z*n+y)*n+x,r=Math.hypot((x+.5-n/2)/config.initialAxes[0],
          (y+.5-n/2)/config.initialAxes[1],(z+.5-n/2)/config.initialAxes[2])*dx;
        phi[i]=.5*(1-Math.tanh((r-radius)/Math.SQRT2));raw[2*i]=phi[i];raw[2*i+1]=temperature;ids[i]=phi[i]>.01?1:0;
      }
      const quats=new Float32Array(4096*4);for(let i=0;i<4096;i++)quats[4*i+3]=1;
      device.queue.writeBuffer(sim.quatBuffer,0,quats);
      for(const dir of [0,1]){
        device.queue.writeTexture({texture:sim.stateTexture(dir)},raw,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
        device.queue.writeTexture({texture:sim.grainTexture(dir)},ids,{bytesPerRow:n*4,rowsPerImage:n},[n,n,n]);
      }
      targetVolume=M.phaseMoments(phi,lambda).volume;previousVolume=targetVolume;lastTime=0;
      await device.queue.onSubmittedWorkDone();
      return {config,params:{...sim.params},targetVolume,temperature,
        note:"identity cubic, production stencil; temperature feedback is fixture control, not a fitted physical coefficient"};
    },
    async control(remaining=config?.maximumTime-sim?.simTime) {
      if(!sim)throw new Error("not staged");
      if(!(remaining>0&&Number.isFinite(remaining)))throw new Error("invalid remaining horizon");
      const steps=Math.ceil(Math.min(config.controlPeriod,remaining)/sim.params.dt),got=await sim.stepSync(steps);
      if(got!==steps)throw new Error("short physics budget");
      const status=await sim.readQuantitativeStatus();if(!status||status.flags||status.issue)throw new Error(JSON.stringify(status));
      const state=await sim.readStateVolume();if(!state)throw new Error("state readback failed");
      temperature=state.T[0];
      const moments=M.phaseMoments(state.phi,config.lambda),elapsed=sim.simTime-lastTime;
      const next=M.nextUniformTemperature({temperature,volume:moments.volume,previousVolume,targetVolume,mobility:moments.mobility,elapsed});
      // Stamp with no seeds changes uniform T and flips fields without changing
      // phi/grain/age. This reuses the production API rather than another PDE.
      sim.quench(temperature-next);await sim.stepSync(0);temperature=next;
      previousVolume=moments.volume;lastTime=sim.simTime;
      return {time:sim.simTime,temperature,volume:moments.volume,relativeVolumeError:(moments.volume-targetVolume)/targetVolume,
        quantitativeStatus:status};
    },
    async measure() {
      if(!sim)throw new Error("not staged");
      const state=await sim.readStateVolume();if(!state)throw new Error("readback failed");
      let tmin=Infinity,tmax=-Infinity;
      for(const t of state.T){tmin=Math.min(tmin,t);tmax=Math.max(tmax,t);}
      if(tmax-tmin>1e-6)throw new Error("feedback temperature is not uniform");
      const observedTemperature=state.T[0];
      const points=M.surfacePoints(state.phi,config.n,config.dx,true);
      let measured;
      try{measured=M.measureWulff(points,config.radius,observedTemperature,config.lambda);}
      catch(error){measured={measurementError:error.message};}
      return {time:sim.simTime,temperature:observedTemperature,temperatureRange:[tmin,tmax],
        ...M.phaseMoments(state.phi,config.lambda),
        ...measured,
        raw:{format:"Wulff surface brackets v1",n:config.n,dx:config.dx,centerConvention:"(cell+.5-n/2)*dx",
          phase:"psi in [0,1]; bracket values oriented from solid to liquid; sign records reversal",
          temperature:observedTemperature,time:sim.simTime,points}};
    },
    async destroy(){if(sim){await device.queue.onSubmittedWorkDone();sim.destroy();sim=null;}},
    async dispose(){await this.destroy();device.removeEventListener("uncapturederror",onError);}
  };
}
