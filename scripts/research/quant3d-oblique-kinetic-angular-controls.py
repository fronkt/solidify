"""Predeclared independent controls for the new nodewise angular wrapper."""
import importlib.util,json,sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from scipy.sparse import eye

path=Path(__file__).with_name('quant3d-oblique-kinetic-angular.py')
spec=importlib.util.spec_from_file_location('angular_control_model',path)
angular=importlib.util.module_from_spec(spec);sys.modules[spec.name]=angular;spec.loader.exec_module(angular)


def independent_fields(gradient,epsilon=.0171):
    radius=np.linalg.norm(gradient,axis=1);normal=gradient/radius[:,None]
    s4=np.sum(normal**4,axis=1);a=1+epsilon*(4*s4-3)
    tangent=16*epsilon*(normal**3-s4[:,None]*normal)
    return {'gradientQ':gradient,'normalFD':normal,'aFD':a,'activeFlux':radius**2/4>=1e-12,
            'w':a*a,'correctionQ':a[:,None]*radius[:,None]*tangent}


def run_controls(baseline_directory,fp32_input):
    original=json.loads(fp32_input.read_text());q=2*np.array(original['psiStored'])-1
    result={'purpose':'controls only; no traveling-profile or stability acceptance','local':None,'periodic':[],
            'coupled':[],'principal':[],'storedPrincipal':[],'passed':False}
    # Generic nondegenerate gradients check the local derivative independently
    # of the restricted finite-difference matrices and tiny-gradient probe.
    g=np.array([[.7,.3,-.2],[.2,-.6,.4],[-.5,.1,.8],[.3,.4,.6]])
    dummy=SimpleNamespace(epsilon=.0171,cutoff=True,g=angular.model.Geometry((2,1,0)),Gcore=[eye(4,format='csr')]*3)
    local=angular.gamma_fields(independent_fields(g),dummy,True);finite=np.empty_like(g);step=1e-6
    for axis in range(3):
        plus=g.copy();minus=g.copy();plus[:,axis]+=step;minus[:,axis]-=step
        finite[:,axis]=(angular.gamma_fields(independent_fields(plus),dummy)['gammaFD']-
                       angular.gamma_fields(independent_fields(minus),dummy)['gammaFD'])/(2*step)
    relative=float(np.linalg.norm(finite-local['gradientWrtGq'])/np.linalg.norm(local['gradientWrtGq']))
    fields=independent_fields(g);nn=fields['normalFD'];s4=np.sum(nn**4,axis=1);s6=np.sum(nn**6,axis=1);K=s6-s4*s4;a=fields['aFD']
    ambient=(16*.0171/3)*((6*nn**5-8*s4[:,None]*nn**3)/a[:,None]-K[:,None]*16*.0171*nn**3/a[:,None]**2)
    projected=(ambient-nn*np.sum(nn*ambient,axis=1)[:,None])/np.linalg.norm(g,axis=1)[:,None]
    ambient_error=float(np.max(np.abs(projected-local['gradientWrtGq'])))
    result['local']={'relativeFiniteDifferenceError':relative,'ambientProjectedMaxError':ambient_error,
                     'passed':relative<2e-7 and ambient_error<2e-12}
    for normal in [(1,0,0),(1,1,0),(1,1,1),(2,1,0),(2,1,1),(3,2,1)]:
        op=angular.model.PlaneOperator(257,angular.model.Geometry(normal,original['uniforms']['dx'],1),
            epsilon=original['uniforms']['delta'],boundary='periodic')
        f=op.evaluate(q);gamma=angular.gamma_fields(f,op,True);radius=np.linalg.norm(f['gradientQ'],axis=1)
        direct=np.zeros(257);active=f['activeFlux']
        direct[active]=np.sum(f['correctionQ'][active]*f['normalFD'][active]**3,axis=1)/(3*f['w'][active]*radius[active])
        flux_error=float(np.max(np.abs(direct-gamma['gammaFD'])))
        direction=.2*q*q+.1*q*q*q
        # A weak gamma direction suffers subtraction error in Float64 finite
        # differences. Independent analytic complex continuation avoids it;
        # branch masks are fixed at the unperturbed literal state.
        step=1e-30
        gd=np.stack([matrix@direction for matrix in op.Gcore],axis=1)
        gc=f['gradientQ'].astype(complex)+1j*step*gd;bc=gc*gc
        rc=np.where(active,np.sum(bc,axis=1),1.)
        numerator=sum(bc[:,i]*bc[:,j]*(bc[:,i]-bc[:,j])**2 for i,j in [(0,1),(0,2),(1,2)])
        ac=1+op.epsilon*(4*np.sum(bc*bc,axis=1)/rc**2-3)
        continuation=(16*op.epsilon/3)*numerator/(rc**4*ac);continuation[~active]=0
        fd=continuation.imag/step;analytic=gamma['jacobian']@direction
        principal=normal in [(1,0,0),(1,1,0),(1,1,1)]
        derivative_error=float(np.max(np.abs(fd-analytic))) if principal else float(np.linalg.norm(fd-analytic)/np.linalg.norm(analytic))
        tau=angular.angular_tau(f,op);omission=float(np.max(np.abs(tau['deltaTau'])))
        unit=op.g.unit;bb=unit*unit
        geometric=16*op.epsilon/(3*(1+op.epsilon*(4*np.sum(unit**4)-3)))*sum(bb[i]*bb[j]*(bb[i]-bb[j])**2 for i,j in [(0,1),(0,2),(1,2)])
        continuum_negative=float(np.max(np.abs(gamma['gammaFD']-geometric)))
        curve=[]
        for probe in [1e-3,1e-4,1e-5,1e-6]:
            plus=angular.gamma_fields(op.evaluate(q+probe*direction),op)['gammaFD']
            minus=angular.gamma_fields(op.evaluate(q-probe*direction),op)['gammaFD']
            fdp=(plus-minus)/(2*probe)
            curve.append({'step':probe,'absoluteError':float(np.max(np.abs(fdp-analytic))),
              'relativeError':float(np.linalg.norm(fdp-analytic)/np.linalg.norm(analytic)) if np.linalg.norm(analytic)>0 else None})
        result['periodic'].append({'normal':normal,'sourceFluxMaxError':flux_error,'gammaDirectionalError':derivative_error,
          'primaryDerivativeReference':'independent rational complex continuation; fixed active set; no conjugation',
          'float64SubtractionProbeSensitivity':curve,
          'omittedAngularTauMaxContrast':omission,'declaredNormalGammaNegativeMaxContrast':continuum_negative,
          'passed':flux_error<2e-12 and derivative_error<(2e-12 if principal else 2e-6)
            and (omission<2e-12 if principal else omission>1e-6 and continuum_negative>1e-6)})
    for normal in [(2,1,0),(2,1,1),(3,2,1)]:
        for cutoff in [True,False]:
            p=angular.build(normal=normal,h=.8,sub=8,half=32.,velocity=.04,cutoff=cutoff)
            y=p['initial'];n=p['n'];x=p['x'];q0=y[:n]
            direction=np.r_[.02*(1-q0*q0)*np.sin(.3*x),.01*np.exp(-x*x/10),.001];step=1e-5
            residual,J=p['evaluate'](y)
            finite=(p['evaluate'](y+step*direction,False)-p['evaluate'](y-step*direction,False))/(2*step)
            analytic=J@direction;error=float(np.linalg.norm(finite-analytic)/np.linalg.norm(analytic))
            result['coupled'].append({'normal':normal,'literalCutoff':cutoff,'relativeError':error,'passed':error<1e-6})
    for normal in [(1,0,0),(1,1,0),(1,1,1)]:
        for h in [.8,.4]:
            for cutoff in [True,False]:
                request=dict(normal=normal,h=h,sub=8,half=32.,velocity=.04,cutoff=cutoff)
                p=angular.build(**request);base=angular.reference.build(candidate=True,**request);y=base['initial']
                ra,Ja=p['evaluate'](y);rp,Jp=base['evaluate'](y);difference=Ja-Jp
                jerror=float(np.max(np.abs(difference.data))) if difference.nnz else 0.
                rerror=float(np.max(np.abs(ra-rp)))
                result['principal'].append({'normal':normal,'h':h,'literalCutoff':cutoff,'residualDifference':rerror,
                  'jacobianDifference':jerror,'passed':rerror<2e-12 and jerror<2e-12})
    baseline=json.loads((baseline_directory/'study.json').read_text())
    for row in baseline['cases']:
        if row['label']!='principal-smooth' or not row['request']['candidate']:continue
        request={key:value for key,value in row['request'].items() if key!='candidate'}
        p=angular.build(**request)
        with np.load(baseline_directory/row['raw']) as raw:y=np.r_[raw['q'],raw['u'],float(raw['uInfinity'])]
        residual=float(np.max(np.abs(p['evaluate'](y,False))))
        result['storedPrincipal'].append({'normal':row['request']['normal'],'residual':residual,'passed':residual<3e-11})
    failed=next(row for row in baseline['cases'] if not row['converged'])
    request={key:value for key,value in failed['request'].items() if key!='candidate'}
    angular_problem=angular.build(**request);base=angular.reference.build(candidate=True,**request)
    with np.load(baseline_directory/failed['failedRaw']) as raw:y=raw['state']
    ra=angular_problem['evaluate'](y,False);rp=base['evaluate'](y,False)
    difference=float(np.max(np.abs(ra-rp)))
    result['oldFailure']={'angularResidual':float(np.max(np.abs(ra))),'principalResidual':float(np.max(np.abs(rp))),
      'difference':difference,'preserved':bool(difference<2e-12 and np.max(np.abs(ra))>=3e-11)}
    result['passed']=bool(result['local']['passed'] and all(row['passed'] for key in ['periodic','coupled','principal','storedPrincipal']
      for row in result[key]) and result['oldFailure']['preserved'])
    return result
