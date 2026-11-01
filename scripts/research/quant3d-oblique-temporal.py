"""Prospective, CPU-only finite-horizon oblique enthalpy pilot.

Prepare/benchmark/seal first. Execution requires committed, clean CPU sources.
No production, existing reference, GPU, coefficient or recovery-band changes.
"""
import os
for name in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:
    os.environ.setdefault(name,'1')
import argparse,hashlib,importlib.util,json,math,platform,subprocess,sys,time,traceback,shutil
from fractions import Fraction
from pathlib import Path
import numpy as np
from scipy.interpolate import CubicHermiteSpline,CubicSpline

ROOT=Path(__file__).resolve().parents[2]
angular=model=None
def load_model():
    global angular,model
    spec=importlib.util.spec_from_file_location('sealed_temporal_angular',Path(__file__).with_name('quant3d-oblique-kinetic-angular.py'))
    angular=importlib.util.module_from_spec(spec);sys.modules[spec.name]=angular;spec.loader.exec_module(angular)
    model=angular.model
NORMAL=(2,1,0);DX=.8;VELOCITY=.04;DT=.004;AMPLITUDE=.001
DELTA=DX/math.sqrt(5);HORIZON=8*DELTA/VELOCITY
LEFT=math.ceil(128/DELTA);RIGHT=math.ceil(512/DELTA)
PROBES=tuple(math.ceil(k*HORIZON/(64*DT)) for k in range(65))
STEPS=PROBES[-1];U=2.**-53
TAIL_LIMIT=1e-8
SOURCE_PATHS=[
 'scripts/research/quant3d-oblique-temporal.py','scripts/research/quant3d-oblique-temporal.md',
 'scripts/research/quant3d-oblique-kinetic.py','scripts/research/quant3d-oblique-kinetic-reference.py',
 'scripts/research/quant3d-oblique-kinetic-angular.py','scripts/research/quant3d-kinetic-reference.py']
sha=lambda data:hashlib.sha256(data).hexdigest()
file_sha=lambda path:sha(Path(path).read_bytes())
def source_hashes():return {p:file_sha(ROOT/p) for p in SOURCE_PATHS}

def source_representations():
    """Exact runtime bytes plus the sole admitted reversible Git LF encoding.

    Sealed Windows CRLF files are never rewritten. A uniform CRLF runtime may
    be reconstructed from its expected LF Git blob; mixed/bare-CR encodings
    are refused, and no whitespace/Unicode/content transformation is admitted.
    """
    rows={}
    for relative in SOURCE_PATHS:
        runtime=(ROOT/relative).read_bytes();blob=runtime.replace(b'\r\n',b'\n')
        require(b'\r' not in blob,'source contains bare CR: '+relative)
        representation='LF-to-CRLF' if b'\r\n' in runtime else 'exact'
        restored=blob.replace(b'\n',b'\r\n') if representation=='LF-to-CRLF' else blob
        require(restored==runtime,'mixed source newline representation: '+relative)
        object_id=hashlib.sha1(b'blob '+str(len(blob)).encode()+b'\0'+blob).hexdigest()
        rows[relative]={'runtimeSha256':sha(runtime),'runtimeBytes':len(runtime),
          'runtimeCrlfCount':runtime.count(b'\r\n'),'runtimeLfCount':runtime.count(b'\n'),
          'gitBlobSha256':sha(blob),'gitBlobObjectId':object_id,'gitBlobBytes':len(blob),
          'representation':representation}
    return rows
def plain(value):
    if isinstance(value,np.generic):return value.item()
    if isinstance(value,np.ndarray):return value.tolist()
    if isinstance(value,Path):return str(value)
    if isinstance(value,Fraction):return str(value)
    raise TypeError(type(value).__name__)
