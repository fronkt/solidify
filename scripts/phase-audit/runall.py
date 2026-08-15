"""Run the invariant calculation for all 25 of Solidify's (base, solute) pairs.

One JSON per system in results/. Runs several systems concurrently -- each is a
separate process, so a system that diverges or hangs cannot take the batch with
it. Every system records the database, the scan window and the phases suspended,
so a row can be re-derived from its own output file alone.

The scan window per base is set from that base's melting point and the region
its invariants are known to sit in. The window is an INPUT to the search, not an
answer: a window that excludes the invariant makes the system report
NO_INVARIANT_IN_RANGE rather than inventing one, which is why each is recorded.
"""
import json, pathlib, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = pathlib.Path(__file__).parent
PY = str(HERE / "pdaudit" / "Scripts" / "python.exe")
OUT = HERE / "results"
OUT.mkdir(exist_ok=True)

AL = "tdbc/mc_al_v2037.tdb"
FE = "tdbc/mc_fe_v2062.tdb"
NI = "tdbc/mc_ni_v2036.tdb"
SN = "tdbc/NIST-solder.tdb"

# base, solute, tdb, tmin, tmax, xmax, xmin, nscan
SYSTEMS = [
    # --- aluminium base (Tm 660.3 C / 933.5 K) --------------------------------
    ("al", "AL", "CU", AL,  700, 960, 0.40, 1e-3, 12),
    ("al", "AL", "SI", AL,  780, 960, 0.35, 1e-3, 12),
    ("al", "AL", "MG", AL,  650, 960, 0.45, 1e-3, 12),
    ("al", "AL", "ZN", AL,  600, 960, 0.97, 1e-3, 14),
    ("al", "AL", "FE", AL,  800, 980, 0.10, 1e-4, 12),
    # Al-Ti: L + Al3Ti -> Al peritectic at 665 C, ABOVE pure Al's melting point,
    # and at only ~0.15 wt% Ti (x ~ 8.5e-4) -- so both the ceiling and the
    # dilute start have to be opened up or the scan steps straight over it.
    ("al", "AL", "TI", AL,  850, 1100, 0.05, 1e-5, 14),

    # --- iron base (Tm 1538 C / 1811 K) ---------------------------------------
    ("fe", "FE", "C",  FE, 1350, 1830, 0.10, 1e-4, 12),
    ("fe", "FE", "MN", FE, 1300, 1830, 0.55, 1e-3, 12),
    ("fe", "FE", "SI", FE, 1150, 1830, 0.55, 1e-3, 18),
    ("fe", "FE", "NI", FE, 1500, 1830, 0.60, 1e-3, 12),
    ("fe", "FE", "CR", FE, 1500, 1950, 0.75, 1e-3, 14),
    ("fe", "FE", "MO", FE, 1600, 1830, 0.40, 1e-3, 12),

    # --- nickel base (Tm 1455 C / 1728 K) -------------------------------------
    ("ni", "NI", "NB", NI, 1450, 1750, 0.35, 1e-3, 12),
    ("ni", "NI", "TI", NI, 1450, 1750, 0.35, 1e-3, 12),
    ("ni", "NI", "AL", NI, 1500, 1980, 0.40, 1e-3, 14),
    ("ni", "NI", "CR", NI, 1500, 1750, 0.60, 1e-3, 12),
    ("ni", "NI", "MO", NI, 1500, 1900, 0.42, 1e-3, 14),
    ("ni", "NI", "W",  NI, 1600, 1900, 0.35, 1e-3, 12),

    # --- magnesium base (Tm 650 C / 923 K) ------------------------------------
    ("mg", "MG", "AL", AL,  650, 940, 0.45, 1e-3, 12),
    ("mg", "MG", "ZN", AL,  580, 940, 0.35, 1e-3, 12),
    ("mg", "MG", "ZR", AL,  850, 1100, 0.05, 1e-5, 14),

    # --- copper base (Tm 1085 C / 1358 K) -------------------------------------
    ("cu", "CU", "SN", SN,  900, 1380, 0.35, 1e-3, 12),
    ("cu", "CU", "ZN", AL,  900, 1380, 0.55, 1e-3, 12),
    ("cu", "CU", "NI", AL, 1300, 1780, 0.85, 1e-3, 14),

    # --- zinc base (Tm 419.5 C / 692.7 K) -------------------------------------
    ("zn", "ZN", "AL", AL,  550, 720, 0.40, 1e-3, 12),
]


def one(spec):
    key, base, sol, tdb, tmin, tmax, xmax, xmin, nscan = spec
    dst = OUT / f"{key}-{sol}.json"
    cmd = [PY, "invariant.py", tdb, base, sol,
           "--tmin", str(tmin), "--tmax", str(tmax), "--xmax", str(xmax),
           "--xmin", str(xmin), "--nscan", str(nscan)]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=3000)
        txt = p.stdout.strip()
        i = txt.find("{")
        data = json.loads(txt[i:]) if i >= 0 else {"status": "NO_OUTPUT",
                                                   "stderr": p.stderr[-800:]}
    except subprocess.TimeoutExpired:
        data = {"status": "TIMEOUT"}
    except Exception as e:
        data = {"status": "RUNNER_ERROR", "error": f"{type(e).__name__}: {e}"}
    data["_spec"] = {"key": key, "base": base, "solute": sol, "tdb": tdb,
                     "tmin": tmin, "tmax": tmax, "xmax": xmax, "xmin": xmin}
    data["_seconds"] = round(time.time() - t0, 1)
    dst.write_text(json.dumps(data, indent=2, default=str))
    return key, sol, data.get("status"), data.get("_seconds")


if __name__ == "__main__":
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    todo = [s for s in SYSTEMS if not only or f"{s[0]}-{s[2]}" in only or s[0] in only]
    print(f"running {len(todo)} systems, 5 at a time", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = {ex.submit(one, s): s for s in todo}
        for f in as_completed(futs):
            key, sol, status, secs = f.result()
            done += 1
            print(f"[{done}/{len(todo)}] {key}-{sol:<3} {status:<28} {secs}s", flush=True)
    print("BATCH DONE", flush=True)
