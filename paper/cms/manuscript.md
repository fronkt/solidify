---
title: "Single precision is not the limiting error: convergence and error budget of three-dimensional dendrite tip selection with a WebGPU phase-field solver"
author:
  - Frank Cai, Purdue University, West Lafayette, IN, USA (ORCID 0009-0003-0041-1459)
date: "Draft 1, 2026-11-27 (not submitted)"
bibliography: refs.bib
link-citations: true
---

<!-- Canonical source. Every number is from paper/cms/data/ledger.json (paper/cms/scripts/ledger.py).
     Do not edit a number by hand: change the ledger or the text that cites it. -->

# Abstract

Single-precision arithmetic is common in GPU phase-field codes and unavoidable in WebGPU, whose shading
language has no 64-bit floating-point type. We test whether it limits a quantitative three-dimensional
benchmark: free dendritic growth of a pure substance at undercooling $\Delta=0.45$, compared with the
phase-field and numerical-solvability values of Karma and Rappel (1996) at three cubic anisotropies. A
thin-interface phase-field solver written in WGSL was run under protocols fixed before each run. A float64 transliteration of the same discrete
update changes the tip selection constant $\sigma^*$ by at most 0.13%, and the same source agrees to 0.03% on
an integrated laptop GPU and a data-center GPU. The anisotropy definition matters far more. Karma and
Rappel's anisotropy strength is grid-corrected, and on our grid a raw input of the same value is 3% weaker at
equilibrium, which lowers $\sigma^*$ by 6.4%. With the anisotropy calibrated from equilibrium shapes, the
solver reproduces their phase-field values at $\varepsilon_4=0.0123$ and 0.0171 within a pre-registered 10%
budget ($\sigma^*$ within 0.6% and 3.8%) and lies 8.8% and 4.9% above solvability. At $\varepsilon_4=0.0265$,
where the tip radius spans 15 grid cells, $\sigma^*$ is 5.8% below solvability and 16% below the phase-field
value. Domain and time-step effects are below 0.1% and grid effects 3-5%, but width convergence is slow: the
tip velocity is linear in the width, which points to an uncancelled first-order correction, and the
sharp-interface limit of $\sigma^*$ is uncertain by 5-17%. For this
benchmark the anisotropy definition and the width convergence, not arithmetic precision, set the accuracy.

**Keywords:** phase-field method; dendritic solidification; tip selection; GPU computing; WebGPU; single precision

# Highlights

- A single-precision WebGPU phase-field solver is tested on 3D dendrite tip selection
- fp64 arithmetic changes the selection constant by at most 0.13%
- Grid-corrected anisotropy shifts sigma* by 6%, more than any numerical control
- Matched anisotropy reproduces Karma-Rappel phase-field values at two of three rows
- Slow, linear width convergence leaves sigma*(W0->0) uncertain by 5-17%

# 1. Introduction

The free growth of a dendrite into an undercooled pure melt is the standard quantitative test of
solidification models. The Ivantsov solution fixes the product of tip radius $\rho$ and velocity $V$ through
the Péclet number $P=\rho V/2D$ at a given undercooling, and the remaining relation is set by capillarity and
its anisotropy: in solvability theory the selection constant $\sigma^*=2Dd_0/(\rho^2V)$ is a function of the
anisotropy strength [@Kessler1988AdvPhys; @BarbieriLanger1989PRA; @BenAmarBrener1993PRL].
Because $\sigma^*$ depends on a small anisotropy through a singular perturbation, it is sensitive to
everything that perturbs the interface at the scale of the tip, and a numerical method that reproduces it
in three dimensions has to resolve interface energy, interface kinetics and a long-range diffusion field at
the same time.

Early phase-field simulations reproduced dendritic shapes but not quantitative selection
[@Kobayashi1993PhysicaD; @Wheeler1993PhysicaD]. Phase-field models reached that standard in three dimensions
with the thin-interface formulation of Karma and Rappel [@KarmaRappel1996PRE; @KarmaRappel1998PRE], which made the interface width a numerical parameter
rather than a physical one and allowed the kinetic coefficient to be set to zero. Their 1996 letter
[@KarmaRappel1996PRL] (KR96 below) reported 3D tip selection at undercooling $\Delta=0.45$ for three cubic
anisotropies and compared it with numerical solvability theory in the axisymmetric approximation. Later work
reached lower undercoolings with adaptive meshes in two dimensions [@Provatas1998PRL] and multiscale
methods in three [@PlappKarma2000JCP], resolved the non-axisymmetric tip morphology [@KarmaLeePlapp2000PRE],
used anisotropies from atomistic simulation [@Bragard2002IntSci] and added convection [@Jeong2001PRE]; see
[@Boettinger2002ARMR] for a review. KR96 Table I remains the 3D reference with phase-field and solvability
values at the same conditions.

Parallel computers [@GeorgeWarren2002JCP] and then graphics processors made large 3D phase-field dendrite
simulations routine [@Yamanaka2011JCG;
@Shimokawabe2011SC; @Takaki2014ISIJ; @Sakane2017JCG], and open frameworks, cross-code comparisons and
community benchmarks now support verification of phase-field codes [@DeWitt2020npj; @Permann2020SoftwareX;
@Hu2027CPC; @Tian2026CMS; @Jokisaari2017CMS; @Jokisaari2018CMS; @Wheeler2019JORS]. Several GPU dendrite codes
run in single precision [@Aoki2011PNST; @Shimokawabe2011SC; @Takaki2014ISIJ]. For lattice Boltzmann solvers,
32-bit arithmetic has been shown to be as accurate as 64-bit in almost all cases [@Lehmann2022PRE], but we
have not found a comparable test for a quantitative phase-field selection result, where the quantity of
interest is set by small capillary and kinetic terms.

WebGPU, a W3C application programming interface for GPU compute and graphics in web browsers
[@W3CWebGPU2026], adds a different setting. Its shading language, WGSL, defines 32-bit and optional 16-bit
floating-point types but no 64-bit type [@W3CWGSL2026], and the same source runs on integrated laptop GPUs and
data-center accelerators from different vendors. Browser PDE solvers began with WebGL, in single precision
and for one- and two-dimensional problems [@Walker2023BMB]; WebGPU solvers have since been published for
nearshore waves and cardiac electrophysiology [@Lynett2026JWPCOE; @Rosales2025CinC]. A browser solver that
meets a quantitative 3D solidification benchmark would let anyone rerun that benchmark from a web page, but
it has to do so in single precision.

