"""Independent source-free Float64 principal-lattice perturbation dynamics.

No imported/frozen production files are modified. Fixed 5D/V^2 protocol,
baseline and signed .002 Gaussian temperature kicks. No fitted coefficients.
"""
import os
for variable in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:
    os.environ.setdefault(variable,'1')
from pathlib import Path
import argparse,hashlib,json,gzip,time,platform
import numpy as np
from scipy.interpolate import CubicHermiteSpline,CubicSpline

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--targets',required=True,type=Path,help='explicit frozen target-manifest.json')
    parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--gpu-result',type=Path,help='optional retained production result for observational comparison')
    args=parser.parse_args()
    OUT=args.out.resolve();OUT.mkdir(parents=True,exist_ok=True)
    manifest_path=args.targets.resolve();manifest=json.loads(manifest_path.read_text())
    assert manifest['format']=='solidify-lattice-kinetic-target-manifest-v1' and manifest['complete']
    input_hashes={str(manifest_path):hashlib.sha256(manifest_path.read_bytes()).hexdigest()}
    targets={}
    for velocity in [.1,.125,.15]:
        entry=manifest['targets'][str(velocity)];path=(manifest_path.parent/entry['path']).resolve()
        checksum=hashlib.sha256(path.read_bytes()).hexdigest();assert checksum==entry['sha256']
        input_hashes[str(path)]=checksum;targets[velocity]=json.loads(path.read_text())
        data=targets[velocity];arrays=[np.asarray(data[name],dtype='<f8') for name in ['x','phi','u']]
        assert hashlib.sha256(b''.join(array.tobytes() for array in arrays)).hexdigest()==data['rawFloat64Sha256']
        assert data['config']['velocity']==velocity and data['config']['normal']=='100'
        assert data['config']['physicalDx']==.8 and data['config']['D']==2.5068
        expected=(47/75)*data['config']['lambda_']/data['config']['D']*(1-(1321/9870)*.8**2/data['config']['a']**2)
        assert abs(data['config']['tauScale']-expected)<1e-13
        assert data['config']['lambda_']==4 and data['config']['epsilon']==.0171

    target=targets[.125];target_path=(manifest_path.parent/manifest['targets']['0.125']['path']).resolve()
    gpu_path=args.gpu_result.resolve() if args.gpu_result else None
    gpu=json.loads(gpu_path.read_text()) if gpu_path else None
    c=target['config'];n=1536;h=.8;dt=float(np.float32(.016))
    terminal_steps=int(np.ceil(5*c['D']/c['velocity']**2/dt))
    late_start=int(np.floor((terminal_steps*dt-8*h/c['velocity'])/dt))
    sample_steps=sorted(set([8]+[round(terminal_steps*f) for f in [.25,.5,.75,.9]]+
        [round(late_start+(terminal_steps-late_start)*i/64) for i in range(65)]))
    config={'dims':[n,8,8],'dx':h,'dt':.016,'terminalSteps':terminal_steps,'lateStartSteps':late_start,'sampleSteps':sample_steps}
    if gpu:
        base=next(row for row in gpu['arms'] if row['config']['name']=='v-0.125')
        assert base['config']['sampleSteps']==sample_steps and base['config']['terminalSteps']==terminal_steps
    tau=c['a']**2*c['tauScale'];D=c['D'];V=c['velocity'];lam=c['lambda_']
    grid=(np.arange(n)+.5-n/2)*h
    splines={name:CubicHermiteSpline(target['x'],target[name],target[name+'Derivative']) for name in ['phi','u']}
    bulk=target['measurement']['modalOuterFits'][-1];roots=target['measurement']['metrologyHeatRoots']

    def profile(x):
        xx=np.asarray(x);left=xx<target['x'][0];right=xx>target['x'][-1]
        q=splines['phi'](np.clip(xx,target['x'][0],target['x'][-1]));q=np.where(left,1,np.where(right,-1,q))
        u=splines['u'](np.clip(xx,target['x'][0],target['x'][-1]))
        for side,mask in [('solid',left),('liquid',right)]:
            if not np.any(mask):continue
            xside=xx[mask];coefs=bulk[side+'Coefficients'];columns=[np.ones(len(xside))]
            if side=='liquid':columns.append(np.exp(-target['measurement']['kappa']*xside))
            for root in roots:
                if root['side']!=side:continue
                z=np.exp(complex(root['real'],root['imaginary'])*xside);columns.extend([z.real,z.imag])
            u[mask]=np.stack(columns,axis=1)@coefs
        return .5*(1+q),1+u

    reference_psi,reference_T=profile(grid)
    kick=np.exp(-.5*(grid/4)**2)
    labels=['baseline','kick-positive','kick-negative'];amplitudes=[0,.002,-.002]
    psi=np.stack([reference_psi]*3).astype('float32').astype('float64')
    T=np.stack([reference_T+amplitude*kick for amplitude in amplitudes]).astype('float32').astype('float64')
    initial_psi=psi.copy();initial_T=T.copy();initial_energy=np.sum(T-psi,axis=1)*h
    initial_mass=np.sum(psi,axis=1)*h;reference_mass=np.sum(reference_psi)*h

    def hash_file(path):return hashlib.sha256(path.read_bytes()).hexdigest()
    result={'purpose':'source-free independent Float64 coupled Euler lattice test, not production acceptance',
     'sourceSha256':hash_file(Path(__file__)),'targetSha256':hash_file(target_path),
     'frozenGpuResultSnapshotSha256':hash_file(gpu_path) if gpu_path else None,'inputHashes':input_hashes,'environment':{'python':platform.python_version(),'numpy':np.__version__},
     'config':{'n':n,'dx':h,'dtDeclared':config['dt'],'dtActual':dt,'steps':config['terminalSteps'],
      'duration':config['terminalSteps']*dt,'D':D,'lambda':lam,'epsilon':c['epsilon'],'a':c['a'],
      'tauScale':c['tauScale'],'actualTau':tau,'amplitudes':amplitudes,'kickSigma':4,
      'boundary':'cell-centered reflecting scalar Laplacian','initialization':'independent Hermite target rounded to Float32, then all dynamics Float64',
      'differenceFromProduction':'principal-plane reduction; no GPU operation rounding or bulk-gradient flux cutoff'},
     'registration':{'sampleSteps':config['sampleSteps'],'lateStartSteps':config['lateStartSteps'],
                     'coefficientsFit':False,'sameFrozenHorizon':True},
     'initialGpuFieldMaxDifferences':{},'runs':[{'label':label,'amplitude':amplitude,'samples':[]} for label,amplitude in zip(labels,amplitudes)]}

    if gpu:
        for label,name in [('baseline','v-0.125'),('kick-positive','v-0.125-temperature-kick')]:
            arm=next(row for row in gpu['arms'] if row['config']['name']==name)
            path=gpu_path.parent/arm['initialRaw']['path'];assert hash_file(path)==arm['initialRaw']['sha256']
            raw=json.loads(gzip.decompress(path.read_bytes()));index=labels.index(label)
            result['initialGpuFieldMaxDifferences'][label]={
              'psi':float(np.max(np.abs(psi[index]-raw['psi']))),'T':float(np.max(np.abs(T[index]-raw['T'])))}

    def save():(OUT/'results.json').write_text(json.dumps(result,indent=2))
    def lap(values):
        output=np.empty_like(values);output[:,1:-1]=(values[:,2:]+values[:,:-2]-2*values[:,1:-1])/(h*h)
        output[:,0]=(values[:,1]-values[:,0])/(h*h);output[:,-1]=(values[:,-2]-values[:,-1])/(h*h)
        return output

    def measure(index,steps):
        p,temp=psi[index],T[index];t=steps*dt
        position=float(np.sum(p)*h-reference_mass)
        maskp=abs(grid-position)<=12;maskt=abs(grid-position)<=24
        def loss(shift):return float(np.mean((p[maskp]-profile(grid[maskp]-shift)[0])**2))
        left,right=position-h,position+h;ratio=(np.sqrt(5)-1)/2
        aa=right-ratio*(right-left);bb=left+ratio*(right-left);fa,fb=loss(aa),loss(bb)
        for _ in range(48):
            if fa<fb:right,bb,fb=bb,aa,fa;aa=right-ratio*(right-left);fa=loss(aa)
            else:left,aa,fa=aa,bb,fb;bb=left+ratio*(right-left);fb=loss(bb)
        shift=(left+right)/2
        rp=p[maskp]-profile(grid[maskp]-shift)[0];rt=temp[maskt]-profile(grid[maskt]-shift)[1]
        raw=OUT/f'{labels[index]}-{steps:07d}.npz'
        np.savez_compressed(raw,x=grid,psi=p,T=temp)
        return {'steps':steps,'time':t,'massPosition':position,'alignedShift':shift,
          'massDisplacement':float(np.sum(p)*h-initial_mass[index]),
          'energyDrift':float(np.sum(temp-p)*h-initial_energy[index]),
          'alignedWave':{'phaseRms':float(np.sqrt(np.mean(rp*rp))),'phaseMax':float(np.max(np.abs(rp))),
                         'temperatureRms':float(np.sqrt(np.mean(rt*rt))),'temperatureMax':float(np.max(np.abs(rt)))},
          'raw':raw.name,'rawSha256':hash_file(raw)}

    save();start=time.perf_counter();sample_steps=set(config['sampleSteps'])
    for i in range(3):result['runs'][i]['initial']=measure(i,0)
    save()
    for step in range(1,config['terminalSteps']+1):
        q=2*psi-1;well=1-q*q
        dp=(c['a']**2*lap(psi)+.5*(q-q*q*q-lam*(T-1)*well*well))/tau
        new=np.clip(psi+dt*dp,0,1)
        T=T+dt*D*lap(T)+(new-psi);psi=new
        if step in sample_steps:
            for i in range(3):result['runs'][i]['samples'].append(measure(i,step))
            save()
            if step<config['lateStartSteps'] or step==config['terminalSteps']:
                print(json.dumps({'step':step,'time':step*dt,'seconds':time.perf_counter()-start,
                  'temperatureRms':[row['samples'][-1]['alignedWave']['temperatureRms'] for row in result['runs']]}),flush=True)
    for row in result['runs']:
        late=[s for s in row['samples'] if s['steps']>=config['lateStartSteps']]
        times=np.array([s['time'] for s in late]);positions=np.array([s['massPosition'] for s in late])
        slope=np.sum((times-times.mean())*(positions-positions.mean()))/np.sum((times-times.mean())**2)
        row['late']={'velocity':float(slope),'relativeVelocityError':float(slope/V-1),
          'intercept':float(positions.mean()-slope*times.mean()),
          'maxima':{key:max(s['alignedWave'][key] for s in late) for key in ['phaseRms','phaseMax','temperatureRms','temperatureMax']}}
    result['seconds']=time.perf_counter()-start;result['completed']=True;save()
    print('THERMAL-CPU-DONE',json.dumps({row['label']:row['late'] for row in result['runs']}),flush=True)
    audit=thermal_tail_audit(targets,result,OUT,gpu_path,gpu,manifest_path)
    (OUT/'tail-audit.json').write_text(json.dumps(audit,indent=2))
    print('THERMAL-TAIL-AUDIT',json.dumps([{key:value for key,value in row.items() if not isinstance(value,list)}
      for row in audit['tailComparisons']]),flush=True)