def save(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    text=json.dumps(value,indent=2,default=plain,allow_nan=False)
    temporary=path.with_name(path.name+'.pending');temporary.write_text(text,encoding='utf-8');temporary.replace(path)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def gamma(k):return math.nextafter(k*U/(1-k*U),math.inf)
def up_add(a,b):return math.nextafter(a+b,math.inf)
def up_mul(a,b):return math.nextafter(a*b,math.inf)
def positive_sum(values):
    a=np.asarray(values,dtype=float).ravel()
    if not np.all(np.isfinite(a)) or np.any(a<0):raise ValueError('invalid nonnegative bound reduction')
    if not len(a):return 0.
    total=float(np.sum(a,dtype=np.float64))
    lower=math.nextafter(1-gamma(max(0,len(a)-1)),-math.inf)
    return math.nextafter(total/lower,math.inf)
def normal_or_zero(values):
    a=np.asarray(values,dtype=float)
    return bool(np.all(np.isfinite(a)) and np.all((a==0)|(np.abs(a)>=np.finfo(float).tiny)))
def energy(psi,T,background):
    b=Fraction.from_float(float(background));total=Fraction(0)
    for temperature,phase in zip(T,psi):
        total+=Fraction.from_float(float(temperature))-Fraction.from_float(float(phase))-b
    return Fraction.from_float(DELTA)*total

def cases(option):
    models=['angular'] if option=='A' else ['principal','angular']
    rows=[]
    for tau_model in models:
        for half in [False,True]:
            for pulse in ['baseline','zero-plus','zero-minus']:
                rows.append({'name':f'{tau_model}-{pulse}-'+('half-dt' if half else 'dt'),
                  'model':tau_model,'pulse':pulse,'halfDt':half,'wide':False})
    for tau_model in models:
        rows.append({'name':f'{tau_model}-baseline-wide','model':tau_model,'pulse':'baseline','halfDt':False,'wide':True})
    assert len(rows)==(7 if option=='A' else 14)
    return rows

def contract():
    return {'normal':list(NORMAL),'dx':DX,'normalPlaneSpacing':DELTA,'velocityReference':VELOCITY,
      'lambda':model.LAMBDA,'D':model.D,'epsilon':model.EPSILON,'epsBar':1,'tauInput':1,'physicalSub':1,
      'amplitude':AMPLITUDE,'pulseWidths':[4,8],'coarseDt':DT,'fineDt':DT/2,
      'requestedHorizon':HORIZON,'coarseSteps':STEPS,'fineSteps':2*STEPS,'actualHorizon':STEPS*DT,
      'coarseProbeSteps':list(PROBES),'fineProbeSteps':[2*k for k in PROBES],
      'primaryIndices':[-LEFT,RIGHT],'wideIndices':[-2*LEFT,2*RIGHT],'primaryN':LEFT+RIGHT+1,'wideN':2*(LEFT+RIGHT)+1,
      'phaseBoundary':'sealed constant q ghosts; not a physical tilted wall',
      'heatBoundary':'symmetric truncated L19 graph; identical computed bond transfer with both signs',
      'targetFrame':'raw imposed-V and one shared phase-derived shift; no temperature-only alignment',
      'tailPrimaryWindow':[40,56],'tailAlternativeWindow':[32,48],'tailValueAndDerivativeNumericalLimit':TAIL_LIMIT,
      'pulsePolicy':'2*A*(G4-c*G8), c=exact represented Gaussian sum ratio, signs separate; actual injected E retained',
      'budgetPolicy':'exact Fraction enthalpy at probes; outward gamma6/gamma2 latent/heat update bound; no projection',
      'sourceAdmission':'exact sealed runtime/snapshot bytes; committed canonical LF blob with declared exact or LF-to-CRLF reconstruction only',
      'numericalMetrologyControls':{'shiftAbsolute':DELTA*1e-6,'alignedTemperatureRms':1e-8,'wrongTemperatureRmsMinimum':1e-4},
      'coreEvolutionLiveness':1e-6,
      'costRule':{'cpuMinutes':45,'rhsEvaluationsPerBenchmark':100,'estimateMultiplier':3,'fixedOverheadSeconds':120,
        'choice':'B if estimatedB<=2700s, else A if estimatedA<=2700s, else C'},
      'scientificAcceptanceBand':None,'recoveryPredicate':None,'adopted':False,'q3Accepted':False}

class Reference:
    def __init__(self,npz,metadata):
        self.meta=metadata;self.config=metadata['config'];self.measurement=metadata['measurement']
        with np.load(npz) as raw:
            self.x=raw['x'].copy();self.q=raw['q'].copy();self.u=raw['u'].copy()
            self.uinf=float(raw['uInfinity'])
        if not np.all(np.isfinite(self.x)) or not np.all(np.diff(self.x)>0):raise ValueError('invalid BVP coordinates')
        if not np.all(np.isfinite(self.q)) or not np.all((self.q>=-1)&(self.q<=1)) or not np.all(np.isfinite(self.u)):
            raise ValueError('unusable BVP state; no clipping or repair allowed')
        self.center=int(np.argmin(abs(self.x)))
        if self.x[self.center]!=0:raise ValueError('BVP phase pin missing')
        self.q_spline=CubicHermiteSpline(self.x,self.q,CubicSpline(self.x,self.q).derivative()(self.x))
        self.u_spline=CubicHermiteSpline(self.x,self.u,CubicSpline(self.x,self.u).derivative()(self.x))
        self.kappa=self.measurement['kappa'];self.roots=self.measurement['metrologyHeatRoots']
        self.fit=next(row for row in self.measurement['modalOuterFits'] if row['windowW']==[40,56])
        self.alternative=next(row for row in self.measurement['modalOuterFits'] if row['windowW']==[32,48])
        self.background=1+self.uinf
    def tail(self,x,fit=None,derivative=False):
        x=np.asarray(x,dtype=float);out=np.empty_like(x);fit=self.fit if fit is None else fit
        for side,mask in [('solid',x<0),('liquid',x>=0)]:
            values=x[mask];coefs=fit[side]['coefficients'];offset=1
            result=np.zeros(len(values)) if derivative else np.full(len(values),coefs[0])
            if side=='liquid':
                result+=coefs[1]*np.exp(-self.kappa*values)*(-self.kappa if derivative else 1);offset=2
            for root in self.roots:
                if root['side']!=side:continue
                alpha=root['real'];beta=root['imaginary'];A,B=coefs[offset:offset+2];offset+=2
                if derivative:A,B=alpha*A+beta*B,alpha*B-beta*A
                with np.errstate(under='ignore'):
                    result+=np.exp(alpha*values)*(A*np.cos(beta*values)+B*np.sin(beta*values))
            if offset!=len(coefs):raise ValueError('tail coefficient/basis identity changed')
            out[mask]=result
        return out
    def psi(self,x):
        x=np.asarray(x,dtype=float);q=self.q_spline(np.clip(x,self.x[0],self.x[-1]))
        return .5*(1+np.where(x<self.x[0],1,np.where(x>self.x[-1],-1,q)))
    def temperature(self,x):
        x=np.asarray(x,dtype=float);u=self.u_spline(np.clip(x,self.x[0],self.x[-1]))
        outside=(x<self.x[0])|(x>self.x[-1]);u[outside]=self.tail(x[outside]);return 1+u
    def initial(self,wide=False):
        factor=2 if wide else 1;j=np.arange(-factor*LEFT,factor*RIGHT+1);x=j*DELTA
        psi=np.where(x<self.x[0],1.,0.);T=1+self.tail(x)
        inside=(x>=self.x[0])&(x<=self.x[-1]);indices=self.center+j[inside]*self.config['sub']
        if not np.array_equal(self.x[indices],x[inside]):raise ValueError('physical samples do not coincide with exact BVP nodes')
        psi[inside]=.5*(1+self.q[indices]);T[inside]=1+self.u[indices]
        validate_state(psi,T)
        return x,psi,T
    def tail_controls(self):
        joins=np.array([self.x[0],self.x[-1]])
        value=float(np.max(abs(self.tail(joins)-self.u_spline(joins))))
        derivative=float(np.max(abs(self.tail(joins,derivative=True)-self.u_spline.derivative()(joins))))
        x,_,_=self.initial(True);outside=(x<self.x[0])|(x>self.x[-1])
        sensitivity=float(np.max(abs(self.tail(x[outside])-self.tail(x[outside],self.alternative))))
        jump=abs(self.measurement['modalLatentJump']-1)
        passed=max(value,derivative,sensitivity)<=TAIL_LIMIT and jump<=1e-8
        return {'passed':passed,'actualBvpExtent':[float(self.x[0]),float(self.x[-1])],
          'joinValueError':value,'joinDerivativeError':derivative,'fixedAlternativeTailSensitivity':sensitivity,
          'freeLatentJumpError':jump,'numericalLimit':TAIL_LIMIT,'basis':'selected outgoing modes, not exhaustive spectrum'}

def validate_state(psi,T):
    if not np.all(np.isfinite(psi)) or not np.all((psi>=0)&(psi<=1)):
        raise ValueError('phase outside supported finite range; no initial repair')
    if not np.all(np.isfinite(T)) or not np.all((T>=-1)&(T<=2)):
        raise ValueError('temperature outside supported finite range')

class Evolution:
    def __init__(self,n,tau_model):
        self.geometry=model.Geometry(NORMAL,DX,1);self.operator=model.PlaneOperator(n,self.geometry,cutoff=True)
        self.model=tau_model;self.weights=self.geometry.weights
        if len(self.weights)!=3 or [r for r,w in self.weights]!=[1,2,3]:raise ValueError('unexpected210 graph bonds')
        lower=1-3*abs(model.EPSILON);Vmax=(827+73*math.sqrt(73))/18432
        gamma_bound=16*abs(model.EPSILON)*Vmax/(3*lower)
        coefficient=float(model.CORRECTION)+(angular.ANGULAR_FACTOR*gamma_bound if tau_model=='angular' else 0)
        self.tau_lower=(47/75)*model.LAMBDA/model.D*(lower*lower-DX*DX*coefficient)
        self.phase_bound=DX*DX*self.tau_lower/(12*(1+20*abs(model.EPSILON)))
        self.heat_bound=DELTA*DELTA/(2*model.D*sum(w for r,w in self.weights))
        if not self.tau_lower>0 or DT>min(self.phase_bound,self.heat_bound):raise ValueError('prospective CFL admission failed')
    def phase(self,psi,T):
        q=2*psi-1;u=T-1;f=self.operator.evaluate(q)
        tau=(angular.angular_tau(f,self.operator)['tau'] if self.model=='angular'
             else model.local_tau(f,self.geometry,1,True))
        if not np.all(np.isfinite(tau)) or np.any(tau<self.tau_lower):raise ValueError('local relaxation violated bound')
        rhs=.5*(f['spatialQ']+q-q**3-model.LAMBDA*u*(1-q*q)**2)/tau
        if not np.all(np.isfinite(rhs)):raise ValueError('nonfinite phase RHS')
        return rhs,tau,f
    def heat(self,T,dt=1.,bounds=False):
        H=np.zeros_like(T);bond_abs=0.
        for jump,weight in self.weights:
            F=(dt*model.D*weight/DELTA**2)*(T[jump:]-T[:-jump])
            if bounds and not normal_or_zero(F):raise ValueError('budget normal-arithmetic assumption failed for heat bond')
            H[:-jump]+=F;H[jump:]-=F
            if bounds:bond_abs=up_add(bond_abs,positive_sum(abs(F)))
        return H,bond_abs
    def rhs(self,psi,T):
        phase,tau,f=self.phase(psi,T);heat,_=self.heat(T)
        return phase,heat+phase
    def step(self,psi,T,dt):
        if dt>min(self.phase_bound,self.heat_bound):raise ValueError('unregistered timestep')
        rhs,tau,fields=self.phase(psi,T);raw=psi+dt*rhs
        if not np.all(np.isfinite(raw)):raise ValueError('nonfinite raw phase')
        new=np.clip(raw,0,1);dpsi=new-psi;H,bonds=self.heat(T,dt,True);nextT=(T+H)+dpsi
        validate_state(new,nextT)
        for value in [dpsi,H,T+H,nextT]:
            if not normal_or_zero(value):raise ValueError('budget normal-arithmetic assumption failed')
        bound=up_mul(gamma(6),up_mul(2.,bonds))
        temperature=up_add(up_add(positive_sum(abs(T)),positive_sum(abs(H))),positive_sum(abs(dpsi)))
        bound=up_add(bound,up_mul(gamma(2),temperature))
        phases=up_add(positive_sum(abs(psi)),positive_sum(abs(new)))
        bound=up_mul(DELTA,up_add(bound,up_mul(U,phases)))
        return new,nextT,bound,{'clamped':int(np.count_nonzero((raw<0)|(raw>1))),
          'tauMinimum':float(tau.min()),'cutoffNodes':int(np.count_nonzero(~fields['activeFlux']))}

def pulse(x,kind):
    if kind=='baseline':return np.zeros_like(x),{'coefficient':0.}
    G4=np.exp(-.5*(x/4)**2);G8=np.exp(-.5*(x/8)**2)
    exact4=sum((Fraction.from_float(float(v)) for v in G4),Fraction(0))
    exact8=sum((Fraction.from_float(float(v)) for v in G8),Fraction(0))
    coefficient=float(exact4/exact8);shape=2*AMPLITUDE*(G4-coefficient*G8)
    if kind=='zero-minus':shape=-shape
    elif kind!='zero-plus':raise ValueError('unregistered perturbation')
    return shape,{'coefficient':coefficient,'nominalAmplitude':AMPLITUDE,
      'representedPulseIntegral':str(Fraction.from_float(DELTA)*sum((Fraction.from_float(float(v)) for v in shape),Fraction(0)))}

def register(ref,x,psi,T,initial,initial_center=0.):
    mass=initial_center+DELTA*math.fsum((psi-initial).tolist())
    pick=abs(x-mass)<=12;tpick=abs(x-mass)<=24
    if np.count_nonzero(pick)<20 or np.count_nonzero(tpick)<40:return {'ready':False,'massPosition':mass}
    def loss(shift):return float(np.mean((psi[pick]-ref.psi(x[pick]-shift))**2))
    left,right=mass-DELTA,mass+DELTA;ratio=(math.sqrt(5)-1)/2
    a=right-ratio*(right-left);b=left+ratio*(right-left);fa,fb=loss(a),loss(b)
    for _ in range(48):
        if fa<fb:right=b;b=a;fb=fa;a=right-ratio*(right-left);fa=loss(a)
        else:left=a;a=b;fa=fb;b=left+ratio*(right-left);fb=loss(b)
    shift=(left+right)/2
    phase=psi[pick]-ref.psi(x[pick]-shift);thermal=T[tpick]-ref.temperature(x[tpick]-shift)
    distance=min(shift-(mass-DELTA),mass+DELTA-shift)
    return {'ready':bool(distance>DELTA*1e-6),'massPosition':mass,'phaseShift':shift,'registrationMinusMass':shift-mass,
      'searchBoundaryDistance':min(shift-(mass-DELTA),mass+DELTA-shift),
      'phaseRms':float(np.sqrt(np.mean(phase*phase))),'phaseMax':float(np.max(abs(phase))),
      'temperatureRms':float(np.sqrt(np.mean(thermal*thermal))),'temperatureMax':float(np.max(abs(thermal)))}

def metrology_controls(ref):
    x,initial,T=ref.initial();shift=.37*DELTA
    psi=ref.psi(x-shift);temp=ref.temperature(x-shift)
    good=register(ref,x,psi,temp,initial)
    wrong=register(ref,x,initial,ref.temperature(x-DELTA),initial)
    rows=[]
    for index in [0,16,32,48,64]:
        t=PROBES[index]*DT;s=1.1*VELOCITY*t
        measured=register(ref,x,ref.psi(x-s),ref.temperature(x-s),initial)
        rows.append((t,measured['phaseShift']))
    tt=np.array([p[0] for p in rows]);ss=np.array([p[1] for p in rows]);mt=tt.mean()
    speed=float(np.sum((tt-mt)*(ss-ss.mean()))/np.sum((tt-mt)**2))
    passed=(good['ready'] and abs(good['phaseShift']-shift)<=DELTA*1e-6
      and good['temperatureRms']<=1e-8 and wrong['temperatureRms']>1e-4
      and abs(speed-1.1*VELOCITY)<1e-7 and abs(speed-VELOCITY)>.05*VELOCITY)
    return {'passed':passed,'knownShift':shift,'observedShift':good,'wrongTemperatureShift':wrong,'changedSpeed':speed}

def budget_controls():
    evolution=Evolution(41,'angular');psi=np.full(41,.4);T=.9+.02*np.sin(np.arange(41)*.3)
    H,bonds=evolution.heat(T,DT,True);dpsi=np.linspace(.001,.003,41)
    new=psi+dpsi;nextT=(T+H)+(new-psi)
    E0=energy(psi,T,0);E1=energy(new,nextT,0)
    bound=up_mul(gamma(6),up_mul(2.,bonds))
    temperature=up_add(up_add(positive_sum(abs(T)),positive_sum(abs(H))),positive_sum(abs(new-psi)))
    phases=up_add(positive_sum(abs(psi)),positive_sum(abs(new)))
    bound=up_mul(DELTA,up_add(up_add(bound,up_mul(gamma(2),temperature)),up_mul(U,phases)))
    wrongT=(T+H)+2*(new-psi)
    residual=float(abs(E1-E0));negative=float(abs(energy(new,wrongT,0)-E0))
    assert abs(E1-E0)<=Fraction.from_float(bound) and abs(energy(new,wrongT,0)-E0)>Fraction.from_float(bound)
    # Clamp negative: the heat must use actual stored dpsi, not raw Euler rate.
    old=np.full(41,.9999);clamped=np.ones(41);raw_increment=np.full(41,.01)
    correct=energy(clamped,T+(clamped-old),0)-energy(old,T,0)
    bad=energy(clamped,T+raw_increment,0)-energy(old,T,0)
    assert abs(correct)<Fraction.from_float(1e-12) and abs(bad)>Fraction.from_float(.01)
    return {'passed':True,'correctBudgetResidual':residual,'arithmeticBound':bound,
      'wrongLatentRejected':negative,'unclampedLatentRejected':float(abs(bad))}


INPUTS={
 'principal':{'path':'verify-out/q3-oblique-coupled-study/case-019',
   'sha256':'e56377eee879c1755f86c4b0aca40825aa233f6d83be87c55fffadfa88c5d0fc'},
 'angular':{'path':'verify-out/q3-oblique-angular-study-v2/case-003',
   'sha256':'f017da2c18659d1ea2ab5ef273c4600a9626a90f3d84e5dac89fc92a8ecf14de'}}

def require(condition,message):
    if not condition:raise ValueError(message)

def array_sha(value):return sha(np.ascontiguousarray(value).astype('<f8',copy=False).tobytes())

def read_reference(out,tau_model,copied=False):
    entry=INPUTS[tau_model]
    stem=(out/'inputs'/tau_model) if copied else ROOT/entry['path']
    raw=stem.with_suffix('.npz');meta_path=stem.with_suffix('.json')
    meta=json.loads(meta_path.read_text(encoding='utf-8'))
    require(file_sha(raw)==entry['sha256']==meta['rawSha256'],'selected BVP raw hash mismatch')
    expected={'normal':list(NORMAL),'h':DX,'sub':16,'half':64.,'velocity':VELOCITY,
      'tau_input':1.,'cutoff':True,'modes':3,'order':6,'bias':1,'tail_periods':4}
    expected.update({'candidate':True} if tau_model=='principal' else {'tau_model':'angular'})
    require(meta['request']==expected and meta['converged'] is True,'selected BVP request/convergence mismatch')
    c=meta['config'];require(c['physicalDx']==DX and c['normalPlaneSpacing']==DELTA
      and c['sub']==16 and c['lambda']==model.LAMBDA and c['D']==model.D
      and c['epsilon']==model.EPSILON and c['literalBulkCutoff'] is True,'selected BVP physics mismatch')
    recorded=meta.get('cpuSourceHashes',meta.get('sourceHashes',{}))
    for path in SOURCE_PATHS[2:]:
        if tau_model=='principal' and path.endswith('kinetic-angular.py'):continue
        require(recorded.get(path)==file_sha(ROOT/path),'BVP dependency source mismatch: '+path)
    require(meta['trace'][-1]['maxResidual']<=3e-11,'selected BVP numerical residual failed')
    return Reference(raw,meta),{'raw':raw,'metadata':meta_path,'rawSha256':file_sha(raw),'metadataSha256':file_sha(meta_path)}

def rhs_controls(ref):
    x,psi,T=ref.initial();evolution=Evolution(len(x),'angular')
    phase,thermal=evolution.rhs(psi,T)
    q=2*psi-1;fields=evolution.operator.evaluate(q)
    tau=angular.angular_tau(fields,evolution.operator)['tau']
    expected=.5*(fields['spatialQ']+q-q**3-model.LAMBDA*(T-1)*(1-q*q)**2)/tau
    phase_error=float(np.max(abs(phase-expected)))
    # Independent finite graph loop uses the literal stored bond numbers.
    sample=np.linspace(-.2,.3,41)+.01*np.sin(np.arange(41))
    small=Evolution(len(sample),'angular');got,_=small.heat(sample,DT,True);oracle=np.zeros_like(sample)
    for i in range(len(sample)):
        for jump,weight in [(1,1/6),(2,2/15),(3,1/30)]:
            if i+jump<len(sample):
                transfer=(DT*model.D*weight/DELTA**2)*(sample[i+jump]-sample[i])
                oracle[i]+=transfer;oracle[i+jump]-=transfer
    graph_error=float(np.max(abs(got-oracle)))
    incident=max(sum(int(i-r>=0)+int(i+r<len(sample)) for r in [1,2,3]) for i in range(len(sample)))
    second=sum(weight*jump**2 for jump,weight in evolution.weights)
    return {'passed':phase_error==0 and graph_error<1e-16 and incident==6 and second==1.,
      'phaseFormulaError':phase_error,'independentGraphError':graph_error,'maximumIncidentBonds':incident,
      'normalSecondMoment':second,'tauLowerBound':evolution.tau_lower,
      'phaseTimestepAdmission':evolution.phase_bound,'heatTimestepAdmission':evolution.heat_bound,
      'finiteStaticRhs':bool(np.all(np.isfinite(phase)) and np.all(np.isfinite(thermal)))}

def benchmark(refs):
    rows=[]
    for tau_model,ref in refs.items():
        for wide in [False,True]:
            x,psi,T=ref.initial(wide);evolution=Evolution(len(x),tau_model)
            before=(array_sha(psi),array_sha(T));evolution.rhs(psi,T)
            wall=time.perf_counter();cpu=time.process_time()
            for _ in range(100):evolution.rhs(psi,T)
            elapsed=time.perf_counter()-wall;cpu=time.process_time()-cpu
            require(before==(array_sha(psi),array_sha(T)),'benchmark advanced or mutated fields')
            rows.append({'model':tau_model,'wide':wide,'n':len(x),'evaluations':100,
              'wallSeconds':elapsed,'processSeconds':cpu,'perEvaluationSeconds':max(cpu,elapsed)/100,
              'inputUnchanged':True})
    def estimate(option):
        total=0.
        for case in cases(option):
            row=next(r for r in rows if r['model']==case['model'] and r['wide']==case['wide'])
            total+=STEPS*(2 if case['halfDt'] else 1)*row['perEvaluationSeconds']
        return 3*total+120
    costs={option:estimate(option) for option in ['A','B']}
    choice='B' if costs['B']<=2700 else ('A' if costs['A']<=2700 else 'C')
    return {'rows':rows,'estimatedSeconds':costs,'selectedOption':choice,
      'rule':'3 * static-RHS cost over all declared steps +120s; B <=2700 else A <=2700 else C'}

def seal_path(out):return out/'prepare-seal.json'

def prepare(out):
    require(not seal_path(out).exists(),'preparation seal exists; use a new output directory')
    hashes=source_hashes();representations=source_representations()
    out.mkdir(parents=True,exist_ok=True);(out/'inputs').mkdir(exist_ok=True)
    save(out/'contract.json',contract())
    refs={};inputs={};checks={}
    for tau_model in ['principal','angular']:
        ref,identity=read_reference(out,tau_model);refs[tau_model]=ref
        for extension,key in [('.npz','raw'),('.json','metadata')]:
            shutil.copyfile(identity[key],out/'inputs'/f'{tau_model}{extension}')
        inputs[tau_model]={key:identity[key] for key in ['rawSha256','metadataSha256']}
        inputs[tau_model]['original']=INPUTS[tau_model]['path']
        arrays=[]
        for wide in [False,True]:
            x,psi,T=ref.initial(wide);pulse_rows=[]
            for kind in ['baseline','zero-plus','zero-minus']:
                perturbation,info=pulse(x,kind);actual=T+perturbation;validate_state(psi,actual)
                injected=energy(psi,actual,ref.background)-energy(psi,T,ref.background)
                # Construction and addition residual are retained exactly, not removed.
                pulse_rows.append({'kind':kind,'exactInjectedEnergy':str(injected),'injectedEnergy':float(injected),
                  'phaseSha256':array_sha(psi),'temperatureSha256':array_sha(actual),**info})
            arrays.append({'wide':wide,'n':len(x),'extent':[float(x[0]),float(x[-1])],
              'xSha256':array_sha(x),'phaseSha256':array_sha(psi),'temperatureSha256':array_sha(T),
              'finiteBoxEnergyExact':str(energy(psi,T,ref.background)),
              'finiteBoxEnergy':float(energy(psi,T,ref.background)),'pulses':pulse_rows,
              'rightEndpointTemperatureGradient':float((T[-1]-T[-2])/DELTA)})
        checks[tau_model]={'tails':ref.tail_controls(),'metrology':metrology_controls(ref),
          'rhs':rhs_controls(ref),'initialArrays':arrays,'farBackground':ref.background,
          'formalContinuousWaveEnergy':model.D/VELOCITY,
          'finiteBvpQuadrature':float(np.trapezoid(1+ref.u-.5*(1+ref.q)-ref.background,ref.x)),
          'note':'formal infinite continuous-wave identity differs from finite quadrature and sampled box; no D/E speed inference'}
    checks['budget']=budget_controls()
    passed=all(checks[k][group]['passed'] for k in refs for group in ['tails','metrology','rhs']) and checks['budget']['passed']
    save(out/'prerequisites.json',{'passed':passed,'checks':checks})
    require(passed,'temporal numerical prerequisites failed; no trajectories admitted')
    cost=benchmark(refs);save(out/'benchmark.json',cost)
    selection=cost['selectedOption'];save(out/'selection.json',{'option':selection,
      'cases':[] if selection=='C' else cases(selection),'trajectoriesEvaluated':0})
    require(hashes==source_hashes(),'CPU source changed during preparation')
    files={path.name:file_sha(path) for path in [out/'contract.json',out/'prerequisites.json',out/'benchmark.json',out/'selection.json']}
    for tau_model in refs:
        for suffix in ['.json','.npz']:
            name='inputs/'+tau_model+suffix;files[name]=file_sha(out/name)
    for relative,digest in hashes.items():
        target=out/'source-snapshot'/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/relative,target)
        require(file_sha(target)==digest,'source snapshot changed while copying')
        files['source-snapshot/'+relative]=digest
    seal={'schema':'solidify-oblique-temporal-prepare-v1','preparedAtUnix':time.time(),
      'sourceHashes':hashes,'sourceRepresentations':representations,'inputSelectors':inputs,'files':files,'selection':selection,
      'gitHeadAtPreparation':git('rev-parse','HEAD'),'environment':{'python':sys.version,'numpy':np.__version__,
        'scipy':__import__('scipy').__version__,'platform':platform.platform()},
      'prerequisitesPassed':True,'trajectoriesEvaluated':0,'adopted':False,'q3Accepted':False}
    save(seal_path(out),seal)
    return {'completed':True,'preparationOnly':True,'accepted':False,'adopted':False,'q3Accepted':False,
      'selectedOption':selection,'estimatedSeconds':cost['estimatedSeconds'],'sealSha256':file_sha(seal_path(out)),
      'prerequisitesPassed':True,'trajectoriesEvaluated':0}