Here we test a WebGPU implementation of the thin-interface model for a pure substance, part of the open
Solidify code [@SolidifyNanoHUB], against KR96 Table I at all three anisotropies. We ask whether single
precision limits the result and, if not, what does. Every campaign was fixed in a protocol committed to
version control before it ran, together with written predictions where a run tested a hypothesis, and every
checkpoint was re-measured by an independent CPU replay. We find that (i) 32-bit arithmetic changes
$\sigma^*$ by at most 0.13%; (ii) the definition of the anisotropy strength matters most among the controlled
factors: KR96's $\varepsilon_4$ is grid-corrected, and a raw input of the same value is 3% weaker on our
grid, which lowers $\sigma^*$ by 6%; (iii) with the anisotropy matched, the solver reproduces KR96's
phase-field values at $\varepsilon_4=0.0123$ and 0.0171 within a 10% budget, while at 0.0265 it falls below
both references; and (iv) convergence in interface width is slow, with $Vd_0/D$ linear rather than
quadratic in the width, which leaves the sharp-interface limit uncertain by about as much as KR96's two
reference columns differ.
Section 2 describes the model, discretization, metrology and protocol, Section 3 the results and Section 4
the error budget and its interpretation.

# 2. Model and numerical method

## 2.1 Thin-interface model

We solve the symmetric thin-interface model of KR98 [@KarmaRappel1998PRE] for a pure substance with equal
thermal diffusivities in solid and liquid. With the phase field $\phi\in[-1,1]$ (solid at $+1$) and the
dimensionless temperature $u=(T-T_m)/(L/c_p)$,

$$\tau(\hat{\mathbf n})\,\partial_t\phi=\nabla\cdot\big[W^2(\hat{\mathbf n})\nabla\phi\big]
+\nabla\cdot\Big[W(\hat{\mathbf n})\,|\nabla\phi|\,(\mathbf I-\hat{\mathbf n}\hat{\mathbf n}^{\mathsf T})\,
\nabla_{\hat{\mathbf n}}W(\hat{\mathbf n})\Big]+\phi-\phi^3-\lambda\,(1-\phi^2)^2\,u, \tag{1}$$

$$\partial_t u=D\,\nabla^2u+\tfrac12\,\partial_t\phi, \tag{2}$$

where $\hat{\mathbf n}=\nabla\phi/|\nabla\phi|$ and the second term of Eq. (1) is the anisotropic part of the
variational derivative of the gradient energy. The interface width is $W(\hat{\mathbf n})=W_0\,a(\hat{\mathbf
n})$ with the cubic anisotropy

$$a(\hat{\mathbf n})=1+\varepsilon_4\big(4\textstyle\sum_i n_i^4-3\big), \tag{3}$$

so that $a=1+\varepsilon_4$ along $\langle100\rangle$ and $1-\varepsilon_4$ along $\langle110\rangle$. Lengths
are in units of $W_0$ and times in units of $\tau_0$. The capillary length and the diffusivity follow from
the thin-interface relations $d_0=a_1W_0/\lambda$ and $D=a_2\lambda W_0^2/\tau_0$, with $a_1=5\sqrt2/8\approx0.8839$
and $a_2=47/75\approx0.6267$, which make the interface kinetic coefficient vanish in the continuum limit when
$\tau(\hat{\mathbf n})=\tau_0a^2(\hat{\mathbf n})$ [@KarmaRappel1998PRE]. The code uses $D=0.6267\,\lambda$. The
melt starts at uniform $u=-\Delta$ with $\Delta=0.45$, and $\lambda$ (equivalently $W_0/d_0=\lambda/a_1$) is the
interface-width parameter varied in Section 3.2.

**Lattice-corrected relaxation time.** On a lattice the kinetic coefficient acquires a contribution of order
$(\Delta x/W_0)^2$. All runs reported here use a relaxation time that cancels the leading term for interfaces
normal to the principal axes,

$$\tau(\hat{\mathbf n})=\tau_0\,\frac{a_2\lambda}{D}\Big[a^2(\hat{\mathbf n})-\frac{1321}{9870}
\Big(\frac{\Delta x}{W_0}\Big)^2\Big], \tag{4}$$

where the prefactor $a_2\lambda/D=0.99995$ only absorbs the rounding of $a_2$. The coefficient $1321/9870$
follows from a modified-equation expansion of the stencil of Section 2.2 for a steadily moving planar front
to first order in velocity; it combines the change of the static profile ($1/20$) with the first-order
thermal and phase-profile corrections ($331/3948$). It contains no needle quantity. The expansion was
checked against independently computed one-dimensional travelling fronts along $\langle100\rangle$ and
$\langle110\rangle$ (99 cases, $\langle111\rangle$ held out), whose corrected residuals fall by a factor of
about 16 per halving of $\Delta x$. Two limits are known. A frozen GPU recovery test of planar fronts passed
its five velocity arms but failed its temperature criterion in a heat-pulse arm, and oblique planar fronts
show the angular $(\Delta x/W_0)^2$ residual that Eq. (4) does not cancel; its size is bounded at about 3.6%
of the principal coefficient, or roughly 0.2% in tip velocity. At $\lambda=4$, Eq. (4) raised the tip velocity
by 4.7% and $\sigma^*$ by 2.5% relative to $\tau=\tau_0a^2$.

## 2.2 Discretization and WebGPU implementation

Both the scalar Laplacian in Eq. (2) and the isotropic part of Eq. (1) use the 19-point stencil

$$L_{19}f_i=\frac{1}{6\Delta x^2}\Big[2\sum_\text{6 faces}f+\sum_\text{12 edges}f-24f_i\Big]
=\nabla^2f+\frac{\Delta x^2}{12}\nabla^4f+O(\Delta x^4), \tag{5}$$

whose leading truncation error is isotropic [@PatraKarttunen2006NMPDE; @Bragard2002IntSci]. The
gradient-energy term is evaluated as
$wL_{19}\phi+D_cw\cdot D_c\phi+D_c\cdot\mathbf A$, with $w=W^2$, $\mathbf A$ the anisotropic flux of Eq. (1) and
$D_c$ central differences; this is a consistent second-order approximation of Eq. (1), not a discretely
variational one. Both fields advance by forward Euler with

$$\Delta t=\min\Big[\frac{\Delta x^2}{12D},\;0.02\,(1-3\varepsilon_4)^2\min\big(1,(\Delta x/0.8)^2\big)\Big], \tag{6}$$

which gives $\Delta t=0.0180$ for $\varepsilon_4=0.0171$, $\Delta x/W_0=0.8$, $\lambda=2.8$. The second term is a
conservative bound on the phase-field update; halving $\Delta t$ is one of the controls (Table 3). The
calibrated runs keep the time step of the corresponding raw-anisotropy run.

Each step is three WGSL compute passes (workgroup $4\times4\times4$): the first stores $W^2$ and $\mathbf A$ in
a four-component flux texture, the second advances $\phi$ and stores $\phi^{n+1}$ and $\phi^{n+1}-\phi^n$,
and the third advances $u$ with that increment as the latent source and swaps the state buffers. Every
field and every operation is 32-bit floating point; the time and the tip metrology on the host are 64-bit.
Including grain bookkeeping used by the application, the solver stores 61 bytes per voxel. To keep each
texture under the 4 GiB single-allocation limit of the Vulkan backend, the largest grids split the flux
texture into two two-component textures; before every campaign the run harness compared the field bytes of
this driver with the application's own solver at steps 1, 17 and 64 of a $32^3$ test and required all nine
comparisons to be identical. All runs used Chrome's WebGPU implementation: on NVIDIA L40S cloud machines
(Linux, Vulkan backend, virtual display), on an NVIDIA RTX 5090, and on the Intel Arc 140V integrated GPU of
a Windows laptop.

