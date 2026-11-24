# Q3c Cloud GPU Plan: Costed Vast.ai 80 GB Execution Proposal (PR #6 / PR #10)

> **APPROVAL STATUS: DRAFT PROPOSAL ONLY (ZERO CLOUD SPEND EXECUTED).**
> No Vast.ai instance has been rented, created, or launched. Every GPU execution command below is gated on Frank's explicit written approval of the campaign option, maximum dollar cap, and frozen commit hash.

## Executive Decision Summary

| Field | Option A (Recommended First Step) | Option B (Full Q3 Acceptance Gate) |
|---|---|---|
| **Goal** | Direct narrow interface-width ladder (`lambda = 4.0` anchor + `3.2` + `2.8`) to resolve the `width-trend-form-unresolved` W1 verdict without extrapolation | Full 5-arm unchanged Karma–Rappel (1996) Q3 literature gate at converged width `lambda = 2.4` (including the `dx = 0.6` refinement arm) |
| **Q3 Acceptance Power** | Diagnostic only (determines whether $W_0 \to 0$ scaling supports a converged follow-up $\lambda$ or pivots to anisotropy/kinetics) | Closes `PR #6 / PR #10` (`Q3c`) end-to-end against unchanged 10% bands, metrology, and coefficients |
| **Peak Texture VRAM** | `~7.3 GiB` (`lambda = 2.8`, ~130M voxels) | **`~30 GiB`** (`lambda = 2.4`, `dx = 0.6` arm, ~489M voxels) |
| **Target GPU Class** | 1× A100-80GB or 1× H100-80GB (same GPU family for clean cross-option anchor) | **1× A100-SXM4-80GB or 1× H100-80GB** (minimum 48–80 GB VRAM required) |
| **Estimated Runtime** | **1.5–2.5 hr** (A100-80GB) / **1.0–1.5 hr** (H100-80GB) | **10–14 hr** (A100-80GB) / **6–9 hr** (H100-80GB) |
| **Estimated Cost (Vast.ai)** | **$2–$6 USD** (typical `$1.20–$2.60/hr`) | **$15–$35 USD** (typical `$1.20–$2.60/hr`) |
| **Hard Dollar Cap** | **$10 USD** (hard wall-clock timeout: `4h`) | **$45 USD** (hard wall-clock timeout: `16h`) |

---

## 1. Current State and Local Hardware Wall

### 1.1 Literature Reference and Open Gap

The 3D quantitative solidification gate (`docs/QUANT-3D.md`, branch `research/q3c-stiffness`) compares SOLIDIFY's calibrated 3D solver against Karma & Rappel (1996, *Phys. Rev. Lett.* 77, 4050, Table I, $\Delta = 0.45$, $\varepsilon_4 = 0.0171$):

- **Reference (KR96 phase-field):** $P = 0.312$, $\sigma^* = 0.063$, $V d_0 / D = 0.012264$, $\rho / \rho_{\text{Iv}} = 0.6624$ (numerical solvability: $P = 0.324$, $\sigma^* = 0.0578$, $V d_0 / D = 0.012135$).
- **Archived five-arm campaigns (fixed terminal, NVIDIA):**
  - Default v3 (`12ce78b`, raw archive SHA-256 `72b3860f...7dce`): $P$ passes, $\sigma^* = 0.0502\text{–}0.0529$ (base `0.051333`, $V d_0 / D = 0.011037$, $-10.0\%$ vs. KR96 PF).
  - Lattice-kinetics candidate (`a11a814`, raw archive SHA-256 `ceea1d7c...cbb23f`): $P = 0.3303$ passes, $\sigma^* = 0.0511\text{–}0.0545$ (base `0.052696`, $V d_0 / D = 0.011498$, $-6.2\%$ vs. KR96 PF; width arm $\lambda = 3.6$: $V d_0 / D = 0.011632$, $\sigma^* = 0.054522$).
