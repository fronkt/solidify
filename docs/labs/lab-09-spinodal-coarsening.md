# Lab 9: Spinodal Decomposition, Lyapunov Decay, and 3D Coarsening

**Estimated time:** 50 minutes  
**Prerequisites:** Regular-solution miscibility gaps, spinodal instability ($\partial^2 f / \partial c^2 < 0$), fourth-order Cahn–Hilliard diffusion, Lifshitz–Slyozov–Wagner (LSW) coarsening  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=9](https://solidify.frankcai.dev/app/#lab=9)

> **In-app Guided Labs tracker:** Opening `#lab=9` launches the Guided Labs panel on the left alongside the **`SPINODAL`** inspector inside the right rail (`NIST PFHub B1`, 2D `200²`), using the shared top lens bar (`COMP`, `CHEM μ`, `ETCH` in 2D; `ISO 3D`, `SLICE`, `VOL` in 3D) and bottom-left transport (`▶ run` / `❚❚ pause`, `reset`, `×2` / `×4`). Every Lyapunov energy check, coarsening run, and 3D sponge check logs into the `DATA` tab and exports via **`export lab ZIP`**, **`export csv`**, or **`print report`**.

## Goals
1. Execute the **NIST PFHub Benchmark 1a** 2D periodic Cahn–Hilliard problem (Jokisaari et al. 2017) on WebGPU and verify strict Lyapunov free-energy decay ($d\mathcal{F}/dt \le 0$) together with conserved mean composition $\langle c \rangle$.
2. Visualize the generalized chemical potential $\mu = f'(c) - \kappa \nabla^2 c$ in the **`CHEM μ`** lens to see how curvature gradients drive domain coarsening.
3. Measure characteristic domain length $L(t)$ across alloy presets (**`Fe–Cr (475 °C)`**, **`Al–Zn`**, and **`Off-critical droplets`**) and compare the fitted coarsening exponent against Lifshitz–Slyozov–Wagner ($t^{1/3}$) theory.
4. Evolve and orbit a 3D `64³` raymarched bicontinuous spinodal sponge while identifying explicit Cahn–Hilliard model boundaries (omitted elastic coherency strain and biharmonic explicit CFL scaling).

---

## Part A: NIST PFHub Benchmark 1a, Lyapunov Decay & Mass Conservation (15 min)

1. Open [solidify.frankcai.dev/app/#lab=9](https://solidify.frankcai.dev/app/#lab=9). Confirm the right-rail engine tab is **`SPINODAL`** with `preset` set to **`NIST PFHub B1`**, dimension toggle at **`2D`** (`200²` periodic domain $[0, 200]^2$, $dx = 1.0$, $dt = 0.003363$), `composition c₀ = 0.50`, `gradient κ = 2.0`, and `mobility M = 5.0`.
2. Notice the initial state at $t = 0$: small smooth cosine ripples ($\varepsilon = 0.01$, Jokisaari et al. 2017 Eq. 5) with initial free energy $\mathcal{F}(0) \approx 319.1$ and mean composition $\langle c \rangle(0) \approx 0.502548$.
3. Press **`▶ run`** (or keep running; click **`×2`** or **`×4`** in transport to advance faster) until **`time t`** passes **`15`** and **`free energy F`** drops below **`78 %`** of $\mathcal{F}(0)$ (below $\sim 249$).
4. Click the **`F(t)`** diagnostics plot in the right rail to enlarge it and inspect the steep early spinodal amplification drop followed by smooth late-stage coarsening. Record `time t`, `free energy F`, `mean ⟨c⟩` (including its mass drift `Δ`), `domain L`, and `c range` (approaching the binodal wells $c_\alpha = 0.30$ and $c_\beta = 0.70$).

## Part B: Chemical Potential $\mu$ & Curvature-Driven Flux (10 min)

1. Keeping the evolved **`NIST PFHub B1`** microstructure at `t ≥ 15`, switch the top lens bar from **`COMP`** to **`CHEM μ`**.
2. Observe where $|\mu|$ is largest: flat interfaces between $c_\alpha$ and $c_\beta$ sit near $\mu \approx 0$, whereas tightly curved necks, tips, and isolated small islands exhibit strong positive or negative $\mu$ via the Gibbs–Thomson curvature contribution $-\kappa \nabla^2 c$.
3. Watch a small curved lobe or neck pinch off and shrink while a flatter neighboring domain thickens. Because solute flux obeys $\mathbf{J} = -M \nabla \mu$, mass flows downhill in chemical potential even while moving uphill in composition during initial decomposition.
4. Switch briefly to **`ETCH`** (top lens bar) to inspect the interface network where $|\nabla c|$ is concentrated, then switch back to **`COMP`**.

## Part C: Alloy Presets & LSW Coarsening Kinetics (15 min)

1. In the **`SPINODAL`** right-rail inspector, change `preset` from `NIST PFHub B1` to **`Fe–Cr (475 °C)`** (ferritic stainless steel 475 °C embrittlement miscibility gap, $c_\alpha = 0.18$, $c_\beta = 0.82$, $\rho_s = 3.5$, $\kappa = 1.8$, $M = 6.0$).
2. Above the diagnostics plot, toggle from **`F(t)`** to **`L(t)`** to view the characteristic interfacial domain length $L(t) = V(c_\beta - c_\alpha) / \int |\nabla c|\,dA$.
3. Run past **`time t ≥ 20`** (using `×4` in transport to reach $t \sim 60\text{–}100$ gives an even cleaner log-log trend). Record `time t`, `domain L`, `LSW slope α`, `mean ⟨c⟩`, and `c range`.
4. **Topology contrast (optional exploration):** switch `preset` to **`Off-critical droplets`** ($c_0 = 0.42$, 30 % minority phase) and watch how an asymmetric composition breaks up into isolated circular droplets coarsening by Ostwald ripening rather than a bicontinuous interconnected network.
5. Click **`export csv`** inside `SPINODAL` to download `solidify-spinodal-*.csv` if you want to inspect the time series in Python (Part 4 of the companion nanoHUB notebook).

## Part D: 3D Bicontinuous Spinodal Sponge (10 min)

1. Inside the **`SPINODAL`** inspector, click the **`3D`** dimension toggle (this launches the `64³` periodic 19-point isotropic Laplacian solver on $[0, 100]^3$). You may run `NIST PFHub B1` (3D cosine initial condition) or `Fe–Cr (475 °C)`.
2. Run past **`time t ≥ 8`** (tip: use `×2` or `×4` in transport) and verify that mass conservation still holds to $|\Delta \langle c \rangle| < 10^{-4}$ in 3D.
3. **Orbit and inspect:** drag directly on the canvas to orbit the raymarched `64³` bicontinuous sponge (double-click the canvas to reset the camera).
4. Cycle across all three 3D top lenses (**`ISO 3D`** isosurface, **`SLICE`** cross-section, and **`VOL`** translucent volume) and compare the connected 3D channel topology against your 2D sections from Parts A–C.

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** or **`print report`** in the Guided Labs panel to save your recorded dataset, and answer the questions below:

1. **Linear spinodal stability analysis:** For NIST PFHub Benchmark 1a ($f(c) = \rho_s (c - c_\alpha)^2 (c_\beta - c)^2$ with $c_\alpha = 0.3$, $c_\beta = 0.7$, $\rho_s = 5.0$, $\kappa = 2.0$, $M = 5.0$, $c_0 = 0.5$), evaluate $f''(c_0)$ analytically and use the Cahn–Hilliard dispersion relation $\omega(k) = -M k^2 (f''(c_0) + \kappa k^2)$ to compute the cutoff wavenumber $k_c$, the fastest-growing wavenumber $k_{\max}$, and the fastest-growing wavelength $\lambda_{\max} = 2\pi / k_{\max}$. Why do wavelengths shorter than $2\pi / k_c$ decay instead of amplifying?
2. **Lyapunov monotonicity & interface equipartition:** Show from $\partial c / \partial t = \nabla \cdot (M \nabla \mu)$ with periodic boundaries that $d\mathcal{F}/dt = -\int M |\nabla \mu|^2\,dV \le 0$. In SOLIDIFY's full $t = 1000$ PFHub Benchmark 1a run, chemical and gradient energies converge to $F_{\text{chem}} = 42.48$ and $F_{\text{grad}} = 41.89$. Why do $F_{\text{chem}}$ and $F_{\text{grad}}$ approach equal halves for equilibrated diffuse interfaces?
3. **Coarsening exponent & finite-box effects:** Compare your measured **`LSW slope α`** in Part C (and SOLIDIFY's full PFHub 1a benchmark slope $\alpha = 0.196$ over $t \in [25, 1000]$) against the asymptotic Lifshitz–Slyozov–Wagner prediction $L(t) \propto t^{1/3}$. Give two physical or finite-size reasons why early-to-intermediate periodic simulations show $\alpha < 1/3$.
4. **Model boundaries (elasticity & numerics):** Real Fe–Cr and Ni-base alloys exhibit lattice misfit between precipitate and matrix phases. How would adding anisotropic elastic coherency strain change the 2D/3D spinodal morphology compared to SOLIDIFY's isotropic $\kappa |\nabla c|^2$ model? Also explain why an explicit fourth-order Cahn–Hilliard solver imposes a $\Delta t \propto \Delta x^4$ timestep constraint.