def thermal_tail_audit(targets,cpu,out,gpu_path,gpu,manifest_path):
    """Interpret retained wave response; never replace an acceptance residual."""
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    target=targets[.125];D=target['config']['D'];V=.125;h=.8
    xi=np.linspace(-24,24,241)
    reference={v:CubicHermiteSpline(t['x'],t['u'],t['uDerivative']) for v,t in targets.items()}
    derivative=(reference[.15](xi)-reference[.1](xi))/.05

    def cpu_raw(entry):
        path=out/entry['raw'];assert sha(path)==entry['rawSha256']
        with np.load(path) as data:return data['x'],data['psi'],data['T']

    def gpu_raw(entry):
        path=gpu_path.parent/entry['path'];assert sha(path)==entry['sha256']
        raw=json.loads(gzip.decompress(path.read_bytes()));n=len(raw['psi'])
        return (np.arange(n)+.5-n/2)*h,np.array(raw['psi']),np.array(raw['T'])

    rows=[]
    for backend in (['Float64CPU','GPU'] if gpu else ['Float64CPU']):
        if backend=='GPU':
            a=next(row for row in gpu['arms'] if row['config']['name']=='v-0.125')
            b=next(row for row in gpu['arms'] if row['config']['name']=='v-0.125-temperature-kick')
            sa=a['samples'][-1];sb=b['samples'][-1]
            xa,pa,ta=gpu_raw(sa['raw']);xb,pb,tb=gpu_raw(sb['raw'])
            va=a['assessment']['fit']['velocity'];vb=b['assessment']['fit']['velocity']
        else:
            a=next(row for row in cpu['runs'] if row['label']=='baseline')
            b=next(row for row in cpu['runs'] if row['label']=='kick-positive')
            sa=a['samples'][-1];sb=b['samples'][-1]
            xa,pa,ta=cpu_raw(sa);xb,pb,tb=cpu_raw(sb)
            va=a['late']['velocity'];vb=b['late']['velocity']
        shift_a=sa['alignedShift'];shift_b=sb['alignedShift'];time_now=sb['time']
        actual=CubicSpline(xb,tb)(xi+shift_b)-CubicSpline(xa,ta)(xi+shift_a)
        delta_v=vb-va
        predicted_full=derivative*delta_v
        amplitude=target['measurement']['modalOuterFits'][-1]['liquidCoefficients'][1]
        predicted_outer=np.where(xi>0,-amplitude*(xi/D)*np.exp(-V*xi/D)*delta_v,0)
        sigma2=4**2+2*D*time_now
        uncoupled_heat=.002*4/np.sqrt(sigma2)*np.exp(-(xi+shift_b)**2/(2*sigma2))
        solid=xi<-6;liquid=xi>6
        rows.append({'backend':backend,'time':time_now,'baseVelocity':va,'kickVelocity':vb,'deltaVelocity':delta_v,
          'predictedOuterPeakAtDoverV':float(-amplitude*delta_v/(np.e*V)),
          'actualAlignedLiquidPeak':float(actual[liquid].max()),
          'actualAlignedLiquidRms':float(np.sqrt(np.mean(actual[liquid]**2))),
          'fixedAmplitudeFullDerivativeLiquidRmsError':float(np.sqrt(np.mean((actual[liquid]-predicted_full[liquid])**2))),
          'fixedAmplitudeOuterLiquidRmsError':float(np.sqrt(np.mean((actual[liquid]-predicted_outer[liquid])**2))),
          'uncoupledHeatLiquidRmsError':float(np.sqrt(np.mean((actual[liquid]-uncoupled_heat[liquid])**2))),
          'actualAlignedSolidMean':float(actual[solid].mean()),'xi':xi.tolist(),
          'actualAlignedTemperatureDifference':actual.tolist(),
          'predictedFromIndependentBranchDerivative':predicted_full.tolist(),
          'predictedFromOuterExponential':predicted_outer.tolist(),'uncoupledHeatGaussian':uncoupled_heat.tolist(),
          'note':'velocity contrast is independently observed; no amplitude fitted or acceptance residual replaced'})

    branches=[];branch_input_hashes={}
    for variant in ['analytic','uncorrected']:
        selected=[]
        for v in [.1,.125,.15]:
            if variant=='analytic':selected.append(targets[v])
            else:
                path=manifest_path.parent/f'target-v{v}-uncorrected.json'
                if not path.exists():break
                branch_input_hashes[str(path)]=sha(path);selected.append(json.loads(path.read_text()))
        if len(selected)!=3:continue
        velocity=np.array([row['config']['velocity'] for row in selected])
        beta=np.array([row['measurement']['modalBetaSolid'] for row in selected])
        delta=1+velocity*beta;B=float((delta[2]-delta[0])/(velocity[2]-velocity[0]));sigma=-B*V**3/D
        branches.append({'variant':variant,'speeds':velocity.tolist(),'undercooling':delta.tolist(),'Bcentral':B,
          'sharpInterfaceSigmaInference':sigma,'sharpInterfaceEFoldTau':1/sigma if sigma!=0 else None,
          'sharpInterfaceEFoldThermalTimes':1/sigma/(D/V**2) if sigma!=0 else None,
          'status':'sharp-interface two-sided heat inference; not a finite-width eigenvalue measurement'})
    for row in cpu['runs']:
        for entry in [row['initial']]+row['samples']:assert sha(out/entry['raw'])==entry['rawSha256']
    return {'purpose':'thermal-response diagnosis; original GPU refusal unchanged',
      'sourceSha256':sha(Path(__file__)),'cpuResultSha256':sha(out/'results.json'),
      'gpuResultSha256':sha(gpu_path) if gpu_path else None,'originalGpuAccepted':gpu.get('accepted') if gpu else None,
      'uncorrectedBranchInputHashes':branch_input_hashes,'tailComparisons':rows,'branchSlopeInferences':branches,
      'allCpuRawHashesVerified':sum(1+len(row['samples']) for row in cpu['runs']),
      'energyIdentity':{'conservedQuantity':'integral(Ttilde-psi) dx','translationModeIntegral':0,
        'reason':'far solid/liquid enthalpy is equal by the latent-jump identity',
        'maximumFloat64Drift':max(abs(row['samples'][-1]['energyDrift']) for row in cpu['runs'])}}


if __name__=='__main__':
    main()