## 2.3 Geometry and boundary conditions

The crystal grows from a spherical seed, $\phi=-\tanh[(r-R_0)/\sqrt2W_0]$, centred on a corner of the box with
its cubic axes along the box edges. All six faces are zero-flux mirror planes (even reflection of $\phi$, $u$
and $w$; odd reflection of the normal component of $\mathbf A$), so the box holds one octant of a crystal
with three mirror planes and the $\langle001\rangle$ tip grows along the $x=y=0$ edge. The box is thermally
insulated. The base box is $270\times270\times612$ cells at $\lambda=4$, $\Delta x/W_0=0.8$, and $R_0=8W_0$.
Other runs scale the box and seed with $(4/\lambda)\,s\,(0.8/\Delta x)$ and the physical run time with
$(4/\lambda)^3s^2$, where $s=(Vd_0/D)_{0.0171}/(Vd_0/D)_{\varepsilon_4}$ from KR96's solvability values, so
that every run has the same size in diffusion lengths; $s=1$, 0.700 and 1.369 for $\varepsilon_4=0.0171$,
0.0265 and 0.0123. The $\lambda=2.8$ base arm is $386\times386\times875$ cells.

The other two $\langle100\rangle$ arms of the octant grow along the $x$ and $y$ edges and reach the side faces
before the measurement window (the side faces are 309 $W_0$ from the axis in the $\lambda=2.8$ base arm,
where the tip ends at 414 $W_0$). Their effect on the measured tip is bounded by the domain control, which
enlarges the box by 11% in every direction and changes the tip quantities by less than $10^{-6}$ (Table 3),
and by temperature read-backs on the three far faces within two tip radii of the tip height, which deviate
from the initial value by at most 0.14% of $\Delta$.

## 2.4 Tip metrology and acceptance

Each run writes 61 checkpoints at fixed physical times, anchored at the end of the run. The run length and
cadence were derived once from KR96's phase-field velocity at $\varepsilon_4=0.0171$, frozen as constants
before any of the runs reported here, and do not depend on their outcome. At each checkpoint the harness
reads back a $40\times40$-column patch next to the dendrite axis and locates the $\phi=0$ crossing in every
column with a quintic interpolant in $\tanh^{-1}\phi$, which is exact for the equilibrium profile. A surface
$z=z_0+c_0+b_xx^2+b_yy^2+O(x^4)$ (even terms only, by symmetry) is fitted in windows of 0.25-0.5 tip radii and
extrapolated to zero window size in (window)$^4$. The tip radius is the reciprocal mean curvature at the apex,
$\rho=-1/(b_x+b_y)$. Synthetic surfaces with known radii, sampled like the simulation, bound the bias of this
estimator near the measured apex profile at 0.4% in $\rho$ and 0.8% in $\sigma^*$. KR96 measured $\rho$ on the
$\phi=0$ surface with the interpolation scheme of KR98 [@KarmaLeePlapp2000PRE]; we did not reimplement that
scheme, so the two radius estimators are not guaranteed to agree.

The last ten checkpoints form three overlapping four-sample windows. In each window the velocity is the
least-squares slope of the tip position and the radius is the window mean; $V$ and $\rho$ are the means over
the windows, and $P=\rho V/2D$, $\sigma^*=2Dd_0/(\rho^2V)$. The measurement uncertainty $u_X$ of $P$ and
$\sigma^*$ propagates the larger of the fit errors and the window-to-window spread of $V$ and $\rho$, and the
drift $d_X$ propagates the larger of their trend and range over the ten samples. A run is valid when it is
stationary (windows agree within errors, $\rho$ and $V$ drift by at most 2.5%), resolved ($u_P,u_\sigma<10\%$),
its tip is at least 8 diffusion lengths $D/V$ from the far and side faces, and the tip has travelled at least
6 diffusion lengths. The acceptance budget against a reference value $X_\mathrm{ref}$ is

$$B_X=\big(1+|X/X_\mathrm{ref}-1|\big)(1+u_X)(1+d_X)-1\le10\%,\qquad X\in\{P,\sigma^*\}. \tag{7}$$

$u_X$ is an estimate, not a certified bound: in a synthetic stress test with a smooth non-polynomial apex the
estimator reported 7.9% uncertainty for a 15.3% error. An independent NumPy reimplementation of the surface
fit and window kinematics recomputes $\rho$, $V$, $P$ and $\sigma^*$ from the crossing heights stored in every
checkpoint and agrees with the GPU harness to about $4\times10^{-15}$.

## 2.5 Effective anisotropy

KR96 define $\varepsilon_4$ as the value in $\gamma(\hat{\mathbf n})$ whose equilibrium (Wulff) shape matches
the equilibrium shape of their phase-field model on their grid. We measure the same quantity for our
discretization. A spherical crystal of radius $R$ relaxes at uniform imposed temperature, which a feedback
loop adjusts only to hold its volume fixed, until the shape is stationary. The support distances $h_{100}$
and $h_{110}$ along $\langle100\rangle$ and $\langle110\rangle$ are obtained from local surface fits to the
$\phi=0$ crossings, and

$$\varepsilon_\mathrm{eff}=\frac{h_{100}-h_{110}}{h_{100}+h_{110}}, \tag{8}$$

which is exact for a Wulff shape of the anisotropy (3); an analytic Wulff control is recovered to
$10^{-5}$, and the $\langle111\rangle$ support is held out as a check. The measurements use $\lambda=4$ and three
geometries ($\Delta x/W_0=0.8$ with $R=20W_0$ and $30W_0$, and $\Delta x/W_0=0.6$ with $R=20W_0$). Because
$\varepsilon_\mathrm{eff}/\varepsilon_4$ is nearly constant at fixed grid (Section 3.3), we set the input for a
target $\varepsilon_\mathrm{KR}$ in one step, $\varepsilon_4=\varepsilon_\mathrm{KR}^2/\varepsilon_\mathrm{eff}
(\varepsilon_\mathrm{KR})$, on the grid of the run, and re-measure the result. In units of $W_0$ the equilibrium
shape does not depend on $\lambda$, which only rescales the temperature that holds it, so the calibration at
$\lambda=4$ applies at $\lambda=2.8$.

## 2.6 Double-precision cross-check

WGSL has no 64-bit type, so the precision test uses an independent transliteration of the three passes, the
initial condition and the read-back into Python, run either as NumPy array code or as fused CUDA kernels
compiled with fused multiply-add disabled and IEEE division and square root, in float32 or float64. Every
input (uniforms, literal constants and the initial state) is first rounded to float32, so a float64 run
solves exactly the discrete problem of the GPU run and differs only in arithmetic. In float32 the port
reproduces fields captured from the WGSL solver to $6\times10^{-7}$ in $(1+\phi)/2$ over 16,384 steps, and its
checkpoints are measured by the same replay as the WebGPU runs.

## 2.7 Protocol

