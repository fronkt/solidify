# SOLIDIFY on nanoHUB

SOLIDIFY v8.0.0 is published on Purdue nanoHUB at [nanohub.org/resources/solidify](https://nanohub.org/resources/solidify) (DOI: [10.21981/C2CG-F533](https://doi.org/10.21981/C2CG-F533), Tool `#2572`, Resource `45643`).

This repository includes the launch wrapper and notebook powering the published tool ([`/middleware/invoke`](../middleware/invoke) -> [`nanohub/notebooks/Solidify_Interactive_Lab.ipynb`](notebooks/Solidify_Interactive_Lab.ipynb)).

## Files

- `/middleware/invoke`: Executable nanoHUB launch script (`100755`) calling `start_jupyter -t -c -T @tool nanohub/notebooks/Solidify_Interactive_Lab.ipynb` under `anaconda-7` (`-r none -w headless`).
- `nanohub/notebooks/Solidify_Interactive_Lab.ipynb`: Jupyter notebook linking to the WebGPU app (`https://solidify.frankcai.dev/app/`) alongside a Python analyzer for SOLIDIFY Run-Export ZIP/CSV archives (cooling-curve $dT/dt$, Gulliver-Scheil A356/AZ91 checks, Hall-Petch curves, and a built-in sample dataset).

## Citation

```bibtex
@misc{cai2026solidify_nanohub,
  author = {Cai, Frank Yang},
  title  = {SOLIDIFY: Interactive WebGPU Phase-Field Solidification \& Metallurgy Lab},
  month  = {Nov},
  year   = {2026},
  url    = {https://nanohub.org/resources/solidify},
  doi    = {10.21981/C2CG-F533}
}
```

## Updating the nanoHUB deployment

1. Push updates to `main` on `https://github.com/fronkt/solidify` (where `nanohub-apps` has read/write access).
2. Ensure `/middleware/invoke` stays Unix LF and executable (`100755`).
3. Open `https://nanohub.org/tools/solidify/status`, request an install, test-launch the notebook, and approve the new revision.
