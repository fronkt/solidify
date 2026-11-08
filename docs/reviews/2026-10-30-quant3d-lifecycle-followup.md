# Read-only lifecycle patch follow-up

Reviewed the uncommitted main-checkout lifecycle patch after the independent 2bd7893 audit. No tracked source was edited by this reviewer; no browser/GPU/cloud work was run.

Executed from the isolated review worktree:

```text
node C:/Users/frank/solidify/scripts/verify-quant3d-tip-lifecycle.mjs C:/Users/frank/solidify-review-protocol/verify-out/fixed-lifecycle-review
```

Result: exit 0, `QPF3-TIP-LIFECYCLE OK`, all 13 modes passed. The positive subset remained unaccepted as a full study, and a launch-failure retry replaced a previously accepted artifact. Detailed rows are in `lifecycle-controls.json`; each case has its runner artifact and log.

No blocking defect found in the reviewed patch.

Verified by source review and the CLI controls:

- Fresh unaccepted result is saved before Chrome-argument parsing, launch, newPage and initial source hashing. Launch/newPage exceptions persist a refusal and exit 1, including a reused output directory.
- No interim assignment can make result.accepted true while terminal results are still being collected. The final assignment requires the all-arm/control verdict, a successfully read array-valued GPU ledger and sourceStable=true.
- Fixture completion/destruction, device cleanup, browser cleanup, ledger-query failure/missing ledger, and late page errors are retained as execution evidence failures and refuse acceptance.
- Final hashes are compared after browser cleanup, so normal source changes during execution fail the stability gate. Source-change test injection alters only the child process read result, not a file.
- Final status is derived after these checks, and agrees with the final accepted boolean and tested exit code.
- The property-getter ledger injection executes through the actual runner's array check and ledger read. It no longer relies on matching a particular serialization of that query.
- The stationarity contract/comment accurately limits its statement to retained rho samples and the three fitted four-sample velocities. Numerical analysis expressions and existing physical/error bands are unchanged in the inspected diff.

Scope: CPU lifecycle plumbing only; no new scientific acceptance or resolution of the acknowledged radius model-form limit is implied. This follow-up covers the requested lifecycle changes, not a fresh audit of all other in-progress main-checkout edits.
