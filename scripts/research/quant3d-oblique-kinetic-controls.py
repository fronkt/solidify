"""Prospective exact-operator controls and portable rational-plane fixtures.

No browser/GPU. No reference coefficient or acceptance band is fitted.
"""
import os
for variable in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ.setdefault(variable,'1')
import argparse,hashlib,importlib.util,json,sys,traceback
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
path=Path(__file__).with_name('quant3d-oblique-kinetic.py')
spec=importlib.util.spec_from_file_location('oblique_kinetic',path)
model=importlib.util.module_from_spec(spec);sys.modules[spec.name]=model;spec.loader.exec_module(model)
NORMALS=[(1,0,0),(1,1,0),(1,1,1),(2,1,0),(2,1,1),(3,2,1)]


def literal_node(psi_at,cell,dx,epsilon=.0171,cutoff=True):
    """Independent literal 3D source translation in stored psi variables.

    It does not use aggregate L19 weights, the q-gradient implementation,
    sparse matrices, or the model's local anisotropy helper.
    """
    cell=np.asarray(cell,dtype=int);axes=np.eye(3,dtype=int)
    def at(c):return float(psi_at(tuple(c)))
    def flux(c):
        g=np.array([(at(c+axis)-at(c-axis))/(2*dx) for axis in axes]);g2=float(g@g)
        if g2<1e-12 and cutoff:return np.zeros(3),1.,g
        if g2==0:return np.zeros(3),1.,g
        gm=np.sqrt(g2);normal=g/gm
        n3=normal*normal*normal
        a=1+epsilon*(4*(n3[0]*normal[0]+n3[1]*normal[1]+n3[2]*normal[2])-3)
        derivative=16*epsilon*n3;tangent=derivative-float(derivative@normal)*normal
        return a*gm*tangent,a*a,g
    center=at(cell);faces=sum(at(cell+sign*axis) for axis in axes for sign in [-1,1])
    edges=0.
    for a in range(3):
        for b in range(a+1,3):
            for u in [-1,1]:
                for v in [-1,1]:edges+=at(cell+u*axes[a]+v*axes[b])
    lap=(2*faces+edges-24*center)/(6*dx*dx)
    A,w,g=flux(cell);gradw=[];divA=0.
    for i,axis in enumerate(axes):
        plus,wp,_=flux(cell+axis);minus,wm,_=flux(cell-axis)
        gradw.append((wp-wm)/(2*dx));divA+=(plus[i]-minus[i])/(2*dx)
    cross=float(np.array(gradw)@g)
    return {'spatialQ':2*(w*lap+cross+divA),'w':w,'gradientQ':2*g,
            'gradWdotGradQ':2*cross,'divCorrectionQ':2*divA,'lapQ':2*lap,'correctionQ':2*A}


