// Browser-only execution; pure helpers are also imported by CPU controls.
export function manufacturedPlaneLine(count,normal,dx,phase=0,epsilon=.0171) {
  const delta=dx/Math.hypot(...normal),unit=normal.map(v=>v/Math.hypot(...normal));
  const a=1+epsilon*(4*unit.reduce((s,v)=>s+v**4,0)-3),state=new Float32Array(count*2);
  for(let i=0;i<count;i++){
    const x=(i-count/2-phase)*delta,t=x/(Math.SQRT2*a),e=Math.exp(-2*Math.abs(t));
    const base=t>=0?e/(1+e):1/(1+e),sech2=4*e/(1+e)**2;
    state[2*i]=base+(.008*Math.sin(.71*x)-.001)*sech2;
    state[2*i+1]=.9-.25*Math.tanh(x/5)+.05*Math.sin(.3*x);
  }
  return state;
}

export async function obliqueRaw(device,texture,dims,bpp) {
  const stride=Math.ceil(dims[0]*bpp/256)*256,b=device.createBuffer({size:stride*dims[1]*dims[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
    const e=device.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:stride,rowsPerImage:dims[1]},dims);
    device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
    const mapped=new Uint8Array(b.getMappedRange()),out=new Uint8Array(dims.reduce((a,b)=>a*b,1)*bpp);
    for(let row=0;row<dims[1]*dims[2];row++)out.set(mapped.subarray(row*stride,row*stride+dims[0]*bpp),row*dims[0]*bpp);
    b.unmap();return out;
  }finally{b.destroy();}
}

