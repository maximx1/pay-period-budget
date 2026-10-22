import { balanceLevel, type BalanceOutlook, type LowBalanceSettings, type OutlookPeriod } from "../../shared/outlook.ts";
import { AppError } from "../lib/errors.ts";
import type { DataStore } from "../repos/types.ts";
import { projectedLeftover } from "./carry.ts";
import type { PeriodService } from "./periods.ts";

// The coming pay periods, and which are set to end low or below zero. See "Low balance
// warnings" in docs/plan/domain.md.

export type OutlookService = ReturnType<typeof createOutlookService>;

const noBudget = () => new AppError(409, "conflict", "Set up your budget first");

export function createOutlookService(deps: { store: DataStore; periods: PeriodService; now?: () => Date }) {
  const { store, periods, now = () => new Date() } = deps;

  /** The user's warning settings, and the current period, which always exists. */
  async function load(userId: string) {
    const today = await periods.today(store, userId);
    const currentId = await periods.locate(userId, today);
    const [current, stored] = await Promise.all([store.periods.findById(userId, currentId), store.settings.get(userId)]);
    if (!current || !stored) throw noBudget();
    const settings: LowBalanceSettings = { lowBalanceCents: stored.lowBalanceCents, periodsAhead: stored.lowBalancePeriods };
    return { current, settings };
  }

  /** Up to `count` periods after the current one, of those that exist, each with how it is set to end. */
  async function comingAfter(userId: string, currentSeq: number, count: number, lowBalanceCents: number): Promise<OutlookPeriod[]> {
    const existing = (await store.periods.listFromSeq(userId, currentSeq + 1)).slice(0, count);
    const found: OutlookPeriod[] = [];
    for (const period of existing) {
      const projectedCents = await projectedLeftover(store, period);
      found.push({
        periodId: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
        projectedCents,
        level: balanceLevel(projectedCents, lowBalanceCents),
      });
    }
    return found;
  }

  return {
    /**
     * The periods after the current one, as many as the user's settings say, of those that
     * exist: one not generated yet is left out. Creates nothing beyond the current period,
     * which always exists.
     */
    async get(userId: string): Promise<BalanceOutlook> {
      const { current, settings } = await load(userId);
      if (settings.periodsAhead === 0) return { settings, periods: [] };
      return { settings, periods: await comingAfter(userId, current.seq, settings.periodsAhead, settings.lowBalanceCents) };
    },

    /**
     * The same, looking at least `atLeast` periods ahead even when the warnings look at
     * fewer or are off: for working out what can safely be spent now.
     */
    async coming(userId: string, atLeast: number): Promise<BalanceOutlook> {
      const { current, settings } = await load(userId);
      const count = Math.max(settings.periodsAhead, atLeast);
      return { settings, periods: await comingAfter(userId, current.seq, count, settings.lowBalanceCents) };
    },

    async setSettings(userId: string, settings: LowBalanceSettings): Promise<LowBalanceSettings> {
      const saved = await store.settings.setLowBalance(
        userId,
        { lowBalanceCents: settings.lowBalanceCents, lowBalancePeriods: settings.periodsAhead },
        now(),
      );
      if (!saved) throw noBudget();
      return settings;
    },
  };
}
