import { dateOf } from "../../shared/dates.ts";
import type { CountedToward } from "../../shared/transactions.ts";
import type { Repos, TransactionRecord } from "../repos/types.ts";
import { applyLeftoverDelta } from "./carry.ts";

// Tying a transaction to a bill or income, counting a payment toward the upcoming entry
// the item generated, and filing it under a category. See "Linking to a bill or income"
// and "Categories" in docs/plan/domain.md.
// Used for one transaction and for a whole import alike, inside the caller's transaction.

export type LinkRequest = {
  /** The item to tie the transaction to; null or undefined for none. */
  billIncomeId?: string | null;
  /** An upcoming transaction the item generated, which this one pays part or all of. */
  countsToward?: string;
  /** The new transaction's signed amount. */
  amountCents: number;
  /**
   * The category to file the transaction under; null for none. Left out, a transaction
   * tied to a bill or income takes that item's category, and a payment toward an entry
   * takes the entry's.
   */
  categoryId?: string | null;
};

export type LinkProblems = Partial<Record<"billIncomeId" | "countsToward" | "categoryId", string>>;

// One wording whether the id is unknown or someone else's: it must not say which.
const NO_SUCH_ITEM = "No such bill or income";
const NO_SUCH_TRANSACTION = "No such transaction";
export const NO_SUCH_CATEGORY = "No such category";

/**
 * Checks links one transaction at a time and keeps count of what is left of each entry
 * being paid toward, so that several payments in one import can share an entry. Nothing
 * is written until `apply`.
 */
export function createLinkPlanner(repos: Repos, userId: string) {
  /** Each of the user's items, with the category it files its entries under. */
  let items: Map<string, string | null> | null = null;
  let categoryIds: Set<string> | null = null;
  const targets = new Map<string, { record: TransactionRecord; remainingCents: number } | null>();

  async function allItems(): Promise<Map<string, string | null>> {
    items ??= new Map((await repos.billsIncome.list(userId)).map((item) => [item.id, item.categoryId]));
    return items;
  }

  async function knownCategory(id: string): Promise<boolean> {
    categoryIds ??= new Set((await repos.categories.list(userId)).map((category) => category.id));
    return categoryIds.has(id);
  }

  async function targetOf(id: string) {
    if (!targets.has(id)) {
      const record = await repos.transactions.findById(userId, id);
      targets.set(id, record ? { record, remainingCents: Math.abs(record.amountCents) } : null);
    }
    return targets.get(id) ?? null;
  }

  return {
    /** The item and category the transaction ends up with, or what is wrong with the request. */
    async plan(
      request: LinkRequest,
    ): Promise<{ billIncomeId: string | null; categoryId: string | null } | { problems: LinkProblems }> {
      const problems: LinkProblems = {};
      const asked = request.billIncomeId ?? null;
      if (asked !== null && !(await allItems()).has(asked)) problems.billIncomeId = NO_SUCH_ITEM;
      const named = request.categoryId;
      if (named != null && !(await knownCategory(named))) problems.categoryId = NO_SUCH_CATEGORY;
      if (request.countsToward === undefined) {
        if (Object.keys(problems).length > 0) return { problems };
        const inherited = asked === null ? null : ((await allItems()).get(asked) ?? null);
        return { billIncomeId: asked, categoryId: named === undefined ? inherited : named };
      }

      const target = await targetOf(request.countsToward);
      if (!target) problems.countsToward = NO_SUCH_TRANSACTION;
      else if (target.record.status !== "upcoming" || !target.record.billIncomeId || !target.record.occurrenceDate) {
        problems.countsToward = "That isn't an upcoming transaction a bill or income added";
      } else if (asked !== null && asked !== target.record.billIncomeId) {
        problems.countsToward = "That transaction belongs to a different bill or income";
      } else if (Math.sign(request.amountCents) !== Math.sign(target.record.amountCents)) {
        problems.countsToward = "Money out can't count toward money coming in, or the other way round";
      }
      if (!target || Object.keys(problems).length > 0) return { problems };

      // More than is left simply finishes it; the rest is an ordinary extra payment.
      target.remainingCents = Math.max(0, target.remainingCents - Math.abs(request.amountCents));
      // It stands in for (part of) the entry, so unless told otherwise it is filed where the entry was.
      return { billIncomeId: target.record.billIncomeId, categoryId: named === undefined ? target.record.categoryId : named };
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
        results.push({
          id: record.id,
          name: record.name,
          previousCents: record.amountCents,
          remainingCents,
          removed: target.remainingCents === 0,
        });
      }
      return results;
    },
  };
}
