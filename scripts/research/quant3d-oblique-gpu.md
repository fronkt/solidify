# Rational-plane production-WGSL controls

This research harness uses the full production pure-3D equations. An integer
plane index is m dot latticeCell for primitive normal m. The physical normal
spacing is dx/length(m), while all lab derivatives retain their production dx.
A planeNeighbour geometry adapter replaces each neighbour address by the exact
integer shift m dot displacement. The plane index is packed into a 3D texture.
No scalar, gradient, anisotropy, local relaxation or heat expression is replaced.
Every specialization must reverse byte-for-byte to the original rectangular
source after removing its geometry adapters.

Native controls use 32-cube specimens whose Float32 inputs are exact samples of
the same manufactured plane line, constant identity grain orientations, no noise
or external program, and default or explicitly opt-in principal kinetic model.
Compare state, grain and age at steps1/2/4 on interiors2/4/8 cells from each face.
Those margins cover the radius-two domain of dependence per substep. Initial
fields must agree exactly at every compared coordinate; all evolved field bytes
must match, and state evolution must be nonzero. A wrong-normal quotient must
evolve valid fields and fail the native comparison, rather than fail setup.

Normals100/110/111 control the reduction;210/211 are oblique and321 is held out.
Periodic manufactured CPU controls and finite-front controls are separate. A
finite front needs prospective physical far-boundary clearance and timestep/
domain controls; kernel equality alone supplies no travelling-wave, kinetic,
stability, capillary, needle or Q3 acceptance.

Packed row/slice faces do not represent physical walls. Their six rectangular
normal-flux reflection predicates are disabled, with reversible source proof.
Periodic mode wraps the plane index. Clamp mode extends plane-end scalar/flux
values constantly; it is not a native box-wall validation. Native equality is
claimed only on the specified interiors, and finite fronts require independent
normal-end clearance/domain controls.

The actual GPU experiment is opt-in. Source hashes, exact source bytes, input
hashes, actual clocks, raw field hashes, hardware metadata, readable device-error
ledger and successful cleanup are required before execution completion.
