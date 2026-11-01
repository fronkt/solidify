"""Read-only uncertainty/refinement audit of the separately sealed angular study."""
import argparse,hashlib,json
from pathlib import Path
import numpy as np


def run(directory):
    path=directory/'study.json';data=json.loads(path.read_text());seal=json.loads((directory/'prepare-seal.json').read_text())
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    fresh=data['freshCases'];reused=data['reusedBaselineCases'];rows=reused+fresh
    if len(fresh)!=87:raise ValueError('all registered requests must finish before final audit')
    count=0
    for row in rows:
        for raw,checksum in [('raw','rawSha256'),('failedRaw','failedRawSha256')]:
            if raw in row:assert sha(directory/row[raw])==row[checksum];count+=1
    for row in seal['baselineFailureRecords']:
        assert sha(directory/'original-failures'/row['failedRaw'])==row['failedRawSha256']
    report={'scope':'finite-range width1/identity angular candidate; no temporal stability/adoption/Q3 acceptance',
      'studySha256':sha(path),'sealSha256':seal['sealSha256'],'summarySourceSha256':sha(Path(__file__)),
      'freshRegistered':87,'freshConverged':sum(row['converged'] for row in fresh),'reused':len(reused),
      'profileHashesVerified':count,'original96Outcome':{'converged':seal['baselineConverged'],
        'registered':seal['baselineRegistered'],'completed':seal['baselineOriginalCompleted'],'failurePreserved':True},
      'cpuSourceStable':data.get('cpuSourceStable'),'inputsStable':data.get('inputsStable'),
      'newStudyCompleted':data['completed'],'prerequisitesPassed':data['controls']['passed'],
      'failures':[{'label':row['label'],'request':row['request'],'error':row.get('error'),'trace':row.get('trace')} for row in fresh if not row['converged']],
      'groups':[],'controls':[],'signedTau':[],'angularRefinement':[]}
    def select(label,normal,tau_model,h,velocity):
        return [row for row in rows if row['label']==label and row['request']['normal']==normal
          and row['request']['tau_model']==tau_model and row['request']['h']==h and row['request']['velocity']==velocity]
    for normal in [[2,1,0],[2,1,1],[3,2,1]]:
        for h in [.8,.4,.2]:
            for mode in ['default','principal','angular']:
                selected=sorted([row for row in rows if row['label']=='physical' and row['request']['normal']==normal
                  and row['request']['h']==h and row['request']['tau_model']==mode],key=lambda row:row['request']['velocity'])
                assert len(selected)==4
                group={'normal':normal,'h':h,'tauModel':mode,'heldOutNormal':normal==[3,2,1]}
                if not all(row['converged'] for row in selected):group['failed']=True;report['groups'].append(group);continue
                v=np.array([row['request']['velocity'] for row in selected]);group['speeds']=v.tolist()
                for side in ['Solid','Liquid']:
                    values=np.array([row['measurement']['modalBeta'+side] for row in selected])
                    primary=np.polynomial.polynomial.polyfit(v[:3],values[:3],2)
                    linear=np.polynomial.polynomial.polyfit(v[:3],values[:3],1)
                    secondary=np.polynomial.polynomial.polyfit(v[1:],values[1:],2)
                    cubic=np.polynomial.polynomial.polyfit(v,values,3)
                    group[side]={'values':values.tolist(),'primaryQuadraticIntercept':float(primary[0]),
                      'linearQuadraticSpread':float(abs(linear[0]-primary[0])),
                      'secondaryQuadraticIntercept':float(secondary[0]),'secondaryPrimarySpread':float(abs(secondary[0]-primary[0])),
                      'cubicIntercept':float(cubic[0]),'cubicPrimarySpread':float(abs(cubic[0]-primary[0])),
                      'heldoutV004Error':float(values[-1]-np.polynomial.polynomial.polyval(.04,primary)),
                      'primaryBetaOverH2':float(primary[0]/h**2),'primaryBetaOverH4':float(primary[0]/h**4)}
                group['solidLiquidPrimaryDifference']=group['Liquid']['primaryQuadraticIntercept']-group['Solid']['primaryQuadraticIntercept']
                report['groups'].append(group)
        for label in ['domain','eta','modes','tail-width']:
            baseline=select('physical',normal,'angular',.2,.005)[0];alternate=select(label,normal,'angular',.2,.005)[0]
            record={'normal':normal,'label':label,'bothConverged':baseline['converged'] and alternate['converged']}
            if record['bothConverged']:record['betaDifference']={side:alternate['measurement']['modalBeta'+side]-baseline['measurement']['modalBeta'+side] for side in ['Solid','Liquid']}
            report['controls'].append(record)
        for h in [.8,.4,.2]:
            baseline=select('physical',normal,'angular',h,.005)[0];alternate=select('cutoff-smooth',normal,'angular',h,.005)[0]
            record={'normal':normal,'h':h,'label':'cutoff-smooth','bothConverged':baseline['converged'] and alternate['converged']}
            if record['bothConverged']:record['betaDifference']={side:alternate['measurement']['modalBeta'+side]-baseline['measurement']['modalBeta'+side] for side in ['Solid','Liquid']}
            report['controls'].append(record)
        signed=sorted(select('signed-tau',normal,'angular',.4,.01),key=lambda row:row['request']['tau_input'])
        nominal=select('physical',normal,'angular',.4,.01)[0]
        values=[row['measurement']['modalBetaSolid'] if row['converged'] else None for row in signed]
        center=nominal['measurement']['modalBetaSolid'] if nominal['converged'] else None
        report['signedTau'].append({'normal':normal,'tauInputs':[row['request']['tau_input'] for row in signed],
          'betaSolid':values,'nominal':center,'responseSignsPassed':center is not None and all(value is not None for value in values) and values[0]<center<values[1],
          'scope':'whole-tau response only; t!=1 has nonzero continuum beta and residual angular h² coefficient'})
        groups=sorted([g for g in report['groups'] if g['normal']==normal and g['tauModel']=='angular'],key=lambda g:g['h'],reverse=True)
        if not any(g.get('failed') for g in groups):
            values=[g['Solid']['primaryQuadraticIntercept'] for g in groups]
            report['angularRefinement'].append({'normal':normal,'h':[g['h'] for g in groups],'solidIntercepts':values,
              'coarseMediumRatio':values[0]/values[1],'mediumFineRatio':values[1]/values[2],
              'orders':[float(np.log2(abs(values[i]/values[i+1]))) for i in range(2)],
              'target':'h² cancellation at t1,width1; compare O(h4) trend and fit uncertainties, not a retrospective pass band'})
    converged=[row for row in fresh if row['converged']]
    report['physicalDiagnostics']={'minQ':min(row['measurement']['qRange'][0] for row in converged),
      'maxQ':max(row['measurement']['qRange'][1] for row in converged),
      'maxMonotonicityViolation':max(row['measurement']['phaseMonotonicityViolation'] for row in converged),
      'maxLatentJumpError':max(abs(row['measurement']['modalLatentJump']-1) for row in converged),
      'maxProjectedResidual':max(abs(row['measurement']['projectedBvpIdentity']['absoluteResidual']) for row in converged),
      'minimumLocalTau':min(row['measurement']['localTauRange'][0] for row in converged)}
    (directory/'summary.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({key:report[key] for key in ['freshRegistered','freshConverged','reused','profileHashesVerified',
      'original96Outcome','cpuSourceStable','newStudyCompleted','failures','angularRefinement','physicalDiagnostics']},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--study',required=True,type=Path)
    run(parser.parse_args().study)
