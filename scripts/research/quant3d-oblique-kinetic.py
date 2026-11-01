"""Exact rational-plane restriction of the pure identity-cubic production stencil.

CPU only. The literal gradient cutoff is retained by default. ``cutoff=False``
selects the smooth active branch for independent principal/formal controls.
No constant-a substitution is made for an oblique plane.
"""
from dataclasses import dataclass
from fractions import Fraction
from functools import reduce
from itertools import combinations, product
from math import gcd
from pathlib import Path
import hashlib
import importlib.util
import json
import math
import numpy as np
from scipy.sparse import bmat, coo_matrix, csr_matrix, diags
from scipy.sparse.linalg import spsolve
from scipy.optimize import brentq

ROOT=Path(__file__).resolve().parents[2]
EPSILON=.0171
LAMBDA=4.
D=.6267*LAMBDA
CORRECTION=Fraction(1321,9870)


def reference_module():
    path=ROOT/'scripts/research/quant3d-kinetic-reference.py'
    spec=importlib.util.spec_from_file_location('unchanged_principal_reference',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def primitive_normal(normal):
    if isinstance(normal,str):
        values=tuple(int(value) for value in normal) if ',' not in normal else tuple(map(int,normal.split(',')))
    else:values=tuple(normal)
    if len(values)!=3 or any(not isinstance(value,(int,np.integer)) for value in values) or not any(values):
        raise ValueError('three nonzero-together integer normal components required')
    divisor=reduce(gcd,(abs(int(value)) for value in values))
    return tuple(int(value)//divisor for value in values)


def l19_counts(normal):
    """Integer numerator of (2 faceSum+edgeSum-24 center)/(6 dx^2)."""
    m=primitive_normal(normal);counts={0:-24}
    for axis in range(3):
        for sign in [-1,1]:
            shift=sign*m[axis];counts[shift]=counts.get(shift,0)+2
    for a,b in combinations(range(3),2):
        for u,v in product([-1,1],repeat=2):
            shift=u*m[a]+v*m[b];counts[shift]=counts.get(shift,0)+1
    counts={shift:value for shift,value in sorted(counts.items()) if value}
    norm2=sum(value*value for value in m)
    assert sum(counts.values())==0
    assert sum(value*shift**2 for shift,value in counts.items())==12*norm2
    assert sum(value*shift**4 for shift,value in counts.items())==12*norm2**2
    assert all(counts.get(-shift)==value for shift,value in counts.items())
    return counts


@dataclass(frozen=True)
class Geometry:
    normal: tuple
    dx: float=.8
    sub: int=32

    def __post_init__(self):
        object.__setattr__(self,'normal',primitive_normal(self.normal))
        if not (math.isfinite(self.dx) and self.dx>0 and isinstance(self.sub,int) and self.sub>=1):
            raise ValueError('positive physical dx and integer sub required')

    @property
    def norm2(self):return sum(value*value for value in self.normal)
    @property
    def unit(self):return np.array(self.normal,dtype=float)/math.sqrt(self.norm2)
    @property
    def delta(self):return self.dx/math.sqrt(self.norm2)
    @property
    def eta(self):return self.delta/self.sub
    @property
    def lab_shifts(self):return tuple(value*self.sub for value in self.normal)
    @property
    def counts(self):return l19_counts(self.normal)
    @property
    def weights(self):return [(shift,float(Fraction(value,6*self.norm2))) for shift,value in self.counts.items() if shift>0]
    @property
    def a_geometric(self):return 1+EPSILON*(4*np.sum(self.unit**4)-3)

    def metadata(self):
        return {'normal':list(self.normal),'unitNormal':self.unit.tolist(),'physicalDx':self.dx,
          'normalPlaneSpacing':self.delta,'eta':self.eta,'sub':self.sub,
          'labIntegerShifts':list(self.normal),'l19Numerator':self.counts,
          'l19WeightsNormalSpacing':[[shift,str(Fraction(value,6*self.norm2))]
             for shift,value in self.counts.items() if shift>0]}


def _linear_operator(n,positions,offsets,coefficients,periodic=False,left=1.,right=-1.):
    rows=[];cols=[];data=[];constant=np.zeros(len(positions))
    for row,j in enumerate(positions):
        for shift,coefficient in zip(offsets,coefficients):
            k=j+shift
            if periodic:k%=n
            if 0<=k<n:rows.append(row);cols.append(k);data.append(coefficient)
            else:constant[row]+=coefficient*(left if k<0 else right)
    return coo_matrix((data,(rows,cols)),shape=(len(positions),n)).tocsr(),constant


class PlaneOperator:
    """Exact Float64 algebraic reduction; its arithmetic is not WGSL bit parity.

    q=2*psi-1. B below is twice the stored production correction flux A.
    Constant phase ghosts are infinite solid(+1)/liquid(-1), not physical walls.
    Periodic mode is a quotient/manufactured operator control, not a front.
    """
    def __init__(self,n,geometry,epsilon=EPSILON,eps_bar=1.,cutoff=True,boundary='constant'):
        if n<5 or boundary not in ['constant','periodic']:raise ValueError('invalid line shape/boundary')
        self.n=n;self.g=geometry;self.epsilon=epsilon;self.eps_bar=eps_bar;self.cutoff=cutoff;self.boundary=boundary
        periodic=boundary=='periodic';margin=0 if periodic else max(abs(s) for s in geometry.lab_shifts)
        self.margin=margin;positions=np.arange(-margin,n+margin);self.ext_n=len(positions)
        self.core=slice(margin,margin+n)
        self.G=[];self.G0=[];self.H=[]
        for shift in geometry.lab_shifts:
            matrix,constant=_linear_operator(n,positions,[-shift,shift],[-.5/geometry.dx,.5/geometry.dx],periodic)
            self.G.append(matrix);self.G0.append(constant)
            if periodic:self.H.append(matrix)
            else:
                rows=np.repeat(np.arange(n),2)
                cols=np.column_stack([np.arange(n)+margin-shift,np.arange(n)+margin+shift]).ravel()
                values=np.tile([-.5/geometry.dx,.5/geometry.dx],n)
                self.H.append(coo_matrix((values,(rows,cols)),shape=(n,self.ext_n)).tocsr())
        offsets=list(geometry.counts);coefficients=[geometry.counts[k]/(6*geometry.dx**2) for k in offsets]
        self.L,self.L0=_linear_operator(n,np.arange(n),[k*geometry.sub for k in offsets],coefficients,periodic)
        self.Gcore=[matrix[self.core] for matrix in self.G]

    def evaluate(self,q,jacobian=False):
        q=np.asarray(q,dtype=float)
        if q.shape!=(self.n,) or not np.all(np.isfinite(q)):raise ValueError('finite one-dimensional q required')
        gradient=np.stack([matrix@q+constant for matrix,constant in zip(self.G,self.G0)],axis=1)
        magnitude=np.linalg.norm(gradient,axis=1)
        active=.25*magnitude*magnitude>=1e-12 if self.cutoff else magnitude>0
        normal=np.zeros_like(gradient);normal[active]=gradient[active]/magnitude[active,None]
        # A flat node on the optional smooth branch uses the plane's limiting
        # normal. Literal production mode instead takes w=eps_bar^2, B=0.
        if not self.cutoff:normal[~active]=self.g.unit
        s4=np.sum(normal**4,axis=1)
        a=1+self.epsilon*(4*s4-3)
        tangent=16*self.epsilon*(normal**3-s4[:,None]*normal)
        e2=self.eps_bar**2
        w=e2*a*a
        B=e2*a[:,None]*magnitude[:,None]*tangent
        if self.cutoff:w[~active]=e2;B[~active]=0;a[~active]=1;tangent[~active]=0
        lap=self.L@q+self.L0
        grad_w=np.stack([matrix@w for matrix in self.H],axis=1)
        div_B=sum(matrix@B[:,axis] for axis,matrix in enumerate(self.H))
        cross=np.sum(grad_w*gradient[self.core],axis=1)
        spatial=w[self.core]*lap+cross+div_B
        result={'gradientQ':gradient[self.core],'normalFD':normal[self.core],'aFD':a[self.core],
          'gradientPsiSquared':.25*magnitude[self.core]**2,'activeFlux':active[self.core],
          'w':w[self.core],'correctionQ':B[self.core],'lapQ':lap,'gradW':grad_w,
          'gradWdotGradQ':cross,'divCorrectionQ':div_B,'spatialQ':spatial}
        if not jacobian:return result
        dw=np.zeros_like(gradient);dB=np.zeros((self.ext_n,3,3))
        for i in np.flatnonzero(active):
            nn=normal[i];tt=tangent[i];aa=a[i];rr=magnitude[i]
            P=np.eye(3)-np.outer(nn,nn);H=np.diag(48*self.epsilon*nn*nn)
            ndotb=16*self.epsilon*s4[i]
            dw[i]=2*e2*aa*tt/rr
            dB[i]=e2*(np.outer(tt,tt)+aa*(np.outer(tt,nn)-np.outer(nn,tt)+P@H@P-ndotb*P))
        W=sum(diags(dw[:,axis])@matrix for axis,matrix in enumerate(self.G)).tocsr()
        BJ=[sum(diags(dB[:,i,j])@self.G[j] for j in range(3)).tocsr() for i in range(3)]
        J=diags(w[self.core])@self.L+diags(lap)@W[self.core]
        for axis in range(3):
            J=J+diags(gradient[self.core,axis])@self.H[axis]@W+diags(grad_w[:,axis])@self.Gcore[axis]+self.H[axis]@BJ[axis]
        result.update(jacobian=J.tocsr(),wJacobian=W[self.core])
        return result


def local_tau(fields,geometry,tau_input=1.,candidate=False,lambda_=LAMBDA,D_=D,eps_bar=1.):
    width2=max(1e-20,eps_bar**2)
    if candidate:
        values=tau_input*(47/75)*lambda_/D_*(fields['w']/width2-float(CORRECTION)*geometry.dx**2/width2)
    else:values=tau_input*fields['w']/width2
    if np.any(~np.isfinite(values)) or np.any(values<=0):raise ValueError('nonpositive/nonfinite local relaxation')
    return values


def phase_heat_rhs(q,u,operator,tau_input=1.,candidate=False):
    """Continuous-time pure equations before Euler clipping, with no sources."""
    fields=operator.evaluate(q);tau=local_tau(fields,operator.g,tau_input,candidate,eps_bar=operator.eps_bar)
    well=1-q*q
    dq=(fields['spatialQ']+q-q**3-LAMBDA*u*well**2)/tau
    # A periodic manufactured u is supported here; a front uses the BVP's
    # independent thermal outgoing closure instead of phase-valued ghosts.
    if operator.boundary!='periodic':raise ValueError('front heat closure belongs to the coupled BVP')
    du=D*(operator.L@u)+.5*dq
    return dq,du,fields,tau


def source_hashes():
    paths=[Path(__file__).resolve(),ROOT/'src/shaders3d.ts',ROOT/'src/shaders3d-quant.ts',
           ROOT/'scripts/research/quant3d-kinetic-reference.py']
    return {path.relative_to(ROOT).as_posix():hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
