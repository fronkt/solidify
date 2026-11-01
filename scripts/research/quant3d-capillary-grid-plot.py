"""Prospectively specified capillary-grid figure; no estimator or coefficient fit.

Default preparation opens no evolved run/audit and renders nothing. --run is
admitted only by a sealed plan and a completed twelve-case run/frozen replay.
"""
import argparse
import copy
import csv
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import sys

ROOT = Path(__file__).resolve().parents[2]
GRIDS = [(.4, 192), (.6, 128), (.8, 96)]
POLICIES = ['quintic', 'cubic', 'raw', 'quinticAllAxes']
DEGREES = [4, 6, 8]
TARGET = 33923.7386779148
SOURCE = '10fb837912870ff0af60d69cf7868c186ae1fa0e'
REPLAY = ROOT / 'scripts/research/quant3d-capillary-grid-replay.py'
FREEZE = ROOT / 'verify-out/q3-capillary-grid-replay/replay-freeze.json'
KNOWN = ROOT / 'verify-out/q3-capillary-grid-known-truth/known-truth-manifest.json'
FREEZE_SHA = '63ba9f2a6aa4ae58ae176112fe793b2a5e59a12279d5b2f718a8d739252d0300'
KNOWN_SHA = '8457c3139bb576415a6a823a03c9df245b849cea60be82592215417e50e3835c'
CORE = {'crossing':'c14ff5136a674e3de38b5700a4df736ed5eea80038b918518724c88ec58a2694',
        'fit_surface':'9631eb39ab96651d0638aa3b9adff77d7139c81f07cacf6903abef1359ec48a6',
        'extrapolate':'9e8cc694facf8f5e8125a50e784203bb15161d27d7bcd575fa1394cac7bb5fff',
        'analyze':'5b7a2729a9c8297c7f2bd467f8c14bc2a86ef707cbf086108154157243e10eec'}
STEM = 'quant3d-capillary-grid-c100-2026-10-31'
SUMMARY_FIELDS = ['radius','sixFaceSpan','relativeToSupportHarmonic','capillary100',
                  'nominalCapillary100','relativeCapillary100Error','maxCondition']
CAPTION = (
    'Inferred C100 = (1 - T) rho100 / 2; signed percent error is '
    '100 [C100 / ((0.8839 / 4)(1 - 15 epsilon)) - 1]. '
    'Panels show raw epsilon 0 and 0.0171 at physical h/W0 = 0.4, 0.6, 0.8. '
    'Colors/line styles distinguish declared lattice phases 0 and h/2 on all axes; '
    'circle/square markers show the fixed primary quintic6/quintic8 estimates. '
    'Whiskers span all four registered crossing-policy variants at the SAME '
    'geometry degree: quintic, cubic, raw, quinticAllAxes. They are policy '
    'sensitivity spans, not confidence intervals or certified error bounds. '
    'Connecting segments only join registered samples; no power law or physical '
    'coefficient is fitted. Degree4 estimates are retained in the exact CSV as '
    'lower-order geometry controls and do not enter the primary markers or whiskers. '
    'Every case is retained. Red rings/labels flag S: stationarity, R: resolution, '
    'C: centroid discrepancy; M marks missing primary or incomplete four-policy '
    'sensitivity. Missing primary values are marked at the axes footer, not at '
    'a fabricated data value, and incomplete sensitivity spans are not drawn. '
    'Windows, crossing policies, six-face combination and extrapolation remain '
    'those of the frozen replay. No capillary calibration or Q3 acceptance follows.'
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    data = path.read_bytes()
    return json.loads(data), data


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':')).encode()


def environment():
    versions = {name:importlib.metadata.version(name) for name in ['matplotlib','numpy']}
    files = {}
    for name, relative in [('matplotlib','matplotlib/__init__.py'),('numpy','numpy/__init__.py'),
                           ('matplotlib','matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf')]:
        path = Path(importlib.metadata.distribution(name).locate_file(relative))
        files[relative] = sha(path.read_bytes())
    value = {'python':platform.python_version(),'implementation':platform.python_implementation(),
             'platform':platform.platform(),'versions':versions,'packageAndFontSha256':files,
             'backend':'Agg','font':'DejaVu Sans','pngDpi':300,'figureInches':[12.8,5.2]}
    return {**value,'sha256':sha(canonical(value))}


