// Browser-side fault injection against the real resource transactions. No
// shader or numerical path is replaced; only an allocation boundary throws.
export async function quant3AllocationChecks() {
  const { Sim3D } = await import("/src/sim3d.ts");
  const { setSeed } = await import("/src/rng.ts");
  const device = window.__solidify.sim().device, n = 32;
  const make = async (alloy = true) => {
    setSeed(0x51105d1f);
    const s = new Sim3D(device, n); s.build();
    Object.assign(s.params, { solver: 0, dt: .005, pPore: 0, noiseAmp: 0, coolRate: 0,
      scen: 0, delta: 0, aniMode3: 1, c0: .3, kPart: .2 });
    if (alloy && !await s.enableAlloy()) throw new Error("fixture alloy allocation failed");
    s.reset(.8); s.addSeed3D(16, 16, 16, 5); await s.stepSync(8);
    return s;
  };
  const raw = async (tex, bpp) => {
    const row = Math.ceil(n*bpp/256)*256;
    const b = device.createBuffer({ size: row*n*n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = device.createCommandEncoder();
    e.copyTextureToBuffer({ texture: tex }, { buffer: b, bytesPerRow: row, rowsPerImage: n }, [n,n,n]);
    device.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ);
    const p = new Uint8Array(b.getMappedRange()), out = new Uint8Array(n*n*n*bpp);
    for (let y = 0; y < n*n; y++) out.set(p.subarray(y*row,y*row+n*bpp),y*n*bpp);
    b.unmap(); b.destroy(); return out;
  };
  const snapshot = async s => {
    const t = { state0:[s.stateTexture(0),8],state1:[s.stateTexture(1),8],
      grain0:[s.grainTexture(0),4],grain1:[s.grainTexture(1),4],age:[s.ageTexture,8],
      fed0:[s.fedTex[0],4],fed1:[s.fedTex[1],4],mask:[s.maskTex,1],flux:[s.fluxTex,16] };
    if(s.soluteTex.length===2){t.solute0=[s.soluteTexture(0),4];t.solute1=[s.soluteTexture(1),4];}
    const out={};for(const [k,[tex,bpp]] of Object.entries(t))out[k]=await raw(tex,bpp);return out;
  };
  const equal = (a,b) => Object.keys(a).filter(k => a[k].length!==b[k]?.length || a[k].some((v,i)=>v!==b[k][i]));
  const phase = async s => { const v=await s.readStateVolume();if(!v)throw new Error("state read failed");
    let sum=0;for(const p of v.phi){if(!Number.isFinite(p))throw new Error("nonfinite phase");sum+=p;}return sum; };
  const prepareQuant = async s => {
    // Legacy stamps heat the seed and use their own tau/W. The transaction
    // checks switch to a separately specified, admitted quantitative state.
    Object.assign(s.params,{solver:1,epsBar:1,tau:1,dx:.8,lambda:2,dTherm:1.2534,dSol:1.2534,
      latent:1,atCoef:.35355339059,frozenT:1,dt:.001});
    const v=await s.readStateVolume(),state=new Float32Array(n*n*n*2),c=new Float32Array(n*n*n);
    for(let i=0;i<c.length;i++){state[2*i]=v.phi[i];state[2*i+1]=.8;c[i]=.3*(1-.8*v.phi[i]);}
    for(const d of [0,1]){
      device.queue.writeTexture({texture:s.stateTexture(d)},state,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
      device.queue.writeTexture({texture:s.soluteTexture(d)},c,{bytesPerRow:n*4,rowsPerImage:n},[n,n,n]);
    }
  };
  const rows=[];
  for(const boundary of ["aux-texture","phase-bind-group"]){
    const s=await make(),before=await snapshot(s),oldPair=[...s.soluteTex],params=JSON.stringify(s.params);
    const method=boundary==="aux-texture"?"createTexture":"createBindGroup",original=device[method];let injected=0,ok;
    device[method]=function(desc){
      const hit=boundary==="aux-texture" ? desc.format==="rg32float" && desc.usage===(GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING)
        : desc.entries.some(e=>e.binding===7&&e.resource?.buffer);
      if(hit&&!injected++){throw new Error(`deliberate Q3 ${boundary} failure`);}return original.call(this,desc);
    };
    try{ok=await s.enableQuant();}finally{device[method]=original;}
    const issue=s.quantitativeIssue,after=await snapshot(s),changed=equal(before,after),a=await phase(s);
    const preservedPair=oldPair.every((t,i)=>s.soluteTex[i]===t),preservedParams=JSON.stringify(s.params)===params;
    const steps=await s.stepSync(80),b=await phase(s);
    rows.push({boundary,injected,returned:ok,issue,changedFields:changed,preservedPair,preservedParams,
      quantAbsent:s.quant===null,steps,phaseBefore:a,phaseAfter:b});s.destroy();
  }

  // Hold a real asynchronous pipeline result so enableQuant/enableAlloy
  // requests overlap deterministically, independently of compiler speed.
  {
    const s=await make(false),original=device.createComputePipelineAsync;
    let signal,release,held=false;
    const entered=new Promise(r=>signal=r),resume=new Promise(r=>release=r);
    device.createComputePipelineAsync=async function(desc){
      const p=original.call(this,desc);if(!held){held=true;signal();await resume;}return p;
    };
    let p,q,a,b,results;
    try{
      p=s.enableQuant();q=s.enableQuant();await entered;
      a=s.enableAlloy();b=s.enableAlloy();release();results=await Promise.all([p,q,a,b]);
    }finally{release();device.createComputePipelineAsync=original;}
    await prepareQuant(s);const before=await phase(s);
    const steps=await s.stepSync(16),status=await s.readQuantitativeStatus(),after=await phase(s);
    rows.push({boundary:"concurrent-quant-alloy",deduplicatedQuant:p===q,deduplicatedAlloy:a===b,results,
      pairLength:s.soluteTex.length,phaseGroups:s.quant?.phaseBG[1].length,transportGroups:s.quant?.transportBG[1].length,
      steps,status,phaseBefore:before,phaseAfter:after});s.destroy();
  }

  // Cancel an alloy transaction while its real validation result is in
  // flight, then request on again. The stale pair must never publish.
  {
    const s=await make(false);if(!await s.enableQuant())throw new Error("quant preparation failed");
    const original=device.popErrorScope;let signal,release,held=false;
    const entered=new Promise(r=>signal=r),resume=new Promise(r=>release=r);
    device.popErrorScope=async function(){const p=original.call(this);if(!held){held=true;signal();await resume;}return p;};
    let stale,current,results;
    try{stale=s.enableAlloy();await entered;s.disableAlloy();current=s.enableAlloy();release();results=await Promise.all([stale,current]);}
    finally{release();device.popErrorScope=original;}
    await prepareQuant(s);
    const before=await phase(s),steps=await s.stepSync(16),status=await s.readQuantitativeStatus(),after=await phase(s);
    rows.push({boundary:"alloy-off-on",results,alloyOn:s.params.alloyOn,pairLength:s.soluteTex.length,
      phaseGroups:s.quant?.phaseBG[1].length,transportGroups:s.quant?.transportBG[1].length,
      steps,status,phaseBefore:before,phaseAfter:after});s.destroy();
  }
  await device.queue.onSubmittedWorkDone();return rows;
}
