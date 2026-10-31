"""Read-only integrity, uncertainty and pre-output analytic-prediction audit."""
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np


def run(directory):
    path=directory/'study.json';study=json.loads(path.read_text());rows=study['cases']
    if len(rows)!=len(study['registration']['cases']):raise ValueError('study has not finished all registered requests')
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    raw_count=0;target_count=0;old_count=0;failed_count=0
    for row,registration in zip(rows,study['registration']['cases']):
        assert row['request']==registration['request'] and row['label']==registration['label']
        for field,checksum in [('raw','rawSha256'),('failedRaw','failedRawSha256')]:
            if field in row:
                assert sha(directory/row[field])==row[checksum];raw_count+=1
                if field=='failedRaw':failed_count+=1
        if 'target' in row:assert sha(directory/row['target'])==row['targetSha256'];target_count+=1
        old=row.get('principalParity',{})
        if 'oldRaw' in old:assert sha(directory/old['oldRaw'])==old['oldRawSha256'];old_count+=1
    report={'scope':'finite-range coupled CPU diagnostics; no calibration/adoption/stability/Q3 acceptance',
      'studySha256':sha(path),'summarySourceSha256':sha(Path(__file__)),
      'registered':len(rows),'converged':sum(row['converged'] for row in rows),
      'failed':[{'label':row['label'],'request':row['request'],'error':row.get('error'),'failedRaw':row.get('failedRaw'),
                 'lastNewton':(row.get('trace') or [None])[-1]} for row in rows if not row['converged']],
      'integrity':{'profileHashesVerified':raw_count,'failedStatesIncluded':failed_count,
                  'targetHashesVerified':target_count,'unchangedReferenceHashesVerified':old_count,
                  'studySourceStable':study.get('sourceStable'),'studyCompleted':study.get('completed')},
      'groups':[],'controls':[],'signedTau':[],'principal':[]}
    def matching(label,normal,candidate,h=.4,velocity=.005):
        return [row for row in rows if row['label']==label and row['request']['normal']==normal
          and row['request']['candidate']==candidate and row['request']['h']==h and row['request']['velocity']==velocity]
    for normal in [[2,1,0],[2,1,1],[3,2,1]]:
        unit=np.array(normal)/np.linalg.norm(normal);s4=float(np.sum(unit**4));s6=float(np.sum(unit**6))
        a=1+.0171*(4*s4-3);gamma=16*.0171*(s6-s4*s4)/(3*a);D=2.5068;lam=4;A1=5*np.sqrt(2)/8;r=(47/75)*lam/D
        prediction_slope=271*gamma/(525*np.sqrt(2)*a*D)
        for h in [.8,.4]:
            for candidate in [False,True]:
                # Select every registered velocity, without dropping failures.
                selected=sorted([row for row in rows if row['label']=='physical' and row['request']['normal']==normal
                  and row['request']['candidate']==candidate and row['request']['h']==h],key=lambda row:row['request']['velocity'])
                group={'normal':normal,'h':h,'candidate':candidate,'gamma':gamma,
                       'formalCandidateBetaOverH2Prediction':prediction_slope,'heldOutNormal':normal==[3,2,1]}
                if not all(row['converged'] for row in selected):group['failure']='registered group contains failed branch';report['groups'].append(group);continue
                velocity=np.array([row['request']['velocity'] for row in selected]);group['speeds']=velocity.tolist()
                formal=prediction_slope*h*h if candidate else A1*a/lam*(1-r)+h*h/a*(A1/lam*(1/20+gamma/5)
                      +(331/5040+151*gamma/420)/(np.sqrt(2)*D))
                group['formalLeadingBetaPrediction']=formal
                for side in ['Solid','Liquid']:
                    values=np.array([row['measurement']['modalBeta'+side] for row in selected])
                    primary=np.polynomial.polynomial.polyfit(velocity[:3],values[:3],2)
                    linear=np.polynomial.polynomial.polyfit(velocity[:3],values[:3],1)
                    secondary=np.polynomial.polynomial.polyfit(velocity[1:],values[1:],2)
                    cubic=np.polynomial.polynomial.polyfit(velocity,values,3)
                    group[side]={'values':values.tolist(),'primaryQuadraticIntercept':float(primary[0]),
                      'linearIntercept':float(linear[0]),'linearQuadraticSpread':float(abs(linear[0]-primary[0])),
                      'secondaryQuadraticIntercept':float(secondary[0]),'secondaryPrimarySpread':float(abs(secondary[0]-primary[0])),
                      'fourPointCubicIntercept':float(cubic[0]),'cubicPrimarySpread':float(abs(cubic[0]-primary[0])),
                      'heldoutV004Error':float(values[-1]-np.polynomial.polynomial.polyval(.04,primary)),
                      'primaryMinusFormal':float(primary[0]-formal),'primaryMinusFormalOverH4':float((primary[0]-formal)/h**4)}
                group['solidLiquidPrimaryDifference']=group['Liquid']['primaryQuadraticIntercept']-group['Solid']['primaryQuadraticIntercept']
                report['groups'].append(group)
        for candidate in [False,True]:
            baseline=matching('physical',normal,candidate)[0]
            for label in ['domain','eta','modes','tail-width']:
                alternate=matching(label,normal,candidate)[0]
                control={'normal':normal,'candidate':candidate,'label':label,'baselineConverged':baseline['converged'],'alternateConverged':alternate['converged']}
                if baseline['converged'] and alternate['converged']:
                    control['betaDifference']={side:alternate['measurement']['modalBeta'+side]-baseline['measurement']['modalBeta'+side] for side in ['Solid','Liquid']}
                else:control['failure']=alternate.get('error',baseline.get('error'))
                report['controls'].append(control)
            signed=sorted(matching('signed-tau',normal,candidate,velocity=.01),key=lambda row:row['request']['tau_input'])
            nominal=matching('physical',normal,candidate,velocity=.01)[0]
            values=[row['measurement']['modalBetaSolid'] if row['converged'] else None for row in signed]
            center=nominal['measurement']['modalBetaSolid'] if nominal['converged'] else None
            report['signedTau'].append({'normal':normal,'candidate':candidate,'tauInputs':[row['request']['tau_input'] for row in signed],
              'solidValues':values,'nominal':center,'responseSignsPassed':center is not None and all(value is not None for value in values) and values[0]<center<values[-1],
              'centeredDerivative':(values[-1]-values[0])/.2 if all(value is not None for value in values) else None})
    for normal in [[1,0,0],[1,1,0],[1,1,1]]:
        for candidate in [False,True]:
            smooth=matching('principal-smooth',normal,candidate,.8,.04)[0];literal=matching('principal-literal',normal,candidate,.8,.04)[0]
            record={'normal':normal,'candidate':candidate,'smoothParity':smooth.get('principalParity'),
                    'literalConverged':literal['converged'],'literalFailure':literal.get('error')}
            if literal['converged']:
                record['literalMinusSmoothBetaSolid']=literal['measurement']['modalBetaSolid']-smooth['measurement']['modalBetaSolid']
            report['principal'].append(record)
    converged=[row for row in rows if row['converged']]
    report['physicalBranchDiagnostics']={
      'minimumQ':min(row['measurement']['qRange'][0] for row in converged),
      'maximumQ':max(row['measurement']['qRange'][1] for row in converged),
      'maximumMonotonicityViolation':max(row['measurement']['phaseMonotonicityViolation'] for row in converged),
      'maximumLatentJumpError':max(abs(row['measurement']['modalLatentJump']-1) for row in converged),
      'maximumProjectedIdentityResidual':max(abs(row['measurement']['projectedBvpIdentity']['absoluteResidual']) for row in converged),
      'maximumRelativeCellPhaseVelocityOscillation':max(row['measurement']['cellPhase']['relativeVelocityOscillation'] for row in converged),
      'maximumInterfaceNormalDeviation':max(row['measurement']['interfaceNormalFdDeviation'] for row in converged)}
    report['largestConvergedControlDifferences']={label:{side:max(abs(row['betaDifference'][side]) for row in report['controls']
      if row['label']==label and 'betaDifference' in row) for side in ['Solid','Liquid']} for label in ['domain','eta','modes','tail-width']}
    (directory/'summary.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({key:report[key] for key in ['registered','converged','failed','integrity','physicalBranchDiagnostics','largestConvergedControlDifferences']},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--study',required=True,type=Path)
    run(parser.parse_args().study)