def expected():
    return {f'dx-{h:g}-epsilon-{epsilon:g}-offset-{offset:g}':
            {'dx':h,'n':n,'epsilon':epsilon,'centerOffset':[offset]*3}
            for h,n in GRIDS for epsilon in [0,.0171] for offset in [0,h/2]}


def clocks(clock, wanted, plan):
    return clock['steps']==wanted['steps'] and clock['simTime']==wanted['time'] \
        and clock['dt']==plan['dt'] and clock['uniformDt']==plan['uniformDt'] \
        and clock['declaredTime']==wanted['steps']*plan['dt'] \
        and clock['uniformTime']==wanted['steps']*plan['uniformDt']


def validate(run, audit, run_sha, known):
    assert run['format']=='solidify-equilibrium-capillary-grid-diagnostic-v1' and run['studyMode']=='grid-refinement'
    assert run['completed'] is True and run['executionCompleted'] is True
    assert run['sourceStable'] is True and run['deviceErrorLedgerRead'] is True
    assert run['errors']==[] and not run.get('exception') and not run.get('cpuOnly')
    assert run['metadata']['hardware']['isFallbackAdapter'] is False
    assert run['accepted'] is False and run['fullMatrixCompleted'] is False and run['q3Accepted'] is False
    assert run['source']==audit['gpuSource']==SOURCE and audit['gpuResultSha256']==run_sha
    assert run['sourceHashes']==run['finalHashes']==audit['sourceHashesDuringGPU']
    assert set(run['sourceHashes'])==set(known['sourceHashVariants'])
    for name,value in run['sourceHashes'].items():
        assert value in known['sourceHashVariants'][name].values()
    assert audit['estimatorFingerprints']==CORE and audit['diagnosticPassed']==run['diagnosticPassed']
    assert audit['physicalVolumeTarget']==run['physicalVolumeTarget']
    assert run['physicalVolumeTarget']['physicalVolume']==TARGET
    wanted = expected()
    assert len(run['cases'])==len(audit['cases'])==12
    rows = {row['config']['name']:row for row in run['cases']}
    derived = {row['config']['name']:row for row in audit['cases']}
    assert len(rows)==len(derived)==12 and set(rows)==set(derived)==set(wanted)
    for name,identity in wanted.items():
        row,record = rows[name],derived[name]
        c = row['config']
        assert record['config']==c and record['result']['config']==c
        assert all(c[key]==value for key,value in identity.items())
        assert c['radius']==20 and c['lambda']==4 and c['gridRefinement'] is True
        assert c['maximumTime']==1000 and c['measurementPeriod']==20 and c['controlPeriod']==4
        assert c['targetPhysicalVolume']==TARGET and row['setup']['targetVolume']==c['targetVolume']
        assert abs(c['targetVolume']*c['dx']**3/TARGET-1)<=64*sys.float_info.epsilon
        assert row['completed'] is True and row['fieldEvolved'] is True and row['initialLiveness']['passed'] is True
        assert record['initialLiveness']==row['initialLiveness'] and record['equilibrium']==row['equilibrium']
        assert type(row['equilibrium']['stationary']) is bool and type(row['equilibrium']['resolved']) is bool
        assert type(row['centroidStable']) is bool and record['centroidStable']==row['centroidStable']
        plan = known['clockPlans'][name]
        assert row['clockPlan']==plan and len(row['measurements'])==len(plan['samples'])==51
        assert len(row['controls'])==len(plan['controls'])
        for control,want in zip(row['controls'],plan['controls']):
            assert clocks(control['clock'],want,plan) and control['time']==want['time'] and control['executedSteps']==want['count']
            assert control['quantitativeStatus']['flags']==0 and not control['quantitativeStatus']['issue']
        for measurement,want in zip(row['measurements'],plan['samples']):
            assert clocks(measurement['clock'],want,plan) and measurement['time']==want['time']
            assert not measurement.get('measurementError')
        if any(c['centerOffset']):
            assert row['missingRecenteringControl']['passed'] is True
        terminal = row['measurements'][-1]
        assert record['terminalClock']==terminal['clock'] and record['translationEvidence']==terminal['translation']
        assert record['result']['temperature']==terminal['temperature']
        assert record['provenance']['compressedSha256']==terminal['raw']['sha256']
        assert record['provenance']['uncompressedSha256']==terminal['raw']['uncompressedSha256']
        assert record['adapter']['maximumOnceOnlyResidual']<=record['adapter']['float64ArithmeticBound']
        assert record['adapter']['missingAndDoubleOffsetRefused'] is True
    assert run['diagnosticPassed']==all(r['equilibrium']['stationary'] and r['equilibrium']['resolved'] and r['centroidStable'] for r in rows.values())
    return rows,derived