def validate_seal(out,seal_sha,expected_commit):
    require(isinstance(seal_sha,str) and len(seal_sha)==64,'explicit preparation seal SHA required')
    require(isinstance(expected_commit,str) and len(expected_commit)==40 and all(c in '0123456789abcdef' for c in expected_commit),
      'explicit full pushed commit required')
    require(file_sha(seal_path(out))==seal_sha,'preparation seal SHA mismatch')
    seal=json.loads(seal_path(out).read_text(encoding='utf-8'))
    require(seal['environment']['python']==sys.version and seal['environment']['numpy']==np.__version__
      and seal['environment']['scipy']==__import__('scipy').__version__,'CPU numeric environment changed after preparation')
    require(seal['sourceHashes']==source_hashes(),'source mismatch from prospective preparation')
    require(seal['sourceRepresentations']==source_representations(),'source representation changed after preparation')
    for name,digest in seal['files'].items():require(file_sha(out/name)==digest,'prepared file changed: '+name)
    require(seal['selection'] in ['A','B'],'cost-selected fallback C does not admit evolution')
    require(git('rev-parse','HEAD')==expected_commit,'execution commit differs from root-reviewed pushed commit')
    admitted={}
    for path,digest in seal['sourceHashes'].items():
        committed=subprocess.check_output(['git','show',expected_commit+':'+path],cwd=ROOT)
        representation=seal['sourceRepresentations'][path]
        require(b'\r' not in committed,'committed source is not the declared canonical LF blob: '+path)
        object_id=hashlib.sha1(b'blob '+str(len(committed)).encode()+b'\0'+committed).hexdigest()
        require(sha(committed)==representation['gitBlobSha256'] and object_id==representation['gitBlobObjectId'],
          'CPU Git blob differs from prepared representation: '+path)
        restored=(committed.replace(b'\n',b'\r\n') if representation['representation']=='LF-to-CRLF' else committed)
        require(sha(restored)==digest and restored==(ROOT/path).read_bytes(),
          'committed source cannot exactly reconstruct sealed runtime bytes: '+path)
        admitted[path]={**representation,'actualGitBlobSha256':sha(committed),
          'actualGitBlobObjectId':object_id,'runtimeReconstructedExactly':True}
    require(not git('diff','--name-only','HEAD','--',*SOURCE_PATHS),'CPU source has uncommitted modifications')
    save(out/'source-admission.json',{'commit':expected_commit,'allSourcesAdmitted':True,
      'allowedTransformations':['exact','LF-to-CRLF'],'sources':admitted})
    return seal

