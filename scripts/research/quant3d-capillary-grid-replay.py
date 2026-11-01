"""Prospectively frozen CPU known-truth and twelve-terminal capillary replay.

No GPU/browser, coefficient fitting, new window, or evolved-profile selection.
The audited estimator snapshot below is self-contained and fingerprint-checked.
"""
import argparse
import ast
import gzip
import hashlib
import json
import math
import platform
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PHYSICAL_TARGET = 33923.7386779148
GRID = [(.8, 96), (.6, 128), (.4, 192)]
CORE_SHA256 = {'crossing': 'c14ff5136a674e3de38b5700a4df736ed5eea80038b918518724c88ec58a2694', 'fit_surface': '9631eb39ab96651d0638aa3b9adff77d7139c81f07cacf6903abef1359ec48a6', 'extrapolate': '9e8cc694facf8f5e8125a50e784203bb15161d27d7bcd575fa1394cac7bb5fff', 'analyze': '5b7a2729a9c8297c7f2bd467f8c14bc2a86ef707cbf086108154157243e10eec'}

def crossing(values,kind='quintic'):
    nodes=np.array([-2,-1,0,1,2,3],float)
    if kind=='cubic':nodes=nodes[1:5];values=values[:,1:5]
    ordinates=values-.5 if kind=='raw' else np.arctanh(1-2*values)
    coefficients=np.linalg.solve(np.vander(nodes,len(nodes),increasing=True),ordinates.T)
    lo=np.zeros(len(values));hi=np.ones(len(values))
    for _ in range(48):
        t=(lo+hi)/2;f=np.sum(coefficients*t[None,:]**np.arange(len(nodes))[:,None],axis=0)
        before=f>=0 if kind=='raw' else f<=0
        lo=np.where(before,t,lo);hi=np.where(before,hi,t)
    return (lo+hi)/2

def fit_surface(u,v,w,radius,degree):
    pick=u*u+v*v<=radius*radius;u=u[pick]/radius;v=v[pick]/radius;w=w[pick]
    powers=[(j,d-j) for d in range(0,degree+1,2) for j in range(0,d+1,2)]
    if len(w)<len(powers)+6:return None
    X=np.array([u**a*v**b for a,b in powers]).T
    coefs,_,rank,singular=np.linalg.lstsq(X,w-w.max(),rcond=None)
    # A sufficient point count does not imply independent tangent locations:
    # on a coarse Cartesian grid small high-order patches can be rank deficient.
    if rank!=len(powers):return None
    a=coefs[powers.index((2,0))]/radius**2;b=coefs[powers.index((0,2))]/radius**2
    if a>=0 or b>=0:return None
    return {'radius':radius,'degree':degree,'points':len(w),'rho':-1/(a+b),
            'rho1':-.5/a,'rho2':-.5/b,'support':w.max()+coefs[0],
            'b1':a,'b2':b,'rms':float(np.sqrt(np.mean((X@coefs+w.max()-w)**2))),
            'condition':float(np.linalg.cond(X))}

def extrapolate(rows,degree,reference_radius):
    selected=[row for row in rows if .12*reference_radius-1e-12<=row['radius']<=.28*reference_radius+1e-12]
    if len(selected)<3:return None
    x=np.array([row['radius']**degree for row in selected])
    a=np.polynomial.polynomial.polyfit(x,[row['b1'] for row in selected],1)[0]
    b=np.polynomial.polynomial.polyfit(x,[row['b2'] for row in selected],1)[0]
    return {'rho':float(-1/(a+b)),'windows':[row['radius'] for row in selected],
            'maxCondition':max(row['condition'] for row in selected)}

