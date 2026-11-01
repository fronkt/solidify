"""Coupled rational-plane traveling reference using the full oblique operator.

The imposed V labels a finite-speed boundary-value problem. It does not prove
dynamic stability, zero-speed identifiability, or production Euler/Float32 parity.
"""
import os
for variable in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ.setdefault(variable,'1')
import argparse,hashlib,importlib.util,json,math,platform,sys,time,traceback
from pathlib import Path
import numpy as np
import scipy
from scipy.interpolate import CubicSpline
from scipy.optimize import brentq
from scipy.sparse import bmat,coo_matrix,csr_matrix,diags
from scipy.sparse.linalg import spsolve

path=Path(__file__).with_name('quant3d-oblique-kinetic.py')
spec=importlib.util.spec_from_file_location('full_oblique_operator',path)
model=importlib.util.module_from_spec(spec);sys.modules[spec.name]=model;spec.loader.exec_module(model)
principal=model.reference_module()


def derivative_stencil(eta,order=6,bias=1):
    offsets=np.arange(-order//2+bias,order//2+bias+1)
    moments=np.vstack([offsets.astype(float)**j for j in range(len(offsets))]);rhs=np.zeros(len(offsets));rhs[1]=1
    return offsets,np.linalg.solve(moments,rhs)/eta


def outgoing_tail(n,eta,delta,kappa,roots,periods=4):
    """Same controlled modal closure as the old reference, with explicit width."""
    width=int(round(periods*delta/eta));positions=np.arange(width+1)*eta
    def basis(coordinates,side):
        columns=[np.ones(len(coordinates))] if side=='solid' else [np.exp(-kappa*coordinates)]
        for row in roots:
            if row['side']!=side:continue
            z=np.exp(complex(row['real'],row['imaginary'])*coordinates);columns.extend([z.real,z.imag])
        return np.stack(columns,axis=1)
    inverse={side:np.linalg.pinv(basis(positions if side=='solid' else -positions,side)) for side in ['solid','liquid']}
    conditions={side:float(np.linalg.cond(basis(positions if side=='solid' else -positions,side))) for side in inverse}
    cache={}
    def ghost(j):
        if j not in cache:
            side='solid' if j<0 else 'liquid';coordinate=j*eta if j<0 else (j-(n-1))*eta
            coefficients=basis(np.array([coordinate]),side)[0]@inverse[side]
            columns=np.arange(width+1) if j<0 else n-1-np.arange(width+1)
            far=0. if j<0 else 1-float(coefficients.sum());cache[j]=(columns,coefficients,far)
        return cache[j]
    return ghost,conditions


def build(normal=(2,1,0),h=.8,sub=16,half=64.,velocity=.04,tau_input=1.,candidate=False,
          cutoff=True,modes=3,order=6,bias=1,tail_periods=4):
    if not (velocity>0 and tau_input>0 and math.isfinite(velocity+tau_input)):raise ValueError('positive finite V and tau input required')
    g=model.Geometry(normal,h,sub);eta=g.eta;count=int(round(half/eta));half=count*eta
    x=np.arange(-count,count+1)*eta;n=len(x)
    op=model.PlaneOperator(n,g,cutoff=cutoff)
    def characteristic(k):
        return model.D*sum(weight*4*np.sinh(shift*g.delta*k/2)**2 for shift,weight in g.weights)/(g.delta**2*k)-velocity
    kappa=brentq(characteristic,1e-10,max(1.,2*velocity/model.D),xtol=1e-14)
    offsets,coefficients=derivative_stencil(eta,order,bias)
    roots=principal.characteristic_roots(g.delta,g.weights,velocity,modes)
    tail,conditions=outgoing_tail(n,eta,g.delta,kappa,roots,tail_periods) if modes else (None,None)
    dq,dq0,_=principal.operator(n,eta,offsets,coefficients,'phase',kappa)
    du,_,duinf=principal.operator(n,eta,offsets,coefficients,'heat',kappa,tail)
    lap_offsets=[shift*sub for shift in g.counts];lap_coeff=[g.counts[shift]/(6*h*h) for shift in g.counts]
    lu,_,luinf=principal.operator(n,eta,lap_offsets,lap_coeff,'heat',kappa,tail)
    heat=model.D*lu+velocity*du;heatinf=model.D*luinf+velocity*duinf
    heatphase=-.5*velocity*dq;heat0=-.5*velocity*dq0
    pin=csr_matrix(([1.],([0],[count])),shape=(1,n))
    tau_w_factor=tau_input*((47/75)*model.LAMBDA/model.D if candidate else 1.)
    def evaluate(y,jacobian=True):
        q,u,uinf=y[:n],y[n:2*n],y[-1];fields=op.evaluate(q,jacobian)
        tau=model.local_tau(fields,g,tau_input,candidate)
        derivative=dq@q+dq0;well=1-q*q
        rp=fields['spatialQ']+q-q**3-model.LAMBDA*u*well**2+velocity*tau*derivative
        rp[0]=q[0]-1;rp[-1]=q[-1]+1
        rh=heat@u+heatinf*uinf+heatphase@q+heat0
        residual=np.r_[rp,rh,q[count]]
        if not jacobian:return residual
        J=fields['jacobian']+diags(1-3*q*q+4*model.LAMBDA*u*q*well)+velocity*diags(tau)@dq
        J=J+velocity*tau_w_factor*diags(derivative)@fields['wJacobian']
        J=J.tolil();U=diags(-model.LAMBDA*well**2).tolil()
        for row in [0,n-1]:
            J.rows[row]=[row];J.data[row]=[1.];U.rows[row]=[];U.data[row]=[]
        matrix=bmat([[J,U,csr_matrix((n,1))],[heatphase,heat,csr_matrix(heatinf[:,None])],
                     [pin,csr_matrix((1,n)),csr_matrix((1,1))]],format='csc')
        return residual,matrix
    a=g.a_geometric
    effective=tau_input*((47/75)*model.LAMBDA/model.D*(1-float(model.CORRECTION)*h*h/(a*a)) if candidate else 1.)
    beta_initial=.8839*a/model.LAMBDA*(effective-1)
    q=-np.tanh(x/(np.sqrt(2)*a));uinf=-1-beta_initial*velocity
    u=spsolve(heat,-heatinf*uinf-heatphase@q-heat0)
    config={**g.metadata(),'half':half,'velocity':velocity,'tauInput':tau_input,'candidate':candidate,
      'literalBulkCutoff':cutoff,'outgoingModes':modes,'tailPeriods':tail_periods,'tailConditions':conditions,
      'derivativeOrder':order,'derivativeBias':bias,'aGeometric':a,'lambda':model.LAMBDA,'D':model.D,'epsilon':model.EPSILON,
      'heatRoots':roots,'initialEffectiveScalarTauScale':effective}
    return {'x':x,'n':n,'geometry':g,'operator':op,'evaluate':evaluate,'initial':np.r_[q,u,uinf],
      'dq':dq,'dq0':dq0,'kappa':kappa,'roots':roots,'config':config}


def solve(problem,initial=None,tolerance=3e-11,max_iterations=40):
    y=problem['initial'].copy() if initial is None else initial.copy();trace=[]
    for iteration in range(max_iterations):
        residual,J=problem['evaluate'](y);error=float(np.max(np.abs(residual)))
        trace.append({'iteration':iteration,'maxResidual':error})
        if error<tolerance:return y,trace
        change=spsolve(J,-residual)
        if not np.all(np.isfinite(change)):raise RuntimeError('nonfinite Newton update')
        old=np.linalg.norm(residual);damping=1.
        for _ in range(20):
            test=y+damping*change;new=problem['evaluate'](test,False)
            if np.all(np.isfinite(new)) and np.linalg.norm(new)<old*(1-1e-4*damping):
                y=test;trace[-1]['damping']=damping;break
            damping*=.5
        else:
            failure=RuntimeError(f'Newton line search failed at residual {error}')
            failure.trace=trace;failure.state=y;raise failure
    failure=RuntimeError(f'Newton iteration budget exhausted at {trace[-1]}')
    failure.trace=trace;failure.state=y;raise failure


def measure(problem,y):
    x,n=problem['x'],problem['n'];q,u,uinf=y[:n],y[n:2*n],float(y[-1]);c=problem['config']
    V=c['velocity'];a=c['aGeometric'];roots=principal.characteristic_roots(problem['geometry'].delta,
      problem['geometry'].weights,V,max(2,c['outgoingModes']))
    fits=[]
    for inner,outer in [(8,16),(12,22),(16,28),(24,40),(32,48),(40,56),(64,88)]:
        if outer*a>c['half']-2*c['physicalDx']:continue
        row={'windowW':[inner,outer]}
        for side,mask in [('solid',(x<=-inner*a)&(x>=-outer*a)),('liquid',(x>=inner*a)&(x<=outer*a))]:
            coordinates=x[mask];columns=[np.ones(len(coordinates))]
            if side=='liquid':columns.append(np.exp(-problem['kappa']*coordinates))
            for root in roots:
                if root['side']!=side:continue
                z=np.exp(complex(root['real'],root['imaginary'])*coordinates);columns.extend([z.real,z.imag])
            matrix=np.stack(columns,axis=1);scale=np.linalg.norm(matrix,axis=0)
            coefficients=np.linalg.lstsq(matrix/scale,u[mask],rcond=None)[0]/scale
            row[side]={'coefficients':coefficients.tolist(),'rms':float(np.sqrt(np.mean((matrix@coefficients-u[mask])**2))),
              'condition':float(np.linalg.cond(matrix/scale)),'points':len(coordinates)}
        us=row['solid']['coefficients'][0];ul=row['liquid']['coefficients'][0]+row['liquid']['coefficients'][1]
        row.update(betaSolid=-us/V,betaLiquid=-ul/V,uSolid=us,uLiquidExtrapolated=ul,
          uInfinityFitted=row['liquid']['coefficients'][0],latentJump=us-row['liquid']['coefficients'][0])
        fits.append(row)
    if not fits:raise RuntimeError('no resolved independently fitted bulk window')
    fields=problem['operator'].evaluate(q);tau=model.local_tau(fields,problem['geometry'],c['tauInput'],c['candidate'])
    qp=problem['dq']@q+problem['dq0'];integral=lambda z:float(np.trapezoid(z,x))
    terms={'spatial':integral(fields['spatialQ']*qp),'well':integral((q-q**3)*qp),
      'thermal':-model.LAMBDA*integral(u*(1-q*q)**2*qp),'relaxation':V*integral(tau*qp*qp)}
    period=problem['geometry'].delta;sampled=np.arange(math.ceil(x[0]/period)+2,math.floor(x[-1]/period)-1)*period
    spline=CubicSpline(x,q).derivative()
    velocity=np.array([-.5*V*period*np.sum(spline(sampled-phase)) for phase in np.arange(256)/256*period])
    core=abs(q)<.99
    return {'modalOuterFits':fits,'modalBetaSolid':fits[-1]['betaSolid'],'modalBetaLiquid':fits[-1]['betaLiquid'],
      'modalLatentJump':fits[-1]['latentJump'],'uInfinityUnknown':uinf,'betaFromFarUndercooling':(-uinf-1)/V,
      'kappa':problem['kappa'],'metrologyHeatRoots':roots,'qRange':[float(q.min()),float(q.max())],
      'phaseMonotonicityViolation':float(max(0,np.max(np.diff(q)))),'localTauRange':[float(tau.min()),float(tau.max())],
      'interfaceNormalFdDeviation':float(np.max(np.linalg.norm(fields['normalFD'][core]+problem['geometry'].unit,axis=1))),
      'projectedBvpIdentity':{'terms':terms,'absoluteResidual':sum(terms.values()),
         'note':'full nonconstant spatial term retained; this is not a claim of a variational discrete energy'},
      'cellPhase':{'samples':256,'period':period/V,'meanMassVelocity':float(velocity.mean()),
         'relativeVelocityOscillation':float(np.ptp(velocity)/V)},
      'scope':'finite-speed coupled branch at imposed V; no zero-speed coefficient, temporal stability or GPU parity inferred'}


def write_case(out,request,label='case'):
    out.mkdir(parents=True,exist_ok=True);start=time.perf_counter()
    result={'request':request,'sourceHashes':{**model.source_hashes(),
      Path(__file__).relative_to(model.ROOT).as_posix():hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
      'environment':{'python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__},'converged':False}
    problem=None
    try:
        problem=build(**request);state,trace=solve(problem);m=measure(problem,state)
        n=problem['n'];raw=out/f'{label}.npz';np.savez_compressed(raw,x=problem['x'],q=state[:n],u=state[n:2*n],uInfinity=state[-1])
        result.update(converged=True,config=problem['config'],trace=trace,measurement=m,raw=raw.name,
          rawSha256=hashlib.sha256(raw.read_bytes()).hexdigest())
    except Exception as error:
        result.update(error=repr(error),trace=getattr(error,'trace',None),traceback=traceback.format_exc())
        if hasattr(error,'state'):
            raw=out/f'{label}-failed-state.npz';np.savez_compressed(raw,state=error.state,x=problem['x'])
            result.update(failedRaw=raw.name,failedRawSha256=hashlib.sha256(raw.read_bytes()).hexdigest())
    result['seconds']=time.perf_counter()-start
    (out/f'{label}.json').write_text(json.dumps(result,indent=2));return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--normal',default='210');parser.add_argument('--dx',type=float,default=.8)
    parser.add_argument('--velocity',type=float,default=.04);parser.add_argument('--sub',type=int,default=16)
    parser.add_argument('--half',type=float,default=64.);parser.add_argument('--modes',type=int,default=3)
    parser.add_argument('--tau-input',type=float,default=1.);parser.add_argument('--candidate',action='store_true')
    parser.add_argument('--smooth-branch',action='store_true');args=parser.parse_args()
    request={'normal':model.primitive_normal(args.normal),'h':args.dx,'sub':args.sub,'half':args.half,
      'velocity':args.velocity,'modes':args.modes,'tau_input':args.tau_input,'candidate':args.candidate,'cutoff':not args.smooth_branch}
    row=write_case(args.out,request)
    print(json.dumps({key:value for key,value in row.items() if key not in ['sourceHashes','trace','traceback']},indent=2))
    if not row['converged']:raise SystemExit(1)
