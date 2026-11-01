"""Separate registered smooth/literal oblique cutoff sensitivity; CPU only.

This extension does not overwrite or repair the original 95/96 study outcome.
"""
import argparse,hashlib,importlib.util,json,sys
from pathlib import Path

path=Path(__file__).with_name('quant3d-oblique-kinetic-reference.py')
spec=importlib.util.spec_from_file_location('oblique_cutoff_reference',path)
reference=importlib.util.module_from_spec(spec);sys.modules[spec.name]=reference;spec.loader.exec_module(reference)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--study',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path);args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    source=args.study/'study.json';study=json.loads(source.read_text())
    requests=[]
    for normal in [[2,1,0],[2,1,1],[3,2,1]]:
        for candidate in [False,True]:
            baseline=next(row for row in study['cases'] if row['label']=='physical' and row['request']['normal']==normal
              and row['request']['candidate']==candidate and row['request']['h']==.4 and row['request']['velocity']==.005)
            request={**baseline['request'],'cutoff':False};requests.append({'request':request,'literalBaseline':baseline['raw']})
    result={'purpose':'separate cutoff sensitivity only; original registered failure preserved',
      'registration':requests,'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'originalStudySha256':hashlib.sha256(source.read_bytes()).hexdigest(),'originalStudyCompleted':study['completed'],'cases':[]}
    save=lambda:(args.out/'controls.json').write_text(json.dumps(result,indent=2));save()
    for index,item in enumerate(requests):
        baseline=next(row for row in study['cases'] if row.get('raw')==item['literalBaseline'])
        assert hashlib.sha256((args.study/baseline['raw']).read_bytes()).hexdigest()==baseline['rawSha256']
        row=reference.write_case(args.out,item['request'],f'case-{index:03d}')
        if row['converged']:
            row['smoothMinusLiteral']={side:row['measurement']['modalBeta'+side]-baseline['measurement']['modalBeta'+side] for side in ['Solid','Liquid']}
        result['cases'].append(row);save()
        print(json.dumps({'request':item['request'],'ok':row['converged'],'difference':row.get('smoothMinusLiteral'),'error':row.get('error')}),flush=True)
    result['completed']=all(row['converged'] for row in result['cases']);save()
    if not result['completed']:raise SystemExit(1)


if __name__=='__main__':main()