def analyze(raw,case):
    p=raw['points'];config=case['config'];n,dx,R=config['n'],config['dx'],config['radius']
    cells=np.array([q['cell'] for q in p]);axes=np.array([q['axis'] for q in p])
    values=np.array([q['brackets'] for q in p]);start=(cells+.5-n/2)*dx
    measured=case['measurement'];prediction=8*measured['h110']-7*measured['h100']
    summaries={};details={}
    for kind in ['quintic','cubic','raw','quinticAllAxes']:
        xyz=start.copy();xyz[np.arange(len(xyz)),axes]+=crossing(values,kind)*dx
        xyz -= np.asarray(raw['appliedCenterOffset'], dtype=float)
        faces=[]
        for axis in range(3):
            for sign in [-1,1]:
                pick=sign*xyz[:,axis]>0
                if kind!='quinticAllAxes':pick&=axes==axis
                uv=[i for i in range(3) if i!=axis]
                u,v,w=xyz[pick,uv[0]],xyz[pick,uv[1]],sign*xyz[pick,axis]
                fits=[];extrap=[]
                for degree in [4,6,8]:
                    rows=[fit_surface(u,v,w,R*f,degree) for f in [.10,.12,.16,.20,.24,.28,.32]]
                    rows=[r for r in rows if r is not None];fits.extend(rows)
                    result=extrapolate(rows,degree,R)
                    if result:extrap.append({'degree':degree,**result})
                faces.append({'axis':axis,'sign':sign,'fits':fits,'extrapolations':extrap})
        details[kind]=faces
        for degree in [4,6,8]:
            results=[r for f in faces for r in f['extrapolations'] if r['degree']==degree]
            if len(results)!=6:continue
            radii=np.array([r['rho'] for r in results])
            radius=float(np.mean(radii));epsilon=config['epsilon'];d0=.8839/config['lambda']
            cap=(1-measured['temperature'])*radius/2
            summaries[kind+str(degree)]={'radius':radius,'sixFaceSpan':float(np.ptp(radii)),
                'relativeToSupportHarmonic':radius/prediction-1,
                'capillary100':cap,'nominalCapillary100':d0*(1-15*epsilon),
                'relativeCapillary100Error':cap/(d0*(1-15*epsilon))-1,
                'maxCondition':max(r['maxCondition'] for r in results)}
    return {'config':config,'temperature':measured['temperature'],
            'epsilonEffective':measured['epsilon'],'epsilonError':measured['epsilonError'],
            'd0Effective':measured['d0Effective'],'supportHarmonicPredictedRadius100':prediction,
            'summaries':summaries,'details':details}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_estimator():
    text = Path(__file__).read_text(encoding='utf-8-sig')
    nodes = {node.name: node for node in ast.parse(text).body if isinstance(node, ast.FunctionDef)}
    for name in ['crossing', 'fit_surface', 'extrapolate']:
        assert sha(ast.get_source_segment(text, nodes[name]).encode()) == CORE_SHA256[name], name
    adapted = ast.get_source_segment(text, nodes['analyze'])
    insertion = "        xyz -= np.asarray(raw['appliedCenterOffset'], dtype=float)\n"
    assert adapted.count(insertion) == 1
    original = adapted.replace(insertion, '')
    assert sha(original.encode()) == CORE_SHA256['analyze']
    namespace = {'np': np, 'crossing': crossing, 'fit_surface': fit_surface, 'extrapolate': extrapolate}
    exec(compile(ast.parse(original), 'unchanged original analyze', 'exec'), namespace)
    return namespace['analyze']


def frame_audit(raw, offset):
    points = raw['points']
    cells = np.asarray([p['cell'] for p in points])
    axes = np.asarray([p['axis'] for p in points])
    roots = np.asarray([p['root'] for p in points])
    xyz = np.asarray([p['xyz'] for p in points])
    applied = np.asarray(raw['appliedCenterOffset'])
    assert raw['declaredCenterOffset'] == list(offset) and np.array_equal(applied, offset)
    assert cells.shape == (len(points), 3) and np.all(cells == np.rint(cells))
    assert np.all((cells >= 0) & (cells < raw['n']))
    assert np.all((axes >= 0) & (axes <= 2)) and np.all(axes == np.rint(axes))
    assert np.all(np.isfinite(xyz)) and np.all(np.isfinite(roots))
    brackets = np.asarray([p['brackets'] for p in points])
    assert brackets.shape == (len(points), 6) and np.all(np.isfinite(brackets))
    lab = (cells + .5 - raw['n'] / 2) * raw['dx']
    lab[np.arange(len(points)), axes] += roots * raw['dx']
    limit = 64 * np.finfo(float).eps * (np.max(np.abs(lab)) + raw['dx'] + 1)
    once = float(np.max(np.abs(lab - applied - xyz)))
    missing = float(np.max(np.abs(lab - xyz)))
    doubled = float(np.max(np.abs(lab - 2 * applied - xyz)))
    assert once <= limit
    if np.any(applied):
        assert missing > limit and doubled > limit
    root_difference = float(np.max(np.abs(crossing(brackets, 'quintic') - roots)) * raw['dx'])
    # Descriptive only: tangential double roots have zero derivative and can
    # amplify polynomial roundoff beyond a universal bisection-width bound.
    endpoints = np.asarray([p.get('endpointRoot') is not None for p in points])
    return {'maximumOnceOnlyResidual': once, 'float64ArithmeticBound': float(limit),
            'missingOffsetResidual': missing, 'doubleOffsetResidual': doubled,
            'missingAndDoubleOffsetRefused': bool(not np.any(applied) or min(missing, doubled) > limit),
            'independentVersusRecordedRootMaxW0': root_difference,
            'exactEndpointPoints': int(np.sum(endpoints)),
            'rootDifferenceIsDescriptive': True}


