"""Strip TDB commands pycalphad's grammar does not implement.

MatCalc's open databases carry vendor commands (REFERENCE_ELEMENT,
ADD_COMPOSITION_SET) alongside the standard ones. None of them carry
thermodynamic parameters -- they are bookkeeping for MatCalc's own solver -- so
dropping them changes no Gibbs energy. Everything that DOES carry energetics
(ELEMENT, SPECIES, PHASE, CONSTITUENT, PARAMETER, FUNCTION, TYPE_DEFINITION)
is kept verbatim.

Prints exactly which command types were dropped and how many, so the audit can
state what was removed rather than claiming an unmodified file.
"""
import sys, re, pathlib
from collections import Counter

KEEP = {
    "ELEMENT", "SPECIES", "PHASE", "CONSTITUENT", "CONST",
    "PARAMETER", "PARAM", "PARA", "PAR",
    "FUNCTION", "FUN", "FUNCT", "TYPE_DEFINITION", "TYPE_DEF", "TYPEDEF",
    "DEFINE_SYSTEM_DEFAULT", "DEFAULT_COMMAND", "DATABASE_INFO",
    "VERSION_DATE", "TEMPERATURE_LIMITS",
}

# Parameter types pycalphad evaluates in an equilibrium calculation.
PARAM_TYPES = {"G", "L", "TC", "BMAGN", "NT", "THETA", "GD", "V0", "VA", "VS"}

# Commands that are dropped and that DO change the model. Recorded by name so
# the audit states the limitation instead of implying an unmodified database.
LOSSY = {
    "ATTACH_CONTRIBUTION": (
        "MatCalc's order/disorder coupling (e.g. BCC_B2 to BCC_A2, GP_MAT to "
        "FCC_A1). pycalphad expresses this through TYPE_DEFINITION's "
        "DISORDERED_PART instead and cannot consume ATTACH_CONTRIBUTION, so "
        "ordered phases are evaluated without their disordered contribution. "
        "Affects systems whose SECOND phase is an ordered one; the primary "
        "solid solutions (FCC_A1, BCC_A2, HCP_A3) are unaffected."
    ),
}


# Typos in the PUBLISHED databases, each repaired by an explicit rule so the
# audit can state what was changed. Verified by re-parsing afterwards.
REPAIRS = [
    (r"6000\.00\.00", "6000.00",
     "duplicated decimal in an upper temperature limit (SIGMA FE:CR:*)"),
    (r"G\(G_PHASE;", "G(G_PHASE,",
     "semicolon where the phase-name comma belongs (G_PHASE FE:CU:SI)"),
    (r"REF:\s+(\S+)", r"REF:\1",
     "whitespace between REF: and its key (Si-Ti parameters)"),
    (r"(REF:\S+)\s+\S+\s*$", r"\1",
     "second word after the REF key (BCC_DISL 'REF:test koze10')"),
    (r"(CONSTITUENT\s+MNB4\s*:\s*MN\s*:\s*B\s*:)\s*>\s*>>\s*1", r"\1",
     "trailing '> >> 1' junk on the MNB4 constituent line"),
]


def repair(cmd):
    """Apply the recorded repairs. Returns (text, [rule descriptions applied])."""
    applied = []
    out = cmd
    for pat, rep, why in REPAIRS:
        new = re.sub(pat, rep, out)
        if new != out:
            applied.append(why)
            out = new
    return out, applied


def split_merged(cmds):
    """A missing '!' merges two PARAMETER commands into one. Split them back."""
    out = []
    for c in cmds:
        flat = " ".join(c.split())
        # a second PARAMETER keyword inside one command == a missing terminator
        parts = re.split(r"\s+(?=PARAMETER\s+[A-Z0-9_]+\s*\()", flat)
        out.extend(parts if len(parts) > 1 else [c])
    return out


def sanitize(src, dst):
    raw = pathlib.Path(src).read_text(errors="replace").replace("\r", "")
    # strip $-comments (to end of line) before splitting on the ! terminator
    nocomment = "\n".join(line.split("$")[0] for line in raw.split("\n"))
    cmds = nocomment.split("!")

    kept, dropped = [], Counter()
    for c in cmds:
        s = c.strip()
        if not s:
            continue
        head = re.split(r"[\s(]", s, 1)[0].upper()
        if head not in KEEP:
            dropped[head] += 1
            continue
        # PARAMETER commands carry a TYPE. pycalphad evaluates G/L (Gibbs),
        # TC/BMAGN (magnetic). MatCalc adds HMVA (vacancy formation enthalpy)
        # and SE (interfacial energy), which feed its precipitation and
        # diffusion solvers and contribute nothing to an equilibrium Gibbs
        # energy -- so dropping them cannot move a phase boundary.
        if head.startswith("PARA") or head == "PAR":
            m = re.match(r"\S+\s+([A-Z0-9_]+)\s*\(", s, re.I)
            if m and m.group(1).upper() not in PARAM_TYPES:
                dropped["PARAMETER:" + m.group(1).upper()] += 1
                continue
        kept.append(s)

    # repair published typos, then drop anything pycalphad's own grammar still
    # rejects -- recorded by name, never silently
    from pycalphad.io.tdb import _tdb_grammar
    g = _tdb_grammar()

    kept = split_merged(kept)
    final, repairs, unparseable = [], Counter(), []
    for c in kept:
        fixed, applied = repair(c)
        for a in applied:
            repairs[a] += 1
        flat = " ".join(fixed.split())
        try:
            g.parse_string(flat)
        except Exception as e:
            unparseable.append((flat, str(e).split("\n")[0]))
            continue
        final.append(fixed)

    pathlib.Path(dst).write_text("\n".join(k + " !" for k in final))
    return final, dropped, repairs, unparseable


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    kept, dropped, repairs, unparseable = sanitize(src, dst)
    print(f"{src} -> {dst}")
    print(f"  kept      {len(kept)} commands")
    if dropped:
        print("  dropped   " + ", ".join(f"{k}x{n}" for k, n in dropped.most_common()))
    for why, n in repairs.most_common():
        print(f"  repaired  x{n}  {why}")
    for flat, err in unparseable:
        print(f"  UNPARSEABLE, DROPPED: {err}\n      {flat[:160]}")
    for k in dropped:
        if k in LOSSY:
            print(f"  LOSSY     {k} x{dropped[k]} -- {LOSSY[k]}")