def probe(ref,x,psi,T,initial,t,step,E0,budget,background,evolution):
    E=energy(psi,T,background);drift=E-E0
    require(abs(drift)<=Fraction.from_float(budget),'exact enthalpy drift exceeds outward arithmetic budget')
    measured=register(ref,x,psi,T,initial)
    require(measured['ready'],'phase registration unresolved in frozen mass-centered search')
    displacement=VELOCITY*t;mask=abs(x-measured['massPosition'])<=24;pmask=abs(x-measured['massPosition'])<=12
    raw_phase=psi[pmask]-ref.psi(x[pmask]-displacement)
    raw_T=T[mask]-ref.temperature(x[mask]-displacement)
    _,tau,fields=evolution.phase(psi,T)
    return {'step':step,'time':t,'energyExact':str(E),'energy':float(E),'driftExact':str(drift),
      'energyDrift':float(drift),'arithmeticBudget':budget,'budgetPassed':True,'measurement':measured,
      'rawImposedV':{'phaseRms':float(np.sqrt(np.mean(raw_phase*raw_phase))),
        'temperatureRms':float(np.sqrt(np.mean(raw_T*raw_T)))},
      'phaseRange':[float(psi.min()),float(psi.max())],'temperatureRange':[float(T.min()),float(T.max())],
      'localTauRange':[float(tau.min()),float(tau.max())],'cutoffNodes':int(np.count_nonzero(~fields['activeFlux'])),
      'coreToLeftClearance':float(measured['massPosition']-12-x[0]),
      'coreToRightClearance':float(x[-1]-measured['massPosition']-12),
      'thermalWindowToLeftClearance':float(measured['massPosition']-24-x[0]),
      'thermalWindowToRightClearance':float(x[-1]-measured['massPosition']-24)}