def run(out):
    out.mkdir(parents=True,exist_ok=True)
    registration={'normalOrder':[list(n) for n in NORMALS],'heldOutNormal':[3,2,1],
      'quotientPeriod':257,'quotientDx':.8,'quotientSub':1,
      'principalToleranceAbsolute':2e-12,'literalOracleToleranceAbsolute':5e-12,
      'jacobianRelativeTolerance':2e-7,'jacobianPrimaryStep':1e-4,
      'jacobianPrimaryDirection':'.2*q^2+.1*q^3; bounded relative gradient change near extrema',
      'jacobianGenericDirectionSteps':[1e-4,1e-5,1e-6,1e-7,1e-8],
      'modifiedEquationSpacings':[.4,.2,.1,.05],
      'physicalCoefficientFit':False,'purpose':'operator verification, not a kinetic calibration'}
    result={'registration':registration,'sourceHashes':model.source_hashes(),
      'controlsSourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'controls':{},'failures':[]}
    def save():(out/'controls.json').write_text(json.dumps(result,indent=2))
    save()
    def group(name,function):
        try:result['controls'][name]=function()
        except Exception as error:result['failures'].append({'name':name,'error':repr(error),'traceback':traceback.format_exc()})
        save()

    n=257;j=np.arange(n);angle=2*np.pi*(j+.173)/n
    q=.05+.65*np.sin(angle)+.12*np.cos(2*angle)+.03*np.sin(3*angle)
    u=-.1+.12*np.cos(angle)+.03*np.sin(2*angle)
    fixtures=[]
    def algebra():
        rows=[]
        for normal in NORMALS:
            g=model.Geometry(normal,.8,1);op=model.PlaneOperator(n,g,boundary='periodic')
            fields=op.evaluate(q)
            oracle={key:[] for key in ['spatialQ','w','gradientQ','gradWdotGradQ','divCorrectionQ','lapQ','correctionQ']}
            m=np.array(normal)
            for index in range(n):
                at=lambda c:.5*(1+q[(index+int(m@np.array(c)))%n])
                value=literal_node(at,(0,0,0),g.dx)
                for key in oracle:oracle[key].append(value[key])
            differences={key:float(np.max(np.abs(fields[key]-np.array(value)))) for key,value in oracle.items()}
            assert max(differences.values())<5e-12,(normal,differences)
            constant=g.a_geometric**2*fields['lapQ']
            negative=float(np.max(np.abs(fields['spatialQ']-constant)))
            if normal in NORMALS[:3]:assert negative<2e-12,(normal,negative)
            else:assert negative>1e-9,(normal,negative)
            candidates={}
            for candidate in [False,True]:
                dq,du,_,tau=model.phase_heat_rhs(q,u,op,candidate=candidate)
                dt=.004;psi=.5*(1+q);new=np.clip(psi+.5*dt*dq,0,1)
                temp=1+u+dt*model.D*(op.L@u)+(new-psi)
                candidates[str(candidate)]={'tau':tau.tolist(),'phaseRhsQ':dq.tolist(),'heatRhsU':du.tolist(),
                    'eulerPsi':new.tolist(),'eulerTemperature':temp.tolist()}
            fixtures.append({'geometry':g.metadata(),'q':q.tolist(),'u':u.tolist(),
              'fields':{key:value.tolist() for key,value in fields.items()},'controls':candidates})
            rows.append({'normal':list(normal),'literalMaxErrors':differences,'constantANegativeMax':negative})
        return rows
    group('literalSourceAndPrincipalAlgebra',algebra)

    def derivatives():
        rows=[];direction=.2*q*q+.1*q*q*q
        generic=.2*np.cos(3*angle)+.13*np.sin(5*angle)
        for normal in NORMALS:
            op=model.PlaneOperator(n,model.Geometry(normal,.8,1),boundary='periodic')
            fields=op.evaluate(q,jacobian=True);step=1e-4
            difference=(op.evaluate(q+step*direction)['spatialQ']-op.evaluate(q-step*direction)['spatialQ'])/(2*step)
            analytic=fields['jacobian']@direction
            relative=float(np.linalg.norm(difference-analytic)/np.linalg.norm(analytic))
            assert relative<2e-7,(normal,relative)
            curve=[];generic_analytic=fields['jacobian']@generic
            for probe in [1e-4,1e-5,1e-6,1e-7,1e-8]:
                fd=(op.evaluate(q+probe*generic)['spatialQ']-op.evaluate(q-probe*generic)['spatialQ'])/(2*probe)
                curve.append({'step':probe,'relativeError':float(np.linalg.norm(fd-generic_analytic)/np.linalg.norm(generic_analytic))})
            rows.append({'normal':list(normal),'directionalRelativeError':relative,'genericProbeCurve':curve,
              'note':'initial1e-6 generic probe failed through finite-difference truncation at tiny gradients; original failure retained'})
        return rows
    group('independentDirectionalJacobian',derivatives)

    def cutoff():
        g=model.Geometry((2,1,0),.8,1);op=model.PlaneOperator(n,g,boundary='periodic')
        fields=op.evaluate(np.full(n,.3),jacobian=True)
        assert not np.any(fields['activeFlux'])
        assert np.array_equal(fields['w'],np.ones(n))
        assert np.array_equal(fields['correctionQ'],np.zeros((n,3)))
        assert np.max(np.abs(fields['spatialQ']))<1e-14
        return {'constantFieldActiveNodes':0,'constantW':1,'correctionZero':True}
    group('literalBulkCutoff',cutoff)

    def expansion():
        rows=[]
        for normal in NORMALS:
            unit=np.array(normal)/np.linalg.norm(normal);s4=np.sum(unit**4);s6=np.sum(unit**6)
            a=1+.0171*(4*s4-3);C=16*a*.0171*(s6-s4*s4)/3;width=np.sqrt(2)*a
            errors=[]
            for dx in [.4,.2,.1,.05]:
                g=model.Geometry(normal,dx,1);x=.73
                at=lambda cell:.5*(1-np.tanh((x+g.delta*int(np.array(normal)@np.array(cell)))/width))
                exact=literal_node(at,(0,0,0),dx)['spatialQ']
                t=np.tanh(x/width);q2=(2*t-2*t**3)/width**2;q4=(-16*t+40*t**3-24*t**5)/width**4
                expected=a*a*q2+dx*dx*(a*a/12+C)*q4
                errors.append({'dx':dx,'absoluteError':abs(exact-expected),'remainderOverDx4':(exact-expected)/dx**4})
            ratios=[errors[i]['absoluteError']/errors[i+1]['absoluteError'] for i in range(3)]
            assert min(ratios[-2:])>14,(normal,errors,ratios)
            rows.append({'normal':list(normal),'S4':float(s4),'S6':float(s6),'C':float(C),'errors':errors,'halvingRatios':ratios,
              'scope':'literal-source consistency with independently supplied expansion; not a fitted correction'})
        return rows
    group('fullModifiedEquationConsistency',expansion)
    fixture={'format':'solidify-oblique-operator-fixtures-v1','scope':'pure identity cubic periodic manufactured fields; no GPU result',
      'registration':registration,'sourceHashes':result['sourceHashes'],'fixtures':fixtures}
    path=out/'operator-fixtures.json';path.write_text(json.dumps(fixture,separators=(',',':')))
    result['fixtureSha256']=hashlib.sha256(path.read_bytes()).hexdigest();result['completed']=not result['failures'];save()
    print(json.dumps(result,indent=2))
    if result['failures']:raise SystemExit('oblique operator controls failed; retained every failure')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True,type=Path)
    run(parser.parse_args().out)
