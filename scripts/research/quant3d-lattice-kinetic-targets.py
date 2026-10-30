"""Reproduce analytic-only planar targets or the preregistered 99-case CPU matrix.

Requires NumPy/SciPy. No production edits, GPU, needle data or fitted coefficients.
Output is explicit and should be an ignored artifact directory.
"""
import os
for variable in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS']:
    os.environ.setdefault(variable, '1')
import argparse
import hashlib
import importlib.util
import json
import math
import platform
import time
from pathlib import Path
import numpy as np
import scipy
from scipy.interpolate import CubicSpline

ROOT = Path(__file__).resolve().parents[2]
DIMENSION = {'100': 1, '110': 2, '111': 3}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--matrix', action='store_true', help='reproduce 99 cases instead of the production-spacing target set')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    source = ROOT / 'scripts/research/quant3d-kinetic-reference.py'
    spec = importlib.util.spec_from_file_location('unchanged_reference', source)
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)
    r = (47/75)*model.LAMBDA/model.D

    def factor(h, normal):
        a = 1 + model.EPSILON*(4/DIMENSION[normal]-3)
        value = r*(1-(1321/9870)*h*h/(a*a))
        if not math.isfinite(value) or value <= 0:
            raise ValueError('analytic relaxation must be positive')
        return value

    def case(label, normal, h, velocity, variant='analytic', sub=None, half=64, modes=3, order=6):
        return dict(label=label, normal=normal, h=h, velocity=velocity, variant=variant,
                    tau_scale=1 if variant=='uncorrected' else factor(h,normal),
                    sub=sub or (32 if h>=.4 else 16), half=half, modes=modes, order=order, bias=1)

    cases = []
    if args.matrix:
        for normal in DIMENSION:
            for h in [.1,.2,.4]:
                for velocity in [.0025,.005,.01,.02]:
                    for variant in ['uncorrected','analytic']:
                        cases.append(case('physical',normal,h,velocity,variant))
        for normal in DIMENSION:
            for h in [.1,.2,.4]:
                sub = 32 if h==.4 else 16
                for label,half,nsub,modes in [('domain',96,sub,3),('modes',64,sub,2),('eta',64,sub*2,3)]:
                    cases.append(case(label,normal,h,.0025,sub=nsub,half=half,modes=modes))
    else:
        for velocity in [.1,.125,.15]:
            for variant in ['uncorrected','analytic']:
                cases.append(case('physical','100',.8,velocity,variant,half=96))
        for label,half,sub,modes,order in [('domain',64,32,3,6),('modes',96,32,2,6),
                                        ('eta',96,64,3,6),('order',96,32,3,8)]:
            cases.append(case(label,'100',.8,.125,sub=sub,half=half,modes=modes,order=order))
        for velocity in [.0025,.005,.01,.02]:
            cases.append(case('coarseLowSpeed','100',.8,velocity,half=96))

    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    result = {
        'format':'solidify-lattice-kinetic-cpu-study-v1',
        'purpose':'analytic-only CPU waves; no production or needle acceptance',
        'formula':{'actualTau':'r*a^2-r*(1321/9870)*h_physical^2','r':r,'coefficient':1321/9870,
                   'DUsed':model.D,'lambdaUsed':model.LAMBDA,'epsilonUsed':model.EPSILON},
        'registration':{'matrix':args.matrix,'primarySpeeds':[.0025,.005,.01],
                        'heldOutVelocity':.02,'heldOutNormal':'111','noCoefficientFit':True},
        'registeredCases':cases,'cases':[],
        'environment':{'python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__},
        'sourceHashes':{p.relative_to(ROOT).as_posix():sha(p) for p in [Path(__file__).resolve(),source]},
    }
    manifest = {'format':'solidify-lattice-kinetic-target-manifest-v1','complete':False,
                'formula':result['formula'],'targets':{},'sourceHashes':result['sourceHashes']}

    def save():
        (args.out/'cpu-results.json').write_text(json.dumps(result,indent=2))
        (args.out/'target-manifest.json').write_text(json.dumps(manifest,indent=2))

    save()
    for index,request in enumerate(cases):
        row={'request':request};result['cases'].append(row);start=time.perf_counter()
        try:
            options={key:value for key,value in request.items() if key not in ['label','variant','sub']}
            options['eta']=request['h']/math.sqrt(DIMENSION[request['normal']])/request['sub']
            p=model.build(**options);state,trace=model.solve(p);measurement=model.measure(p,state)
            n=p['n'];x=p['x'];phi=state[:n];u=state[n:2*n]
            raw=args.out/f'profile-{index:03d}.npz'
            np.savez_compressed(raw,x=x,phi=phi,u=u,uInfinity=state[-1])
            row.update(converged=True,config=p['config'],trace=trace,measurement=measurement,
                       raw=raw.name,rawSha256=sha(raw))
            if not args.matrix and request['label']=='physical':
                target={
                    'format':'solidify-coupled-kinetic-target-v1','purpose':result['purpose'],
                    'reference':'https://doi.org/10.1103/PhysRevE.57.4323 Sec.VI.B.2',
                    'method':'exact finite physical shifts; refined traveling derivative; free far-liquid constant; outgoing complex heat modes',
                    'sourceHashes':result['sourceHashes'],'environment':result['environment'],
                    'config':p['config'],'measurement':measurement,'trace':trace,'formula':result['formula'],
                    'variant':request['variant'],'x':x.tolist(),'phi':phi.tolist(),'u':u.tolist(),
                    'phiDerivative':CubicSpline(x,phi).derivative()(x).tolist(),
                    'uDerivative':CubicSpline(x,u).derivative()(x).tolist(),
                    'rawFloat64Sha256':hashlib.sha256(b''.join(v.astype('<f8').tobytes() for v in [x,phi,u])).hexdigest(),
                    'limitations':'continuous-time principal plane; production Euler/Float32/cutoff and dynamic recovery require testing'}
                path=args.out/f"target-v{request['velocity']}-{request['variant']}.json"
                path.write_text(json.dumps(target,separators=(',',':')))
                row.update(target=path.name,targetSha256=sha(path))
                if request['variant']=='analytic':
                    manifest['targets'][str(request['velocity'])]={'path':path.name,'sha256':sha(path)}
        except Exception as error:
            row.update(converged=False,error=repr(error))
        row['seconds']=time.perf_counter()-start
        save()
        print(json.dumps({'index':index,'request':request,'converged':row['converged'],
                          'error':row.get('error'),'seconds':row['seconds']}),flush=True)
    manifest['complete']=not args.matrix and len(manifest['targets'])==3 and all(row['converged'] for row in result['cases'])
    save()
    if not all(row['converged'] for row in result['cases']):
        raise SystemExit('CPU study incomplete; inspect retained failures')
    print('LATTICE-KINETIC-CPU',len(cases),'converged; manifest',manifest['complete'],flush=True)


if __name__=='__main__':
    main()