def evolve_case(out,case,ref):
    started=time.perf_counter();directory=out/'trajectories'/case['name'];directory.mkdir(parents=True,exist_ok=False)
    result={'case':case,'completed':False,'accepted':False,'adopted':False,'q3Accepted':False,'samples':[]}
    save(directory/'result.json',result)
    x,initial,baseT=ref.initial(case['wide']);perturbation,perturbation_info=pulse(x,case['pulse'])
    psi=initial.copy();T=baseT+perturbation;validate_state(psi,T)
    E0=energy(psi,T,ref.background);evolution=Evolution(len(x),case['model'])
    multiplier=2 if case['halfDt'] else 1;dt=DT/multiplier;steps=STEPS*multiplier
    scheduled=[s*multiplier for s in PROBES];selected=set(scheduled);budget=0.;clamps=0;mintau=math.inf
    try:
        for step in range(steps+1):
            if step in selected:
                item=probe(ref,x,psi,T,initial,step*dt,step,E0,budget,ref.background,evolution)
                item['clampedNodeStepsToDate']=clamps
                raw=directory/f'probe-{len(result["samples"]):02d}.npz'
                np.savez_compressed(raw,x=x,psi=psi,T=T,step=np.int64(step),dt=np.float64(dt),time=np.float64(step*dt))
                item.update(raw=raw.name,rawSha256=file_sha(raw),phaseSha256=array_sha(psi),temperatureSha256=array_sha(T))
                result['samples'].append(item)
            if step==steps:break
            psi,T,B,diagnostic=evolution.step(psi,T,dt);budget=up_add(budget,B)
            clamps+=diagnostic['clamped'];mintau=min(mintau,diagnostic['tauMinimum'])
        require([row['step'] for row in result['samples']]==scheduled,'declared65 sample schedule missing')
        change=float(np.max(abs(psi-initial)))
        require(change>contract()['coreEvolutionLiveness'],'actual phase evolution was not live')
        times=np.array([row['time'] for row in result['samples']]);positions=np.array([row['measurement']['phaseShift'] for row in result['samples']])
        def slope(mask):
            tt=times[mask];ss=positions[mask];tt=tt-tt.mean();return float(np.dot(tt,ss-ss.mean())/np.dot(tt,tt))
        result.update(completed=True,dt=dt,steps=steps,n=len(x),actualHorizon=steps*dt,
          finalEnergyBudget=budget,clampedNodeSteps=clamps,tauMinimum=mintau,phaseEvolutionMaximum=change,
          descriptiveSpeed={'fullHorizon':slope(np.ones(len(times),dtype=bool)),
            'lastTwoCellPeriods':slope(times>=HORIZON-2*DELTA/VELOCITY)},
          perturbation=perturbation_info,initialInjectedEnergyExact=str(E0-energy(initial,baseT,ref.background)),
          initialInjectedEnergy=float(E0-energy(initial,baseT,ref.background)))
    except Exception as error:
        raw=directory/'failure-state.npz';np.savez_compressed(raw,x=x,psi=psi,T=T)
        result.update(error=repr(error),traceback=traceback.format_exc(),failedRaw=raw.name,failedRawSha256=file_sha(raw))
        raise
    finally:
        result['seconds']=time.perf_counter()-started;save(directory/'result.json',result)
    return result