export async function createObliquePlane(device,c,initial,M,defaults,specialize) {
  const dims=c.dims,count=dims.reduce((a,b)=>a*b,1),resources=[];
  if(initial.length!==2*count)throw new Error('wrong plane initial field shape');
  const p={...defaults,solver:1,lambda:4,dx:c.dx,dt:c.dt,epsBar:1,tau:1,delta:c.epsilon??.0171,deltaZ:0,
    aniMode3:1,latent:1,dTherm:2.5068,dSol:2.5068,atCoef:0,frozenT:0,alloyOn:0,
    noiseAmp:0,pPore:0,twinProb:0,facet:0,scen:0,coolRate:0,heatIn:0,envRate:0,tFar:.9};
  const sources=[M.FLUX3D_WGSL,M.phi3dWgsl(false,c.candidate===true),M.transport3dWgsl(false)];
  const specs=sources.map(s=>specialize(s,dims,c.normal,{count:c.count??count,boundary:c.boundary??'clamp'}));
  const tex=format=>{const t=device.createTexture({size:dims,dimension:'3d',format,
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|(format==='r8uint'?0:GPUTextureUsage.STORAGE_BINDING)});resources.push(t);return t;};
  const buf=(size,usage)=>{const b=device.createBuffer({size,usage});resources.push(b);return b;};
  const q=new Float32Array(M.MAX_GRAINS3*4);for(let i=0;i<M.MAX_GRAINS3;i++)q[4*i+3]=1;
  device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');let fixture;
  try{
    const state=[tex('rg32float'),tex('rg32float')],grain=[tex('r32uint'),tex('r32uint')],flux=tex('rgba32float'),aux=tex('rg32float'),
      age=tex('rg32float'),fed=tex('r32uint'),mask=tex('r8uint');
    const uniform=buf(M.P3.BYTES,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),quat=buf(q.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),
      twin=buf(4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),status=buf(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),
      staging=buf(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),pipes=[];
    for(const s of specs){const mod=device.createShaderModule({code:s.code}),info=await mod.getCompilationInfo();
      const errors=info.messages.filter(v=>v.type==='error');if(errors.length)throw new Error(errors.map(v=>v.message).join('\n'));
      pipes.push(await device.createComputePipelineAsync({layout:'auto',compute:{module:mod,entryPoint:'main'}}));}
    const E=(binding,resource)=>({binding,resource}),U=E(0,{buffer:uniform}),V=t=>t.createView();
    const groups=[0,1].map(d=>[
      [U,E(1,V(state[d])),E(2,V(grain[d])),E(3,{buffer:quat}),E(4,V(flux))],
      [U,E(1,V(state[d])),E(2,V(grain[d])),E(3,V(flux)),E(4,V(aux)),E(5,V(mask)),E(7,{buffer:status})],
      [U,E(1,V(state[d])),E(2,V(grain[d])),E(3,V(aux)),E(4,V(state[1-d])),E(5,V(grain[1-d])),E(6,V(age)),E(7,V(fed)),
        E(10,{buffer:quat}),E(11,{buffer:twin}),E(12,V(mask)),E(13,{buffer:status})]
    ].map((entries,i)=>device.createBindGroup({layout:pipes[i].getBindGroupLayout(0),entries})));
    const ids=new Uint32Array(count).fill(1);
    for(const d of [0,1]){device.queue.writeTexture({texture:state[d]},initial,{bytesPerRow:dims[0]*8,rowsPerImage:dims[1]},dims);
      device.queue.writeTexture({texture:grain[d]},ids,{bytesPerRow:dims[0]*4,rowsPerImage:dims[1]},dims);}
    device.queue.writeBuffer(quat,0,q);device.queue.writeBuffer(status,0,new Uint32Array([0,0x7f800000,0,0]));
    const data=new ArrayBuffer(M.P3.BYTES),u32=new Uint32Array(data),f32=new Float32Array(data);
    const ints=new Set(['n','frame','aniMode3','seedCount','curGen','scen','alloyOn','idFloor','probeX','probeY','probeZ','solver','frozenT']);
    let dir=0,steps=0,frame=0,time=0;
    fixture={p,state,grain,age,flux,aux,specs,get dir(){return dir;},get steps(){return steps;},
      async advance(amount){
        if(!Number.isSafeInteger(amount)||amount<1)throw new Error('positive exact step count required');
        let left=amount;while(left){const batch=Math.min(left,2048);frame++;
          const values={...p,n:dims[0],frame,time,curGen:1,idFloor:1,seedCount:0,probeX:0xffffffff,probeY:0xffffffff,probeZ:0xffffffff};
          for(const [key,offset] of Object.entries(M.P3)){if(key==='BYTES'||key==='sliceN')continue;
            if(ints.has(key))u32[offset]=values[key]??0;else f32[offset]=values[key]??0;}
          device.queue.writeBuffer(uniform,0,data);const e=device.createCommandEncoder(),pass=e.beginComputePass();
          for(let k=0;k<batch;k++){for(let j=0;j<3;j++){pass.setPipeline(pipes[j]);pass.setBindGroup(0,groups[dir][j]);pass.dispatchWorkgroups(...dims.map(n=>Math.ceil(n/4)));}dir=1-dir;}
          pass.end();device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();steps+=batch;time+=batch*p.dt;left-=batch;
        }
        const e=device.createCommandEncoder();e.copyBufferToBuffer(status,0,staging,0,16);device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);
        const bytes=staging.getMappedRange().slice(0);staging.unmap();const flags=new Uint32Array(bytes)[0];
        if(flags)throw new Error('oblique quantitative flags '+flags);
        return {steps,time:steps*Math.fround(p.dt),declaredTime:time,uniformDt:Math.fround(p.dt)};
      },
      async fields(){return {state:await obliqueRaw(device,state[dir],dims,8),grain:await obliqueRaw(device,grain[dir],dims,4),age:await obliqueRaw(device,age,dims,8)};},
      async destroy(){let failure;try{await device.queue.onSubmittedWorkDone();}catch(e){failure=e;}
        for(const r of resources)try{r.destroy();}catch(e){failure??=e;}if(failure)throw failure;}
    };
  }catch(error){for(const r of resources)try{r.destroy();}catch{}await device.popErrorScope();await device.popErrorScope();throw error;}
  const validation=await device.popErrorScope(),memory=await device.popErrorScope();
  if(validation||memory){await fixture.destroy();throw new Error(validation?.message??memory.message);}return fixture;
}

