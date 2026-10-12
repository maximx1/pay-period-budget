import { dateOf } from "../../shared/dates.ts";
import type { CountedToward } from "../../shared/transactions.ts";
import type { Repos, TransactionRecord } from "../repos/types.ts";
import { applyLeftoverDelta } from "./carry.ts";

// Tying a transaction to a recurring item, and counting a payment toward the upcoming
// entry the item generated. See "Linking to a recurring item" in docs/plan/domain.md.
// Used for one transaction and for a whole import alike, inside the caller's transaction.

export type LinkRequest = {
  /** The item to tie the transaction to; null or undefined for none. */
  recurringId?: string | null;
  /** An upcoming transaction the item generated, which this one pays part or all of. */
  countsToward?: string;
  /** The new transaction's signed amount. */
  amountCents: number;
};

export type LinkProblems = Partial<Record<"recurringId" | "countsToward", string>>;

// One wording whether the id is unknown or someone else's: it must not say which.
const NO_SUCH_ITEM = "No such recurring item";
const NO_SUCH_TRANSACTION = "No such transaction";

/**
 * Checks links one transaction at a time and keeps count of what is left of each entry
 * being paid toward, so that several payments in one import can share an entry. Nothing
 * is written until `apply`.
 */
export function createLinkPlanner(repos: Repos, userId: string) {
  let itemIds: Set<string> | null = null;
  const targets = new Map<string, { record: TransactionRecord; remainingCents: number } | null>();

  async function knownItem(id: string): Promise<boolean> {
    itemIds ??= new Set((await repos.recurring.list(userId)).map((item) => item.id));
    return itemIds.has(id);
  }

  async function targetOf(id: string) {
    if (!targets.has(id)) {
      const record = await repos.transactions.findById(userId, id);
      targets.set(id, record ? { record, remainingCents: Math.abs(record.amountCents) } : null);
    }
    return targets.get(id) ?? null;
  }

  return {
    /** The item the transaction ends up tied to, or what is wrong with the request. */
    async plan(request: LinkRequest): Promise<{ recurringId: string | null } | { problems: LinkProblems }> {
      const problems: LinkProblems = {};
      const asked = request.recurringId ?? null;
      if (asked !== null && !(await knownItem(asked))) problems.recurringId = NO_SUCH_ITEM;
      if (request.countsToward === undefined) {
        return problems.recurringId ? { problems } : { recurringId: asked };
      }

      const target = await targetOf(request.countsToward);
      if (!target) problems.countsToward = NO_SUCH_TRANSACTION;
      else if (target.record.status !== "upcoming" || !target.record.recurringId || !target.record.occurrenceDate) {
        problems.countsToward = "That isn't an upcoming transaction a recurring item added";
      } else if (asked !== null && asked !== target.record.recurringId) {
        problems.countsToward = "That transaction belongs to a different recurring item";
      } else if (Math.sign(request.amountCents) !== Math.sign(target.record.amountCents)) {
        problems.countsToward = "Money out can't count toward money coming in, or the other way round";
      }
      if (!target || Object.keys(problems).length > 0) return { problems };

      // More than is left simply finishes it; the rest is an ordinary extra payment.
      target.remainingCents = Math.max(0, target.remainingCents - Math.abs(request.amountCents));
      return { recurringId: target.record.recurringId };
    },

    /**
     * Shrinks, or removes, every entry that was paid toward, and carries the change to the
     * starting amounts that follow. Call once, after the paying transactions are saved.
     */
    async apply(now: Date): Promise<CountedToward[]> {
      const results: CountedToward[] = [];
      for (const target of targets.values()) {
        if (!target || target.remainingCents === Math.abs(target.record.amountCents)) continue;
        const { record } = target;
        const remainingCents = Math.sign(record.amountCents) * target.remainingCents;

        if (target.remainingCents === 0) await repos.transactions.delete(userId, record.id);
        else await repos.transactions.update(userId, record.id, { amountCents: remainingCents }, now);

        const period = await repos.periods.findContaining(userId, dateOf(record.occursAt));
        if (period) await applyLeftoverDelta(repos, userId, period.seq, remainingCents - record.amountCents, now);
        results.push({ id: record.id, name: record.name, remainingCents, removed: target.remainingCents === 0 });
      }
      return results;
    },
  };
}
