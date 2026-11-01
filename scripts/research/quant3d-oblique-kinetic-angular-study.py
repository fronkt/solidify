"""Prepare/seal first, then execute the separate angular CPU candidate study."""
import os
for name in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ.setdefault(name,'1')
import argparse,hashlib,importlib.util,json,shutil,sys,time,traceback
from datetime import datetime,timezone
from pathlib import Path

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]


def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);return module


angular=load('registered_angular_model','quant3d-oblique-kinetic-angular.py')
controls_module=load('registered_angular_controls','quant3d-oblique-kinetic-angular-controls.py')
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()


def requests():
    rows=[]
    def add(label,normal,tau_model='angular',h=.2,velocity=.005,**changes):
        request={'tau_model':tau_model,'normal':list(normal),'h':h,'sub':16,'half':64.,'velocity':velocity,
          'tau_input':1.,'cutoff':True,'modes':3,'order':6,'bias':1,'tail_periods':4}
        request.update(changes);rows.append({'label':label,'request':request})
    for normal in [(2,1,0),(2,1,1),(3,2,1)]:
        for h in [.8,.4,.2]:
            for velocity in [.005,.01,.02,.04]:add('physical',normal,h=h,velocity=velocity)
        for velocity in [.005,.01,.02,.04]:
            for tau_model in ['default','principal']:add('physical',normal,tau_model,velocity=velocity)
    for normal in [(2,1,0),(2,1,1),(3,2,1)]:
        for tau_input in [.9,1.1]:add('signed-tau',normal,h=.4,velocity=.01,tau_input=tau_input)
        for label,change in [('domain',{'half':96.}),('eta',{'sub':32}),('modes',{'modes':2}),('tail-width',{'tail_periods':8})]:
            add(label,normal,**change)
        for h in [.8,.4,.2]:add('cutoff-smooth',normal,h=h,cutoff=False)
    assert len(rows)==87
    return rows


CPU_PATHS=[
 'scripts/research/quant3d-oblique-kinetic.py','scripts/research/quant3d-oblique-kinetic-reference.py',
 'scripts/research/quant3d-kinetic-reference.py','scripts/research/quant3d-oblique-kinetic-angular.py',
 'scripts/research/quant3d-oblique-kinetic-angular-controls.py','scripts/research/quant3d-oblique-kinetic-angular-fixtures.py',
 'scripts/research/quant3d-oblique-kinetic-angular-study.py','scripts/research/quant3d-oblique-kinetic-angular-summary.py',
 'scripts/research/quant3d-oblique-kinetic-angular.md']


def cpu_hashes():return {path:sha(ROOT/path) for path in CPU_PATHS}


