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
  2. KR96 Table I vs the published PRL and erratum PRL 78, 753 (1997): CHECKED 2026-11-27 from the author's
     library copies. Table I identical to arXiv v1; the erratum corrects only Eq. (7), the form used here.
  3. Zenodo draft 10.5281/zenodo.24617045: the author publishes it before submitting.
  4. Declaration of competing interest file: generated in Editorial Manager with Elsevier's tool.
