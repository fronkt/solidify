"""Registered coupled oblique CPU study; finite-speed diagnostics only.

The exact operator, candidate coefficient, cases and fit windows are frozen in
the first artifact before any case executes. Failed states and traces remain.
"""
import os
for name in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ.setdefault(name,'1')
import argparse,hashlib,importlib.util,json,sys,time,traceback
from pathlib import Path
import numpy as np
from scipy.interpolate import CubicSpline

path=Path(__file__).with_name('quant3d-oblique-kinetic-reference.py')
spec=importlib.util.spec_from_file_location('coupled_oblique_reference',path)
reference=importlib.util.module_from_spec(spec);sys.modules[spec.name]=reference;spec.loader.exec_module(reference)
model=reference.model


def run(out):
    out.mkdir(parents=True,exist_ok=True)
    cases=[]
    def add(label,normal,candidate,h=.4,velocity=.005,**changes):
        request={'normal':normal,'h':h,'sub':16,'half':64.,'velocity':velocity,'tau_input':1.,
                 'candidate':candidate,'cutoff':True,'modes':3,'order':6,'bias':1,'tail_periods':4}
        request.update(changes);cases.append({'label':label,'request':request})
    for normal in [(1,0,0),(1,1,0),(1,1,1)]:
        for candidate in [False,True]:
            add('principal-smooth',normal,candidate,h=.8,velocity=.04,cutoff=False)
            add('principal-literal',normal,candidate,h=.8,velocity=.04)
    for normal in [(2,1,0),(2,1,1),(3,2,1)]:
        for h in [.8,.4]:
            for velocity in [.005,.01,.02,.04]:
                for candidate in [False,True]:add('physical',normal,candidate,h=h,velocity=velocity)
    for normal in [(2,1,0),(2,1,1),(3,2,1)]:
        for candidate in [False,True]:
            for label,change in [('domain',{'half':96.}),('eta',{'sub':32}),('modes',{'modes':2}),('tail-width',{'tail_periods':8})]:
                add(label,normal,candidate,**change)
            for tau_input in [.9,1.1]:add('signed-tau',normal,candidate,velocity=.01,tau_input=tau_input)
    assert len(cases)==96
    extra=[Path(__file__).resolve(),path.resolve()]
    def sources():return {**model.source_hashes(),**{p.relative_to(model.ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in extra}}
    result={'format':'solidify-oblique-coupled-study-v1','purpose':'controlled exact-spatial finite-speed branches; no adoption or Q3 acceptance',
      'registration':{'cases':cases,'heldOutNormal':[3,2,1],'primarySpeeds':[.005,.01,.02],'heldOutVelocity':.04,
        'linearQuadraticSensitivityRequired':True,'principalProfileToleranceQ':1e-7,'principalProfileToleranceU':1e-8,
        'principalBetaTolerance':2e-7,'coupledJacobianRelativeTolerance':1e-6,
        'candidateCoefficient':'1321/9870 from principal-plane analytic derivation only; never selected from oblique or needle data',
        'numericalControls':'reported separately; no post hoc physical coefficient or acceptance band'},
      'sourceHashes':sources(),'started':time.time(),'cases':[],'coupledJacobianControls':[],'completed':False}
    def save():(out/'study.json').write_text(json.dumps(result,indent=2))
    save()
    for normal in [(2,1,0),(2,1,1),(3,2,1)]:
        for candidate in [False,True]:
            row={'normal':normal,'candidate':candidate};result['coupledJacobianControls'].append(row)
            try:
                p=reference.build(normal=normal,h=.8,sub=8,half=32.,velocity=.04,candidate=candidate)
                y=p['initial'].copy();n=p['n'];x=p['x'];q=y[:n]
                direction=np.r_[.02*(1-q*q)*np.sin(.3*x),.01*np.exp(-x*x/10),.001]
                residual,J=p['evaluate'](y);step=1e-5
                finite=(p['evaluate'](y+step*direction,False)-p['evaluate'](y-step*direction,False))/(2*step)
                analytic=J@direction;error=float(np.linalg.norm(finite-analytic)/np.linalg.norm(analytic))
                row.update(relativeError=error,passed=error<1e-6)
                if not row['passed']:row['failure']='registered full coupled directional Jacobian check failed'
            except Exception as error:row.update(passed=False,error=repr(error),traceback=traceback.format_exc())
            save()
    if not all(row['passed'] for row in result['coupledJacobianControls']):
        result['failure']='coupled Jacobian prerequisite failed';save();raise SystemExit(result['failure'])
    for index,registration in enumerate(cases):
        label=f'case-{index:03d}';row=reference.write_case(out,registration['request'],label)
        row['label']=registration['label'];result['cases'].append(row)
        if row['converged'] and registration['label']=='principal-smooth':
            request=registration['request'];g=model.Geometry(request['normal'],request['h'],request['sub'])
            a=g.a_geometric
            effective=request['tau_input']*((47/75)*model.LAMBDA/model.D*(1-float(model.CORRECTION)*g.dx*g.dx/(a*a)) if request['candidate'] else 1.)
            try:
                old=reference.principal.build(h=g.dx,eta=g.eta,half=request['half'],velocity=request['velocity'],
                  tau_scale=effective,order=request['order'],bias=request['bias'],normal=''.join(map(str,g.normal)),modes=request['modes'])
                state,trace=reference.principal.solve(old);measurement=reference.principal.measure(old,state)
                with np.load(out/row['raw']) as raw:
                    q_error=float(np.max(np.abs(raw['q']-state[:old['n']])));u_error=float(np.max(np.abs(raw['u']-state[old['n']:2*old['n']])))
                beta_error=row['measurement']['modalBetaSolid']-measurement['modalBetaSolid']
                oldraw=out/f'{label}-unchanged-principal.npz'
                np.savez_compressed(oldraw,x=old['x'],q=state[:old['n']],u=state[old['n']:2*old['n']],uInfinity=state[-1])
                row['principalParity']={'qMaxDifference':q_error,'uMaxDifference':u_error,'betaSolidDifference':beta_error,
                  'passed':q_error<1e-7 and u_error<1e-8 and abs(beta_error)<2e-7,'oldTrace':trace,
                  'oldRaw':oldraw.name,'oldRawSha256':hashlib.sha256(oldraw.read_bytes()).hexdigest()}
            except Exception as error:row['principalParity']={'passed':False,'error':repr(error),'traceback':traceback.format_exc()}
        if row['converged'] and registration['label']=='physical' and registration['request']['h']==.8 and registration['request']['velocity']==.04:
            with np.load(out/row['raw']) as raw:
                x=raw['x'];q=raw['q'];u=raw['u']
            target={'format':'solidify-oblique-coupled-target-v1','purpose':'independent literal full-operator finite-speed branch',
              'sourceHashes':row['sourceHashes'],'config':row['config'],'measurement':row['measurement'],
              'x':x.tolist(),'q':q.tolist(),'u':u.tolist(),'qDerivative':CubicSpline(x,q).derivative()(x).tolist(),
              'uDerivative':CubicSpline(x,u).derivative()(x).tolist(),
              'rawFloat64Sha256':hashlib.sha256(b''.join(array.astype('<f8').tobytes() for array in [x,q,u])).hexdigest(),
              'limitations':'imposed finite V; no temporal stability, literal zero-speed beta, all-angle correction or GPU equality claim'}
            targetpath=out/f'{label}-target.json';targetpath.write_text(json.dumps(target,separators=(',',':')))
            row.update(target=targetpath.name,targetSha256=hashlib.sha256(targetpath.read_bytes()).hexdigest())
        save();m=row.get('measurement',{})
        print(json.dumps({'index':index,'label':row['label'],'request':row['request'],'ok':row['converged'],
          'seconds':row['seconds'],'betaSolid':m.get('modalBetaSolid'),'betaLiquid':m.get('modalBetaLiquid'),
          'latentJump':m.get('modalLatentJump'),'error':row.get('error'),'principalParity':row.get('principalParity')}),flush=True)
    result['finalSourceHashes']=sources();result['sourceStable']=result['sourceHashes']==result['finalSourceHashes']
    result['completed']=result['sourceStable'] and all(row['converged'] and row.get('principalParity',{'passed':True})['passed'] for row in result['cases'])
    result['finished']=time.time();save()
    print('OBLIQUE-CPU-STUDY',len(result['cases']),sum(row['converged'] for row in result['cases']),result['completed'],flush=True)
    if not result['completed']:raise SystemExit(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True,type=Path)
    run(parser.parse_args().out)