- **CPU replay diagnosis (484 archived tip checkpoints, zero metrology defect):** Time stationarity, domain size, and $\Delta t$ controls move $\sigma^*$ by $< 0.5\%$ and are excluded. Known-truth apex metrology bias is $\le 0.38\%$ in $\rho$ and $\le 0.8\%$ in $\sigma^*$. The only resolved, replicated sensitivity in the archived five-arm data is finite interface width: shrinking $W_0 / d_0$ by $10\%$ ($\lambda: 4.0 \to 3.6$) raises $V d_0 / D$ by $+1.17\text{–}1.54\%$ and $\sigma^*$ by $+3.12\text{–}3.47\%$.

### 1.2 Completed W1 Width-Ladder Results (`ab2b45c`, 2026-11-07, Intel Arc 140V)

To test the finite-interface-width hypothesis without cloud spend, protocol `scripts/research/quant3d-width-ladder.md` (`W1`, frozen at commit `230c146`, recorded in commit `ab2b45c`) ran three wide-side arms locally on the Intel Arc 140V (`2.5–3 hr`, raw archive `D:\solidify\q3c-w1-width-ladder-2026-11-07.zip`, SHA-256 `3ea24d4da32d6375217125ed491073efd75cc2b3bab5b325c00bf929081928ad`):

| Arm | $\lambda$ | $W_0 / d_0$ | Grid (`nx × ny × nz`) | Texture GiB | $V d_0 / D$ | $\sigma^*$ | $P$ | $\rho / \rho_{\text{Iv}}$ | Window $V$ spread |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| `w50` (Arc 140V) | `5.0` | `5.657` | `216 × 216 × 490` | `1.30` | `0.0111286` | `0.048676` | `0.33810` | `0.7179` | `3.3e-4` |
| `w44` (Arc 140V) | `4.4` | `4.978` | `246 × 246 × 557` | `1.9` | `0.0113569` | `0.050998` | `0.33369` | `0.7085` | `1.2e-4` |
| `w40-anchor` (Arc 140V) | `4.0` | `4.525` | `270 × 270 × 612` | `2.5` | `0.0114949` | `0.052713` | `0.33020` | `0.7011` | `7.4e-4` |
| `width` (NVIDIA `a11a814`) | `3.6` | `4.073` | `300 × 300 × 680` | `3.4` | `0.0116323` | `0.054522` | `0.32661` | `0.6935` | `8.3e-4` |
| KR96 PF reference | — | — | `200 × 200 × 400` | — | `0.012264` | `0.063` | `0.312` | `0.6624` | — |

**Frozen decision-rule outcome (`ab2b45c`):**
- **Rules 1–2 (execution & validity):** PASS on all three arms; independent CPU replay (`quant3d-q3c-tip-replay.py`, 61 checkpoints/arm) matches every printed digit with zero device errors.
- **Rule 3 (cross-platform anchor):** Intel Arc 140V vs. archived NVIDIA at $\lambda = 4.0$ agrees to `-0.024%` in $V d_0 / D$ (limit `0.25%`) and `+0.033%` in $\sigma^*$ (limit `1.0%`). PASS.
- **Rule 4 (monotonicity):** $V d_0 / D$ strictly decreases across $\lambda = 3.6 \to 4.0 \to 4.4 \to 5.0$ by `1.18% / 1.20% / 2.01%` against spread bounds `0.17% / 0.15% / 0.07%`. Width sensitivity is real and **not refuted**.
- **Rule 5 (scaling form):** Log residuals of $V d_0 / D$ at $\lambda = 4.4, 5.0$ are `+0.079% / +0.207%` (quadratic RMS `0.157%`) vs. `-0.044% / -0.329%` (linear RMS `0.235%`). Quadratic passes `<= 0.2%` but fails dominance (`0.157% > 0.5 × 0.235% = 0.1175%`); linear fails `<= 0.2%`. **Verdict: `width-trend-form-unresolved`** (`q3Accepted = false`).
- **Frozen protocol consequence (`quant3d-width-ladder.md` Section 5):** Extrapolating to $W_0 \to 0$ is disallowed. The pre-registered next step is a **direct narrow ladder** on the $\lambda < 3.6$ side before (or leading into) a converged five-arm gate.

