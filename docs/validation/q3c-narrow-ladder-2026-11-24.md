# Q3c Option A: Direct Narrow Interface-Width Ladder (`lambda = 4.0, 3.2, 2.8`) — 2026-11-24

- **Hardware:** AWS EC2 `g6e.2xlarge` (`us-east-1a`, NVIDIA L40S 48 GB VRAM, Ada Lovelace, driver `580.126.09`, Chrome `158.0.8127.88` via `xvfb-run` Vulkan ANGLE: `maxBufferSize = 4 GiB`, `maxTextureDimension3D = 2048`).
- **Source frozen:** `origin/research/q3c-stiffness` @ `ab2b45c` (unchanged shaders, coefficients, local-tip metrology, and fixed physical terminal schedule).
- **Artifacts:**
  - GPU harness summary: `docs/validation/quant3d-q3c-narrow-ladder-2026-11-24.json`
  - Independent Python CPU replay (`183/183` checkpoints): `docs/validation/quant3d-q3c-narrow-ladder-replay-2026-11-24.json`
  - Raw SHA-256-hashed checkpoint archive (`25.71 MB`): `D:\solidify\q3c-narrow-ladder-2026-11-24\q3c-narrow-out.tar.gz` (`sha256: 21250c1348b2b22f1752331cfd74e38d6912485b11fb005e64e221179f58433d`).
- **Audit & hygiene:** `errors = 0`, `deviceErrors = 0`, `9/9` bit-hash equivalence pairs vs. native `Sim3D`, `61/61` checkpoints resolved per arm (`0` unresolved), independent Python CPU replay matches every printed digit. Total GPU compute time: `148.5 min` (`9.83 + 44.03 + 94.65 min`); EC2 instance `i-0400b3a8535a3387f`, temporary SG, and temporary key pair verified deleted.

## Combined 6-Point Width Ladder (`W1` Wide + Archived `width` + AWS L40S Narrow)

| Arm | $\lambda$ | $W_0 / d_0$ | Grid (`nx × ny × nz`) | Wall min | $V d_0 / D$ | vs KR96 PF / Solv | $\sigma^*$ | vs KR96 PF / Solv | $P$ | vs KR96 PF / Solv | $\rho / \rho_{\text{Iv}}$ |
|---|---:|---:|---|---:|---:|---|---:|---|---:|---|---:|
| `w50` (Arc 140V) | `5.0` | `5.657` | `216 × 216 × 490` | — | `0.0111286` | `-9.26%` / `-8.29%` | `0.048676` | `-22.74%` / `-15.79%` | `0.33810` | `+8.37%` / `+4.35%` | `0.7179` |
| `w44` (Arc 140V) | `4.4` | `4.978` | `246 × 246 × 557` | — | `0.0113569` | `-7.40%` / `-6.41%` | `0.050998` | `-19.05%` / `-11.77%` | `0.33369` | `+6.95%` / `+2.99%` | `0.7085` |
| `w40-anchor` (L40S) | `4.0` | `4.525` | `270 × 270 × 612` | `9.83` | `0.0114977` | `-6.25%` / `-5.25%` | `0.052696` | `-16.36%` / `-8.83%` | `0.33029` | `+5.86%` / `+1.94%` | `0.7013` |
| `width` (NVIDIA `a11a814`) | `3.6` | `4.073` | `300 × 300 × 680` | — | `0.0116323` | `-5.15%` / `-4.14%` | `0.054522` | `-13.46%` / `-5.67%` | `0.32661` | `+4.68%` / `+0.81%` | `0.6935` |
| `w32` (L40S) | `3.2` | `3.620` | `338 × 338 × 765` | `44.03` | `0.0117679` | `-4.04%` / `-3.02%` | `0.055590` | `-11.76%` / `-3.82%` | `0.32534` | `+4.28%` / `+0.41%` | `0.6908` |
| **`w28` (L40S)** | **`2.8`** | **`3.168`** | **`386 × 386 × 874`** | **`94.65`** | **`0.0119012`** | **`-2.96%` / `-1.93%`** | **`0.056977`** | **`-9.56%` / `-1.42%`** | **`0.32317`** | **`+3.58%` / `-0.26%`** | **`0.6862`** |
| KR96 numerical solvability | `0` | `0` | sharp-interface | — | `0.012135` | — | `0.0578` | — | `0.324` | — | — |
| KR96 PF Table I | — | — | `200 × 200 × 400` | — | `0.012264` | — | `0.063` | — | `0.312` | — | `0.6624` |

## Key Findings

1. **Cross-platform anchor PASS (near bit-exact):** `w40-anchor` on Linux NVIDIA L40S matches archived Windows NVIDIA `a11a814` to `-2.9e-8` (`-0.000003%`) in $V d_0 / D$ and `-8.3e-7` (`-0.00008%`) in $\sigma^*$.
2. **Direct single-arm clearance of every KR96 10% band at $\lambda = 2.8$ (`w28`):** Without any extrapolation, `w28` clears KR96 PF Table I on all four observables ($V d_0 / D$: `-2.96%`, $\sigma^*$: `-9.56%`, $P$: `+3.58%`, $\rho / \rho_{\text{Iv}}$: `+3.59%`), and agrees with Karma & Rappel (1996) numerical solvability theory to **`-1.93%` ($V d_0 / D$), `-1.42%` ($\sigma^*$), and `-0.26%` ($P$)**.
3. **Pre-registered narrow-side scaling verdict:** Monotonicity PASS across all 6 widths (`5.0 -> 2.8`). On the pre-registered $V d_0 / D$ two-anchor rule (`w32`, `w28`), **`linear` resolves cleanly over `quadratic` by `8.2×`** (`logRMS = 0.0298%` vs. `0.2450%`). Across all 6 widths, both linear and quadratic predict at $\lambda = 2.4$: $V d_0 / D \approx 0.01203\text{–}0.01205$ (`-1.8%` PF / `-0.8%` solvability), $\sigma^* \approx 0.0582\text{–}0.0587$ (`-7.0%` PF / `+1.0%` solvability), and $P \approx 0.320\text{–}0.322$ (`+2.8%` PF / `-0.8%` solvability).
4. **Status & next decision:** Option A is complete (`q3Accepted` stays `false` until a full 5-arm gate — including `dx = 0.6`, domain, and `dt/2` controls — runs at a converged width). Because `g6e.2xlarge` (48 GB L40S) ran `w28` in `94.7 min` and comfortably holds the `~30 GiB` `dx = 0.6` arm, Option B (`5-arm` gate at $\lambda = 2.4$ or `2.8`) is now directly feasible on the exact same AWS hardware whenever approved.