def extract(rows, derived, run_sha='', audit_sha=''):
    table,points = [],[]
    for name,identity in expected().items():
        row,record = rows[name],derived[name]
        c = row['config']
        flags = ''.join(code for code,value in [('S',row['equilibrium']['stationary']),('R',row['equilibrium']['resolved']),('C',row['centroidStable'])] if not value)
        summaries = record['result']['summaries']
        for degree in DEGREES:
            values = []
            for policy in POLICIES:
                summary = summaries.get(policy+str(degree))
                available = summary is not None
                if available:
                    assert all(type(summary[key]) in [int,float] and math.isfinite(summary[key]) for key in SUMMARY_FIELDS)
                    nominal=(.8839/4)*(1-15*c['epsilon'])
                    error=summary['capillary100']/nominal-1
                    bound=128*sys.float_info.epsilon*(1+abs(error))
                    assert abs(summary['nominalCapillary100']/nominal-1)<=bound
                    assert abs(summary['relativeCapillary100Error']-error)<=bound
                    assert abs(summary['capillary100']-(1-record['result']['temperature'])*summary['radius']/2)<=bound
                    values.append(100*summary['relativeCapillary100Error'])
                table.append({'case':name,'h_W0':c['dx'],'n':c['n'],'epsilon':c['epsilon'],
                    'offset_x_W0':c['centerOffset'][0],'offset_y_W0':c['centerOffset'][1],'offset_z_W0':c['centerOffset'][2],
                    'offset_fraction_h':0.5 if any(c['centerOffset']) else 0.,'geometry_degree':degree,
                    'crossing_policy':policy,'role':'degree4_control' if degree==4 else 'primary' if policy=='quintic' else 'crossing_sensitivity',
                    'available':available,'stationary':row['equilibrium']['stationary'],'resolved':row['equilibrium']['resolved'],
                    'centroid_stable':row['centroidStable'],'quality_flags':flags,'missing_summary':not available,
                    **{key:summary[key] if available else '' for key in SUMMARY_FIELDS},
                    'signed_C100_error_percent':100*summary['relativeCapillary100Error'] if available else '',
                    'terminal_steps':record['terminalClock']['steps'],'terminal_uniform_time':record['terminalClock']['uniformTime'],
                    'terminal_raw_sha256':record['provenance']['compressedSha256'],
                    'terminal_raw_uncompressed_sha256':record['provenance']['uncompressedSha256'],
                    'run_sha256':run_sha,'audit_sha256':audit_sha})
            if degree in [6,8]:
                primary=summaries.get('quintic'+str(degree))
                points.append({'case':name,'h':c['dx'],'epsilon':c['epsilon'],'phase':.5 if any(c['centerOffset']) else 0.,
                    'degree':degree,'value':100*primary['relativeCapillary100Error'] if primary else None,
                    'low':min(values) if len(values)==4 else None,'high':max(values) if len(values)==4 else None,
                    'sensitivityPoliciesPresent':len(values),'flags':flags+('M' if primary is None or len(values)!=4 else '')})
    assert len(table)==144 and len(points)==24
    return table,points


