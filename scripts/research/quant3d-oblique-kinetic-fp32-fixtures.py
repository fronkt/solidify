"""Export a NEW fixture with exact stored-Float32 inputs/uniforms; CPU only.

The reference evaluates their real algebra in Float64. It does not claim to
emulate WGSL intermediate Float32 operations, fusion, or compiler behavior.
"""
import argparse,hashlib,importlib.util,json,sys
from pathlib import Path
import numpy as np

path=Path(__file__).with_name('quant3d-oblique-kinetic.py')
spec=importlib.util.spec_from_file_location('oblique_fp_input',path)
model=importlib.util.module_from_spec(spec);sys.modules[spec.name]=model;spec.loader.exec_module(model)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True,type=Path)
    out=parser.parse_args().out;out.mkdir(parents=True,exist_ok=True)
    count=257;j=np.arange(count);angle=2*np.pi*(j+.173)/count
    prescribed_q=.05+.65*np.sin(angle)+.12*np.cos(2*angle)+.03*np.sin(3*angle)
    prescribed_u=-.1+.12*np.cos(angle)+.03*np.sin(2*angle)
    psi=np.array(.5*(1+prescribed_q),dtype='<f4');temperature=np.array(1+prescribed_u,dtype='<f4')
    q=2*psi.astype(float)-1;u=temperature.astype(float)-1
    uniforms={key:float(np.float32(value)) for key,value in {'dx':.8,'dt':.004,'delta':.0171,'lambda':4.,
      'dTherm':2.5068,'tau':1.,'epsBar':1.}.items()}
    result={'format':'solidify-oblique-fp32-input-fixtures-v1','period':count,
      'purpose':'actual stored-Float32 inputs/uniforms, independent real-algebra reference; no GPU output',
      'scope':'pure identity cubic; exact rational-plane quotient; no wall or grain-orientation test',
      'uniforms':uniforms,'inputEncoding':'q=2*Float32(psi)-1,u=Float32(Ttilde)-1; all subsequent reference algebra Float64',
      'wgslIntermediateRoundingEmulated':False,'comparisonToleranceDeclaredByRoot':2e-6,
      'sourceHashes':{**model.source_hashes(),Path(__file__).name:hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
      'psiStored':psi.astype(float).tolist(),'temperatureStored':temperature.astype(float).tolist(),
      'inputFloat32Sha256':hashlib.sha256(psi.tobytes()+temperature.tobytes()).hexdigest(),'fixtures':[]}
    for normal in [(1,0,0),(1,1,0),(1,1,1),(2,1,0),(2,1,1),(3,2,1)]:
        g=model.Geometry(normal,uniforms['dx'],1)
        op=model.PlaneOperator(count,g,epsilon=uniforms['delta'],eps_bar=uniforms['epsBar'],boundary='periodic')
        fields=op.evaluate(q)
        row={'geometry':g.metadata(),'fields':{key:value.tolist() for key,value in fields.items()},'controls':{}}
        for candidate in [False,True]:
            tau=model.local_tau(fields,g,uniforms['tau'],candidate,uniforms['lambda'],uniforms['dTherm'],uniforms['epsBar'])
            well=1-q*q
            dq=(fields['spatialQ']+q-q**3-uniforms['lambda']*u*well**2)/tau
            du=uniforms['dTherm']*(op.L@u)+.5*dq
            new=np.clip(psi.astype(float)+.5*uniforms['dt']*dq,0,1)
            temp=temperature.astype(float)+uniforms['dt']*uniforms['dTherm']*(op.L@u)+(new-psi)
            rounded_psi=np.asarray(new,dtype='<f4');rounded_temp=np.asarray(temp,dtype='<f4')
            row['controls'][str(candidate)]={'tau':tau.tolist(),'phaseRhsQ':dq.tolist(),'heatRhsU':du.tolist(),
              'eulerPsiReal':new.tolist(),'eulerTemperatureReal':temp.tolist(),
              'eulerPsiRounded':rounded_psi.astype(float).tolist(),'eulerTemperatureRounded':rounded_temp.astype(float).tolist(),
              'outputFloat32Sha256':hashlib.sha256(rounded_psi.tobytes()+rounded_temp.tobytes()).hexdigest()}
        result['fixtures'].append(row)
    output=out/'operator-fp32-input-fixtures.json';output.write_text(json.dumps(result,separators=(',',':')))
    metadata={'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
      'inputFloat32Sha256':result['inputFloat32Sha256'],'sourceHashes':result['sourceHashes'],'uniforms':uniforms}
    (out/'fixture-metadata.json').write_text(json.dumps(metadata,indent=2));print(json.dumps(metadata,indent=2))


if __name__=='__main__':main()