def prepare(out,baseline,fp32):
    out.mkdir(parents=True,exist_ok=True)
    if (out/'prepare-seal.json').exists():raise ValueError('prepared seal exists; preserve it and choose a new output directory')
    old=json.loads((baseline/'study.json').read_text());reused=[]
    for index,row in enumerate(old['cases']):
        if row['label']!='physical':continue
        assert row['converged'];assert sha(baseline/row['raw'])==row['rawSha256']
        reused.append({'oldIndex':index,'normal':row['request']['normal'],'h':row['request']['h'],
          'velocity':row['request']['velocity'],'tauModel':'principal' if row['request']['candidate'] else 'default',
          'raw':row['raw'],'rawSha256':row['rawSha256']})
    assert len(reused)==48
    seal={'format':'solidify-angular-kinetic-preoutput-seal-v1','prepared':datetime.now(timezone.utc).isoformat(),
      'status':'prepared before any new angular evaluation','cpuSourceHashes':cpu_hashes(),
      'baselineStudySha256':sha(baseline/'study.json'),'fp32InputSha256':sha(fp32),
      'baselineRegistered':len(old['cases']),'baselineConverged':sum(row['converged'] for row in old['cases']),
      'baselineOriginalCompleted':old['completed'],'baselineFailureRecords':[row for row in old['cases'] if not row['converged']],
      'reusedBaselineCases':reused,'freshCases':requests(),'freshCount':87,'combinedMainCount':108,
      'heldOutNormal':[3,2,1],'primarySpeeds':[.005,.01,.02],'heldOutVelocity':.04,
      'physicalWidthScope':1,'zeroBetaTauInputScope':1,'noPhysicalCoefficientFit':True,
      'baselineWgslSnapshotHashes':{path:value for path,value in old['sourceHashes'].items() if path.startswith('src/')}}
    for path,value in seal['cpuSourceHashes'].items():
        source=ROOT/path;destination=out/'exact-source'/path;destination.parent.mkdir(parents=True,exist_ok=True)
        data=source.read_bytes();assert hashlib.sha256(data).hexdigest()==value;destination.write_bytes(data)
    for path,value in seal['baselineWgslSnapshotHashes'].items():
        archived=baseline/'exact-source'/path;source=archived if archived.exists() else ROOT/path
        assert sha(source)==value;destination=out/'exact-source'/path;destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_bytes(source.read_bytes())
    for row in seal['baselineFailureRecords']:
        raw=baseline/row['failedRaw'];assert sha(raw)==row['failedRawSha256']
        destination=out/'original-failures'/row['failedRaw'];destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(raw,destination)
    seal['sealSha256']=hashlib.sha256(json.dumps(seal,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    (out/'prepare-seal.json').write_text(json.dumps(seal,indent=2))
    print('ANGULAR-PREPARED',json.dumps({'sealSha256':seal['sealSha256'],'fresh':87,'reused':48,
      'cpuSourceHashes':seal['cpuSourceHashes']},indent=2));return seal


def execute(out,baseline,fp32):
    seal=json.loads((out/'prepare-seal.json').read_text())
    payload={key:value for key,value in seal.items() if key!='sealSha256'}
    assert hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()==seal['sealSha256'],'prepared seal corrupted'
    assert cpu_hashes()==seal['cpuSourceHashes'],'prepared CPU/protocol source changed'
    assert sha(baseline/'study.json')==seal['baselineStudySha256'],'old baseline changed'
    assert sha(fp32)==seal['fp32InputSha256'],'prepared stored-FP32 input changed'
    assert requests()==seal['freshCases']
    if (out/'study.json').exists():raise ValueError('study result already exists; preserve every attempt and use a new prepared output directory')
    result={'format':'solidify-nodewise-angular-cpu-study-v1','sealSha256':seal['sealSha256'],
      'started':datetime.now(timezone.utc).isoformat(),'completed':False,'q3Accepted':False,'adopted':False,
      'cpuSourceHashes':seal['cpuSourceHashes'],'baselineWgslSnapshotHashes':seal['baselineWgslSnapshotHashes'],
      'baselineOriginalCompleted':seal['baselineOriginalCompleted'],'baselineFailurePreserved':True,
      'freshCases':[],'reusedBaselineCases':[],'controls':None,
      'scope':'identity-cubic width1; imposed finite V; h² cancellation test only, not temporal stability or Q3 acceptance'}
    save=lambda:(out/'study.json').write_text(json.dumps(result,indent=2));save()
    try:
        controls=controls_module.run_controls(baseline,fp32);result['controls']=controls
        (out/'prerequisite-controls.json').write_text(json.dumps(controls,indent=2));save()
        if not controls['passed']:raise RuntimeError('frozen prerequisite controls failed; no new profile attempted')
        print('ANGULAR-PREREQUISITES PASSED',flush=True)
        old=json.loads((baseline/'study.json').read_text())
        for index,item in enumerate(seal['reusedBaselineCases']):
            prior=old['cases'][item['oldIndex']];assert sha(baseline/item['raw'])==item['rawSha256']
            destination=out/f'reused-{index:03d}.npz';shutil.copyfile(baseline/item['raw'],destination)
            request={key:value for key,value in prior['request'].items() if key!='candidate'};request['tau_model']=item['tauModel']
            result['reusedBaselineCases'].append({'label':'physical','request':request,'converged':prior['converged'],
              'config':prior['config'],'measurement':prior['measurement'],'raw':destination.name,'rawSha256':item['rawSha256'],
              'provenance':{'oldIndex':item['oldIndex'],'oldStudySha256':seal['baselineStudySha256'],'oldSourceHashes':prior['sourceHashes']}})
        save()
        for index,item in enumerate(seal['freshCases']):
            row=angular.write_case(out,item['request'],f'case-{index:03d}',seal['cpuSourceHashes'],seal['baselineWgslSnapshotHashes'])
            row['label']=item['label'];result['freshCases'].append(row);save();m=row.get('measurement',{})
            print(json.dumps({'index':index,'label':item['label'],'request':item['request'],'ok':row['converged'],
              'seconds':row['seconds'],'betaSolid':m.get('modalBetaSolid'),'betaLiquid':m.get('modalBetaLiquid'),
              'error':row.get('error')}),flush=True)
    except Exception as error:
        result['exception']=repr(error);result['traceback']=traceback.format_exc()
    result['finalCpuSourceHashes']=cpu_hashes();result['cpuSourceStable']=result['finalCpuSourceHashes']==seal['cpuSourceHashes']
    result['inputsStable']=sha(baseline/'study.json')==seal['baselineStudySha256'] and sha(fp32)==seal['fp32InputSha256']
    result['completed']=not result.get('exception') and result['cpuSourceStable'] and result['inputsStable']
    result['completed']&=len(result['freshCases'])==87 and len(result['reusedBaselineCases'])==48 and all(row['converged'] for row in result['freshCases'])
    result['finished']=datetime.now(timezone.utc).isoformat();save()
    print('ANGULAR-STUDY-DONE',len(result['freshCases']),sum(row['converged'] for row in result['freshCases']),result['completed'],flush=True)
    if not result['completed']:raise SystemExit(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--baseline-study',required=True,type=Path);parser.add_argument('--fp32-inputs',required=True,type=Path)
    choice=parser.add_mutually_exclusive_group(required=True);choice.add_argument('--prepare-only',action='store_true');choice.add_argument('--run',action='store_true')
    args=parser.parse_args();out=args.out.resolve();baseline=args.baseline_study.resolve();fp32=args.fp32_inputs.resolve()
    if args.prepare_only:prepare(out,baseline,fp32)
    else:execute(out,baseline,fp32)