### 1.3 Why Local Hardware (Intel Arc 140V) Hits Both Walls

1. **The $\lambda^{-6}$ wall-time wall:** Holding the physical domain fixed in $d_0$ units scales voxel count as $\lambda^{-3}$ and fixed physical terminal time (`1949.1356` base $\tau_0$) scales explicit step count as $\lambda^{-2}$ to $\lambda^{-3}$ via $W_0 \propto \lambda d_0$ and $\tau_0 \propto W_0^2$. At the measured Intel Arc 140V throughput (`1.099e9` voxel-substeps/s):
   - $\lambda = 4.0$ base arm: `73 min` (`1.0×`).
   - $\lambda = 3.2$ arm: `~3.8×` (`~4.6 hr` locally).
   - $\lambda = 2.8$ arm: `~8.4×` (`~10 hr` locally).
   - $\lambda = 2.4$ base arm alone: `~21×` (`~26 hr` locally, vs. `~70 min` on an RTX 5090).
   - Full five-arm campaign at $\lambda = 2.4$: `~220` base-arm units (`> 11 days` continuous local GPU time).
2. **The ~30 GB VRAM texture wall (`dx = 0.6` refinement arm):** In the unchanged five-arm gate at $\lambda = 2.4$, refining mesh spacing from $dx / W_0 = 0.8$ to $0.6$ scales voxel count by $(4/3)^3 \approx 2.37\times$ to **~489 million voxels (~30 GiB of 3D storage textures alone)** before WebGPU staging buffers, browser compositor, and Vulkan driver overhead. That exceeds the Intel Arc 140V shared memory ceiling and leaves zero safe headroom on a 32 GB consumer GPU, requiring an **80 GB-class datacenter GPU** (A100-SXM4-80GB or H100-80GB).

---

## 2. Two Costed Campaign Options (Zero Spend Until Approved)

Both options preserve the unchanged five-arm bands, local-tip metrology, terminal physical time, and source-freeze discipline. Neither option changes any solver coefficient or relaxes any acceptance threshold.

### Option A (Recommended First Step): Direct Narrow Width Ladder (`lambda = 4.0` Anchor + `3.2` + `2.8`)

Executes the exact next diagnostic mandated by the `width-trend-form-unresolved` verdict before committing to a full five-arm expenditure:

| Arm | $\lambda$ | $W_0 / d_0$ | Approx. Grid | Approx. Voxels | Texture VRAM | Relative Cost (`w40 = 1×`) |
|---|---:|---:|---|---:|---:|---:|
| `w40-anchor` | `4.0` | `4.525` | `270 × 270 × 612` | `44.6 M` | `~2.5 GiB` | `1.0×` |
| `w32` | `3.2` | `3.620` | `338 × 338 × 765` | `87.4 M` | `~4.9 GiB` | `~3.8×` |
| `w28` | `2.8` | `3.168` | `386 × 386 × 874` | `130.2 M` | `~7.3 GiB` | `~8.4×` |
| **Total (Option A)** | — | — | — | **peak `130.2 M`** | **peak `~7.3 GiB`** | **`~13.2×`** |

