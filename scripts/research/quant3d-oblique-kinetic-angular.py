"""Identity-cubic nodewise angular relaxation layered over sealed references.

No prior operator/reference or production source is modified. The pairwise
variance form of gamma equals the source-flux invariant in real arithmetic.
"""
import os
for name in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ.setdefault(name,'1')
import hashlib,importlib.util,json,sys,time,traceback
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix,diags

path=Path(__file__).with_name('quant3d-oblique-kinetic-reference.py')
spec=importlib.util.spec_from_file_location('sealed_angular_base_reference',path)
reference=importlib.util.module_from_spec(spec);sys.modules[spec.name]=reference;spec.loader.exec_module(reference)
model=reference.model
ANGULAR_FACTOR=1084/1645


def gamma_fields(fields,operator,jacobian=False):
    """Nodewise gamma and dgamma/dq, including literal/optional fallback policy.

    Pairwise K=sum_{i<j}g_i²g_j²(g_i²-g_j²)²/(sum g²)^4 avoids cancellation
    at principal normals. No declared continuum normal enters live nodes.
    """
    g=fields['gradientQ'];b=g*g;radius2=np.sum(b,axis=1);live=radius2>0
    if operator.cutoff:live&=fields['activeFlux']
    denominator=np.where(live,radius2,1.)
    numerator=np.zeros(len(g));d_numerator_db=np.zeros_like(g)
    for i,j in [(0,1),(0,2),(1,2)]:
        difference=b[:,i]-b[:,j]
        numerator+=b[:,i]*b[:,j]*difference*difference
        d_numerator_db[:,i]+=b[:,j]*difference*(3*b[:,i]-b[:,j])
        d_numerator_db[:,j]+=b[:,i]*difference*(b[:,i]-3*b[:,j])
    K=numerator/denominator**4;K[~live]=0
    a=fields['aFD'];constant=16*operator.epsilon/3
    gamma=constant*K/a
    flat=(radius2==0)&(~np.asarray(operator.cutoff))
    if np.any(flat):
        nn=operator.g.unit;bb=nn*nn
        geometric=sum(bb[i]*bb[j]*(bb[i]-bb[j])**2 for i,j in [(0,1),(0,2),(1,2)])
        gamma[flat]=constant*geometric/a[flat]
    out={'gammaFD':gamma,'K':K,'live':live,'flatSmoothFallback':flat}
    if not jacobian:return out
    dK=(2*g*d_numerator_db)/denominator[:,None]**4-8*K[:,None]*g/denominator[:,None]
    nn=fields['normalFD'];s4=np.sum(nn**4,axis=1)
    da=16*operator.epsilon*(nn**3-s4[:,None]*nn)/np.sqrt(denominator)[:,None]
    gradient=constant*(dK/a[:,None]-K[:,None]*da/a[:,None]**2)
    gradient[~live]=0
    J=sum(diags(gradient[:,i])@operator.Gcore[i] for i in range(3)).tocsr()
    out.update(gradientWrtGq=gradient,jacobian=J)
    return out


def angular_tau(fields,operator,tau_input=1.,lambda_=model.LAMBDA,D_=model.D,jacobian=False):
    width2=max(1e-20,operator.eps_bar**2);r=(47/75)*lambda_/D_
    gamma=gamma_fields(fields,operator,jacobian)
    current=model.local_tau(fields,operator.g,tau_input,True,lambda_,D_,operator.eps_bar)
    factor=-tau_input*r*operator.g.dx**2/width2*ANGULAR_FACTOR
    values=current+factor*gamma['gammaFD']
    if not np.all(np.isfinite(values)) or np.any(values<=0):raise ValueError('nonpositive/nonfinite angular relaxation')
    return {'tau':values,'principalTau':current,'deltaTau':values-current,'gamma':gamma,'deltaFactor':factor}