Each campaign was described in a protocol committed to version control before it ran, which fixed the arms,
grids, schedules, gates, reference values and acceptance rule; where a run tested a hypothesis, the protocol
also recorded a numerical prediction. Raw checkpoint archives are kept with SHA-256 hashes. We report the
order in which the method reached its present form, because each step followed a miss of the KR96 reference.
At $\lambda=4$ with $\tau=\tau_0a^2$, the solver gave $\sigma^*=0.050$-0.053 against KR96's phase-field 0.063
(raw $\varepsilon_4=0.0171$). The 19-point stencil had been chosen from equilibrium-shape measurements, not
from a needle, and the lattice correction (4) was derived analytically and committed before any needle run
used it; the solver source has not changed since. The width ladder was then extended in steps
($\lambda=5.0$-4.0, then 4.0-2.8), and $\lambda=2.8$ for the controls was chosen after the narrow ladder had
run. The calibrated-anisotropy runs, which give Table 5, were the first runs at KR96's definition of
$\varepsilon_4$. Individual runs were therefore pre-registered, but the sequence of hypotheses was chosen
adaptively.

Table 1. Runs reported in this paper. A0: controls at $\lambda=4$ (Section 2.7); W: width ladder; B: base and controls at $\lambda=2.8$; R: raw-anisotropy rows at $\varepsilon_4=0.0265$; C: calibrated-anisotropy rows. $\varepsilon_\mathrm{eff}$ is the equilibrium-measured anisotropy of the input on the run's grid ($R=20W_0$). All runs use $\Delta=0.45$ and the relaxation time (4); wall times include checkpoint read-back and are not recorded for the RTX 5090 runs.

| run | GPU | input $\varepsilon_4$ | $\varepsilon_\mathrm{eff}$ | $\lambda$ | $\Delta x/W_0$ | grid | $\Delta t/\tau_0$ | steps | wall (min) |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|
| A0 base | RTX 5090 | 0.0171 | 0.01660 | 4.00 | 0.8 | 270×270×612 | 0.01800 | 108,282 | - |
| A0 domain | RTX 5090 | 0.0171 | 0.01660 | 4.00 | 0.8 | 300×300×680 | 0.01800 | 108,282 | - |
| A0 grid | RTX 5090 | 0.0171 | 0.01681 | 4.00 | 0.6 | 360×360×816 | 0.01013 | 192,501 | - |
| A0 dt/2 | RTX 5090 | 0.0171 | 0.01660 | 4.00 | 0.8 | 270×270×612 | 0.00900 | 216,564 | - |
| A0 width | RTX 5090 | 0.0171 | 0.01660 | 3.60 | 0.8 | 300×300×680 | 0.01800 | 148,535 | - |
| W 5.0 | Arc 140V | 0.0171 | 0.01660 | 5.00 | 0.8 | 216×216×490 | 0.01702 | 58,634 | 24 |
| W 4.4 | Arc 140V | 0.0171 | 0.01660 | 4.40 | 0.8 | 246×246×557 | 0.01800 | 81,354 | 50 |
| W 4.0 | Arc 140V | 0.0171 | 0.01660 | 4.00 | 0.8 | 270×270×612 | 0.01800 | 108,282 | 99 |
| W 4.0 | L40S | 0.0171 | 0.01660 | 4.00 | 0.8 | 270×270×612 | 0.01800 | 108,282 | 10 |
| W 3.2 | L40S | 0.0171 | 0.01660 | 3.20 | 0.8 | 338×338×765 | 0.01800 | 211,488 | 44 |
| B base | L40S | 0.0171 | 0.01660 | 2.80 | 0.8 | 386×386×875 | 0.01800 | 315,690 | 95 |
| B domain | L40S | 0.0171 | 0.01660 | 2.80 | 0.8 | 429×429×972 | 0.01800 | 315,690 | 142 |
| B width | L40S | 0.0171 | 0.01660 | 2.52 | 0.8 | 429×429×972 | 0.01800 | 433,045 | 195 |
| B dt/2 | L40S | 0.0171 | 0.01660 | 2.80 | 0.8 | 386×386×875 | 0.00900 | 631,380 | 154 |
| B grid | L40S | 0.0171 | 0.01681 | 2.80 | 0.6 | 515×515×1166 | 0.01013 | 561,226 | 471 |
| C 0.0171 | L40S | 0.017613 | 0.01710 | 2.80 | 0.8 | 386×386×875 | 0.01800 | 315,690 | 79 |
| R 0.0265 base | L40S | 0.0265 | 0.02561 | 2.80 | 0.8 | 271×271×613 | 0.01695 | 164,491 | 15 |
| R 0.0265 width | L40S | 0.0265 | 0.02561 | 2.52 | 0.8 | 301×301×681 | 0.01695 | 225,639 | 28 |
| R 0.0265 grid | L40S | 0.0265 | 0.02605 | 2.80 | 0.6 | 361×361×817 | 0.00953 | 292,429 | 59 |
| C 0.0265 | L40S | 0.027416 | 0.02649 | 2.80 | 0.8 | 271×271×613 | 0.01695 | 164,491 | 15 |
| C 0.0123 | L40S | 0.0127554 | 0.01231 | 2.80 | 0.8 | 529×529×1198 | 0.01855 | 574,322 | 530 |
| C 0.0265 grid | L40S | 0.0269561 | 0.02650 | 2.80 | 0.6 | 361×361×817 | 0.00953 | 292,429 | 59 |


# 3. Results

All quantities below are terminal values from the fixed physical schedule of each run, measured by the GPU
harness and recomputed from the stored interface crossings by the independent replay of Section 2.4. Table 1
lists the runs. The tip Péclet number is $P=\rho V/2D$ and the selection constant is
$\sigma^*=2Dd_0/(\rho^2V)$, so that $Vd_0/D=2P^2\sigma^*$ and $\rho/d_0=1/(P\sigma^*)$. "Error" means the
relative difference from a KR96 Table I entry, and "budget" means $(1+|e|)(1+u)(1+d)-1$ with the measurement
uncertainty $u$ and drift $d$ of Section 2.4; a run is accepted against a reference when the budget is at most
10% in both $P$ and $\sigma^*$.

Every run grows a steady needle crystal. After an overshoot, $\sigma^*$ stays within 3% of its terminal
value from about five diffusion times $D/V^2$ onward and $P$ from about four (Fig. 2); the late-time
fluctuations are largest at $\varepsilon_4=0.0123$, where $\sigma^*$ wanders by up to 2% until the end. Each run lasts about 15
diffusion times, and its stationarity windows cover the last 2.2-2.4. Near the tip the crystal is close to a paraboloid of revolution of
the measured radius; it falls away from it beyond about one tip radius from the axis, and more steeply along
$\langle110\rangle$ than along $\langle100\rangle$, as expected for a fourfold anisotropic tip (Fig. 1).