- **Hardware:** 1× A100-80GB (PCIe or SXM4) or 1× H100-80GB. Running Option A on the same 80 GB datacenter GPU family also validates Linux Vulkan headless WebGPU throughput and the Rule 3 platform anchor (`<= 0.25%` $V d_0 / D$, `<= 1%` $\sigma^*$ vs. `a11a814`) prior to Option B.
- **Estimated wall time:** **1.5–2.5 hr** on 1× A100-80GB or **1.0–1.5 hr** on 1× H100-80GB (including ~10 min container setup, 2-min WebGPU smoke check, and CPU checkpoint replay).
- **Estimated cost:** **$2–$6 USD** at typical Vast.ai on-demand rates (`$1.20–$2.60/hr`).
- **Hard spend cap:** **$10 USD** (enforced via `timeout 4h` + billing monitor).
- **Decision value:** Separates quadratic vs. linear $W_0 \to 0$ scaling directly on the narrow side of $\lambda = 3.6$. If width convergence stalls short of KR96, we pivot directly to the equilibrium-calibrated $\varepsilon_4$ definition / angular kinetic hypotheses (`quant3d-width-ladder.md` Section 4 items 2–3) without spending $15–$35 on Option B.

### Option B: Full 5-Arm Converged-Width Q3 Acceptance Gate at `lambda = 2.4` (Including `dx = 0.6` 30 GB Arm)

Closes `PR #6 / PR #10` (`Q3c`) end-to-end against the unchanged five-arm Karma & Rappel (1996) literature acceptance gate (`base`, narrower-width control, `dx = 0.6` mesh-refinement arm, larger-domain control, and `dt/2` temporal control):

- **Peak memory footprint:** `~489 M` voxels -> **`~30 GiB` textures** on the `dx = 0.6` arm, plus staging/driver overhead -> **requires >= 48–80 GB GPU VRAM** (1× A100-SXM4-80GB or 1× H100-80GB for comfortable 80 GB margin and zero OOM risk).
- **Total compute budget:** `~220` $\lambda = 4.0$ base-arm units (`quant3d-width-ladder.md` Section 7: `~12 hr` on one RTX 5090).
- **Estimated wall time:** **10–14 hr** on 1× A100-SXM4-80GB or **6–9 hr** on 1× H100-80GB (accounting for memory-bandwidth-bound 3D stencil dispatch plus checkpoint readbacks).
- **Estimated cost:** **$15–$35 USD** at typical Vast.ai on-demand rates (`$1.20–$2.60/hr`).
- **Hard spend cap:** **$45 USD** (enforced via `timeout 16h` + per-arm incremental sync).
- **Recommended staging:** Run Option A first (`$2–$6`), inspect the resolved scaling form and anchor check locally, and only then approve Option B at the reference-blind selected $\lambda$.

---

## 3. Vast.ai Offer Filter and Reproducible Headless WebGPU Vulkan Setup

### 3.1 Exact Vast.ai Offer Filter (Read-Only Search)

Use on-demand (non-interruptible) verified datacenter hosts with >= 80 GB VRAM, high reliability, fast download bandwidth, and direct SSH ports. Do **not** run `vastai create instance` until Frank approves an option and dollar cap:

```bash
vastai search offers \
  "num_gpus=1 gpu_ram>=80 reliability>=0.98 inet_down>=500 cuda_vers>=12.0 direct_port_count>=1 verified=true rentable=true" \
  --order "dph_total" --raw
```

Recommended post-filter checks before selecting an `offer_id`:
- Prefer `A100_SXM4` (80 GB HBM2e, 2.0 TB/s) or `H100_SXM` / `H100_PCIE` (80 GB HBM3, 2.0–3.35 TB/s) since 3D 19-point stencil sweeps are memory-bandwidth bound.
- Require `dph_total <= 2.60` (typical A100-80GB: `$1.20–$1.80/hr`; H100-80GB: `$1.80–$2.60/hr`) and disk allocation `--disk 80` (for Chrome, Node dependencies, and raw tip-checkpoint archives).
- Reject interruptible/spot bids for Option B to prevent preemption mid-arm.

### 3.2 Container Image and Headless Chromium Vulkan WebGPU Flags

