"""Independent CPU physical-lattice cross-check and finite-speed GPU target.
No GPU is started; this is an explicit diagnostic, not a registered gate.
"""
import json,hashlib,time
from pathlib import Path
import numpy as np
from scipy.interpolate import CubicSpline

TARGET=Path(__file__).with_name('quant3d-kinetic-target.json')
target=json.loads(TARGET.read_text())
x=np.asarray(target['x']);phi=np.asarray(target['phi']);u=np.asarray(target['u'])
c,m=target['config'],target['measurement'];roots=m['metrologyHeatRoots'];bulk=m['modalOuterFits'][-1]
phase=CubicSpline(x,phi);thermal=CubicSpline(x,u)
def profile(coordinates):
    phase_values=phase(np.clip(coordinates,x[0],x[-1]))
    phase_values=np.where(coordinates<x[0],1,np.where(coordinates>x[-1],-1,phase_values))
    heat=thermal(np.clip(coordinates,x[0],x[-1]))
    for side in ['solid','liquid']:
        mask=coordinates<x[0] if side=='solid' else coordinates>x[-1]
        if not mask.any():continue
        xi=coordinates[mask];coefs=bulk['solidCoefficients' if side=='solid' else 'liquidCoefficients']
        terms=[np.ones(len(xi))]
        if side=='liquid':terms.append(np.exp(-m['kappa']*xi))
        for r in roots:
            if r['side']!=side:continue
            z=np.exp(complex(r['real'],r['imaginary'])*xi);terms.extend([z.real,z.imag])
        heat[mask]=np.stack(terms,axis=1)@coefs
    return .5*(phase_values+1),heat+1

def lap(field,h):
    out=np.empty_like(field);out[1:-1]=(field[2:]+field[:-2]-2*field[1:-1])/(h*h)
    out[0]=(field[1]-field[0])/(h*h);out[-1]=(field[-2]-field[-1])/(h*h)
    return out

def rhs(psi,T):
    q=2*psi-1;well=1-q*q;a=c['a'];h=c['h']
    velocity=(a*a*lap(psi,h)+.5*(q-q*q*q-4*(T-1)*well*well))/(a*a)
    return velocity,c['D']*lap(T,h)+velocity

def run(n,dt,method='euler',offset=0.,dtype='float64',duration=160):
    t0=time.perf_counter();h=c['h'];grid=(np.arange(n)+.5-n/2)*h-offset
    psi,T=profile(grid);psi=psi.astype(dtype);T=T.astype(dtype)
    initial_mass=float(np.sum(psi,dtype=np.float64)*h)
    initial_energy=float(np.sum(T.astype(np.float64)-psi.astype(np.float64))*h)
    count=int(round(duration/dt));trace=[]
    for j in range(1,count+1):
        if method=='euler':
            dp,dT=rhs(psi,T);new=np.clip(psi+dt*dp,0,1)
            T=T+dt*c['D']*lap(T,h)+(new-psi);psi=new
        else:
            k1=rhs(psi,T);k2=rhs(psi+.5*dt*k1[0],T+.5*dt*k1[1]);k3=rhs(psi+.5*dt*k2[0],T+.5*dt*k2[1]);k4=rhs(psi+dt*k3[0],T+dt*k3[1])
            psi=psi+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]);T=T+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1])
        if j%max(1,round(1/dt))==0 or j==count:
            time_now=j*dt;expected_psi,expected_T=profile(grid-c['velocity']*time_now)
            mass=float(np.sum(psi,dtype=np.float64)*h)-initial_mass
            expected_mass=float(np.sum(expected_psi)*h)-initial_mass
            local=abs(grid-c['velocity']*time_now)<24
            trace.append({'time':time_now,'massDisplacement':mass,'expectedMassDisplacement':expected_mass,
              'phaseRms':float(np.sqrt(np.mean((psi[local]-expected_psi[local])**2))),
              'temperatureRms':float(np.sqrt(np.mean((T[local]-expected_T[local])**2)))})
    energy=float(np.sum(T.astype(np.float64)-psi.astype(np.float64))*h)
    result={'n':n,'dt':dt,'method':method,'cellOffsetW0':offset,'dtype':dtype,'duration':duration,
      'meanVelocity':trace[-1]['massDisplacement']/duration,'expectedVelocity':c['velocity'],
      'velocityRelativeDifference':trace[-1]['massDisplacement']/(duration*c['velocity'])-1,
      'energyDrift':energy-initial_energy,'final':trace[-1],'trace':trace,'seconds':time.perf_counter()-t0}
    return result

result={'purpose':'CPU physical-grid validation of an independent finite-speed target; no GPU run',
  'targetSha256':hashlib.sha256(TARGET.read_bytes()).hexdigest(),'sourceHashes':target['sourceHashes'],
  'timeMarchSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'runs':[]}
def save():Path('verify-out/quant3d-kinetic-cpu.json').write_text(json.dumps(result,indent=2))
for n,dt,method,offset,dtype in [(1536,.016,'euler',0,'float64'),(1536,.008,'euler',0,'float64'),
  (1536,.008,'rk4',0,'float64'),(2048,.016,'euler',0,'float64'),
  (1536,.016,'euler',.2,'float64'),(1536,.016,'euler',.4,'float64'),(1536,.016,'euler',.6,'float64'),
  (1536,.016,'euler',0,'float32')]:
 row=run(n,dt,method,offset,dtype);result['runs'].append(row);save()
 print(json.dumps({k:v for k,v in row.items() if k!='trace'}),flush=True)