def load_raw(base, metadata):
    path = (base / metadata['path']).resolve()
    assert path.is_relative_to(base.resolve()), 'raw path escaped the artifact directory'
    encoded = path.read_bytes()
    decoded = gzip.decompress(encoded)
    assert sha(encoded) == metadata['sha256'] and sha(decoded) == metadata['uncompressedSha256']
    raw = json.loads(decoded)
    assert len(raw['points']) == metadata['points']
    return raw, {'path': str(path), 'compressedSha256': sha(encoded),
                 'uncompressedSha256': sha(decoded), 'points': len(raw['points'])}, encoded


def source_identity(variants):
    result = {}
    for path, expected in variants.items():
        data = (ROOT / path).read_bytes()
        lf = data.replace(b'\r\n', b'\n')
        assert sha(lf) == expected['lf'], ('source/protocol changed after known-truth generation', path)
        assert sha(data) in expected.values(), ('unrecorded source-byte representation', path)
        result[path] = sha(data)
    return result


def name_for(dx, epsilon, offset):
    return f'dx-{dx:g}-epsilon-{epsilon:g}-offset-{offset:g}'


def known_truth(manifest_path, out, original_analyze):
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    assert manifest['format'] == 'solidify-capillary-grid-known-truth-v1'
    assert manifest['physicalVolumeTarget']['physicalVolume'] == PHYSICAL_TARGET
    assert len(manifest['cases']) == 6
    assert {(c['config']['dx'], c['config']['n'], c['config']['centerOffset'][0]) for c in manifest['cases']} == {
        (dx, n, offset) for dx, n in GRID for offset in [0, dx / 2]}
    working_sources = source_identity(manifest['sourceHashVariants'])
    results = []
    for case in manifest['cases']:
        raw, provenance, _ = load_raw(manifest_path.parent, case['raw'])
        c = case['config']
        assert raw['config'] == c and c['epsilon'] == 0 and c['radius'] == 20
        assert c['targetPhysicalVolume'] == PHYSICAL_TARGET
        assert abs(c['targetVolume'] * c['dx']**3 / PHYSICAL_TARGET - 1) <= 64 * np.finfo(float).eps
        adapter = frame_audit(raw, c['centerOffset'])
        result = analyze(raw, case)
        zero_identity = None
        if not any(c['centerOffset']):
            zero_identity = result == original_analyze(raw, case)
            assert zero_identity
        for degree in [6, 8]:
            assert abs(result['summaries']['quintic' + str(degree)]['radius'] / 20 - 1) < 1e-4
        results.append({'config': c, 'knownRadius100': 20, 'adapter': adapter,
                        'zeroOffsetOriginalAnalysisIdentity': zero_identity, 'provenance': provenance, 'result': result})
    output = {'scope': 'CPU known-truth sphere fixtures; evolved grid results not opened',
              'estimatorFingerprints': CORE_SHA256, 'workingSourceHashes': working_sources,
              'knownTruthManifestSha256': sha(manifest_bytes), 'cases': results}
    (out / 'known-truth-stiffness-audit.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
    return manifest, output


def clock_matches(clock, expected, plan):
    return clock['steps'] == expected['steps'] and clock['simTime'] == expected['time'] \
        and clock['dt'] == plan['dt'] and clock['uniformDt'] == plan['uniformDt'] \
        and clock['declaredTime'] == expected['steps'] * plan['dt'] \
        and clock['uniformTime'] == expected['steps'] * plan['uniformDt']


def terminal_replay(path, out, manifest, known):
    run_bytes = path.read_bytes()
    run = json.loads(run_bytes)
    assert run['format'] == 'solidify-equilibrium-capillary-grid-diagnostic-v1'
    assert run['studyMode'] == 'grid-refinement' and len(run['cases']) == 12
    assert run['completed'] and run['executionCompleted'] and run['deviceErrorLedgerRead'] and run['sourceStable']
    assert not run['errors'] and not run.get('exception')
    assert run['accepted'] is False and run['fullMatrixCompleted'] is False and run['q3Accepted'] is False
    assert run['physicalVolumeTarget']['physicalVolume'] == PHYSICAL_TARGET
    assert set(run['sourceHashes']) == set(manifest['sourceHashVariants'])
    for source, checksum in run['sourceHashes'].items():
        assert checksum in manifest['sourceHashVariants'][source].values(), ('GPU source not prospectively frozen', source)
    assert run['sourceHashes'] == run['finalHashes']
    expected_names = {name_for(dx, e, off) for dx, n in GRID for e in [0, .0171] for off in [0, dx / 2]}
    assert {c['config']['name'] for c in run['cases']} == expected_names
    results = []
    (out / 'terminal-raw').mkdir(exist_ok=True)
    for case in run['cases']:
        c = case['config']
        assert c['name'] == name_for(c['dx'], c['epsilon'], c['centerOffset'][0])
        assert (c['dx'], c['n']) in GRID and c['radius'] == 20 and c['lambda'] == 4
        assert c['centerOffset'] in [[0, 0, 0], [c['dx'] / 2] * 3]
        assert c['targetPhysicalVolume'] == PHYSICAL_TARGET
        assert abs(c['targetVolume'] * c['dx']**3 / PHYSICAL_TARGET - 1) <= 64 * np.finfo(float).eps
        assert case['setup']['targetVolume'] == c['targetVolume']
        assert case['completed'] and case['initialLiveness']['passed'] and case['fieldEvolved']
        plan = manifest['clockPlans'][c['name']]
        assert case['clockPlan'] == plan
        assert len(case['measurements']) == len(plan['samples']) == 51
        assert len(case['controls']) == len(plan['controls'])
        for observed, expected in zip(case['controls'], plan['controls']):
            assert clock_matches(observed['clock'], expected, plan)
            assert observed['executedSteps'] == expected['count'] and observed['time'] == expected['time']
            assert observed['quantitativeStatus']['flags'] == 0 and not observed['quantitativeStatus']['issue']
        for observed, expected in zip(case['measurements'], plan['samples']):
            assert clock_matches(observed['clock'], expected, plan) and observed['time'] == expected['time']
        if any(c['centerOffset']):
            assert case['missingRecenteringControl']['passed']
            assert case['measurements'][0]['gridPairKey'] == f"dx={c['dx']},n={c['n']},epsilon={c['epsilon']:g}"
        measurement = case['measurements'][-1]
        raw, provenance, encoded = load_raw(path.parent, measurement['raw'])
        assert raw['config'] == c and raw['clock'] == measurement['clock']
        assert raw['time'] == measurement['time'] and raw['temperature'] == measurement['temperature']
        adapter = frame_audit(raw, c['centerOffset'])
        (out / 'terminal-raw' / Path(measurement['raw']['path']).name).write_bytes(encoded)
        results.append({'config': c, 'terminalClock': measurement['clock'], 'equilibrium': case['equilibrium'],
            'centroidStable': case['centroidStable'], 'initialLiveness': case['initialLiveness'],
            'translationEvidence': measurement['translation'], 'endpointHandling': measurement.get('endpointHandling'),
            'adapter': adapter, 'provenance': provenance, 'result': analyze(raw, {'config': c, 'measurement': measurement})})
    pairs = []
    for dx, n in GRID:
        for epsilon in [0, .0171]:
            pair = [next(c for c in results if c['config']['dx'] == dx and c['config']['epsilon'] == epsilon
                         and c['config']['centerOffset'][0] == off) for off in [0, dx / 2]]
            pairs.append({'dx': dx, 'n': n, 'epsilon': epsilon,
                'quantities': {key: {'offset0': pair[0]['result']['summaries'][key],
                                    'offsetHalf': pair[1]['result']['summaries'][key],
                                    'relativeRadiusChange': pair[1]['result']['summaries'][key]['radius']
                                        / pair[0]['result']['summaries'][key]['radius'] - 1,
                                    'capillaryErrorDifference': pair[1]['result']['summaries'][key]['relativeCapillary100Error']
                                        - pair[0]['result']['summaries'][key]['relativeCapillary100Error']}
                               for key in pair[0]['result']['summaries']}})
    sequences = [{'epsilon': epsilon, 'offsetFractionDx': fraction,
                  'meshCases': [next(c for c in results if c['config']['dx'] == dx and c['config']['epsilon'] == epsilon
                                    and c['config']['centerOffset'][0] == dx * fraction)
                                for dx, n in GRID]} for epsilon in [0, .0171] for fraction in [0, .5]]
    output = {'scope': 'twelve fixed-policy terminal diagnostics; no fit/window/acceptance change or needle bound',
              'gpuSource': run['source'], 'sourceHashesDuringGPU': run['sourceHashes'],
              'gpuResultSha256': sha(run_bytes), 'diagnosticPassed': run['diagnosticPassed'],
              'physicalVolumeTarget': run['physicalVolumeTarget'], 'estimatorFingerprints': CORE_SHA256,
              'knownTruthAuditSha256': sha((out / 'known-truth-stiffness-audit.json').read_bytes()),
              'cases': results, 'pairedDifferences': pairs, 'meshSequences': sequences,
              'environment': {'python': platform.python_version(), 'numpy': np.__version__}}
    (out / 'terminal-stiffness-audit.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps({'completedCases': len(results), 'pairedDifferences': [
        {'dx': p['dx'], 'epsilon': p['epsilon'], 'quintic6': p['quantities']['quintic6']['capillaryErrorDifference'],
         'quintic8': p['quantities']['quintic8']['capillaryErrorDifference']} for p in pairs]}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--known-truth', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path('verify-out/q3-capillary-grid-replay'))
    parser.add_argument('--result', type=Path)
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    freeze_path = out / 'replay-freeze.json'
    manifest_path = args.known_truth.resolve()
    if args.result:
        freeze = json.loads(freeze_path.read_text(encoding='utf-8'))
        assert freeze['knownTruthPassed'] and freeze['evolvedResultOpened'] is False
        assert freeze['knownTruthManifestSha256'] == sha(manifest_path.read_bytes())
        assert sha(Path(__file__).read_bytes()) in freeze['sourceHashVariants'][Path(__file__).resolve().relative_to(ROOT).as_posix()].values()
    original_analyze = checked_estimator()
    manifest, known = known_truth(manifest_path, out, original_analyze)
    if args.result:
        assert freeze['sourceHashVariants'] == manifest['sourceHashVariants']
        terminal_replay(args.result.resolve(), out, manifest, known)
    else:
        freeze = {'format': 'solidify-capillary-grid-replay-freeze-v1', 'status': 'FROZEN before new evolved grid output',
                  'created': datetime.now(timezone.utc).isoformat(), 'knownTruthPassed': True, 'evolvedResultOpened': False,
                  'physicalVolumeTarget': PHYSICAL_TARGET, 'sourceHashVariants': manifest['sourceHashVariants'],
                  'knownTruthManifestSha256': sha(manifest_path.read_bytes()),
                  'knownTruthAuditSha256': sha((out / 'known-truth-stiffness-audit.json').read_bytes()),
                  'estimatorFingerprints': CORE_SHA256}
        freeze_path.write_text(json.dumps(freeze, indent=2), encoding='utf-8')
        print(json.dumps({'status': freeze['status'], 'cases': len(known['cases']),
            'physicalVolumeTarget': PHYSICAL_TARGET, 'knownTruth': [{'dx': c['config']['dx'],
                'offset': c['config']['centerOffset'][0], 'adapter': c['adapter'],
                'quintic6Radius': c['result']['summaries']['quintic6']['radius'],
                'quintic8Radius': c['result']['summaries']['quintic8']['radius']} for c in known['cases']]}), flush=True)


if __name__ == '__main__':
    main()