def comparisons(out,results):
    by_name={r['case']['name']:r for r in results};rows=[]
    def raw(result,k):
        sample=result['samples'][k];path=out/'trajectories'/result['case']['name']/sample['raw']
        require(file_sha(path)==sample['rawSha256'],'retained trajectory raw changed')
        with np.load(path) as data:return data['x'].copy(),data['psi'].copy(),data['T'].copy()
    models=sorted({r['case']['model'] for r in results})
    for tau_model in models:
        for suffix in ['dt','half-dt']:
            base=by_name[f'{tau_model}-baseline-{suffix}'];plus=by_name[f'{tau_model}-zero-plus-{suffix}'];minus=by_name[f'{tau_model}-zero-minus-{suffix}']
            for k in range(65):
                x,bp,bT=raw(base,k);_,pp,pT=raw(plus,k);_,mp,mT=raw(minus,k)
                center=base['samples'][k]['measurement']['massPosition'];mask=abs(x-center)<=24
                oddp=(pp-mp)/2;evenp=(pp+mp)/2-bp;oddT=(pT-mT)/2;evenT=(pT+mT)/2-bT
                rows.append({'model':tau_model,'kind':'signed-response','clock':suffix,'probe':k,
                  'time':base['samples'][k]['time'],'phaseOddRms':float(np.sqrt(np.mean(oddp[mask]**2))),
                  'phaseEvenRms':float(np.sqrt(np.mean(evenp[mask]**2))),
                  'temperatureOddRms':float(np.sqrt(np.mean(oddT[mask]**2))),
                  'temperatureEvenRms':float(np.sqrt(np.mean(evenT[mask]**2)))})
        for kind in ['baseline','zero-plus','zero-minus']:
            coarse=by_name[f'{tau_model}-{kind}-dt'];fine=by_name[f'{tau_model}-{kind}-half-dt']
            for k in range(65):
                x,cp,cT=raw(coarse,k);fx,fp,fT=raw(fine,k)
                require(np.array_equal(x,fx) and coarse['samples'][k]['time']==fine['samples'][k]['time'],'paired timestep coordinates/clocks differ')
                mask=abs(x-coarse['samples'][k]['measurement']['massPosition'])<=24
                rows.append({'model':tau_model,'kind':'timestep-difference','pulse':kind,'probe':k,
                  'time':coarse['samples'][k]['time'],'phaseRms':float(np.sqrt(np.mean((cp[mask]-fp[mask])**2))),
                  'temperatureRms':float(np.sqrt(np.mean((cT[mask]-fT[mask])**2)))})
        coarse=by_name[f'{tau_model}-baseline-dt'];wide=by_name[f'{tau_model}-baseline-wide']
        for k in range(65):
            x,cp,cT=raw(coarse,k);wx,wp,wT=raw(wide,k);start=LEFT
            require(np.array_equal(x,wx[start:start+len(x)]),'wide domain central samples changed')
            mask=abs(x-coarse['samples'][k]['measurement']['massPosition'])<=24
            rows.append({'model':tau_model,'kind':'domain-difference','probe':k,'time':coarse['samples'][k]['time'],
              'phaseRms':float(np.sqrt(np.mean((cp[mask]-wp[start:start+len(x)][mask])**2))),
              'temperatureRms':float(np.sqrt(np.mean((cT[mask]-wT[start:start+len(x)][mask])**2)))})
    save(out/'descriptive-comparisons.json',{'scientificAcceptanceBand':None,'rows':rows})
    return {'rows':len(rows),'sha256':file_sha(out/'descriptive-comparisons.json')}

