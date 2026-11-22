# SOLIDIFY on nanoHUB (Purdue University)

This repository is ready for direct GitHub registration as a Purdue nanoHUB Jupyter learning tool (executable root [`/middleware/invoke`](../middleware/invoke) -> [`nanohub/notebooks/Solidify_Interactive_Lab.ipynb`](notebooks/Solidify_Interactive_Lab.ipynb)).

## Contents
- `/middleware/invoke`: Root nanoHUB executable launch wrapper (`git update-index --chmod=+x middleware/invoke`) invoking `start_jupyter` on the interactive lab notebook.
- `nanohub/notebooks/Solidify_Interactive_Lab.ipynb`: Interactive Jupyter notebook combining one-click launchers into the live WebGPU instrument (`https://solidify.frankcai.dev/app/`) with a Python Run-Export ZIP/CSV analyzer (cooling-curve $dT/dt$, Gulliver-Scheil A356/AZ91 validation, and Hall-Petch yield-strength curves, plus a built-in sample dataset).

## Publishing on nanoHUB.org (5-minute checklist)
1. Sign in at `https://nanohub.org/` with your Purdue account.
2. On GitHub (`https://github.com/fronkt/solidify/settings/access`), invite **`nanohub-apps`** as a collaborator so nanoHUB can pull and build updates automatically.
3. Open `https://nanohub.org/tools/create` and fill in:
   - **Tool Short Name:** `solidify` (matches `-t solidify` in `/middleware/invoke`)
   - **Repository Host:** `Host GIT repository on GitHub`
   - **Repository URL:** `https://github.com/fronkt/solidify`
   - **Type:** `Publish as a Jupyter notebook`
4. Visit `https://nanohub.org/tools/solidify/status` and click **have it installed for testing**, then verify the notebook launches cleanly and request publication to mint an official citable **nanoHUB DOI** and begin tracked educator/student usage metrics.
