#!/usr/bin/env bash
# Build the CMS manuscript: ledger -> figures -> Table 1 -> docx + pdf. Run from the repository root:
#   bash paper/cms/build.sh
# Table 1 in manuscript.md is a copy of paper/cms/data/table1.md; re-paste it if the ledger changes.
set -euo pipefail
cd "$(dirname "$0")/../.."
python -I paper/cms/scripts/ledger.py
python -I paper/cms/scripts/figures.py
python -I paper/cms/scripts/tables.py > /dev/null
cd paper/cms
mkdir -p build
pandoc manuscript.md --citeproc --csl elsevier-with-titles.csl --resource-path=. \
  -o build/manuscript.docx
pandoc manuscript.md --citeproc --csl elsevier-with-titles.csl --resource-path=. \
  --pdf-engine=xelatex -V geometry:margin=25mm -V fontsize=11pt -V linestretch=1.4 \
  -V mainfont="Times New Roman" -V mathfont="Cambria Math" \
  -o build/manuscript.pdf
echo "built paper/cms/build/manuscript.{docx,pdf}"
