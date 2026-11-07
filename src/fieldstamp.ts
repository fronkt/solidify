/**
 * Which field an asynchronous read describes.
 *
 * A census (`readStats`) is submitted against the field as it is when the
 * read is ISSUED and resolves frames later. A reset, a clear, a lab pour or a
 * grid swap in between replaces that field, and the result then describes
 * the OLD cast: fed to the frame loop's consumers it seeds the replay ledger's
 * baseline (so the fresh pour reads as remelted), puts a stale undercooling on
 * the HUD right after `hud.reset()`, gives the lab record a first sample from
 * the previous melt, and drives the nucleation model, the analysis panel, the
 * challenge, the heat-treatment census and an applied recipe's cooling rate
 * from a field that is gone.
 *
 * Each solver counts its own resets (`fieldGen`, bumped first thing in
 * `reset()`); a swap is a different solver object. The stamp records both at
 * issue, and a result is consumed only while both still hold.
 */

/** a solver whose field can be replaced: `fieldGen` counts its resets */
export interface FieldOwner { readonly fieldGen: number }

/** the solver a read was issued against, and its reset count then */
export interface FieldStamp { readonly owner: FieldOwner; readonly gen: number }

export const stampField = (owner: FieldOwner): FieldStamp => ({ owner, gen: owner.fieldGen });

/** the stamped field is still the one on screen: same solver, no reset since */
export const stillCurrent = (stamp: FieldStamp, now: FieldOwner | null | undefined): boolean =>
  now === stamp.owner && now.fieldGen === stamp.gen;
