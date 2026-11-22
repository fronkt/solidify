# Outreach & Grant Drafts for SOLIDIFY (Review & Send Manually)

All templates below are drafts for your review. Do not send without confirming links, dates, and recipient details.

---

## 1. Journal of Materials Education (JME): Template Request & Submission Cover Email

**To:** `icmated@unt.edu` (Attn: Prof. Jincheng Du, International Council on Materials Education, UNT)  
**Subject:** Manuscript submission & author template inquiry: *SOLIDIFY* (Browser-Native WebGPU Phase-Field Solidification Lab)

Dear Professor Du and the *Journal of Materials Education* Editorial Team,

I am writing to submit (and request your current Word/LaTeX author template for) an instructional software and laboratory-module manuscript for *Journal of Materials Education*:

**Title:** *SOLIDIFY: A Real-Time, Browser-Native WebGPU Phase-Field Laboratory for Teaching Dendritic Solidification, Alloy Chemistry, and Heat Treatment*  
**Author:** Frank Cai (Purdue University, ORCID `0009-0003-0041-1459`)  
**Live Tool:** https://solidify.frankcai.dev/  
**Source & Turnkey Lab Pack (MIT License):** https://github.com/fronkt/solidify

**Brief Summary:**  
SOLIDIFY runs real-time 2D (`2048^2`) and 3D (`192^3`) phase-field solidification (Kobayashi similarity mode and a quantitative Karma–Rappel thin-interface solver with anti-trapping current matching published 2D solvability tip velocity to 1.2% and tip radius to 4.4%), a 118-element periodic alloy composer with CALPHAD-reconciled binary phase diagrams, foundry Lab Mode thermal analysis (cooling curves, step-block casting, Niyama porosity, Sievert's H2 rejection), and Arrhenius-coupled Monte Carlo Potts heat treatment directly in a standard browser with zero installation. The manuscript pairs the instrument with four ready-to-assign 50-minute undergraduate MSE laboratory worksheets, Run-Export ZIP grading workflows, and an explicit claim-by-claim transparency framework documenting where the model is quantitative versus qualitative.

Could you confirm the current JME submission instructions and share the latest formatting template so I can finalize the submission package?

Thank you for your time and consideration.

Best regards,  
Frank Cai  
Purdue University  
cai485@purdue.edu | https://orcid.org/0009-0003-0041-1459

---

## 2. Purdue nanoHUB Onboarding & Tool Registration Pitch

**To:** Purdue nanoHUB Tool / Education Team (`help@nanohub.org` or Purdue NCN faculty contact)  
**Subject:** Contributing a WebGPU Phase-Field Solidification Lab + Jupyter Analysis Module (*SOLIDIFY*) to nanoHUB

Hello nanoHUB Team,

I am a Purdue University research assistant (`cai485@purdue.edu`) and the developer of **SOLIDIFY** (https://solidify.frankcai.dev/, MIT License), a browser-native WebGPU phase-field solidification and physical-metallurgy laboratory.

SOLIDIFY lets undergraduate and graduate MSE students run real-time 2D and 3D (`192^3`) dendritic solidification (including a benchmarked Karma–Rappel thin-interface solver), explore a 118-element alloy composer with binary phase diagrams and Gulliver–Scheil segregation, pour 3D step-block castings with cooling-curve analysis and Niyama porosity, and run Arrhenius-coupled Potts heat treatments directly in the browser.

I have packaged a companion Jupyter notebook module (root `/middleware/invoke` + `nanohub/notebooks/Solidify_Interactive_Lab.ipynb` in https://github.com/fronkt/solidify, release `v8.0.0`) following the `nanohub-simple-jupyter-tool` layout that pairs one-click launchers for four 50-minute undergraduate MSE labs with Python post-processing of exported cooling-curve, Scheil, and Hall–Petch ZIP datasets.

I would love to publish SOLIDIFY as a nanoHUB tool / learning module with a citable DOI so MSE instructors across Purdue and other universities can assign it directly. Could you point me to the fastest workflow to register and install this hybrid WebGPU + Jupyter module on nanoHUB?

Best regards,  
Frank Cai  
Purdue University | cai485@purdue.edu

---

## 3. Purdue MSE Faculty / Prof. Xiaoming Wang: Classroom Pilot & NSF Broader Impacts Pitch

**To:** Prof. Xiaoming Wang / Purdue MSE Solidification & Undergraduate Curriculum Faculty  
**Subject:** Zero-install browser solidification lab (SOLIDIFY) for intro/undergrad MSE + NSF Broader Impacts

Dear Professor [Name],

I wanted to share a zero-install WebGPU solidification laboratory I built, **SOLIDIFY** (https://solidify.frankcai.dev/), along with four ready-to-assign 50-minute undergraduate lab worksheets (`docs/labs/` in the GitHub repo: dendrites & Karma–Rappel calibration, alloy chemistry & Scheil segregation, 3D step-block casting & Niyama porosity, and Arrhenius heat treatment & Hall–Petch design).

Because it runs locally on student laptops in Chrome/Edge/Safari/Firefox with no cluster accounts or software installs, and exports deterministic ZIP archives (`manifest.json` + CSVs + print-ready PNGs) with mid-pour intervention flags, it drops directly into an existing lecture demo or recitation lab. Its calibrated 2D solver is verified against Karma–Rappel (1998) tip velocity to 1.2% and Tong et al. (2001) tip radius to 4.4%, and its `/science/` companion page states every model boundary explicitly.

Two ways this might be useful to your group:
1. **Classroom pilot:** If you or a colleague teaching introductory MSE, phase transformations, or casting would like to try one of the 50-minute labs (or even a 10-minute live lecture demo), I am happy to customize a preset link for your syllabus and gather student feedback.
2. **NSF Broader Impacts / IUSE / nanoHUB:** We have also packaged SOLIDIFY as a citable Purdue nanoHUB module (`v8.0.0`) and completed a full `t = 1500` NIST PFHub Benchmark 3 run directly in browser WebGPU (`507 s`, matching published Penn State MOOSE to `0.14%` on free energy, `-0.31%` on solid fraction, and `-2.25%` on tip position; Zenodo DOI `10.5281/zenodo.24437743`). If you are preparing an NSF DMR, CAREER, or IUSE proposal that needs an already-built, verifiable interactive cyberinfrastructure deliverable for Broader Impacts, I would be glad to collaborate on embedding SOLIDIFY into it.

Happy to demo it in 5 minutes whenever convenient.

Best,  
Frank Cai  
cai485@purdue.edu

---

## 4. Emergent Ventures / 1517 Medici Grant Memo (Short-Form Application Pitch)

**Project:** SOLIDIFY (+ Browser-Native Scientific Instruments Suite)  
**Builder:** Frank Cai (high school senior, paid Purdue University RA, NSF ACCESS PI `CHE260157`)  
**Live demo:** https://solidify.frankcai.dev/ | **Code:** https://github.com/fronkt/solidify (MIT)

**What I built:**  
Most computational materials science lives either behind inaccessible HPC research codes (MOOSE, PRISMS-PF) or inaccurate classroom animations. I built **SOLIDIFY**, a real-time 2D and 3D (`192^3`, 7.1M voxels) WebGPU phase-field solidification and physical-metallurgy instrument running at 60 fps in a plain browser tab. Unlike toy demos, it passes 47 automated physics and UI verification scripts, including Karma–Rappel (1998) thin-interface tip velocity to 1.2%, Tong et al. (2001) tip radius to 4.4%, Gibbs–Thomson critical radius to 0.5%, width-independent anti-trapping partitioning, and a full `t = 1500` NIST PFHub Benchmark 3 dendritic-growth run completed in 507 s on a laptop iGPU (matching published Penn State MOOSE to 0.14% on free energy, -0.31% on solid fraction, and -2.25% on tip position; Zenodo DOI `10.5281/zenodo.24437743`), alongside a 118-element periodic alloy composer screening 708 base-element pairs with CALPHAD-checked invariants, 3D foundry casting with step-block molds and Niyama porosity, and Arrhenius-coupled Monte Carlo Potts heat treatment with Zener pinning and stored-energy recovery.

**What this grant funds (concrete 6-month milestones):**
1. Publish and maintain the NIST PFHub Benchmark 3 browser-WebGPU reference entry (`10.5281/zenodo.24437743`) and extend quantitative validation to 3D solidification benchmarks.
2. Deploy SOLIDIFY as a citable Purdue nanoHUB learning module and run controlled classroom pilots across 5–10 undergraduate MSE courses using our 4 turnkey 50-minute lab worksheets (measuring pre/post concept-inventory gains).
3. Extend the same zero-install WebGPU scientific-instrument architecture to companion interactive physics/chemistry simulators (starting with our WebGPU quantum-orbital and chemical-bonding laboratory, `Orbital`) so students worldwide can run quantitative computational experiments on any laptop GPU.

**Ask:** $5,000–$15,000 (Emergent Ventures) / $1,000 (1517 Medici microgrant) covering domain/hosting infrastructure, open-access/conference dissemination (TMS/ASEE student registration & travel), GPU testing hardware, and classroom pilot deployment.

---

## 5. Show HN / MatSci.org Launch Draft

**Title (Show HN):** `Show HN: Solidify – Real-time 2D/3D WebGPU phase-field solidification lab in the browser`

**Body:**  
Hi HN, I built SOLIDIFY (https://solidify.frankcai.dev/), an open-source, zero-install browser lab that solves coupled phase-field solidification PDEs directly on your GPU using WebGPU compute shaders (TypeScript + WGSL, MIT licensed: https://github.com/fronkt/solidify).

A few things under the hood that go past a visual demo:
- **Real physics, no scripted branches:** Runs both a multi-grain Kobayashi solver (`512^2`–`2048^2` in 2D, up to `192^3` = 7.1M voxels raymarched live in 3D) and a quantitative Karma–Rappel thin-interface solver with an anti-trapping current. Tested against Karma–Rappel (1998) 2D solvability tip velocity (1.2% error), Tong et al. (2001) tip radius (4.4%), Gibbs–Thomson critical radius (0.5%), and a full `t = 1500` NIST PFHub Benchmark 3 run completed in 507 s on a laptop iGPU (within 0.14% on free energy, -0.31% on solid fraction, and -2.25% on tip position of published Penn State MOOSE, with pixel-matched sidebranch contours).
- **Ten simultaneous lenses on one live casting:** Switch between incandescent melt, polarized grain orientation, etched optical micrograph, thermal camera, SEM relief, synchrotron X-ray solute segregation, interface curvature, and 3D serial sectioning.
- **118-element Alloy Composer:** Evaluates all 6 × 118 = 708 base-element pairs. 25 are backed by cited CALPHAD-reconciled binary invariants with live chord phase diagrams and Gulliver–Scheil eutectic readouts; the other 683 return computed physical refusals (Clausius–Clapeyron vapor pressure advisories like 59 atm for Zn over steel, Hägg interstitial ratio for Fe–C, checked monotectic miscibility gaps).
- **Foundry Lab Mode & Solid-State Heat Treatment:** Pour 3D step-block castings with live cooling-curve landmark extraction and Niyama porosity risk, then run hour-scale Arrhenius-integrated Monte Carlo Potts grain growth, Zener pinning, 3D Σ3 annealing twins (gated by real stacking-fault energy), and Hall–Petch yield strength specs.
- **Explicit honesty about limits:** The interactive `/science/` page (https://solidify.frankcai.dev/science/) lets you play with mini WebGPU experiments and states clearly what is quantitative vs. qualitative (for instance, why 2D coupled alloys cannot match physical Lewis numbers and why T6 precipitate aging is not modeled).

Needs a WebGPU browser (Chrome, Edge, Safari 26+, recent Firefox). Happy to answer questions on WGSL compute shaders, phase-field numerics, or materials science!
