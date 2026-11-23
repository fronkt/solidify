# SOLIDIFY on nanoHUB

This repository includes the launch wrapper and notebook required to register SOLIDIFY as a Jupyter tool on Purdue nanoHUB ([`/middleware/invoke`](../middleware/invoke) -> [`nanohub/notebooks/Solidify_Interactive_Lab.ipynb`](notebooks/Solidify_Interactive_Lab.ipynb)).

## Files

- `/middleware/invoke`: Executable nanoHUB launch script (`100755`) that calls `start_jupyter` on the lab notebook.
- `nanohub/notebooks/Solidify_Interactive_Lab.ipynb`: Jupyter notebook linking to the WebGPU app (`https://solidify.frankcai.dev/app/`) alongside a Python analyzer for SOLIDIFY Run-Export ZIP/CSV archives (cooling-curve $dT/dt$, Gulliver-Scheil A356/AZ91 checks, Hall-Petch curves, and a built-in sample dataset).

## Registration steps on nanoHUB.org

1. Sign in at `https://nanohub.org/`.
2. Invite **`nanohub-apps`** as a collaborator on `https://github.com/fronkt/solidify/settings/access` so nanoHUB can pull updates.
3. Open `https://nanohub.org/tools/create` and set:
   - **Tool Short Name:** `solidify` (matches `-t solidify` in `/middleware/invoke`)
   - **Repository Host:** `Host GIT repository on GitHub`
   - **Repository URL:** `https://github.com/fronkt/solidify`
   - **Type:** `Publish as a Jupyter notebook`
4. Open `https://nanohub.org/tools/solidify/status`, install for testing, verify the notebook launches cleanly, and request publication.