![Tip shape at the end of two calibrated runs ($\lambda=2.8$). (a) Depth below the tip, $(z_\mathrm{tip}-z)/\rho$,
over the quarter cross-section next to the dendrite axis for $\varepsilon_4=0.0171$ ($\Delta x/W_0=0.8$;
solid), compared with a paraboloid of revolution of the same tip radius (dashed). (b) Profiles along
$\langle100\rangle$ (solid) and $\langle110\rangle$ (dashed) for $\varepsilon_4=0.0171$ and 0.0265
($\Delta x/W_0=0.6$), with the paraboloid (dotted). Heights are the interpolated interface crossings stored in
the archived terminal checkpoints, and $\rho$ is the local tip radius measured from the same
state.](figures/fig1_tip_shape.png){#fig:tip}

![Approach to the steady state in the three calibrated runs: (a) $\sigma^*$ and (b) $P$, each divided by its
terminal value, against time in units of the terminal diffusion time $D/V^2$. The gray band is
$\pm1\%$.](figures/fig2_transient.png){#fig:transient}

## 3.1 Arithmetic precision and portability

Table 2 compares three implementations of the same discrete update at two operating points: the WGSL
solver run through WebGPU, and an independent array transliteration of it run in float32 and in float64
(Section 2.6). All three integrate the same number of steps on the same grid from the same float32-rounded
inputs, so the float64-float32 difference isolates arithmetic precision.

Table 2. Terminal state of the $\lambda=4$ anchor (270 x 270 x 612, 108,282 steps) and the $\lambda=2.8$ base
arm (386 x 386 x 875, 315,690 steps) at raw $\varepsilon_4=0.0171$, $\Delta x/W_0=0.8$.

| arm | quantity | WebGPU (fp32) | port fp32 | port fp64 | fp64 vs fp32 |
|---|---|---:|---:|---:|---:|
| $\lambda=4$ | $\sigma^*$ | 0.052696 | 0.052713 | 0.052687 | -0.050% |
| | $P$ | 0.33029 | 0.33020 | 0.33031 | +0.034% |
| | $Vd_0/D$ | 0.011498 | 0.011495 | 0.011497 | +0.018% |
| $\lambda=2.8$ | $\sigma^*$ | 0.056977 | 0.056949 | 0.057023 | +0.130% |
| | $P$ | 0.32317 | 0.32318 | 0.32304 | -0.044% |
| | $Vd_0/D$ | 0.011901 | 0.011896 | 0.011901 | +0.042% |

Double precision moves $\sigma^*$ by 0.13% at $\lambda=2.8$ and every quantity by at most 0.05% at
$\lambda=4$. The float32 port and the WebGPU run differ by at most 0.05% at both points, so the
transliteration does not introduce a difference of its own. The precision effect is 36 times smaller than
the $\sigma^*$ measurement uncertainty of the same run (4.7%) and 77 times smaller than the 10% acceptance
budget. It grows with step count (0.05% after 108,282 steps, 0.13% after 315,690), which is consistent with
accumulated rounding of small far-field increments, but at these run lengths it is negligible.

The same WGSL source also gives the same answer on different hardware. The $\lambda=4$ anchor run on an
Intel Arc 140V integrated laptop GPU and on an NVIDIA L40S agrees to 0.024% in $V$ and 0.033% in
$\sigma^*$; on an NVIDIA RTX 5090 and the L40S it agrees to $8\times10^{-7}$ relative in every quantity.

## 3.2 Numerical controls and the interface-width ladder

At raw $\varepsilon_4=0.0171$ and $\lambda=2.8$ each control changes one parameter from the base arm
(Table 3). Enlarging the box by 11% in every direction changes nothing measurable ($<10^{-6}$), halving
the time step changes $\sigma^*$ by 0.025%, a 10% narrower interface ($\lambda=2.52$) raises it by 1.7%, and
refining the grid to $\Delta x/W_0=0.6$ lowers it by 3.2%. All four controls are inside the 10% rule fixed
before the runs. The same four controls at $\lambda=4$ were also inside the rule (largest change 3.5%), yet
the $\lambda=4$ base arm sits 16% below KR96's phase-field $\sigma^*$ and 9% below the solvability value.
Small pairwise changes therefore do not show that a run has reached its converged limit, which is why the
interface width was varied over a wider range.

Table 3. Relative change from the base arm, raw $\varepsilon_4=0.0171$.

| control | $\lambda=4$: $P$ | $\lambda=4$: $\sigma^*$ | $\lambda=2.8$: $P$ | $\lambda=2.8$: $\sigma^*$ | $\lambda=2.8$: $Vd_0/D$ |
|---|---:|---:|---:|---:|---:|
| domain enlarged | $<10^{-5}$ | $<10^{-5}$ | $<10^{-6}$ | $<10^{-6}$ | $<10^{-6}$ |
| time step halved | -0.04% | +0.08% | +0.03% | -0.03% | +0.04% |
| narrower interface ($\lambda\times0.9$) | -1.1% | +3.5% | -0.4% | +1.7% | +0.9% |
| finer grid ($\Delta x/W_0=0.6$) | +1.2% | -3.0% | +1.4% | -3.2% | -0.4% |

Figure 3 shows the seven-point width ladder, $\lambda=5.0$ to 2.52 at $\Delta x/W_0=0.8$, which halves
$W_0/d_0$ and raises the tip resolution from 13 to 24 cells per tip radius. Over this range $\sigma^*$
rises by 19%, from 0.0487 to 0.0579, $P$ falls from 0.338 to 0.322 and $Vd_0/D$ rises from 0.01113 to
0.01200. Every quantity changes monotonically and smoothly; the scatter about a low-order fit is 0.06-0.4%,
an order of magnitude below the per-run measurement uncertainty, which is therefore a conservative,
systematic bound rather than random noise. $Vd_0/D$ is linear in $\lambda$ (relative rms 0.06%) and is fitted
three times worse by a function of $\lambda^2$ (0.20%); for $\sigma^*$ and $P$ the two forms fit about
equally well. The extrapolated $W_0\to0$ value of $\sigma^*$ depends on which form is assumed: 0.0609
(+5.1% above the $\lambda=2.52$ value) for a $\lambda^2$ dependence, 0.0675 (+16.6%) for a linear one, and
0.0641 (+10.6%) for a full quadratic. The ladder does not determine the sharp-interface limit of $\sigma^*$
to better than about 5-17%. Section 4.2 discusses why the dependence is linear.

![Interface-width ladder at raw $\varepsilon_4=0.0171$, $\Delta x/W_0=0.8$: (a) $\sigma^*$, (b) $P$ and (c) $Vd_0/D$
against $\lambda$, with least-squares fits linear in $\lambda$ (solid) and in $\lambda^2$ (dashed), extrapolated to
$\lambda=0$. The diamond is the calibrated run at $\lambda=2.8$. Horizontal lines: KR96 phase-field (dash-dot)
and solvability (dotted) values at $\varepsilon_4=0.0171$. The $\lambda=5.0$ and 4.4 runs used an Intel Arc
140V, $\lambda=3.6$ an RTX 5090 and the others an L40S.](figures/fig3_width_ladder.png){#fig:ladder}

## 3.3 Effective anisotropy

KR96 define $\varepsilon_4$ as the anisotropy that, in the surface energy $\gamma(\mathbf{n})$, reproduces
the equilibrium shape of their phase-field model on their grid, that is, the grid-corrected strength. An
input (raw) $\varepsilon_4$ is not that quantity, because the lattice adds anisotropy of its own
[@Mullis2006CMS]. Figure 4 and
Table 4 give the effective anisotropy $\varepsilon_\mathrm{eff}$ that our discretization produces, measured
from equilibrium shapes as described in Section 2.5. At $\Delta x/W_0=0.8$ the effective strength is 2.9-3.6%
below the input value, and at 0.6 it is 1.7-1.8% below; a larger shape ($R=30W_0$ instead of $20W_0$)
changes $\varepsilon_\mathrm{eff}$ by at most 0.4%. With the 7-point Laplacian the same input of 0.0171 had given
$\varepsilon_\mathrm{eff}=0.01357$, 21% low, which is why the quantitative solver uses the 19-point stencil.
Bragard et al. [@Bragard2002IntSci] used an isotropic 18-neighbour Laplacian to make the lattice corrections
to the anisotropy vanish at order $\Delta x^2$; here the remaining deficit falls by a factor of 1.7-2.0 from
$\Delta x/W_0=0.8$ to 0.6, close to the factor 1.78 expected for an $O(\Delta x^2)$ error, so a second-order
lattice correction remains, most likely from the central-difference anisotropic terms of Section 2.2. Grid
shifts of this kind are common: Plapp and Karma report an input anisotropy of 0.0284 acting as 0.025 at
$\Delta x/W_0=0.8$ [@PlappKarma2000JCP]. The ratio $\varepsilon_\mathrm{eff}/\varepsilon_4$ is nearly
independent of $\varepsilon_4$ at fixed grid, so one proportional step, raw $=\varepsilon_\mathrm{KR}^2/
\varepsilon_\mathrm{eff}(\varepsilon_\mathrm{KR})$, sets the input that reproduces a target strength. The calibrated
inputs measured $\varepsilon_\mathrm{eff}=0.0123136$, 0.0171027 and 0.0264916 at $\Delta x/W_0=0.8$, and
0.0264996 at 0.6 (targets 0.0123, 0.0171 and 0.0265; largest miss 0.11%).

![Effective anisotropy measured from equilibrium shapes, as a fraction of the input value, for two grid
spacings and two shape radii ($\lambda=4$). Fit errors are smaller than the
markers.](figures/fig4_effective_anisotropy.png){#fig:eff}

Table 4. Effective anisotropy from equilibrium shapes ($\lambda=4$).

| raw $\varepsilon_4$ | $\Delta x=0.8$, $R=20$ | $\Delta x=0.6$, $R=20$ | $\Delta x=0.8$, $R=30$ |
|---:|---:|---:|---:|
| 0.0123 | 0.011861 (0.964) | 0.012078 (0.982) | 0.011826 (0.961) |
| 0.0171 | 0.016602 (0.971) | 0.016805 (0.983) | 0.016578 (0.969) |
| 0.0265 | 0.025615 (0.967) | 0.026052 (0.983) | 0.025697 (0.970) |
| 0.012755 (cal.) | 0.012314 | 0.012527 | 0.012266 |
| 0.017613 (cal.) | 0.017103 | 0.017311 | 0.017093 |
| 0.027416 (cal.) | 0.026492 | 0.026951 | 0.026579 |
| 0.026956 (cal., $\Delta x=0.6$) | 0.026051 | 0.026500 | 0.026135 |

Matching the definition matters more than any numerical control in Section 3.2. At $\varepsilon_4=0.0171$,
$\lambda=2.8$, replacing the raw input (effective 0.016602) by the calibrated one (effective 0.017103, +3.0%)
raises $\sigma^*$ by 6.4%, lowers $P$ by 1.8% and raises $Vd_0/D$ by 2.6%. Before that run we recorded a
prediction from KR96's own solvability slopes, $d\ln\sigma^*/d\ln\varepsilon_4=1.881$ and
$d\ln P/d\ln\varepsilon_4=-0.499$ (Section 2.7); the measured values differ from it by +0.67% in $\sigma^*$
and -0.36% in $P$. The definition effect is therefore the expected response to a 3% change in anisotropy
strength. The same predictions, made before the two calibrated $\varepsilon_4=0.0265$ runs, held to +1.2%
and +0.23% in $\sigma^*$.

## 3.4 Comparison with KR96 at three anisotropies

Table 5 and Fig. 5 compare the calibrated runs with KR96 Table I. All runs pass the validity gates of
Section 2.4: they are stationary and resolved, the box faces are at least 10.9 diffusion lengths ($D/V$)
ahead of and beside the tip, and the tip has travelled at least 15 diffusion lengths.

Table 5. Calibrated runs ($\lambda=2.8$) against KR96 Table I ($\Delta=0.45$). Errors are relative to the
KR96 entry; budgets are $(1+|e|)(1+u)(1+d)-1$; accepted means both budgets $\le 10\%$.

| $\varepsilon_4$ | $\Delta x/W_0$ | $\rho/\Delta x$ | $P$ | $\sigma^*$ | vs PF: $e_P$, $e_\sigma$ | PF budget $P$ / $\sigma^*$ | vs solv.: $e_P$, $e_\sigma$ | solv. budget $P$ / $\sigma^*$ |
|---|---:|---:|---:|---:|---|---|---|---|
| 0.0123 | 0.8 | 30.8 | 0.3581 | 0.03579 | -0.5%, -0.6% | 3.7% / 7.2% (accepted) | -2.4%, +8.8% | 5.7% / 15.9% |
| 0.0171 | 0.8 | 20.5 | 0.3173 | 0.06063 | +1.7%, -3.8% | 4.2% / 9.0% (accepted) | -2.1%, +4.9% | 4.6% / 10.2% |
| 0.0265 | 0.8 | 11.2 | 0.2496 | 0.14127 | +5.8%, -11.7% | 12.6% / 27.1% | +1.0%, -0.5% | 7.6% / 14.4% |
| 0.0265 | 0.6 | 15.4 | 0.2555 | 0.13374 | +8.3%, -16.4% | 11.6% / 23.7% | +3.4%, -5.8% | 6.6% / 12.5% |

At the two weaker anisotropies the solver reproduces KR96's phase-field values inside the budget:
$\sigma^*$ is 0.6% and 3.8% below them and $P$ within 1.7%. Against the solvability values the same runs
are 8.8% and 4.9% high in $\sigma^*$; the 0.0171 run misses the solvability budget by 0.16 percentage
points, mostly because of its 4.7% $\sigma^*$ measurement uncertainty. KR96's own phase-field entries lie
9.4% and 9.0% above solvability at these anisotropies, so both phase-field results sit on the same side of
the solvability values.

At $\varepsilon_4=0.0265$ the comparison is not accepted against either reference. At $\Delta x/W_0=0.8$ the
tip radius is 11 cells and the $\sigma^*$ uncertainty (9.3%) and drift (4.1%) alone use more than the budget,
although $\sigma^*$ lies 0.5% from solvability. Refining to $\Delta x/W_0=0.6$ (15 cells, input re-calibrated
for that grid) cuts the uncertainty to 6.0% and the drift to 0.25%, and lowers $\sigma^*$ by 5.3% to 0.1337,
5.8% below solvability and 16.4% below KR96's phase-field value. This change passes the 10% grid rule, but
it shows that the close agreement at the coarser grid was partly a grid effect. With increasing anisotropy
our $\sigma^*$ moves from KR96's phase-field values toward, and at 0.0265 below, the solvability values
(Fig. 5).

![(a) $\sigma^*$ and (b) $P$ against the effective anisotropy (KR96's definition) for the $\lambda=2.8$ runs,
with KR96's phase-field (squares) and numerical-solvability (circles) values. Open markers: raw input,
plotted at the effective anisotropy it measures on its own grid; filled diamonds: calibrated input. Error bars
are the measurement uncertainty $u$.](figures/fig5_kr96_rows.png){#fig:kr96}

The tip shape gives a second comparison that does not go through $\rho$ or $V$. KR96 decomposed the tip as
$r^2(\varphi,z)=\sum_nA_n(z)\cos4n\varphi$, with $r$ and $z$ in units of $\rho$ and the tip at $z=0$, fitted the
four-fold amplitude as $A_1(z)=A|z|^\alpha$ and listed $\alpha$ and $A^{-1}$ in Table I. The same decomposition
applied to our archived crossing heights over $0.75\le|z|/\rho\le2.5$ gives $\alpha=1.655$ and $A^{-1}=10.35$ at
$\varepsilon_4=0.0171$ (KR96: 1.68 and 10.1), and $\alpha=1.603$ and 1.620 with $A^{-1}=8.08$ and 8.53 at 0.0265
for $\Delta x/W_0=0.8$ and 0.6 (KR96: 1.62 and 7.8). This comparison was not part of the acceptance protocol.
At $\varepsilon_4=0.0123$ the read-back patch, 1.3 tip radii wide, does not reach the fit range.

## 3.5 Raw-anisotropy runs and an accidental agreement

Run at raw $\varepsilon_4=0.0171$, the $\lambda=2.8$ base arm lies 1.4% below the solvability $\sigma^*$
and the $\lambda=2.52$ arm 0.23% above it, and all five $\lambda=2.8$ arms pass the solvability budget
(largest 9.2%). Read alone, these numbers suggest that the solver converges to solvability theory rather
than to KR96's phase-field results. Sections 3.2 and 3.3 show why that reading is wrong: the raw input is
2.9% weaker than KR96's anisotropy, which lowers $\sigma^*$ by about 6%, and the finite width lowers it by
a further, poorly determined amount. The two errors carry the same sign, and together they happen to bring
the raw-anisotropy runs to the solvability value. We reported the raw-anisotropy agreement in an earlier
public validation note; the corrected comparison is Table 5.

# 4. Discussion

## 4.1 What limits the accuracy

Figure 6 ranks every effect on $\sigma^*$ that we measured at $\varepsilon_4=0.0171$, $\lambda=2.8$.
Floating-point precision (0.13%) and hardware (0.03%) are the smallest entries after the box size and time
step. The interface width and grid controls are 1.7% and 3.2%, and the anisotropy definition is 6.4%. The
largest and least certain term is the extrapolation of the width ladder to $W_0\to0$, 5-17% depending on the
assumed form. A single-precision solver is therefore adequate for this benchmark by more than an order of
magnitude.

![Measured changes of $\sigma^*$ at $\varepsilon_4=0.0171$, $\lambda=2.8$, by factor (log scale). The hatched bar
is the range of $W_0\to0$ extrapolations of the width ladder (Fig. 3a). Vertical lines: the 10% acceptance
budget and the separation between KR96's phase-field and solvability values.](figures/fig6_error_budget.png){#fig:budget}

The quantities that decide whether a 3D tip-selection result agrees with a reference at the 5%
level are the definition of the anisotropy strength and the slow width convergence, and both apply equally
to a double-precision code.

## 4.2 Origin of the linear width dependence

At a fixed physical state, the interface Péclet number $p=W_0V/D=(W_0/d_0)(Vd_0/D)$ and the dimensionless
tip curvature $W_0/\rho=(W_0/d_0)P\sigma^*$ are both proportional to $\lambda$. The thin-interface analysis
removes the interface kinetic coefficient at first order in $p$ [@KarmaRappel1998PRE; @Echebarria2004PRE]:
$\beta=a_1[\tau_0/(\lambda W_0)-a_2W_0/D]$ vanishes for $\tau_0=a_2\lambda W_0^2/D$ [@Karma2001PRL]. Discretization
errors of a second-order scheme scale as $(\Delta x/\rho)^2$ and $(\Delta xV/D)^2$, that is as $\lambda^2$ at fixed
$\Delta x/W_0$. A term linear in $\lambda$ therefore indicates a first-order correction that is not cancelled. We
see two candidates and cannot separate them with the present data.

The first is a residual kinetic coefficient. If the discrete scheme realizes the relaxation time with a small
relative error $\delta$, then $\beta=a_1a_2\delta W_0/D$, and the ratio of kinetic to capillary undercooling at
the tip is

$$\frac{\beta V}{d_0/\rho}=a_1a_2\,\delta\,\frac{W_0V\rho}{Dd_0}=2a_2\,\delta\,\lambda P, \tag{9}$$

which is linear in $\lambda$ at fixed $P$; a positive $\delta$ slows the tip more at larger $\lambda$, as in
Fig. 3c. Eq. (4) cancels the $O(\Delta x^2)$ kinetic error only for principal-plane fronts, and neither its
angular remainder, nor the higher-order terms at $\Delta x/W_0=0.8$, nor the kinetics of curved fronts have been
measured on the tip. The size of the effect is a difficulty for this explanation, however. Eq. (4) as a whole
changed $V$ by 4.7% at $\lambda=4$, whereas the fits of Fig. 3c put $V$ at $\lambda=4$ 6-11% below its
$\lambda\to0$ value, so the uncancelled part would have to be larger than the correction that was applied.

The second candidate is a curvature correction of order $W_0/\rho$. Equilibrium shapes speak against a large
static contribution: from $R=20W_0$ to $30W_0$ the effective anisotropy changes by at most 0.4% and the
effective capillary length by less than 0.1%. Those shapes are less curved than any tip in the ladder
($W_0/\rho=0.053$-0.093), so the test is indirect, and a dynamic curvature effect is not tested at all.

It is also possible that the dependence turns over toward $\lambda^2$ at widths narrower than we could
afford, in which case the quadratic extrapolation in Fig. 3 is the better estimate. In any case, narrowing the
interface at fixed $\Delta x/W_0$ converges slowly here, and measuring the discrete kinetics on curved and oblique
moving fronts is the most direct next test.

## 4.3 Phase-field versus solvability references

The two KR96 columns are not equivalent references. KR96's "numerical solvability" values come from the
steady-state growth equations in the standard axisymmetric approximation, which neglects the four-fold
variation of the tip shape and surface energy around the growth axis. KR96 found their phase-field
$\sigma^*$ systematically above these values, increasingly so at larger anisotropy, and attributed the
difference most likely to the axisymmetric approximation rather than to solvability theory itself
[@KarmaRappel1996PRL]. The phase-field column is therefore KR96's best estimate of three-dimensional tip
selection, and the solvability column is an approximation to the same quantity. The two differ by 9-13% in
$\sigma^*$ at the three anisotropies, and KR96 state that their phase-field values are independent of $d_0/W_0$
to within 10%.

Our residual uncertainty is of the same size. If the grid effect (-3.2%) and the width extrapolation (+5% to
+17%) measured at raw anisotropy carry over to the calibrated run, applying both moves $\sigma^*$ at
$\varepsilon_4=0.0171$ from 0.0606 to between about 0.062 and 0.068, which contains KR96's phase-field value
(0.063) and lies 7-18% above the solvability value (0.0578). That estimate leans toward the phase-field value,
but it rests on a model-dependent extrapolation, on a grid effect that was not measured at the calibrated
anisotropy, and on runs whose own $\sigma^*$ uncertainty is 4.7%. The data therefore do not settle where the
solver's sharp-interface limit lies; they show that at the resolution used here it reproduces KR96's
phase-field Table I values at $\varepsilon_4=0.0123$ and 0.0171, as a comparison of two finite-width
phase-field calculations at similar grid spacings ($\Delta x/W_0=0.6$-0.8 in KR96) should. We did not run
calibrated grid and width controls at 0.0123 and 0.0171, and KR96 also corrected their relaxation time for
the grid by a procedure that the letter does not specify, so part of the remaining difference cannot be
attributed. At $\varepsilon_4=0.0265$ the refined run undershoots both references; with a tip radius of only
15 cells, a further grid refinement is the next test.

## 4.4 Cost and practicality

The solver stores 61 bytes per voxel. The $\lambda=2.8$ base arm (130 million voxels, 7.4 GiB of textures)
took 95 min for 315,690 steps on an NVIDIA L40S, and the largest run, the calibrated $\varepsilon_4=0.0123$
arm (335 million voxels, 19.1 GiB), took 8.8 h for 574,322 steps. Including checkpoint read-back, the L40S
sustained 6.0-8.9 $\times10^9$ voxel updates per second across all runs. The Intel Arc 140V integrated GPU of
a 2024 laptop ran the $\lambda=5.0$-4.0 arms at 0.8-0.9 $\times10^9$ voxel updates per second, so the
$\lambda=4$ anchor takes 99 min there; the $\lambda=2.8$ base arm (7.4 GiB) would take about 12-14 h at
those rates, and we have not run it on that machine.

Two WebGPU constraints shaped the implementation. WGSL has no 64-bit floating-point type, which this study
shows is not a limitation for steady tip selection at these run lengths. Drivers also cap the size of a
single allocation (4 GiB on the Vulkan backend used here), so the largest grids split the four-component
flux texture into two two-component textures; this changes no arithmetic, and the split solver reproduces
the unsplit one bit for bit on a test volume (Section 2.2).

## 4.5 Limitations

The study covers one undercooling ($\Delta=0.45$), a pure substance with equal diffusivities, smooth cubic
anisotropy with the crystal axes aligned to the grid, and no thermal noise, so side branches are not
resolved and only the steady tip is tested. The octant symmetry imposes mirror planes that suppress
non-symmetric modes. Lower undercoolings need larger domains relative to the tip and longer runs, which is
where both the memory limit of a single WebGPU allocation and accumulated single-precision rounding would
next be tested.

# 5. Conclusions

1. Single precision is adequate for three-dimensional tip selection at $\Delta=0.45$. Over $3\times10^5$
   steps, double precision changes $\sigma^*$ by at most 0.13%, about 75 times below a 10% budget, and the
   same WGSL source gives results that agree to 0.03% across GPU vendors.
2. Comparisons with KR96 require the anisotropy strength to be matched first. A raw input is 2-4% weaker than
   KR96's grid-corrected value at $\Delta x/W_0=0.8$, which moves $\sigma^*$ by 6-8%. A one-step calibration
   from equilibrium shapes removes the mismatch, and the shifts it causes were predicted from KR96's own
   solvability slopes to within 1.2%.
3. At matched anisotropy the solver reproduces KR96's phase-field Table I at $\varepsilon_4=0.0123$ and
   0.0171 within a pre-registered 10% budget. At $\varepsilon_4=0.0265$ it does not, and the tip resolution
   (11-15 cells per radius) remains the open question.
4. Pairwise controls inside 10% did not establish convergence. The tip velocity is linear in the interface
   width, which points to a first-order correction (kinetic or curvature) that the thin-interface
   cancellation leaves on this lattice, and it leaves the sharp-interface limit of $\sigma^*$ uncertain by
   5-17%. Measuring the discrete kinetics on curved, moving fronts is the most direct next test.
5. The code, protocols and checkpoint archives are open, so the benchmark can be rerun in a web browser and
   every number in this paper re-derived from the archived data.

# Data and code availability

The source code is available under the MIT license at https://github.com/fronkt/solidify, and the released
application is archived on nanoHUB [@SolidifyNanoHUB]. The branch `research/q3d-paper` holds the solver
revision used for every run, the run harnesses, the frozen protocols, all result files and CPU replays
(`docs/validation/`), the double-precision port, and the scripts that produce every number, table and figure in
this paper from those files (`paper/cms/scripts/`). The raw checkpoint archives (about 1.5 GB, with SHA-256
hashes recorded in the result files) will be deposited on Zenodo [DOI to be added before submission].

<!-- PRE-SUBMISSION CHECK: KR96 Table I values are transcribed from arXiv patt-sol/9607005v1. The published PRL
     text was revised after v1, and an erratum exists (PRL 78, 753 (1997), doi:10.1103/PhysRevLett.78.753.2).
     Confirm Table I against the published PRL and the erratum before submission. -->

<!-- PRE-SUBMISSION CHECK: the Option A/B runner configuration that produced the lambda = 2.8 raw-anisotropy runs
     was generated on the cloud machine and is not in the repository; only its results and replays are. -->

<!-- PRE-SUBMISSION CHECK: deposit the raw archives on Zenodo and add the DOI. -->

<!-- PRE-SUBMISSION CHECK: tag the commit of the paper and replace "branch research/q3d-paper" with that tag. -->

# CRediT authorship contribution statement

[CRediT: Frank to confirm]

# Declaration of competing interest

The author declares no competing financial interests or personal relationships that could have appeared to
influence the work reported in this paper.

# Funding

[FUNDING: Frank to confirm; default "This research did not receive any specific grant from funding agencies in
the public, commercial, or not-for-profit sectors."]

# Declaration of generative AI and AI-assisted technologies in the manuscript preparation process

[AI DECLARATION: Frank's wording required; Elsevier template: "During the preparation of this work the author
used [tool] in order to [reason]. After using this tool, the author reviewed and edited the content as needed
and takes full responsibility for the content of the publication."]

# References