def controls(known):
    run={'format':'solidify-equilibrium-capillary-grid-diagnostic-v1','studyMode':'grid-refinement',
        'completed':True,'executionCompleted':True,'sourceStable':True,'deviceErrorLedgerRead':True,
        'errors':[],'accepted':False,'fullMatrixCompleted':False,'q3Accepted':False,'source':SOURCE,
        'metadata':{'hardware':{'isFallbackAdapter':False}},'physicalVolumeTarget':known['physicalVolumeTarget'],
        'sourceHashes':{k:v['raw'] for k,v in known['sourceHashVariants'].items()},'cases':[],'diagnosticPassed':True}
    run['finalHashes']=run['sourceHashes'].copy()
    audit={'gpuSource':SOURCE,'gpuResultSha256':'synthetic-run-sha','sourceHashesDuringGPU':run['sourceHashes'].copy(),
        'estimatorFingerprints':CORE,'physicalVolumeTarget':run['physicalVolumeTarget'],'diagnosticPassed':True,'cases':[]}
    for name,identity in expected().items():
        c={'name':name,**identity,'radius':20,'lambda':4,'gridRefinement':True,'maximumTime':1000,
           'measurementPeriod':20,'controlPeriod':4,'targetPhysicalVolume':TARGET,'targetVolume':TARGET/identity['dx']**3}
        plan=known['clockPlans'][name]
        def clock(e):return {'steps':e['steps'],'simTime':e['time'],'dt':plan['dt'],'uniformDt':plan['uniformDt'],
                            'declaredTime':e['steps']*plan['dt'],'uniformTime':e['steps']*plan['uniformDt']}
        measurements=[{'clock':clock(e),'time':e['time'],'temperature':.98,'translation':{'fixture':True},
                       'raw':{'sha256':'1'*64,'uncompressedSha256':'2'*64}} for e in plan['samples']]
        row={'config':c,'completed':True,'fieldEvolved':True,'setup':{'targetVolume':c['targetVolume']},
            'initialLiveness':{'passed':True},'equilibrium':{'stationary':True,'resolved':True},'centroidStable':True,
            'clockPlan':plan,'measurements':measurements,'missingRecenteringControl':{'passed':True},
            'controls':[{'clock':clock(e),'time':e['time'],'executedSteps':e['count'],
                         'quantitativeStatus':{'flags':0,'issue':None}} for e in plan['controls']]}
        summaries={}
        for degree in DEGREES:
            for index,policy in enumerate(POLICIES):
                percent=(-1 if not any(c['centerOffset']) else 1)*(degree/10+index/100+c['dx'])
                nominal=(.8839/4)*(1-15*c['epsilon']);cap=nominal*(1+percent/100)
                summaries[policy+str(degree)]={'radius':2*cap/(1-.98),'sixFaceSpan':0.,'relativeToSupportHarmonic':0.,
                    'capillary100':cap,'nominalCapillary100':nominal,'relativeCapillary100Error':percent/100,'maxCondition':100.}
        record={'config':c,'terminalClock':measurements[-1]['clock'],'initialLiveness':row['initialLiveness'],
                'equilibrium':row['equilibrium'],'centroidStable':True,'translationEvidence':measurements[-1]['translation'],
                'provenance':{'compressedSha256':'1'*64,'uncompressedSha256':'2'*64},
                'adapter':{'maximumOnceOnlyResidual':0.,'float64ArithmeticBound':1e-12,'missingAndDoubleOffsetRefused':True},
                'result':{'config':c,'temperature':.98,'summaries':summaries}}
        run['cases'].append(row);audit['cases'].append(record)
    rows,derived=validate(run,audit,'synthetic-run-sha',known)
    table,points=extract(rows,derived)
    assert len(table)==144 and sum(r['geometry_degree']==4 for r in table)==48
    assert len(points)==24 and all(p['sensitivityPoliciesPresent']==4 for p in points)
    assert {p['h'] for p in points}=={.4,.6,.8} and {p['phase'] for p in points}=={0.,.5}
    assert any(p['value']<0 for p in points) and any(p['value']>0 for p in points)
    for point in points:
        values=[r['signed_C100_error_percent'] for r in table if r['case']==point['case'] and r['geometry_degree']==point['degree']]
        assert len(values)==4 and point['low']==min(values) and point['high']==max(values)
    altered=copy.deepcopy(derived);first=next(iter(altered))
    altered[first]['equilibrium']={'stationary':False,'resolved':False};altered[first]['centroidStable']=False
    altered_rows=copy.deepcopy(rows);altered_rows[first]['equilibrium']={'stationary':False,'resolved':False};altered_rows[first]['centroidStable']=False
    table_flagged,points_flagged=extract(altered_rows,altered)
    assert len(table_flagged)==144 and all('SRC' in p['flags'] for p in points_flagged if p['case']==first)
    altered[first]['result']['summaries'].pop('cubic8');altered[first]['result']['summaries'].pop('quintic6')
    missing_table,missing_points=extract(altered_rows,altered)
    assert len(missing_table)==144 and len(missing_points)==24
    assert sum(not r['available'] for r in missing_table)==2
    assert all(p['low'] is None and p['high'] is None and 'M' in p['flags'] for p in missing_points if p['case']==first)
    mutations=[lambda r,a:r.update(completed=False),lambda r,a:r.update(executionCompleted=False),
        lambda r,a:r.update(sourceStable=False),lambda r,a:r.update(deviceErrorLedgerRead=False),
        lambda r,a:r.update(errors=['cleanup failure']),lambda r,a:r['cases'].pop(),
        lambda r,a:r['cases'].__setitem__(11,r['cases'][0]),lambda r,a:a.update(gpuResultSha256='wrong'),
        lambda r,a:r['finalHashes'].update({'src/sim3d.ts':'0'*64}),
        lambda r,a:r['cases'][0]['measurements'].pop(),lambda r,a:r['cases'][0]['controls'][0]['quantitativeStatus'].update(flags=32),
        lambda r,a:a['cases'][0]['adapter'].update(missingAndDoubleOffsetRefused=False)]
    for mutation in mutations:
        r,a=copy.deepcopy(run),copy.deepcopy(audit);mutation(r,a)
        try:validate(r,a,'synthetic-run-sha',known)
        except AssertionError:pass
        else:raise AssertionError('partial/stale/unlinked execution admitted')
    return {'syntheticRefusals':len(mutations),'all144RowsAnd48Degree4ControlsRetained':True,
            'signedWhiskersUseExactlyFourSameDegreePolicies':True,'qualityAndMissingCasesFlaggedWithoutFiltering':True,
            'evolvedInputsOpened':False,'figureOrCsvGenerated':False}


