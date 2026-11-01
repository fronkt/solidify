"""Export already solved angular profiles, separately from the sealed study.

No solve, coefficient selection, GPU or reference-acceptance decision is made.
"""
import argparse,hashlib,importlib.util,json,sys
from pathlib import Path
import numpy as np
from scipy.interpolate import CubicSpline

path=Path(__file__).with_name('quant3d-oblique-kinetic-angular.py')
spec=importlib.util.spec_from_file_location('angular_front_export_model',path)
angular=importlib.util.module_from_spec(spec);sys.modules[spec.name]=angular;spec.loader.exec_module(angular)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--study',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path);args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    study_path=args.study/'study.json';study=json.loads(study_path.read_text())
    assert study['completed'] and study['cpuSourceStable'] and study['inputsStable']
    manifest={'format':'solidify-angular-front-manifest-v1','studySha256':hashlib.sha256(study_path.read_bytes()).hexdigest(),
      'exportSourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'fronts':[]}
    for normal in [[2,1,0],[2,1,1],[3,2,1]]:
        row=next(row for row in study['freshCases'] if row['label']=='physical' and row['request']['tau_model']=='angular'
          and row['request']['normal']==normal and row['request']['h']==.8 and row['request']['velocity']==.04)
        rawpath=args.study/row['raw'];assert hashlib.sha256(rawpath.read_bytes()).hexdigest()==row['rawSha256']
        with np.load(rawpath) as data:x=data['x'];q=data['q'];u=data['u'];uinf=float(data['uInfinity'])
        g=angular.model.Geometry(normal,.8,row['request']['sub']);op=angular.model.PlaneOperator(len(x),g,cutoff=True)
        fields=op.evaluate(q);tau=angular.angular_tau(fields,op)
        target={'format':'solidify-oblique-angular-coupled-target-v1','purpose':'already solved finite-speed branch; not a stability or zero-beta proof',
          'cpuSourceHashes':study['cpuSourceHashes'],'config':row['config'],'measurement':row['measurement'],
          'x':x.tolist(),'q':q.tolist(),'u':u.tolist(),'uInfinityUnknown':uinf,
          'qDerivative':CubicSpline(x,q).derivative()(x).tolist(),'uDerivative':CubicSpline(x,u).derivative()(x).tolist(),
          'diagnosticsOnly':{'w':fields['w'].tolist(),'gammaFD':tau['gamma']['gammaFD'].tolist(),'tauAngular':tau['tau'].tolist()},
          'rawFloat64Sha256':hashlib.sha256(b''.join(array.astype('<f8').tobytes() for array in [x,q,u])).hexdigest(),
          'profileEncoding':'Cubic Hermite values/derivatives; free thermal constants and outgoing roots retained in measurement',
          'limitations':'phase/T initialization only; recompute gamma/tau from evolved fields. Imposed V, no attraction/Float32/Euler/finite-wall acceptance.'}
        filename='front-'+''.join(map(str,normal))+'-h0.8-v0.04-angular.json';out=args.out/filename
        out.write_text(json.dumps(target,separators=(',',':')))
        manifest['fronts'].append({'normal':normal,'path':filename,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),
          'originalRawSha256':row['rawSha256'],'rawFloat64Sha256':target['rawFloat64Sha256']})
    (args.out/'front-manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))


if __name__=='__main__':main()
