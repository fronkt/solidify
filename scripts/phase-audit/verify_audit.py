"""Fast audit-method regressions; requires the audit's numpy/pycalphad environment."""
from invariant import phase_vertices, model_limit, UnsupportedEquilibrium, wt_pct

row = phase_vertices(["LIQUID", "FCC_A1", ""], [0.7, 0.3, float("nan")], [0.1, 0.04, 0])
assert row == {"LIQUID": {"f": 0.7, "x": 0.1}, "FCC_A1": {"f": 0.3, "x": 0.04}}
try:
    phase_vertices(["HCP_A3", "HCP_A3"], [0.9, 0.1], [0.002, 0.99])
except UnsupportedEquilibrium as exc:
    assert "0.002" in str(exc) and "0.99" in str(exc)
else:
    raise AssertionError("distinct HCP composition sets were silently overwritten")
assert model_limit("FE", "SI", ["LIQUID", "BCC_A2", "FCC_A1"])
assert model_limit("MG", "ZR", ["LIQUID", "HCP_A3", "CBCC_A12"])
assert model_limit("NI", "NB", ["LIQUID", "FCC_A1", "DELTA"]) is None
assert abs(wt_pct(0.0491, "FE", "NI") - 5.147545467207776) < 1e-10
print("audit method: vertex preservation, duplicate refusal, model scope and Fe-Ni units passed")