export async function installObliqueGpuDriver() {
  const H=await import('/scripts/research/quant3d-oblique-gpu-driver.mjs');
  const {plane3dSpecialize}=await import('/scripts/fixtures/plane3d-specialize.mjs');
  const M=await import('/src/shaders3d.ts'),{Sim3D,DEFAULTS3D}=await import('/src/sim3d.ts');
  const S=window.__solidify,device=S.sim().device;S.app.setRun(false);const errors=[];let disposed=false;
  const onError=e=>errors.push({kind:'device',message:e.error.message});device.addEventListener('uncapturederror',onError);
  device.lost.then(info=>{if(!disposed||info.reason!=='destroyed')errors.push({kind:'device-lost',reason:info.reason,message:info.message});});
  const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
  const base64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
  const selected=(bytes,bpp,indices)=>{const out=new Uint8Array(indices.length*bpp);indices.forEach((j,i)=>out.set(bytes.subarray(j*bpp,(j+1)*bpp),i*bpp));return out;};
  window.__q3oblique={errors:()=>[...errors],
    async metadata(){const i=device.adapterInfo;return {hardware:{vendor:i.vendor,architecture:i.architecture,isFallbackAdapter:i.isFallbackAdapter??null},build:S.app.meta().build,
      shaderHashes:await Promise.all([M.FLUX3D_WGSL,M.phi3dWgsl(false),M.transport3dWgsl(false),M.phi3dWgsl(false,true)].map(s=>sha(new TextEncoder().encode(s))))};},
    async periodicControl(input,fixture,candidate){
      const dims=[128,4,4],count=input.period,capacity=dims.reduce((a,b)=>a*b,1),initial=new Float32Array(capacity*2);
      if(count!==257||input.psiStored.length!==count||input.temperatureStored.length!==count)throw new Error('unexpected periodic fixture');
      for(let i=0;i<count;i++){initial[2*i]=input.psiStored[i];initial[2*i+1]=input.temperatureStored[i];}
      const c={dims,count,normal:fixture.geometry.normal,dx:input.uniforms.dx,dt:input.uniforms.dt,epsilon:input.uniforms.delta,candidate,boundary:'periodic'};
      const plane=await H.createObliquePlane(device,c,initial,M,DEFAULTS3D,plane3dSpecialize);
      try{
        const before=await plane.fields(),expectedHash=await sha(new Uint8Array(initial.buffer));
        if(await sha(before.state)!==expectedHash)throw new Error('periodic initial readback mismatch');
        const clock=await plane.advance(1),after=await plane.fields(),state=new Float32Array(after.state.buffer),psi=[],temperature=[];
        for(let i=0;i<count;i++){psi.push(state[2*i]);temperature.push(state[2*i+1]);}
        const flux=new Float32Array((await H.obliqueRaw(device,plane.flux,dims,16)).buffer);
        return {config:c,clock,initialStateSha256:expectedHash,actualInitialInputSha256:await sha(before.state.subarray(0,count*8)),
          psi,temperature,flux:Array.from(flux.subarray(0,count*4)),stateSha256:await sha(after.state),grainSha256:await sha(after.grain),ageSha256:await sha(after.age),
          specialization:plane.specs.map(s=>({geometry:s.geometry,replacements:s.replacements,geometryOnlyRoundtrip:s.geometryOnlyRoundtrip}))};
      }finally{await plane.destroy();}
    },
    async nativeControl(c){
      const n=32,dims=[128,4,4],count=dims.reduce((a,b)=>a*b,1),m=c.normal;
      const center=m.reduce((s,v)=>s+v,0)*(n-1)/2,origin=count/2-Math.floor(center);
      const line=H.manufacturedPlaneLine(count,m,c.dx,center-Math.floor(center)+c.phase,c.epsilon);
      const config={...c,dims,count,boundary:'clamp'};
      const plane=await H.createObliquePlane(device,{...config,normal:c.wrongNormal??m},line,M,DEFAULTS3D,plane3dSpecialize);
      let sim=null;
      const state=new Float32Array(n**3*2),ids=new Uint32Array(n**3).fill(1),quats=new Float32Array(M.MAX_GRAINS3*4);
      for(let j=0;j<M.MAX_GRAINS3;j++)quats[4*j+3]=1;
      const planeIndices=new Int32Array(n**3);
      for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
        const i=(z*n+y)*n+x,j=origin+m[0]*x+m[1]*y+m[2]*z;
        if(j<0||j>=count)throw new Error('native specimen exceeds manufactured line');planeIndices[i]=j;
        state[2*i]=line[2*j];state[2*i+1]=line[2*j+1];
      }
      const comparisons=[];let changedStateBytes=0,changedAgeBytes=0,changedPhaseValues=0,quotientPhaseChanged=0;
      try{
        sim=new Sim3D(device,n,{latticeKinetics:c.candidate});sim.build();
        if(!await sim.enableQuant())throw new Error('native oblique allocation failed');Object.assign(sim.params,plane.p);sim.reset(plane.p.tFar);
        device.queue.writeBuffer(sim.quatBuffer,0,quats);
        for(const d of [0,1]){device.queue.writeTexture({texture:sim.stateTexture(d)},state,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
          device.queue.writeTexture({texture:sim.grainTexture(d)},ids,{bytesPerRow:n*4,rowsPerImage:n},[n,n,n]);}
        const initialChecks=[];
        for(const d of [0,1])for(const [kind,texture,shape,expected] of [
          ['native',sim.stateTexture(d),[n,n,n],new Uint8Array(state.buffer)],
          ['quotient',plane.state[d],dims,new Uint8Array(line.buffer)]]){
          const observed=await H.obliqueRaw(device,texture,shape,8),expectedSha256=await sha(expected),observedSha256=await sha(observed);
          if(observedSha256!==expectedSha256)throw new Error('actual initial upload/readback mismatch');
          initialChecks.push({kind,dir:d,expectedSha256,observedSha256,exact:true});
        }
        let previous=0;
        for(const target of [1,2,4]){
          const got=await sim.stepSync(target-previous);if(got!==target-previous)throw new Error('short native budget');
          const clock=await plane.advance(target-previous);previous=target;
          const native={state:await H.obliqueRaw(device,sim.stateTexture(sim.dir),[n,n,n],8),grain:await H.obliqueRaw(device,sim.grainTexture(sim.dir),[n,n,n],4),age:await H.obliqueRaw(device,sim.ageTexture,[n,n,n],8)};
          const quotient=await plane.fields(),indices=[],mapped=[],margin=2*target;
          const qstate=new Float32Array(quotient.state.buffer);
          for(let i=0;i<count;i++)if(!Number.isFinite(qstate[2*i])||!Number.isFinite(qstate[2*i+1])
            ||qstate[2*i]<0||qstate[2*i]>1||qstate[2*i+1]<-1||qstate[2*i+1]>2)throw new Error('invalid evolved quotient field');
          if(target===4)for(let i=0;i<count;i++)quotientPhaseChanged+=qstate[2*i]!==line[2*i];
          for(let z=margin;z<n-margin;z++)for(let y=margin;y<n-margin;y++)for(let x=margin;x<n-margin;x++){
            const i=(z*n+y)*n+x;indices.push(i);mapped.push(planeIndices[i]);}
          for(const [field,bpp] of [['state',8],['grain',4],['age',8]]){
            const a=selected(native[field],bpp,indices),b=selected(quotient[field],bpp,mapped);let mismatches=0;const examples=[];
            for(let i=0;i<a.length;i++)if(a[i]!==b[i]){mismatches++;if(examples.length<8)examples.push({byte:i,native:a[i],quotient:b[i]});}
            if(field==='state'&&target===4){const initial=selected(new Uint8Array(state.buffer),8,indices);for(let i=0;i<a.length;i++)changedStateBytes+=a[i]!==initial[i];
              const av=new Float32Array(a.buffer),iv=new Float32Array(initial.buffer);for(let i=0;i<av.length;i+=2)changedPhaseValues+=av[i]!==iv[i];}
            if(field==='age')for(const v of a)changedAgeBytes+=v!==0;
            comparisons.push({target,field,margin,interiorCells:indices.length,mismatches,examples,
              nativeSha256:await sha(a),quotientSha256:await sha(b),nativeBase64:base64(a),quotientBase64:base64(b),clock});
          }
        }
        const status=await sim.readQuantitativeStatus();if(!status||status.flags||status.issue)throw new Error('native quantitative refusal');
        return {config:c,initialStateSha256:await sha(new Uint8Array(state.buffer)),initialLineSha256:await sha(new Uint8Array(line.buffer)),comparisons,
          changedStateBytes,changedPhaseValues,quotientPhaseChanged,quotientFiniteAndInRange:true,changedAgeBytes,initialChecks,nativeStatus:status,specialization:plane.specs.map(s=>({geometry:s.geometry,replacements:s.replacements,rectangularFluxFacesDisabled:s.rectangularFluxFacesDisabled,geometryOnlyRoundtrip:s.geometryOnlyRoundtrip}))};
      }finally{try{await device.queue.onSubmittedWorkDone();}finally{try{sim?.destroy();}finally{await plane.destroy();}}}
    },
    async dispose(){disposed=true;device.removeEventListener('uncapturederror',onError);}
  };
}
