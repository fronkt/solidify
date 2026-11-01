"""New angular-mode expectations from the unchanged stored-FP32 input packet."""
import argparse,hashlib,importlib.util,json,sys
from pathlib import Path
import numpy as np

path=Path(__file__).with_name('quant3d-oblique-kinetic-angular.py')
spec=importlib.util.spec_from_file_location('angular_fixture_model',path)
angular=importlib.util.module_from_spec(spec);sys.modules[spec.name]=angular;spec.loader.exec_module(angular)


def export(inputs,out):
    original=json.loads(inputs.read_text())
    assert original['format']=='solidify-oblique-fp32-input-fixtures-v1' and original['period']==257
    assert original['uniforms']['epsBar']==1.,'zero-beta study is registered at nondimensional width1 only'
    out.mkdir(parents=True,exist_ok=True);uniforms=original['uniforms']
    psi=np.asarray(original['psiStored'],dtype='<f4');T=np.asarray(original['temperatureStored'],dtype='<f4')
    assert hashlib.sha256(psi.tobytes()+T.tobytes()).hexdigest()==original['inputFloat32Sha256']
    q=2*psi.astype(float)-1;u=T.astype(float)-1
    hashes={**original['sourceHashes'],
      path.relative_to(angular.model.ROOT).as_posix():hashlib.sha256(path.read_bytes()).hexdigest(),
      Path(__file__).relative_to(angular.model.ROOT).as_posix():hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'scripts/research/quant3d-oblique-kinetic-reference.py':hashlib.sha256(angular.path.read_bytes()).hexdigest()}
    result={key:original[key] for key in ['period','psiStored','temperatureStored','uniforms','inputFloat32Sha256']}
    result.update(format='solidify-oblique-angular-fp32-input-fixtures-v1',sourceHashes=hashes,
      previousInputSha256=hashlib.sha256(inputs.read_bytes()).hexdigest(),wgslIntermediateRoundingEmulated=False,
      purpose='nodewise identity-cubic angular tau; fixed real algebra from stored-Float32 inputs, no GPU output',
      widthScope='epsBar1 nondimensional physical study; other-width flux ratios are algebra only',fixtures=[])
    for old in original['fixtures']:
        g=angular.model.Geometry(old['geometry']['normal'],uniforms['dx'],1)
        op=angular.model.PlaneOperator(257,g,epsilon=uniforms['delta'],eps_bar=uniforms['epsBar'],boundary='periodic')
        fields=op.evaluate(q)
        for name,value in fields.items():assert np.array_equal(value,np.array(old['fields'][name])),name
        tau=angular.angular_tau(fields,op,uniforms['tau'],uniforms['lambda'],uniforms['dTherm'])
        well=1-q*q
        dq=(fields['spatialQ']+q-q**3-uniforms['lambda']*u*well**2)/tau['tau']
        du=uniforms['dTherm']*(op.L@u)+.5*dq
        new=np.clip(psi.astype(float)+.5*uniforms['dt']*dq,0,1)
        temp=T.astype(float)+uniforms['dt']*uniforms['dTherm']*(op.L@u)+(new-psi)
        np_psi=np.asarray(new,dtype='<f4');np_T=np.asarray(temp,dtype='<f4')
        encoded={key:value.tolist() for key,value in fields.items()};encoded['gammaFD']=tau['gamma']['gammaFD'].tolist()
        result['fixtures'].append({'geometry':old['geometry'],'fields':encoded,'controls':{'Angular':{
          'tau':tau['tau'].tolist(),'principalTau':tau['principalTau'].tolist(),'phaseRhsQ':dq.tolist(),'heatRhsU':du.tolist(),
          'eulerPsiReal':new.tolist(),'eulerTemperatureReal':temp.tolist(),
          'eulerPsiRounded':np_psi.astype(float).tolist(),'eulerTemperatureRounded':np_T.astype(float).tolist(),
          'outputFloat32Sha256':hashlib.sha256(np_psi.tobytes()+np_T.tobytes()).hexdigest()}}})
    output=out/'angular-fp32-input-fixtures.json';output.write_text(json.dumps(result,separators=(',',':')))
    metadata={'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
      'sourceHashes':hashes,'previousInputSha256':result['previousInputSha256'],
      'inputFloat32Sha256':result['inputFloat32Sha256']}
    (out/'fixture-metadata.json').write_text(json.dumps(metadata,indent=2));return metadata


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--inputs',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path);args=parser.parse_args()
    print(json.dumps(export(args.inputs,args.out),indent=2))