Use an Ubuntu 22.04 CUDA 12 runtime image (`nvidia/cuda:12.4.1-runtime-ubuntu22.04`) with host Vulkan ICD access, Node.js 20 LTS, Python 3 + NumPy, and `google-chrome-stable`. `scripts/research/quant3d-width-ladder.mjs` launches Puppeteer using `process.env.CHROME_PATH` and a JSON string array in `process.env.CHROME_ARGS` (and automatically appends `--enable-unsafe-webgpu` and `--enable-gpu`):

```bash
# Inside the Vast.ai instance (after installing nodejs 20, python3-numpy, google-chrome-stable, vulkan-tools)
export CHROME_PATH="/usr/bin/google-chrome-stable"
export CHROME_ARGS='["--headless=new","--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=vulkan","--enable-features=Vulkan","--ignore-gpu-blocklist","--disable-gpu-sandbox"]'
```

### 3.3 Mandatory 2-Minute WebGPU Adapter and VRAM Smoke Check

**Before launching any multi-hour arm**, run this 2-minute gate (`< $0.10` elapsed). If any check fails (for example, missing host Vulkan ICD or SwiftShader CPU fallback), abort and destroy the instance immediately:

```bash
# 1. Confirm 80 GB NVIDIA GPU and clean memory
nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv

# 2. Confirm hardware NVIDIA Vulkan device (must NOT be llvmpipe / SwiftShader)
vulkaninfo --summary | grep -E "deviceName|deviceType|apiVersion"

# 3. Confirm headless Chrome exposes a hardware WebGPU adapter with target limits
node -e '
import("puppeteer").then(async ({ default: puppeteer }) => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-gpu", ...JSON.parse(process.env.CHROME_ARGS || "[]")],
  });
  const page = await browser.newPage();
  const info = await page.evaluate(async () => {
    const ad = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (!ad) return { ok: false, reason: "no adapter" };
    const ai = ad.info || {};
    const lim = ad.limits;
    return {
      ok: !ad.isFallbackAdapter,
      isFallbackAdapter: !!ad.isFallbackAdapter,
      vendor: ai.vendor, architecture: ai.architecture, device: ai.device,
      maxBufferSizeGiB: +(lim.maxBufferSize / 1073741824).toFixed(2),
      maxStorageBindingGiB: +(lim.maxStorageBufferBindingSize / 1073741824).toFixed(2),
      maxTextureDimension3D: lim.maxTextureDimension3D,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
  if (!info.ok) process.exit(1);
});
'
```

Confirm before proceeding:
- `ok: true` and `isFallbackAdapter: false` with NVIDIA vendor/device reported.
- `maxTextureDimension3D >= 2048` (required for `nz = 612..1024+` 3D needle boxes).
- Clean test allocation of target texture size (e.g., `~7.3 GiB` for Option A or `~30 GiB` for Option B) with zero WebGPU `out-of-memory` validation errors.

### 3.4 Frozen-Commit Checkout and Exact Execution Commands

Match the exact source-freeze and CLI workflow in `scripts/research/quant3d-width-ladder.md` Section 8:

```bash
# 1. Clean checkout of frozen pushed commit (NEVER run dirty local edits)
git clone https://github.com/fronkt/solidify.git /workspace/solidify
cd /workspace/solidify
git checkout <FROZEN_COMMIT_SHA>
git status --short   # must be empty
npm ci

# 2. Mandatory CPU self-tests, metrology controls, and synthetic CLI controls
node scripts/research/quant3d-width-ladder.mjs verify-out/q3c-width-ladder-selftest
node scripts/research/quant3d-width-ladder-metrology.mjs verify-out/q3c-width-ladder-metrology
node scripts/research/quant3d-width-ladder-cli-controls.mjs verify-out/q3c-width-ladder-cli-controls
python3 -I scripts/research/quant3d-q3c-tip-replay.py --self-test

# 3. Launch Vite on port 5199 inside tmux and run the frozen GPU campaign under hard timeout
npx vite --port 5199 --strictPort > verify-out/vite.log 2>&1 &
VITE_PID=$!

# Option A (direct narrow ladder, hard 4h ceiling; use pre-registered narrow-ladder config on frozen branch):
timeout --signal=TERM 4h \
  node scripts/research/quant3d-width-ladder.mjs verify-out/q3c-narrow-ladder 5199 --run \
  2>&1 | tee verify-out/q3c-narrow-ladder.log

# Option B (full 5-arm gate at converged lambda, hard 16h ceiling once pre-registered):
# timeout --signal=TERM 16h \
#   node scripts/research/<frozen-five-arm-script>.mjs verify-out/q3c-five-arm-l24 5199 --run \
#   2>&1 | tee verify-out/q3c-five-arm-l24.log

kill $VITE_PID || true

# 4. Independent CPU replay and SHA-256 archive packaging on the instance
python3 -I scripts/research/quant3d-q3c-tip-replay.py \
  --campaign ladder=verify-out/q3c-narrow-ladder/samples \
  --out verify-out/q3c-narrow-ladder/replay.json

tar -czf /workspace/q3c-cloud-artifacts.tar.gz -C verify-out q3c-narrow-ladder q3c-narrow-ladder.log
sha256sum /workspace/q3c-cloud-artifacts.tar.gz | tee /workspace/q3c-cloud-artifacts.sha256
```

---

## 4. Spend Protection, Verification, and Teardown Watchdog

### 4.1 Hard Spend Guardrails

1. **Zero pre-approval spend:** No `vastai create instance` call is permitted until Frank signs off below.
2. **Hard wall-clock watchdog:** Every remote GPU execution runs under GNU `timeout` (`4h` for Option A -> `$10` max cap; `16h` for Option B -> `$45` max cap) paired with an automated check that logs elapsed cost (`elapsed_hr * dph_total`) after each completed arm and aborts before crossing `85%` of the approved dollar cap.
3. **Incremental per-arm sync:** Copy each completed arm's JSON and raw checkpoint folder back to the local machine as soon as that arm finishes (`scp -P $SSH_PORT -r root@$SSH_HOST:/workspace/solidify/verify-out/<campaign>/ ...`), so a host reboot or mid-campaign timeout never loses earlier arms.
4. **Immediate fail-fast on Vulkan fallback or WebGPU error:** Any `refused-execution`, WebGPU `uncapturederror`, or software adapter immediately halts the run and triggers teardown rather than burning idle GPU hours.

### 4.2 Mandatory Local Verification Before Instance Teardown

Do **not** destroy the Vast.ai instance until all four local checks succeed (and confirm teardown per operational guardrails, then verify billing stopped):

1. **Archive transfer:** Download `/workspace/q3c-cloud-artifacts.tar.gz` and `/workspace/q3c-cloud-artifacts.sha256` to `D:\solidify\`.
2. **Hash verification:** Compute local SHA-256 (`Get-FileHash -Algorithm SHA256`) and verify byte-exact match against the remote `.sha256` digest.
3. **Independent local CPU replay:** Extract and run `python -I scripts/research/quant3d-q3c-tip-replay.py` locally against the downloaded raw checkpoints; confirm every arm's `V d0/D`, `sigma*`, `P`, and `rho/rho_Iv` match the remote CLI JSON, `deviceErrors === 0`, and Rule 3 platform anchor passes.
4. **Teardown and billing check:** Run `vastai destroy instance <INSTANCE_ID>` (only after confirmation and local verification) and confirm `vastai show instances` lists zero active contracts.

---

## Explicit Approval Gate

Execution of Section 3 is **blocked** pending explicit sign-off from Frank:

- [ ] **Selected Option:** `Option A (Direct Narrow Ladder, $2–$6 est., $10 cap)` / `Option B (Full 5-Arm Gate, $15–$35 est., $45 cap)` / `Defer`
- [ ] **Approved Maximum Spend Cap (USD):** `________`
- [ ] **Approved Frozen Commit SHA on `research/q3c-stiffness`:** `________`
