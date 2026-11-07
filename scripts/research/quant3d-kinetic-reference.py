"""Independent coupled discrete-space planar reference; CPU only.

The physical shift h is retained exactly; eta refines only the traveling
derivative. Outgoing complex heat modes are controlled independently. The
exported finite-speed profile is not a zero-kinetics or needle-acceptance claim.
"""
import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import numpy as np
import scipy
from scipy.optimize import brentq, root
from scipy.sparse import bmat, coo_matrix, csr_matrix, diags
from scipy.sparse.linalg import spsolve

A1, A2, LAMBDA, EPSILON = .8839, .6267, 4., .0171
D, ANISO = A2 * LAMBDA, 1 + EPSILON


def characteristic_roots(h,weights,velocity,modes):
    def symbol(s):
        return D*sum(weight*4*np.sinh(j*h*s/2)**2 for j,weight in weights)/(h*h)+velocity*s
    rows=[]
    for branch in range(1,modes+1):
        frequency=2*np.pi*branch/h
        alpha=np.sqrt(velocity*frequency/(2*D))
        for sign in [-1,1]:
            guess=sign*alpha-velocity/(2*D)+1j*(frequency-sign*alpha)
            def function(z):
                f=symbol(z[0]+1j*z[1]);return [f.real,f.imag]
            solution=root(function,[guess.real,guess.imag],tol=1e-11)
            s=complex(*solution.x)
            if abs(symbol(s))>1e-8 or s.real*sign<=0:
                raise RuntimeError('outgoing heat characteristic root unresolved')
            rows.append({'branch':branch,'side':'solid' if sign>0 else 'liquid',
                         'real':s.real,'imaginary':s.imag,'residual':abs(symbol(s))})
    return rows


def outgoing_tail(n,eta,h,kappa,roots):
    # Controlled low-frequency radiation closure. Increasing mode count and
    # interval is mandatory; this is not a claim to retain every DDE root.
    width=int(round(4*h/eta));positions=np.arange(width+1)*eta
    def basis(coordinates,side):
        columns=[np.ones(len(coordinates))] if side=='solid' else [np.exp(-kappa*coordinates)]
        for row in roots:
            if row['side']!=side:continue
            value=np.exp(complex(row['real'],row['imaginary'])*coordinates)
            columns.extend([value.real,value.imag])
        return np.stack(columns,axis=1)
    inverse={side:np.linalg.pinv(basis(positions if side=='solid' else -positions,side))
             for side in ['solid','liquid']}
    conditions={side:float(np.linalg.cond(basis(positions if side=='solid' else -positions,side)))
                for side in ['solid','liquid']}
    cache={}
    def ghost(j):
        if j in cache:return cache[j]
        side='solid' if j<0 else 'liquid'
        coordinate=j*eta if j<0 else (j-(n-1))*eta
        coefficients=basis(np.array([coordinate]),side)[0]@inverse[side]
        columns=np.arange(width+1) if j<0 else n-1-np.arange(width+1)
        far=0. if j<0 else 1-float(coefficients.sum())
        cache[j]=(columns,coefficients,far)
        return cache[j]
    return ghost,conditions


def operator(n, eta, offsets, coefficients, kind, kappa, tail=None):
    """Linear operator plus fixed phase ghost and free liquid-constant terms."""
    rows, cols, data = [], [], []
    constant, infinity = np.zeros(n), np.zeros(n)
    for offset, coefficient in zip(offsets, coefficients):
        for i in range(n):
            j = i + offset
            if 0 <= j < n:
                rows.append(i); cols.append(j); data.append(coefficient)
            elif kind == 'phase':
                constant[i] += coefficient * (1. if j < 0 else -1.)
            elif tail is not None:
                columns,weights,far=tail(j)
                rows.extend([i]*len(columns));cols.extend(columns);data.extend(coefficient*weights)
                infinity[i]+=coefficient*far
            elif j < 0:
                rows.append(i); cols.append(0); data.append(coefficient)
            else:
                exponential = np.exp(-kappa * (j - (n - 1)) * eta)
                rows.append(i); cols.append(n - 1); data.append(coefficient * exponential)
                infinity[i] += coefficient * (1 - exponential)
    return coo_matrix((data, (rows, cols)), shape=(n, n)).tocsr(), constant, infinity


