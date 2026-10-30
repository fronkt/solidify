// Symmetry is checked against an independent full-volume evolution, followed
// by an analytic divergence probe. Removing only the marked fix must falsify
// both boundary checks; an image or a flat equilibrium plane cannot do that.
export async function quant3BoundaryChecks(){
  const {Sim3D}=await import("/src/sim3d.ts");
  const {phi3dWgsl,MAX_GRAINS3}=await import("/src/shaders3d.ts");
  const S=window.__solidify,device=S.sim().device;S.app.setRun(false);
  const code=phi3dWgsl(false),begin="// QUANT-NORMAL-FLUX-BEGIN",end="// QUANT-NORMAL-FLUX-END";
  const first=code.indexOf(begin),last=code.indexOf(end);
  if(first<0||last<first||first!==code.lastIndexOf(begin)||last!==code.lastIndexOf(end))throw new Error("quantitative ghost markers changed");
  const oldCode=code.slice(0,first)+code.slice(last+end.length);
  const module=device.createShaderModule({code:oldCode,label:"deliberate old clamped normal-A operator"});
  const info=await module.getCompilationInfo(),errors=info.messages.filter(m=>m.type==="error");
  if(errors.length)throw new Error(errors.map(e=>e.message).join("\n"));
  const oldPhase=await device.createComputePipelineAsync({layout:"auto",compute:{module,entryPoint:"main"}});
  const quats=new Float32Array(MAX_GRAINS3*4);for(let i=0;i<MAX_GRAINS3;i++)quats[4*i+3]=1;
  const sims=[];
  async function create(n,old=false){
    const s=new Sim3D(device,n);sims.push(s);s.build();
    if(!await s.enableQuant())throw new Error("quantitative boundary fixture allocation failed");
    Object.assign(s.params,{solver:1,lambda:4,dx:.8,dt:.005,epsBar:1,tau:1,aniMode3:1,delta:.04,deltaZ:0,
      dTherm:2.5068,dSol:2.5068,latent:1,frozenT:0,noiseAmp:0,pPore:0,scen:0,coolRate:0,heatIn:0,twinProb:0,facet:0});
    s.reset(.8);device.queue.writeBuffer(s.quatBuffer,0,quats);
    if(old){s.quant.phase[0]=oldPhase;s.quantGroups(s.quant);}
    return s;
  }
  function writeSphere(s,centered){
    const n=s.n,dx=s.params.dx,center=centered?n/2:0,state=new Float32Array(n*n*n*2),grain=new Uint32Array(n*n*n);
    for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const i=(z*n+y)*n+x,v=[x,y,z].map(a=>(a+.5-center)*dx),r=Math.hypot(...v),p=.5*(1-Math.tanh((r-6)/Math.SQRT2));
      state[2*i]=p;state[2*i+1]=.8+.015*Math.cos(.2*v[0])*Math.cos(.2*v[1])*Math.cos(.2*v[2]);grain[i]=p>.01?1:0;
    }
    for(const d of [0,1]){
      device.queue.writeTexture({texture:s.stateTexture(d)},state,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
      device.queue.writeTexture({texture:s.grainTexture(d)},grain,{bytesPerRow:n*4,rowsPerImage:n},[n,n,n]);
    }
  }
  const sum=a=>{let out=0;for(const x of a){if(!Number.isFinite(x))throw new Error("nonfinite boundary fixture");out+=x;}return out;};
  function compare(full,oct){
    let maxPhi=0,maxT=0,boundaryPhi=0,boundaryT=0,boundarySamples=0;
    for(let z=0;z<32;z++)for(let y=0;y<32;y++)for(let x=0;x<32;x++){
      const a=((z+32)*64+y+32)*64+x+32,b=(z*32+y)*32+x,
        p=Math.abs(full.phi[a]-oct.phi[b]),t=Math.abs(full.T[a]-oct.T[b]);
      if(!Number.isFinite(p)||!Number.isFinite(t))throw new Error("nonfinite mirror comparison");
      maxPhi=Math.max(maxPhi,p);maxT=Math.max(maxT,t);
      if(x===0||y===0||z===0){boundarySamples++;boundaryPhi=Math.max(boundaryPhi,p);boundaryT=Math.max(boundaryT,t);}
    }
    return {maxPhi,maxT,boundaryPhi,boundaryT,boundarySamples};
  }
  const mirror=[],manufactured=[];
  try{
    const full=await create(64),octant=await create(32),oldOctant=await create(32,true);
    writeSphere(full,true);writeSphere(octant,false);writeSphere(oldOctant,false);
    const initial=sum((await octant.readStateVolume()).phi);let previous=0;
    for(const target of [1,17,64]){
      for(const s of [full,octant,oldOctant])await s.stepSync(target-previous);previous=target;
      const f=await full.readStateVolume(),o=await octant.readStateVolume(),b=await oldOctant.readStateVolume();
      if(!f||!o||!b)throw new Error("mirror state readback failed");
      const statuses=await Promise.all([full,octant,oldOctant].map(s=>s.readQuantitativeStatus()));
      if(statuses.some(s=>!s||s.flags||s.issue))throw new Error(`boundary fixture refused: ${JSON.stringify(statuses)}`);
      mirror.push({target,correct:compare(f,o),oldOperator:compare(f,b),initialPhase:initial,phase:sum(o.phi),statuses});
    }

    // A_x=x (or x-L at the upper face), with phi=.5,T=1,w=1, gives
    // div(A)=1 at that face when its normal ghost is odd. Clamping A instead
    // gives exactly one half. Run PHI then TRANSPORT without recomputing A.
    const correct=await create(32),old=await create(32,true),n=32,dt=.001;
    for(const axis of [0,1,2])for(const side of [0,1]){
      const row={axis,side:side?"upper":"lower",expectedPhi:.5+dt,correct:null,oldOperator:null};
      for(const [label,s]of [["correct",correct],["oldOperator",old]]){
        Object.assign(s.params,{dt,delta:0,aniMode3:0,frozenT:1});s.dir=0;s.clearQuantitativeStatus();
        const state=new Float32Array(n*n*n*2),grain=new Uint32Array(n*n*n).fill(1),flux=new Float32Array(n*n*n*4);
        for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
          const i=(z*n+y)*n+x,v=[x,y,z][axis];state[2*i]=.5;state[2*i+1]=1;
          flux[4*i+axis]=(v+.5-(side?n:0))*s.params.dx;flux[4*i+3]=1;
        }
        for(const d of [0,1]){
          device.queue.writeTexture({texture:s.stateTexture(d)},state,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
          device.queue.writeTexture({texture:s.grainTexture(d)},grain,{bytesPerRow:n*4,rowsPerImage:n},[n,n,n]);
        }
        device.queue.writeTexture({texture:s.fluxTex},flux,{bytesPerRow:n*16,rowsPerImage:n},[n,n,n]);
        s.writeParams(0);const enc=device.createCommandEncoder(),pass=enc.beginComputePass();
        for(const [pipe,bg]of [[s.quant.phase[0],s.quant.phaseBG[0][0]],[s.quant.transport[0],s.quant.transportBG[0][0]]]){
          pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(n/4,n/4,n/4);
        }
        pass.end();device.queue.submit([enc.finish()]);await device.queue.onSubmittedWorkDone();s.dir=1;
        const v=await s.readStateVolume(),status=await s.readQuantitativeStatus();if(!v||!status||status.flags||status.issue)throw new Error("manufactured boundary probe refused");
        let maxError=0,sumPhi=0,count=0;
        for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)if([x,y,z][axis]===(side?n-1:0)){
          const p=v.phi[(z*n+y)*n+x];if(!Number.isFinite(p))throw new Error("nonfinite manufactured phase");
          maxError=Math.max(maxError,Math.abs(p-row.expectedPhi));sumPhi+=p;count++;
        }
        row[label]={maxError,meanPhi:sumPhi/count,samples:count,status};
      }
      manufactured.push(row);
    }
    return {config:{full:64,octant:32,dx:.8,dt:.005,radius:6,lambda:4,delta:.04,identityQuaternion:true,
      scalarTemperature:".8+.015*cos(.2x)*cos(.2y)*cos(.2z)",oldControl:"remove only QUANT-NORMAL-FLUX marked block"},mirror,manufactured};
  }finally{await device.queue.onSubmittedWorkDone();for(const s of sims)s.destroy();}
}
