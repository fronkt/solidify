# Publishing SOLIDIFY on nanoHUB (Purdue University)

This folder packages **SOLIDIFY** as a nanoHUB Jupyter-backed interactive learning module + Run-Export analysis workbench so students and instructors worldwide can launch the live WebGPU instrument, run all four undergraduate MSE labs, and analyze exported cooling-curve, Scheil, and Hall–Petch datasets directly inside nanoHUB — earning a **citable nanoHUB DOI** and **tracked global usage & classroom metrics**.

## Included Files
- `middleware/invoke` — nanoHUB middleware launcher (`start_jupyter`)
- `notebooks/Solidify_Interactive_Lab.ipynb` — interactive lab guide, deep-link launcher to [solidify.frankcai.dev](https://solidify.frankcai.dev/app/), and Run-Export ZIP/CSV quantitative analyzer (includes embedded sample dataset so every cell executes out of the box)

## Step-by-Step Deployment on nanoHUB.org
1. Log in at [nanohub.org](https://nanohub.org) (use your `@purdue.edu` account).
2. Navigate to **Contribute → Register a New Tool** (or contact the Purdue nanoHUB developer support team directly to fast-track an external WebGPU + Jupyter companion module).
3. Reserve tool short name: `solidify` (title: *SOLIDIFY: Real-Time WebGPU Phase-Field Solidification & Metallurgy Lab*).
4. Push or mirror this `nanohub/` directory into the assigned nanoFORGE / GitHub tool repository so `middleware/invoke` and `notebooks/Solidify_Interactive_Lab.ipynb` sit at the tool root (ensure `chmod +x middleware/invoke`).
5. Test inside your nanoHUB workspace (`Test` environment) and verify all notebook cells run cleanly with the embedded sample data and ZIP upload widget.
6. Submit **Request Installation** → verify in **nanoHUB Apps** → fill out Tool Description, Author ORCID (`0009-0003-0041-1459`), References, and MIT License → click **Publish** to mint your permanent **nanoHUB DOI**.