def run(out,seal_sha,expected_commit):
    seal=validate_seal(out,seal_sha,expected_commit);selection=json.loads((out/'selection.json').read_text())
    require(selection['cases']==cases(seal['selection']),'selection differs from static stage design')
    refs={key:read_reference(out,key,True)[0] for key in {case['model'] for case in selection['cases']}}
    results=[]
    for case in selection['cases']:
        require(source_hashes()==seal['sourceHashes'],'CPU source changed during execution')
        result=evolve_case(out,case,refs[case['model']]);results.append(result)
        print(json.dumps({'case':case['name'],'completed':result['completed'],'seconds':result['seconds'],
          'speed':result['descriptiveSpeed'],'energyDrift':result['samples'][-1]['energyDrift']},default=plain),flush=True)
    summary=comparisons(out,results)
    require(source_hashes()==seal['sourceHashes'],'CPU source changed during execution')
    for name,digest in seal['files'].items():require(file_sha(out/name)==digest,'prospective artifact changed during execution: '+name)
    return {'completed':len(results)==len(selection['cases']) and all(row['completed'] for row in results),
      'accepted':False,'adopted':False,'q3Accepted':False,'scientificAcceptanceBand':None,
      'option':seal['selection'],'expectedTrajectories':len(selection['cases']),'completedTrajectories':len(results),
      'sealSha256':seal_sha,'sourceStable':True,'inputStable':True,'commit':expected_commit,
      'sourceAdmissionSha256':file_sha(out/'source-admission.json'),
      'cases':[{'case':r['case'],'seconds':r['seconds'],'descriptiveSpeed':r['descriptiveSpeed'],
        'initialInjectedEnergy':r['initialInjectedEnergy'],'terminal':r['samples'][-1],
        'rawResultSha256':file_sha(out/'trajectories'/r['case']['name']/'result.json')} for r in results],
      'comparisons':summary,'scope':'finite horizon physical-sub1 Float64 evolution on artificial closed normal heat graph; no universal stability/recovery or native GPU claim'}