def prepare(args):
    assert not args.plan.exists(),'preserve the original plot plan; choose a new file for an explicit amendment'
    known,known_bytes=load(KNOWN);freeze,freeze_bytes=load(FREEZE)
    assert sha(known_bytes)==KNOWN_SHA and sha(freeze_bytes)==FREEZE_SHA
    assert freeze['knownTruthPassed'] is True and freeze['evolvedResultOpened'] is False
    assert freeze['estimatorFingerprints']==CORE and freeze['sourceHashVariants']==known['sourceHashVariants']
    value={'format':'solidify-prospective-capillary-grid-plot-v1','createdAt':datetime.now(timezone.utc).isoformat(),
        'status':'FROZEN before completed evolved replay opened','evolvedInputsOpened':False,'artifactsGenerated':False,
        'scriptSha256':sha(Path(__file__).read_bytes()),'replaySourceSha256':sha(REPLAY.read_bytes()),
        'replayFreezeSha256':FREEZE_SHA,'knownTruthManifestSha256':KNOWN_SHA,'estimatorFingerprints':CORE,
        'expectedSource':SOURCE,'intendedRun':str(args.result.resolve()),'intendedAudit':str(args.audit.resolve()),
        'outputDirectory':str(args.out.resolve()),'outputStem':STEM,'environment':environment(),
        'design':{'panelsEpsilon':[0,.0171],'physicalH':[.4,.6,.8],'phasesFractionH':[0,.5],
                  'primarySummaryKeys':['quintic6','quintic8'],'sensitivityPolicies':POLICIES,
                  'whisker':'min/max all four policies at the same degree; incomplete spans not drawn',
                  'csvDegrees':DEGREES,'csvExpectedRows':144,'zeroReference':True,'fitPowerLawOrPhysicalCoefficient':False,
                  'keepEveryCaseAndFlagDiscrepancies':True,'caption':CAPTION},'controls':controls(known)}
    value['planSha256']=sha(canonical(value))
    args.plan.parent.mkdir(parents=True,exist_ok=True)
    args.plan.write_text(json.dumps(value,indent=2),encoding='utf-8')
    print(json.dumps({'plan':str(args.plan),'planSha256':value['planSha256'],'evolvedInputsOpened':False,
                      'artifactsGenerated':False,'controls':value['controls']}))


