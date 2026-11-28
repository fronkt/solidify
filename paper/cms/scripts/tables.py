"""Table 1 (run list) for the CMS paper, generated from paper/cms/data/ledger.json."""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
L = json.load(open(os.path.join(ROOT, "paper", "cms", "data", "ledger.json"), encoding="utf-8"))
EQ = L["equilibrium"]


def eff(raw, dx):
    m = [e for e in EQ if e["R"] == 20 and e["dx"] == dx and abs(e["epsRaw"] / raw - 1) < 1e-6]
    return m[0]["epsEff"] if m else None


GPU = {"NVIDIA L40S": "L40S", "NVIDIA RTX 5090": "RTX 5090", "Intel Arc 140V": "Arc 140V"}
LABEL = {("lattice-5arm", "base"): "A0 base", ("lattice-5arm", "domain"): "A0 domain", ("lattice-5arm", "dt"): "A0 dt/2",
         ("lattice-5arm", "width"): "A0 width", ("lattice-5arm", "dx"): "A0 grid",
         ("q3c-W1", "w50"): "W 5.0", ("q3c-W1", "w44"): "W 4.4", ("q3c-W1", "w40-anchor"): "W 4.0",
         ("q3c-A", "w40-anchor"): "W 4.0", ("q3c-A", "w32"): "W 3.2", ("q3c-A", "w28"): "B base",
         ("q3c-B", "domain"): "B domain", ("q3c-B", "dt"): "B dt/2", ("q3c-B", "width"): "B width",
         ("q3c-B", "dx"): "B grid", ("q3d-s1", "e171cal"): "C 0.0171", ("q3d-s1", "e265base"): "R 0.0265 base",
         ("q3d-s1", "e265width"): "R 0.0265 width", ("q3d-s1", "e265dx"): "R 0.0265 grid",
         ("q3d-s2", "e265cal"): "C 0.0265", ("q3d-s2", "e123cal"): "C 0.0123", ("q3d-s3", "e265cal06"): "C 0.0265 grid"}
rows = []
for a in L["arms"]:
    if not a.get("ready", True):
        continue
    e = eff(a["epsRaw"], a["dx"])
    d = a["dims"]
    rows.append("| %s | %s | %.6g | %s | %.2f | %.1f | %d×%d×%d | %.5f | %s | %s |" % (
        LABEL[(a["session"], a["name"])], GPU[a["gpu"]], a["epsRaw"], ("%.5f" % e) if e else "-", a["lambda"], a["dx"],
        d[0], d[1], d[2], a["dt"], f"{a['steps']:,}" if a.get("steps") else "-",
        ("%.0f" % a["wallMinutes"]) if a.get("wallMinutes") else "-"))
head = (r"| run | GPU | input $\varepsilon_4$ | $\varepsilon_\mathrm{eff}$ | $\lambda$ | $\Delta x/W_0$ | grid | "
        r"$\Delta t/\tau_0$ | steps | wall (min) |" + "\n" +
        # dash counts set the relative column widths in pandoc's docx output
        "|" + "|".join(["-" * 12, "-" * 9, "-" * 10 + ":", "-" * 9 + ":", "-" * 5 + ":", "-" * 6 + ":",
                        "-" * 15, "-" * 9 + ":", "-" * 9 + ":", "-" * 6 + ":"]) + "|")
out = head + "\n" + "\n".join(rows) + "\n"
open(os.path.join(ROOT, "paper", "cms", "data", "table1.md"), "w", encoding="utf-8").write(out)
print(out)
