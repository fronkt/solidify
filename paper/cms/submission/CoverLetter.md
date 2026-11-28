Frank Cai\
Purdue University, West Lafayette, IN 47907, USA\
frankyc11223@gmail.com

[DATE]

The Editors\
*Computational Materials Science*

Dear Editors,

I am submitting the manuscript "Single precision is not the limiting error: convergence and error budget of
three-dimensional dendrite tip selection with a WebGPU phase-field solver" for consideration as a research
article in *Computational Materials Science*.

The paper tests a thin-interface phase-field solver written for WebGPU, the browser GPU interface whose shading
language has no 64-bit floating-point type, against the three-dimensional dendrite tip-selection results of
Karma and Rappel (1996). It reports a full error budget for that benchmark. A float64 transliteration of the
same discrete update changes the tip selection constant by at most 0.13%, so single precision is not what limits
the result. The larger effects are the definition of the anisotropy strength (Karma and Rappel's value is
grid-corrected, and matching it moves the result by 5-6%), the lattice spacing, and a slow, linear convergence in
interface width. Together these are as large as the 9-13% difference between Karma and Rappel's phase-field and
solvability values, which limits how sharply this benchmark can discriminate between them. The paper also
documents a sampling artifact that can bias tip-radius measurements on a lattice and how to avoid it.

I believe the work fits the journal's interest in validated computational methods: it validates a
non-first-principles method against a published three-dimensional reference, quantifies each numerical error
separately, and shows that a portable single-precision browser solver meets the same standard as conventional
codes. The source code, run protocols, result files and the scripts that produce every number and figure are
public (https://github.com/fronkt/solidify, tag cms-submission-1), and the raw checkpoint data are deposited on
Zenodo (doi:10.5281/zenodo.24617045).

This manuscript has not been published and is not under consideration elsewhere. A separate manuscript on the
same software as a teaching tool (two-dimensional, qualitative) is under review at the *Journal of Materials
Education*; it contains none of the three-dimensional results reported here.

Suggested referees:

1. Dr. Damien Tourret, IMDEA Materials Institute, Madrid, Spain (damien.tourret@imdea.org): GPU phase-field
   solvers, their numerical accuracy, and quantitative dendrite modelling.
2. Prof. Tomohiro Takaki, Kyoto Institute of Technology, Japan (takaki@kit.ac.jp): large-scale GPU and
   adaptive-mesh phase-field simulations of three-dimensional dendrites.
3. Dr. Mathis Plapp, CNRS, Laboratoire de Physique de la Matière Condensée, École Polytechnique, France
   (mathis.plapp@polytechnique.fr): thin-interface phase-field theory and three-dimensional dendrite tip
   morphology.

Alternate: Prof. Andrew M. Mullis, University of Leeds, UK (A.M.Mullis@leeds.ac.uk): mesh-induced anisotropy
in phase-field methods.

Thank you for considering this submission.

Sincerely,

Frank Cai