def draw(points, out, source_sha):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    matplotlib.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.titlesize':12,
        'axes.labelsize':11,'axes.spines.top':False,'axes.spines.right':False,
        'svg.fonttype':'none','svg.hashsalt':source_sha,'savefig.facecolor':'white'})
    fig,axes=plt.subplots(1,2,figsize=(12.8,5.2),sharey=True,constrained_layout=True)
    colors={0.:'#0072B2',.5:'#D55E00'}
    finite=[abs(value) for p in points for value in [p['value'],p['low'],p['high']] if value is not None]
    limit=1.12*max(finite+[.5])
    for ax,epsilon in zip(axes,[0,.0171]):
        ax.set_title(r'$\epsilon = '+f'{epsilon:g}'+r'$')
        ax.set_xlabel(r'Physical grid spacing $h/W_0$');ax.set_xticks([.4,.6,.8]);ax.set_xlim(.37,.83)
        ax.set_ylim(-limit,limit);ax.axhline(0,color='#444444',linewidth=.8,zorder=0)
        ax.grid(axis='y',alpha=.2,linewidth=.6)
        for phase in [0.,.5]:
            for degree in [6,8]:
                selected=sorted([p for p in points if p['epsilon']==epsilon and p['phase']==phase and p['degree']==degree],key=lambda p:p['h'])
                color=colors[phase]
                ax.plot([p['h'] for p in selected],[p['value'] if p['value'] is not None else math.nan for p in selected],
                    color=color,linestyle='-' if phase==0 else '--',linewidth=1.25,
                    marker='o' if degree==6 else 's',markersize=5.5,markeredgewidth=1.1,
                    markerfacecolor=color if degree==6 else 'white',zorder=3)
                for p in selected:
                    if p['value'] is not None and p['low'] is not None:
                        ax.errorbar(p['h'],p['value'],yerr=[[p['value']-p['low']],[p['high']-p['value']]],
                            fmt='none',ecolor=color,elinewidth=1,alpha=.5,capsize=4 if degree==6 else 2.5,zorder=1)
                    if p['flags']:
                        if p['value'] is None:
                            y=.025+.05*phase+.035*(degree==8)
                            ax.plot(p['h'],y,marker='x',color='#B2182B',transform=ax.get_xaxis_transform(),clip_on=False)
                            ax.annotate('Q'+str(degree)+' missing',(p['h'],y),xycoords=ax.get_xaxis_transform(),
                                xytext=(3,4),textcoords='offset points',fontsize=7,color='#B2182B')
                        else:
                            ax.scatter([p['h']],[p['value']],s=110,facecolors='none',edgecolors='#B2182B',linewidths=.9,zorder=4)
                            ax.annotate(p['flags'],(p['h'],p['value']),xytext=(5,5),textcoords='offset points',fontsize=7,color='#B2182B')
    axes[0].set_ylabel(r'Signed inferred $C_{100}$ error (%)')
    legend=[Line2D([],[],color=colors[0.],linestyle='-',label='Phase 0'),
            Line2D([],[],color=colors[.5],linestyle='--',label='Phase h/2 (all axes)'),
            Line2D([],[],color='#333333',marker='o',linestyle='none',label='Primary quintic6'),
            Line2D([],[],color='#333333',marker='s',markerfacecolor='white',linestyle='none',label='Primary quintic8'),
            Line2D([],[],color='#B2182B',marker='o',markerfacecolor='none',linestyle='none',label='Flagged discrepancy')]
    fig.legend(handles=legend,loc='upper center',bbox_to_anchor=(.5,1.065),ncol=5,frameon=False,fontsize=9)
    fig.text(.5,-.035,'Whiskers: four-policy sensitivity spans, not confidence/error bounds. Degree4 controls: exact CSV.',
             ha='center',fontsize=9,color='#444444')
    fig.savefig(out/(STEM+'.png.tmp'),format='png',dpi=300,bbox_inches='tight',metadata={'Description':CAPTION})
    fig.savefig(out/(STEM+'.svg.tmp'),format='svg',bbox_inches='tight',metadata={
        'Title':'Capillary grid refinement: fixed C100 estimators','Description':CAPTION+' Plot source SHA256: '+source_sha,
        'Creator':'Solidify research / Matplotlib','Date':None})
    plt.close(fig)


