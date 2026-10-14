import type { PeriodCategoryLimit } from "../../shared/categories.ts";
import type { LocalDate } from "../../shared/dates.ts";
import type { CategoryRecord, PeriodRecord, Repos, TransactionRecord } from "../repos/types.ts";

// A period's limits: copies of each category's usual limit, made when the period is
// generated and from then on its own. See "Limits" in docs/plan/domain.md.

/** Gives a period that has just been generated the usual limit of every category that has one. */
export async function addUsualLimits(repos: Repos, period: PeriodRecord, now: Date): Promise<void> {
  for (const category of await repos.categories.list(period.userId)) {
    if (category.defaultLimitCents === null) continue;
    await repos.categoryLimits.set({
      periodId: period.id,
      categoryId: category.id,
      userId: period.userId,
      limitCents: category.defaultLimitCents,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Brings the current period and every later one that exists into line with a category's
 * usual limit, replacing what each has; with no usual limit, theirs are removed. Periods
 * that ended before `today` are left as they are.
 */
export async function applyUsualLimit(repos: Repos, category: CategoryRecord, today: LocalDate, now: Date): Promise<void> {
  const { userId, id: categoryId, defaultLimitCents } = category;
  for (const period of await repos.periods.listAll(userId)) {
    if (period.endDate < today) continue;
    if (defaultLimitCents === null) await repos.categoryLimits.delete(userId, period.id, categoryId);
    else {
      await repos.categoryLimits.set({
        periodId: period.id,
        categoryId,
        userId,
        limitCents: defaultLimitCents,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

/**
 * A period's limits with what has been spent against each. `records` are the period's
 * transactions: spending follows their dates, wherever the period's boundaries now are.
 */
export async function limitsWithSpending(
  repos: Repos,
  period: PeriodRecord,
  records: TransactionRecord[],
): Promise<PeriodCategoryLimit[]> {
  const limits = await repos.categoryLimits.listForPeriod(period.userId, period.id);
  return limits.map(({ categoryId, categoryName, limitCents }) => {
    let netCents = 0;
    let paidNetCents = 0;
    for (const record of records) {
      if (record.categoryId !== categoryId) continue;
      netCents += record.amountCents;
      if (record.status === "paid") paidNetCents += record.amountCents;
    }
    // Money out is negative. Money in under the same category (a refund) counts against it,
    // but more coming in than going out is not negative spending.
    return {
      categoryId,
      name: categoryName,
      limitCents,
      spentCents: Math.max(0, -netCents),
      paidSpentCents: Math.max(0, -paidNetCents),
    };
  });
}