def build(h=.8, eta=.05, half=24., velocity=.04, tau_scale=1., order=6, bias=1,normal='100',modes=0):
    physical_dx=h
    dimension={'100':1,'110':2,'111':3}[normal]
    h=physical_dx/np.sqrt(dimension)
    a=1+EPSILON*(4/dimension-3)
    weights={'100':[(1,1.)],'110':[(1,8/12),(2,1/12)],'111':[(1,1/3),(2,1/6)]}[normal]
    shift = int(round(h / eta))
    count = int(round(half / eta))
    if abs(shift * eta - h) > 1e-12:
        raise ValueError('normal-plane shift must be an integer eta multiple')
    half=count*eta
    x = np.arange(-count, count + 1) * eta
    n = len(x)
    # Positive root of the EXACT discrete bulk-heat characteristic equation.
    # Divide by kappa to remove the trivial constant root at zero.
    def characteristic(k):
        return D*sum(weight*4*np.sinh(j*k*h/2)**2 for j,weight in weights)/(h*h*k)-velocity
    kappa = brentq(characteristic, 1e-10, max(1., 2 * velocity / D), xtol=1e-14)
    derivative = {
        4: ([-2,-1,1,2], [1,-8,8,-1], 12),
        6: ([-3,-2,-1,1,2,3], [-1,9,-45,45,-9,1], 60),
        8: ([-4,-3,-2,-1,1,2,3,4], [3,-32,168,-672,672,-168,32,-3], 840),
    }[order]
    offsets=derivative[0]
    coeff = np.array(derivative[1]) / (derivative[2] * eta)
    if bias:
        offsets=np.arange(-order//2+bias,order//2+bias+1)
        moments=np.vstack([offsets.astype(float)**j for j in range(len(offsets))])
        rhs=np.zeros(len(offsets));rhs[1]=1
        coeff=np.linalg.solve(moments,rhs)/eta
    roots=characteristic_roots(h,weights,velocity,modes)
    tail,tail_conditions=outgoing_tail(n,eta,h,kappa,roots) if modes else (None,None)
    dp, dp0, _ = operator(n, eta, offsets, coeff, 'phase', kappa)
    du, _, duinf = operator(n, eta, offsets, coeff, 'heat', kappa,tail)
    lapoffsets=[0];lapcoeff=[-2*sum(weight for _,weight in weights)/(h*h)]
    for j,weight in weights:
        lapoffsets.extend([-j*shift,j*shift]);lapcoeff.extend([weight/(h*h)]*2)
    lp, lp0, _ = operator(n, eta, lapoffsets, lapcoeff, 'phase', kappa)
    lu, _, luinf = operator(n, eta, lapoffsets, lapcoeff, 'heat', kappa,tail)
    heat = D*lu + velocity*du
    heatinf = D*luinf + velocity*duinf
    phase = a**2*lp + velocity*tau_scale*a**2*dp
    phase0 = a**2*lp0 + velocity*tau_scale*a**2*dp0
    heatphase = -.5*velocity*dp
    heat0 = -.5*velocity*dp0
    pin = csr_matrix(([1.], ([0], [count])), shape=(1,n))

    def evaluate(y, jacobian=True):
        phi, u, uinf = y[:n], y[n:2*n], y[-1]
        well = 1-phi*phi
        rp = phase@phi + phase0 + phi - phi**3 - LAMBDA*u*well**2
        rp[0], rp[-1] = phi[0]-1, phi[-1]+1
        rh = heat@u + heatinf*uinf + heatphase@phi + heat0
        residual = np.r_[rp,rh,phi[count]]
        if not jacobian:
            return residual
        pp = (phase + diags(1-3*phi*phi+4*LAMBDA*u*phi*well)).tolil()
        pu = diags(-LAMBDA*well**2).tolil()
        for row in [0,n-1]:
            pp.rows[row], pp.data[row] = [row], [1.]
            pu.rows[row], pu.data[row] = [], []
        matrix = bmat([[pp,pu,csr_matrix((n,1))],
                       [heatphase,heat,csr_matrix(heatinf[:,None])],
                       [pin,csr_matrix((1,n)),csr_matrix((1,1))]],format='csc')
        return residual, matrix

    beta_continuum = A1*a/LAMBDA*(tau_scale-1)
    phi = -np.tanh(x/(np.sqrt(2)*a))
    uinf = -1-beta_continuum*velocity
    # Obtain a genuinely coupled thermal initial profile, not frozen T.
    u = spsolve(heat,-heatinf*uinf-heatphase@phi-heat0)
    return {'x':x,'n':n,'kappa':kappa,'evaluate':evaluate,'dp':dp,'dp0':dp0,'lp':lp,'lp0':lp0,
            'initial':np.r_[phi,u,uinf],'betaContinuum':beta_continuum,
            'config':dict(h=h,physicalDx=physical_dx,normal=normal,weights=weights,eta=eta,half=half,velocity=velocity,tauScale=tau_scale,
                          derivativeOrder=order,derivativeBias=bias,lambda_=LAMBDA,epsilon=EPSILON,D=D,a=a,
                          outgoingModes=modes,tailConditions=tail_conditions,heatRoots=roots)}


def solve(problem, initial=None, tolerance=3e-11, max_iterations=35):
    y = problem['initial'].copy() if initial is None else initial.copy()
    trace = []
    for iteration in range(max_iterations):
        residual, matrix = problem['evaluate'](y)
        error = float(np.max(np.abs(residual)))
        trace.append({'iteration':iteration,'maxResidual':error})
        if error < tolerance:
            return y, trace
        delta = spsolve(matrix,-residual)
        if not np.all(np.isfinite(delta)):
            raise RuntimeError('nonfinite Newton update')
        old = np.linalg.norm(residual)
        damping = 1.
        for _ in range(18):
            candidate = y+damping*delta
            new = problem['evaluate'](candidate,False)
            if np.all(np.isfinite(new)) and np.linalg.norm(new) < old*(1-1e-4*damping):
                y = candidate
                trace[-1]['damping'] = damping
                break
            damping *= .5
        else:
            raise RuntimeError(f'Newton line search stalled at residual {error}')
    raise RuntimeError(f'Newton did not converge: {trace[-1]}')


def measure(problem,y):
    x,n,kappa,c = problem['x'],problem['n'],problem['kappa'],problem['config']
    phi,u,uinf = y[:n],y[n:2*n],float(y[-1])
    V = c['velocity'];a=c['a']
    fits=[];modal_fits=[]
    roots=characteristic_roots(c['h'],c['weights'],V,max(2,c['outgoingModes']))
    def bulk_fit(mask,side):
        coordinates=x[mask]
        columns=[np.ones(len(coordinates))]
        if side=='liquid':columns.append(np.exp(-kappa*coordinates))
        for row in roots:
            if row['side']!=side:continue
            value=np.exp(complex(row['real'],row['imaginary'])*coordinates)
            columns.extend([value.real,value.imag])
        matrix=np.stack(columns,axis=1)
        scale=np.linalg.norm(matrix,axis=0)
        coefficients=np.linalg.lstsq(matrix/scale,u[mask],rcond=None)[0]/scale
        return coefficients,float(np.sqrt(np.mean((matrix@coefficients-u[mask])**2))),float(np.linalg.cond(matrix/scale))
    for inner,outer in [(6,12),(8,16),(10,20),(12,22),(16,28),(24,40),(32,48),(40,56),
                        (64,96),(96,128),(128,160),(144,176),(160,224),(192,256),(256,320)]:
        lo,hi = inner*a,outer*a
        if hi>c['half']-c['h']:
            continue
        solid=(x<=-lo)&(x>=-hi);liquid=(x>=lo)&(x<=hi)
        ui_s=float(np.mean(u[solid]))
        X=np.c_[np.ones(np.count_nonzero(liquid)),np.exp(-kappa*x[liquid])]
        far,amplitude=np.linalg.lstsq(X,u[liquid],rcond=None)[0]
        ui_l=float(far+amplitude)
        fits.append({'windowW':[inner,outer],'uSolidExtrapolated':ui_s,
                     'uLiquidExtrapolated':ui_l,'uInfinityFitted':float(far),
                     'temperatureJumpLiquidMinusSolid':ui_l-ui_s,
                     'betaSolid':-ui_s/V,'betaLiquid':-ui_l/V,
                     'latentJump':ui_s-float(far),
                     'solidRms':float(np.std(u[solid])),
                     'liquidRms':float(np.sqrt(np.mean((X@np.r_[far,amplitude]-u[liquid])**2)))})
        s,sr,sc=bulk_fit(solid,'solid');l,lr,lc=bulk_fit(liquid,'liquid')
        modal_fits.append({'windowW':[inner,outer],'betaSolid':-float(s[0])/V,'betaLiquid':-float(l[0]+l[1])/V,
                          'uSolid':float(s[0]),'uLiquidExtrapolated':float(l[0]+l[1]),
                          'uInfinity':float(l[0]),'latentJump':float(s[0]-l[0]),
                          'rms':[sr,lr],'condition':[sc,lc],
                          'solidCoefficients':s.tolist(),'liquidCoefficients':l.tolist()})
    last=fits[-1]
    derivative=problem['dp']@phi+problem['dp0']
    integral=lambda values:float(np.trapezoid(values,x))
    I=integral(derivative**2)
    J=integral(derivative*(1-phi*phi)**2)
    thermal=integral(u*derivative*(1-phi*phi)**2)
    phase_balance=c['tauScale']*a**2*V*I-LAMBDA*thermal
    # No latent jump is imposed: both u[-infinity] and u[+infinity] are free.
    return {'kappa':kappa,'continuumKappa':V/D,'uInfinityUnknown':uinf,
            'uCenter':float(u[n//2]),'betaFromFarUndercooling':(-uinf-1)/V,
            'betaSolid':last['betaSolid'],'betaLiquid':last['betaLiquid'],
            'temperatureJump':last['temperatureJumpLiquidMinusSolid'],
            'latentJump':last['latentJump'],'latentJumpError':last['latentJump']-1,
            'phiRange':[float(phi.min()),float(phi.max())],
            'phaseMonotonicityViolation':float(max(0,np.max(np.diff(phi)))),
            'continuumBeta':problem['betaContinuum'],'outerFits':fits,'modalOuterFits':modal_fits,
            'modalBetaSolid':modal_fits[-1]['betaSolid'],'modalBetaLiquid':modal_fits[-1]['betaLiquid'],
            'modalLatentJump':modal_fits[-1]['latentJump'],
            'metrologyHeatRoots':roots,
            'phaseEnergyIdentity':{'tauVIntegralPhiPrimeSquared':c['tauScale']*a**2*V*I,
              'lambdaIntegralUPhiPrimeWellSquared':LAMBDA*thermal,'absoluteResidual':phase_balance,
              'shiftLaplacianIntegralPhiPrime':integral((problem['lp']@phi+problem['lp0'])*derivative),
              'integralPhiPrimeWellSquared':J,
              'bareMobilityContribution':-c['tauScale']*a**2*I/(LAMBDA*J),
              'diffusiveContributionRelativeSolid':integral((u-last['uSolidExtrapolated'])*derivative*(1-phi*phi)**2)/(V*J)}}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',default='scripts/research/quant3d-kinetic-target.json')
    args=parser.parse_args()
    from scipy.interpolate import CubicSpline
    repository=Path(__file__).resolve().parents[2]
    source_paths=[Path(__file__).resolve(),repository/'src/shaders3d.ts',repository/'src/shaders3d-quant.ts']
    problem=build(h=.8,eta=.0125,half=64,velocity=.04,tau_scale=1,order=6,bias=1,normal='100',modes=2)
    y,trace=solve(problem);measurement=measure(problem,y)
    x=problem['x'];n=problem['n'];phi=y[:n];u=y[n:2*n]
    controls=[]
    for options in [dict(eta=.025,half=64,order=6,modes=2),dict(eta=.025,half=96,order=8,modes=3)]:
        p=build(h=.8,velocity=.04,tau_scale=1,bias=1,normal='100',**options)
        state,history=solve(p);m=measure(p,state)
        controls.append({'config':p['config'],'trace':history,'betaSolid':m['modalBetaSolid'],
                         'betaLiquid':m['modalBetaLiquid'],'latentJump':m['modalLatentJump']})
    result={'format':'solidify-coupled-kinetic-target-v1',
      'purpose':'independent finite-speed [100] coupled profile; no zero-beta or needle-acceptance claim',
      'reference':'https://doi.org/10.1103/PhysRevE.57.4323 Sec.VI.B.2',
      'method':'exact physical finite shift in phase and heat; refined sixth-order traveling derivative; free far-liquid constant; two outgoing complex heat branches; phase-origin pin',
      'environment':{'python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__},
      'sourceHashes':{p.relative_to(repository).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
         for p in source_paths},
      'config':problem['config'],'measurement':measurement,'trace':trace,'controls':controls,
      'units':{'x':'W0','time':'tau0','phase':'phi=2*psi-1','temperature':'u=Ttilde-1'},
      'proposal':{'dimensions':[1536,8,8],'domainControl':[2048,8,8],'dt':[.016,.008],
        'duration':160,'cellOffsets':[0,.2,.4,.6],'cellPeriod':20,'periods':8,
        'expectedMeanMassVelocity':.04,'normal':'100','boundary':'cell-centered scalar reflection; uniform transverse planes'},
      'x':x.tolist(),'phi':phi.tolist(),'u':u.tolist(),
      'phiDerivative':CubicSpline(x,phi).derivative()(x).tolist(),
      'uDerivative':CubicSpline(x,u).derivative()(x).tolist(),
      'profileEncoding':'Hermite values and derivatives reproduce the independently calculated cubic spline; outgoing tails use measurement.modalOuterFits[-1] and metrologyHeatRoots',
      'rawFloat64Sha256':hashlib.sha256(b''.join(v.astype('<f8').tobytes() for v in [x,phi,u])).hexdigest(),
      'limitations':'Continuous-time principal-plane reduction; production Euler/compiler/bulk-cutoff effects require direct comparison. No GPU code or needle outcome is used to fit this profile.'}
    path=Path(args.out);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(result,separators=(',',':')))
    print(json.dumps({'path':str(path),'betaSolid':measurement['modalBetaSolid'],
                      'betaLiquid':measurement['modalBetaLiquid'],'latentJump':measurement['modalLatentJump'],
                      'points':n,'rawFloat64Sha256':result['rawFloat64Sha256']}))


if __name__=='__main__':
    main()
