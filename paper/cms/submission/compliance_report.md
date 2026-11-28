# Compliance report — Cai_TipSelection_CMS_manuscript.docx vs Computational Materials Science

| Status | Check | Detail |
|---|---|---|
| PASS | page size (section 1) | want (21.59, 27.94) cm, got (21.59, 27.94) cm |
| PASS | top margin (section 1) | want 2.54 cm, got 2.54 cm |
| PASS | bottom margin (section 1) | want 2.54 cm, got 2.54 cm |
| PASS | left margin (section 1) | want 2.54 cm, got 2.54 cm |
| PASS | right margin (section 1) | want 2.54 cm, got 2.54 cm |
| PASS | line numbers (section 1) | want continuous, got continuous |
| PASS | page numbers (section 1) | PAGE field in footer |
| PASS | Normal style font | want Times New Roman, got Times New Roman |
| PASS | Normal style size | want 12.0 pt, got 12.0 |
| PASS | Normal style line spacing | want 2.0, got 2.0 |
| PASS | theme-font overrides | no theme fonts in styles part |
| PASS | run-level font overrides | none found |
| PASS | run-level size overrides | none found |
| PASS | paragraph line-spacing deviations | none found |
| PASS | text highlighting | 0 highlighted runs |
| PASS | colored text (direct) | 0 colored runs (check deliberate vs leftover) |
| PASS | required section: Abstract | found |
| PASS | required section: Conclusions | found |
| PASS | required section: Data and code availability | found |
| PASS | required section: CRediT | found |
| PASS | required section: Declaration of competing interest | found |
| PASS | required section: Declaration of generative AI | found |
| PASS | required section: References | found |
| PASS | section order | Abstract → Introduction → Model and numerical method → Results → Discussion → Conclusions → Data and code availability → CRediT authorship contribution statement → Declaration of competing interest → Funding → Declaration of generative AI → References |
| PASS | abstract word count | limit 250, got 249 |
| PASS | keyword count | want 1–6, got 6 |

**26 checks: 26 PASS, 0 WARN, 0 FAIL**

## 5b. Word render (Microsoft Word via export_pdf.ps1)

- 33 pages, Letter, Times New Roman 12 pt, double spacing, continuous line numbers, page numbers: confirmed by
  reading the rendered PDF (title page, pages 5, 11, 18 and the reference list).
- Equations render as native Word math (529 OMML objects); no clipped equations seen on the pages read.
- Tables 1-5: cell text 9 pt single-spaced, columns autofit; Tables 1 and 5 fit the text width (Table 5 wraps two
  error cells onto a second line, acceptable for review).
- Six figures embedded inline with captions; separate files in `figures/` (vector PDF plus 600 dpi PNG).
- Graphical abstract 1535 x 590 px TIFF (minimum 1328 x 531) plus vector PDF.

## 5c. Semantic spot-check

- References: rendered by the elsevier-with-titles CSL, numbered in order of first citation; all 50 bibliography
  entries were checked against Crossref or DataCite (46 in paper/cms/refs-ledger.md; Solidify, Ji 2022 and
  Boccardo 2023 checked directly; the dataset is the paper's own Zenodo record); the 41 cited ones appear in the list.
- Section order and required statements: present (Data and code availability, CRediT, competing interest,
  funding, generative-AI declaration before the References).
- Open author items (not audit failures):
  1. Generative-AI declaration: placeholder with Elsevier's template sentence; the author writes it.
  2. KR96 Table I vs the published PRL and erratum PRL 78, 753 (1997): to be checked by the author.
  3. Zenodo draft 10.5281/zenodo.24617045: the author publishes it before submitting.
  4. Declaration of competing interest file: generated in Editorial Manager with Elsevier's tool.