def run_plot(args):
    plan,plan_bytes=load(args.plan)
    assert plan['format']=='solidify-prospective-capillary-grid-plot-v1'
    assert sha(canonical({k:v for k,v in plan.items() if k!='planSha256'}))==plan['planSha256']
    assert plan['evolvedInputsOpened'] is False and plan['artifactsGenerated'] is False
    assert sha(Path(__file__).read_bytes())==plan['scriptSha256']
    assert sha(REPLAY.read_bytes())==plan['replaySourceSha256']
    assert str(args.result.resolve())==plan['intendedRun'] and str(args.audit.resolve())==plan['intendedAudit']
    assert str(args.out.resolve())==plan['outputDirectory'] and environment()==plan['environment']
    known,known_bytes=load(KNOWN);freeze,freeze_bytes=load(FREEZE)
    assert sha(known_bytes)==KNOWN_SHA==plan['knownTruthManifestSha256']
    assert sha(freeze_bytes)==FREEZE_SHA==plan['replayFreezeSha256']
    assert freeze['estimatorFingerprints']==CORE and freeze['sourceHashVariants']==known['sourceHashVariants']
    inputs={'run':args.result,'audit':args.audit,'plotPlan':args.plan,'replaySource':REPLAY,
            'replayFreeze':FREEZE,'knownTruthManifest':KNOWN}
    run,run_bytes=load(args.result);audit,audit_bytes=load(args.audit)
    run_sha,audit_sha=sha(run_bytes),sha(audit_bytes)
    rows,derived=validate(run,audit,run_sha,known)
    known_audit=args.audit.parent/'known-truth-stiffness-audit.json'
    assert sha(known_audit.read_bytes())==audit['knownTruthAuditSha256']
    inputs['knownTruthReplayAudit']=known_audit
    capture_path=args.result.parent/'source-capture.json'
    capture,capture_bytes=load(capture_path)
    assert capture['format']=='solidify-capillary-exact-source-capture-v1' and capture['source']==SOURCE
    assert capture['allStartupHashesMatched'] is True and type(capture['capturedAtStartup']) is bool
    assert capture['runStarted']==run['started']
    assert len(capture['files'])==14 and {r['path'] for r in capture['files']}==set(run['sourceHashes'])
    inputs['sourceCaptureLedger']=capture_path
    for record in capture['files']:
        name=record['path'];path=args.result.parent/'exact-source'/name
        data=path.read_bytes()
        assert sha(data)==record['copySha256']==record['startupSha256']==run['sourceHashes'][name]
        assert len(data)==record['bytes'] and record['startupHashMatched'] is True
        inputs['exactSource:'+name]=path
    input_hashes={key:sha(path.read_bytes()) for key,path in inputs.items()}
    table,points=extract(rows,derived,run_sha,audit_sha)
    args.out.mkdir(parents=True,exist_ok=True)
    suffixes=['.png','.svg','.csv','.md','.json']
    assert all(not (args.out/(STEM+s)).exists() and not (args.out/(STEM+s+'.tmp')).exists() for s in suffixes), 'preserve existing plot outputs'
    with (args.out/(STEM+'.csv.tmp')).open('w',newline='',encoding='utf-8') as file:
        writer=csv.DictWriter(file,fieldnames=list(table[0]));writer.writeheader();writer.writerows(table)
    caption=CAPTION+'\n\nObserved case flags (all cases retained):\n\n'
    for name in expected():
        selected=[p for p in points if p['case']==name]
        caption+='- '+name+': '+(', '.join('Q'+str(p['degree'])+' '+(p['flags'] or 'none') for p in selected))+'.\n'
    (args.out/(STEM+'.md.tmp')).write_text(caption,encoding='utf-8')
    draw(points,args.out,plan['scriptSha256'])
    for key,path in inputs.items():
        assert sha(path.read_bytes())==input_hashes[key],('input changed while plotting',key)
    generated={s:{'sha256':sha((args.out/(STEM+s+'.tmp')).read_bytes()),
                  'bytes':(args.out/(STEM+s+'.tmp')).stat().st_size} for s in suffixes[:-1]}
    result={'format':'solidify-capillary-grid-plot-provenance-v1','createdAt':datetime.now(timezone.utc).isoformat(),
        'sourceCommitDuringGPU':SOURCE,'plotSourceSha256':plan['scriptSha256'],'planSha256':plan['planSha256'],
        'planFileSha256':sha(plan_bytes),'inputSha256':input_hashes,'environment':plan['environment'],
        'environmentSha256':plan['environment']['sha256'],'design':plan['design'],'outputs':generated,
        'casesRetained':12,'csvRows':144,'degree4ControlRows':48,'points':points,
        'diagnosticPassedAsOriginallyRecorded':run['diagnosticPassed'],
        'sourceCaptureProvenance':{'capturedAtStartup':capture['capturedAtStartup'],'capturedAt':capture['capturedAt'],
                                   'ledgerSha256':sha(capture_bytes),'originalEndSourceHashesMatched':True},
        'allInputsUnchanged':True,'powerLawOrPhysicalCoefficientFitted':False,'accepted':False,'q3Accepted':False}
    (args.out/(STEM+'.json.tmp')).write_text(json.dumps(result,indent=2),encoding='utf-8')
    for suffix in suffixes:
        (args.out/(STEM+suffix+'.tmp')).replace(args.out/(STEM+suffix))
    print(json.dumps({'outputs':str(args.out),'casesRetained':12,'csvRows':144,'degree4Controls':48,
                      'flaggedPrimaryPoints':sum(bool(p['flags']) for p in points),'accepted':False,'q3Accepted':False}))


def main():
    if not __debug__:
        raise RuntimeError('optimized Python disables evidence assertions; refusing operation')
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--prepare-only',action='store_true')
    mode.add_argument('--self-test',action='store_true')
    mode.add_argument('--run',action='store_true')
    parser.add_argument('--result',type=Path,default=ROOT/'verify-out/q3-capillary-grid-gpu/capillary-grid-result.json')
    parser.add_argument('--audit',type=Path,default=ROOT/'verify-out/q3-capillary-grid-replay/terminal-stiffness-audit.json')
    parser.add_argument('--plan',type=Path,default=ROOT/'verify-out/q3-capillary-grid-plot-plan.json')
    parser.add_argument('--out',type=Path,default=ROOT/'verify-out/q3-capillary-grid-plot')
    args=parser.parse_args()
    if args.run:
        run_plot(args)
    elif args.self_test:
        known,data=load(KNOWN);assert sha(data)==KNOWN_SHA
        print(json.dumps(controls(known)))
    else:
        prepare(args)


if __name__=='__main__':
    main()