def build(tau_model='angular',**request):
    if tau_model not in ['default','principal','angular']:raise ValueError('unknown explicit tau model')
    base=reference.build(candidate=tau_model!='default',**request)
    if tau_model!='angular':
        base['config']['tauModel']=tau_model;return base
    original=base['evaluate'];n=base['n'];op=base['operator'];V=base['config']['velocity'];tau_input=base['config']['tauInput']
    def evaluate(y,jacobian=True):
        got=original(y,jacobian)
        residual,J=got if jacobian else (got,None)
        q=y[:n];fields=op.evaluate(q,False);tau=angular_tau(fields,op,tau_input,jacobian=jacobian)
        qp=base['dq']@q+base['dq0'];delta=tau['deltaTau']
        addition=V*delta*qp;addition[0]=addition[-1]=0
        residual[:n]+=addition
        if not jacobian:return residual
        extra=V*(diags(delta)@base['dq']+tau['deltaFactor']*diags(qp)@tau['gamma']['jacobian'])
        extra=extra.tolil()
        for row in [0,n-1]:extra.rows[row]=[];extra.data[row]=[]
        extra=extra.tocoo();full=coo_matrix((extra.data,(extra.row,extra.col)),shape=J.shape).tocsc()
        return residual,J+full
    base['evaluate']=evaluate;base['config'].update(tauModel='angular',angularFactor=ANGULAR_FACTOR,
      gammaPolicy='nodewise centered-gradient pairwise variance; literal cutoff gamma0; smooth flat fallback fixed geometric gamma/J0')
    return base


def measure(problem,y):
    data=reference.measure(problem,y)
    if problem['config']['tauModel']!='angular':return data
    n=problem['n'];q=y[:n];u=y[n:2*n];fields=problem['operator'].evaluate(q)
    tau=angular_tau(fields,problem['operator'],problem['config']['tauInput'])
    x=problem['x'];qp=problem['dq']@q+problem['dq0'];integral=lambda value:float(np.trapezoid(value,x))
    terms={'spatial':integral(fields['spatialQ']*qp),'well':integral((q-q**3)*qp),
      'thermal':-model.LAMBDA*integral(u*(1-q*q)**2*qp),
      'relaxation':problem['config']['velocity']*integral(tau['tau']*qp*qp)}
    data.update(localTauRange=[float(tau['tau'].min()),float(tau['tau'].max())],
      gammaRange=[float(tau['gamma']['gammaFD'].min()),float(tau['gamma']['gammaFD'].max())],
      angularDeltaTauRange=[float(tau['deltaTau'].min()),float(tau['deltaTau'].max())],
      projectedBvpIdentity={'terms':terms,'absoluteResidual':sum(terms.values()),
        'note':'full spatial and nodewise angular tau terms retained; not a variational-energy or stability proof'})
    return data


def write_case(out,request,label,cpu_sources,baseline_wgsl_sources):
    out.mkdir(parents=True,exist_ok=True);start=time.perf_counter();problem=None
    result={'request':request,'converged':False,'cpuSourceHashes':cpu_sources,'baselineWgslSnapshotHashes':baseline_wgsl_sources}
    try:
        problem=build(**request);state,trace=reference.solve(problem);measurement=measure(problem,state);n=problem['n']
        raw=out/f'{label}.npz';np.savez_compressed(raw,x=problem['x'],q=state[:n],u=state[n:2*n],uInfinity=state[-1])
        result.update(converged=True,config=problem['config'],trace=trace,measurement=measurement,
          raw=raw.name,rawSha256=hashlib.sha256(raw.read_bytes()).hexdigest())
    except Exception as error:
        result.update(error=repr(error),trace=getattr(error,'trace',None),traceback=traceback.format_exc())
        if hasattr(error,'state'):
            raw=out/f'{label}-failed.npz';np.savez_compressed(raw,x=problem['x'],state=error.state)
            result.update(failedRaw=raw.name,failedRawSha256=hashlib.sha256(raw.read_bytes()).hexdigest())
    result['seconds']=time.perf_counter()-start
    (out/f'{label}.json').write_text(json.dumps(result,indent=2));return result