def entry():
    # Invalidate an old CLI verdict before argument parsing and model imports.
    argv=sys.argv[1:];out=ROOT/'verify-out/q3-oblique-temporal-pilot-v1'
    for k,arg in enumerate(argv):
        if arg=='--out' and k+1<len(argv):out=Path(argv[k+1]).resolve()
        elif arg.startswith('--out='):out=Path(arg.split('=',1)[1]).resolve()
    if not out.is_relative_to(ROOT/'verify-out'):
        print('Temporal output must be under the ignored verify-out directory',file=sys.stderr);return 1
    result={'completed':False,'accepted':False,'adopted':False,'q3Accepted':False}
    save(out/'result.json',result)
    try:
        parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('mode',choices=['prepare','run'])
        parser.add_argument('--out',type=Path,default=out);parser.add_argument('--seal-sha');parser.add_argument('--expected-commit')
        args=parser.parse_args();require(args.out.resolve()==out,'ambiguous output argument')
        require(out.is_relative_to(ROOT/'verify-out'),'temporal output must be a new ignored verify-out directory')
        load_model()
        result=(prepare(out) if args.mode=='prepare' else run(out,args.seal_sha,args.expected_commit))
        save(out/'result.json',result);print(json.dumps(result,default=plain),flush=True);return 0
    except BaseException as error:
        result.update(error=repr(error),traceback=traceback.format_exc())
        save(out/'result.json',result);print(json.dumps({'completed':False,'error':repr(error)}),file=sys.stderr,flush=True)
        return 1

if __name__=='__main__':sys.exit(entry())
