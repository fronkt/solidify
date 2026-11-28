#!/usr/bin/env bash
# Build the CMS submission manuscript from paper/cms/manuscript.md, apply the approved spec, audit it and
# render it with Word. Run from the repository root: bash paper/cms/submission/build_submission.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SKILL="C:/Users/frank/.claude/skills/journal-submission/scripts"
OUT=submission/Cai_TipSelection_CMS_manuscript.docx
pandoc manuscript.md --citeproc --csl elsevier-with-titles.csl --resource-path=. -o "$OUT"
python "$SKILL/apply_format.py" "$OUT" --spec submission/requirements.md --out "$OUT"
python - "$OUT" <<'PY'
import sys
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_LINE_SPACING
d = Document(sys.argv[1])
st = d.styles["Title"]
st.font.size = Pt(16); st.font.bold = True; st.font.name = "Times New Roman"
st.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
st.paragraph_format.space_after = Pt(12)
# table cells use pandoc's "Compact" paragraph style: 9 pt, single spaced; columns autofit to content
cs = d.styles["Compact"]
cs.font.size = Pt(9); cs.font.name = "Times New Roman"
cs.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
cs.paragraph_format.space_before = Pt(0); cs.paragraph_format.space_after = Pt(0)
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
for t in d.tables:
    t.autofit = True
    tblPr = t._tbl.tblPr
    lay = tblPr.find(qn("w:tblLayout"))
    if lay is None:
        lay = OxmlElement("w:tblLayout"); tblPr.append(lay)
    lay.set(qn("w:type"), "autofit")
    for row in t.rows:
        for cell in row.cells:
            for par in cell.paragraphs:
                par.style = cs
                par.paragraph_format.line_spacing = None
d.save(sys.argv[1])
print("title and table styles set")
PY
python "$SKILL/audit.py" "$OUT" --spec submission/requirements.md --out submission/compliance_report.md | tail -2
# the render and spot-check notes (stages 5b/5c) live in their own file so a rebuild cannot erase them
{ echo; cat submission/compliance_notes.md; } >> submission/compliance_report.md
powershell -NoProfile -ExecutionPolicy Bypass -File "$SKILL/export_pdf.ps1" -DocxPath "$(cygpath -w "$PWD/$OUT")"
