"""Report EVERY command in a sanitized TDB that pycalphad's own grammar rejects.

Uses pycalphad's grammar directly, one command at a time, so the whole list
comes out in a single pass instead of one exception per run. These are
malformations in the published databases, not in the sanitizer -- so they are
listed verbatim and repaired individually, with each repair recorded.
"""
import sys, pathlib
from pycalphad.io.tdb import _tdb_grammar

g = _tdb_grammar()
path = sys.argv[1]
txt = pathlib.Path(path).read_text(errors="replace")
bad = []
for i, cmd in enumerate(txt.split("!")):
    # read_tdb joins continuation lines before parsing; feeding the grammar raw
    # multi-line text reports "unexpected indent" for every perfectly good
    # multi-line FUNCTION. Normalise whitespace first or the checker invents
    # hundreds of failures that the real parser does not have.
    s = " ".join(cmd.split())
    if not s:
        continue
    try:
        g.parse_string(s)
    except Exception as e:
        bad.append((i, s, str(e).split("\n")[0]))

print(f"{path}: {len(bad)} unparseable command(s)")
for i, s, e in bad:
    one = " ".join(s.split())
    print(f"\n[{i}] {e}\n    {one[:240]}")
