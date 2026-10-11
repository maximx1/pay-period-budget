import type { Repos } from "../repos/types.ts";

/**
 * Keeps stored starting amounts in step after the projected leftover of the period at
 * `afterSeq` changed by `deltaCents`: every later period's starting amount moves by the
 * same amount, up to (not including) the first one whose starting amount was set by hand.
 * A manual amount is pinned, so nothing beyond it depends on what came before.
 * Call inside the transaction that made the change.
 */
export async function applyLeftoverDelta(
  repos: Repos,
  userId: string,
  afterSeq: number,
  deltaCents: number,
  now: Date,
): Promise<void> {
  if (deltaCents === 0) return;
  for (const period of await repos.periods.listFromSeq(userId, afterSeq + 1)) {
    if (period.startingMode === "manual") return;
    await repos.periods.update(userId, period.id, { startingCents: period.startingCents + deltaCents }, now);
  }
}
