import type { PeriodRecord, Repos } from "../repos/types.ts";

// Keeping stored starting amounts in step. See "Carrying leftover forward" and "Manual
// starting amount" in docs/plan/domain.md for the rules these functions implement.
// All of them must be called inside the transaction that made the change.

/**
 * Projected leftover: the starting amount plus every transaction in the period, paid or
 * not. It is what the period is expected to end with, and so what the next one starts with.
 */
export async function projectedLeftover(repos: Repos, period: PeriodRecord): Promise<number> {
  const { paidCents, upcomingCents } = await repos.transactions.sumInRange(
    period.userId,
    period.startDate,
    period.endDate,
  );
  return period.startingCents + paidCents + upcomingCents;
}

/**
 * The projected leftover of the period at `afterSeq` changed by `deltaCents`: move every
 * later period's starting amount by the same amount, up to (not including) the first one
 * whose starting amount was set by hand. A manual amount is pinned, so nothing beyond it
 * depends on what came before.
 *
 * Working in differences (rather than recalculating) is deliberate: a period marked stale
 * keeps following new transactions while still holding the gap the user chose not to carry.
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

/**
 * Flags every period after `afterSeq`, up to the next manual one, as possibly out of date.
 * Used when a starting amount is changed by hand and the user chose not to carry it forward.
 */
export async function markStaleAfter(repos: Repos, userId: string, afterSeq: number, now: Date): Promise<void> {
  for (const period of await repos.periods.listFromSeq(userId, afterSeq + 1)) {
    if (period.startingMode === "manual") return;
    if (!period.carryStale) await repos.periods.update(userId, period.id, { carryStale: true }, now);
  }
}

/**
 * Recalculates starting amounts from the period at `fromSeq` onward: each becomes the
 * projected leftover of the one before it (the opening balance for the very first), until
 * a manual period is reached. A recalculated amount is exactly as trustworthy as the
 * period it was derived from, so it is stale only if that one is.
 */
export async function recomputeChain(
  repos: Repos,
  userId: string,
  fromSeq: number,
  openingCents: number,
  now: Date,
): Promise<void> {
  const chain = await repos.periods.listFromSeq(userId, Math.max(0, fromSeq - 1));
  let previous = fromSeq > 0 ? (chain.shift() ?? null) : null;

  for (const [index, period] of chain.entries()) {
    // The caller decides what happens to the period it starts on; later manual ones are pinned.
    if (index > 0 && period.startingMode === "manual") return;

    const startingCents = previous ? await projectedLeftover(repos, previous) : openingCents;
    const carryStale = previous !== null && previous.startingMode === "auto" && previous.carryStale;
    await repos.periods.update(userId, period.id, { startingCents, carryStale }, now);
    previous = { ...period, startingCents, carryStale };
  }
}
