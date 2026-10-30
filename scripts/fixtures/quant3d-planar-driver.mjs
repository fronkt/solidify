// Efficient long-normal planar reference. This is the production 3D stencil
// with integer texture bounds specialized, not a replacement 1D solver.
export async function installQuant3PlanarDriver() {
  const { Sim3D, DEFAULTS3D } = await import("/src/sim3d.ts");
  const { FLUX3D_WGSL, phi3dWgsl, transport3dWgsl, P3, MAX_GRAINS3 } = await import("/src/shaders3d.ts");
  const { rect3dSpecialize } = await import("/scripts/fixtures/rect3d-specialize.mjs");
  const S=window.__solidify,device=S.sim().device;S.app.setRun(false);
  const sources=[FLUX3D_WGSL,phi3dWgsl(true),transport3dWgsl(true)],ints=new Set([
    "n","frame","aniMode3","seedCount","curGen","scen","alloyOn","idFloor","probeX","probeY","probeZ","solver","frozenT"]);
  const quats=new Float32Array(MAX_GRAINS3*4);for(let i=0;i<MAX_GRAINS3;i++)quats[4*i+3]=1;
  const sha=async b=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",b))].map(v=>v.toString(16).padStart(2,"0")).join("");
  let active=null;
  const params=c=>({...DEFAULTS3D,solver:1,lambda:c.lambda,dx:c.dx,dt:c.dt,epsBar:1,tau:1,delta:0,deltaZ:0,
    aniMode3:0,latent:1,dTherm:.6267*c.lambda,dSol:.6267*c.lambda,atCoef:c.at,frozenT:1,alloyOn:1,
    noiseAmp:0,pPore:0,twinProb:0,facet:0,scen:0,coolRate:0,heatIn:0,c0:.3,kPart:.15});
  const fields=c=>{
    const [nx,ny,nz]=c.dims,count=nx*ny*nz,state=new Float32Array(count*2),grain=new Uint32Array(count),solute=new Float32Array(count);
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const i=(z*ny+y)*nx+x,p=.5*(1-Math.tanh(((x+.5)*c.dx-c.x0)/Math.SQRT2));
      state[2*i]=p;state[2*i+1]=c.T;grain[i]=p>.01?1:0;solute[i]=.3*(1-.85*p);
    }return {state,grain,solute};
  };
  async function raw(texture,dims,bpp,origin=[0,0,0]){
    const row=Math.ceil(dims[0]*bpp/256)*256,b=device.createBuffer({size:row*dims[1]*dims[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const e=device.createCommandEncoder();e.copyTextureToBuffer({texture,origin},{buffer:b,bytesPerRow:row,rowsPerImage:dims[1]},dims);
      device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const p=new Uint8Array(b.getMappedRange()),out=new Uint8Array(dims.reduce((a,b)=>a*b,1)*bpp);
      for(let i=0;i<dims[1]*dims[2];i++)out.set(p.subarray(i*row,i*row+dims[0]*bpp),i*dims[0]*bpp);b.unmap();return out;
    }finally{b.destroy();}
  }
  const crossing=row=>{for(let i=0;i<row.length-1;i++)if(row[i]>=.5&&row[i+1]<.5)return i+.5+(row[i]-.5)/(row[i]-row[i+1]);return NaN;};
  async function create(c){
    const dims=c.dims,res=[],p=params(c);
    const tex=format=>{const t=device.createTexture({size:dims,dimension:"3d",format,
      usage:GPUTextureUsage.TEXTURE_BINDING|(format==="r8uint"?0:GPUTextureUsage.STORAGE_BINDING)|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});res.push(t);return t;};
    const buf=(size,usage)=>{const b=device.createBuffer({size,usage});res.push(b);return b;};
    device.pushErrorScope("out-of-memory");device.pushErrorScope("validation");let f;
    try{
      const state=[tex("rg32float"),tex("rg32float")],grain=[tex("r32uint"),tex("r32uint")],solute=[tex("r32float"),tex("r32float")];
      const flux=tex("rgba32float"),aux=tex("rg32float"),age=tex("rg32float"),fed=tex("r32uint"),mask=tex("r8uint");
      const uniform=buf(P3.BYTES,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),quat=buf(quats.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
      const twin=buf(4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),status=buf(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
      const staging=buf(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),pipes=[],codes=sources.map(s=>rect3dSpecialize(s,dims));
      for(const code of codes){const module=device.createShaderModule({code});const info=await module.getCompilationInfo();
        const errors=info.messages.filter(m=>m.type==="error");if(errors.length)throw new Error(errors.map(e=>e.message).join("\n"));
        pipes.push(await device.createComputePipelineAsync({layout:"auto",compute:{module,entryPoint:"main"}}));}
      const e=(binding,resource)=>({binding,resource}),u=e(0,{buffer:uniform}),view=t=>t.createView();
      const groups=[0,1].map(d=>[
        [u,e(1,view(state[d])),e(2,view(grain[d])),e(3,{buffer:quat}),e(4,view(flux))],
        [u,e(1,view(state[d])),e(2,view(grain[d])),e(3,view(flux)),e(4,view(aux)),e(5,view(mask)),e(6,view(solute[d])),e(7,{buffer:status})],
        [u,e(1,view(state[d])),e(2,view(grain[d])),e(3,view(aux)),e(4,view(state[1-d])),e(5,view(grain[1-d])),e(6,view(age)),e(7,view(fed)),
          e(8,view(solute[d])),e(9,view(solute[1-d])),e(10,{buffer:quat}),e(11,{buffer:twin}),e(12,view(mask)),e(13,{buffer:status})]
      ].map((entries,i)=>device.createBindGroup({layout:pipes[i].getBindGroupLayout(0),entries})));
      const initial=fields(c);for(const d of [0,1]){
        device.queue.writeTexture({texture:state[d]},initial.state,{bytesPerRow:dims[0]*8,rowsPerImage:dims[1]},dims);
        device.queue.writeTexture({texture:grain[d]},initial.grain,{bytesPerRow:dims[0]*4,rowsPerImage:dims[1]},dims);
        device.queue.writeTexture({texture:solute[d]},initial.solute,{bytesPerRow:dims[0]*4,rowsPerImage:dims[1]},dims);
      }
      device.queue.writeBuffer(quat,0,quats);device.queue.writeBuffer(status,0,new Uint32Array([0,0x7f800000,0,0]));
      const bytes=new ArrayBuffer(P3.BYTES),u32=new Uint32Array(bytes),f32=new Float32Array(bytes);
      let dir=0,time=0,steps=0,frame=0;const cap=Math.max(1,Math.floor(1.6e8/dims.reduce((a,b)=>a*b,1)));
      f={c,p,state,grain,solute,age,get dir(){return dir;},get time(){return time;},get steps(){return steps;},
        shaderHashes:await Promise.all(codes.map(s=>sha(new TextEncoder().encode(s)))),
        async advance(count){
          let left=count;while(left>0){const batch=Math.min(left,cap);frame++;
            const values={...p,n:dims[0],frame,time,curGen:1,idFloor:1,seedCount:0,probeX:0xffffffff,probeY:0xffffffff,probeZ:0xffffffff};
            for(const [k,o] of Object.entries(P3)){if(k==="BYTES"||k==="sliceN")continue;if(ints.has(k))u32[o]=values[k]??0;else f32[o]=values[k]??0;}
            device.queue.writeBuffer(uniform,0,bytes);const enc=device.createCommandEncoder(),pass=enc.beginComputePass();
            for(let i=0;i<batch;i++){for(let j=0;j<3;j++){pass.setPipeline(pipes[j]);pass.setBindGroup(0,groups[dir][j]);pass.dispatchWorkgroups(...dims.map(n=>Math.ceil(n/4)));}dir=1-dir;}
            pass.end();device.queue.submit([enc.finish()]);await device.queue.onSubmittedWorkDone();time+=batch*p.dt;steps+=batch;left-=batch;
          }
          const enc=device.createCommandEncoder();enc.copyBufferToBuffer(status,0,staging,0,16);device.queue.submit([enc.finish()]);await staging.mapAsync(GPUMapMode.READ);
          const b=staging.getMappedRange().slice(0);staging.unmap();const flags=new Uint32Array(b)[0],minTauFactor=new Float32Array(b)[1];
          if(flags)throw new Error(`quantitative diagnostic flags ${flags}`);return {steps,time,minTauFactor};
        },
        async sample(){const origin=[0,dims[1]>>1,dims[2]>>1],shape=[dims[0],1,1];
          const s=new Float32Array((await raw(state[dir],shape,8,origin)).buffer),c=new Float32Array((await raw(solute[dir],shape,4,origin)).buffer),phi=[],T=[];
          for(let i=0;i<c.length;i++){phi.push(s[2*i]);T.push(s[2*i+1]);}return {phi,T,c:Array.from(c),front:crossing(phi),steps,time};
        },
        async census(){const s=new Float32Array((await raw(state[dir],dims,8)).buffer),c=new Float32Array((await raw(solute[dir],dims,4)).buffer);
          let mass=0,negative=0,nonFinite=0,transverseError=0;for(let i=0;i<c.length;i++){
            mass+=c[i];negative+=c[i]<0;nonFinite+=!Number.isFinite(c[i])||!Number.isFinite(s[2*i])||!Number.isFinite(s[2*i+1]);
            const x=i%dims[0];transverseError=Math.max(transverseError,Math.abs(c[i]-c[x]),Math.abs(s[2*i]-s[2*x]));
          }return {mass,negative,nonFinite,transverseError,count:c.length};
        },
        async destroy(){await device.queue.onSubmittedWorkDone();for(const r of res)r.destroy();}
      };
    }catch(error){for(const r of res)r.destroy();await device.popErrorScope();await device.popErrorScope();throw error;}
    const validation=await device.popErrorScope(),memory=await device.popErrorScope();if(validation||memory){await f.destroy();throw new Error(validation?.message??memory.message);}return f;
  }
  window.__q3planar={
    async stage(c){if(active)await active.destroy();active=await create(c);return {params:active.p,shaderHashes:active.shaderHashes};},
    sample:()=>active.sample(),census:()=>active.census(),advance:n=>active.advance(n),
    async destroy(){if(active)await active.destroy();active=null;},
    async equivalence(){
      const n=32,c={dims:[n,n,n],dx:.8,dt:.001,lambda:3,T:.9,at:.35355339059,x0:n*.8/2};
      const rect=await create(c),sim=new Sim3D(device,n);sim.build();const comparisons=[];
      try{if(!await sim.enableQuant()||!await sim.enableAlloy())throw new Error("production cube allocation failed");Object.assign(sim.params,params(c));sim.reset(c.T);
        const init=fields(c);device.queue.writeBuffer(sim.quatBuffer,0,quats);for(const d of [0,1]){
          device.queue.writeTexture({texture:sim.stateTexture(d)},init.state,{bytesPerRow:n*8,rowsPerImage:n},c.dims);
          device.queue.writeTexture({texture:sim.grainTexture(d)},init.grain,{bytesPerRow:n*4,rowsPerImage:n},c.dims);
          device.queue.writeTexture({texture:sim.soluteTexture(d)},init.solute,{bytesPerRow:n*4,rowsPerImage:n},c.dims);
        }
        let prior=0;for(const target of [1,17,64]){await sim.stepSync(target-prior);await rect.advance(target-prior);prior=target;
          for(const [field,a,b,size] of [["state",sim.stateTexture(sim.dir),rect.state[rect.dir],8],
            ["grain",sim.grainTexture(sim.dir),rect.grain[rect.dir],4],["solute",sim.soluteTexture(sim.dir),rect.solute[rect.dir],4],["age",sim.ageTexture,rect.age,8]]){
            const left=await raw(a,c.dims,size),right=await raw(b,c.dims,size);let mismatches=0;for(let i=0;i<left.length;i++)if(left[i]!==right[i])mismatches++;
            comparisons.push({target,field,mismatches,productionHash:await sha(left),specializedHash:await sha(right)});
          }
        }return comparisons;
      }finally{await device.queue.onSubmittedWorkDone();sim.destroy();await rect.destroy();}
    }
  };
}
