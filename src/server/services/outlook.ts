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

  return {
    /**
     * The periods after the current one, as many as the user's settings say, of those that
     * exist: one not generated yet is left out. Creates nothing beyond the current period,
     * which always exists.
     */
    async get(userId: string): Promise<BalanceOutlook> {
      const today = await periods.today(store, userId);
      const currentId = await periods.locate(userId, today);
      const [current, stored] = await Promise.all([store.periods.findById(userId, currentId), store.settings.get(userId)]);
      if (!current || !stored) throw noBudget();

      const settings: LowBalanceSettings = {
        lowBalanceCents: stored.lowBalanceCents,
        periodsAhead: stored.lowBalancePeriods,
      };
      if (settings.periodsAhead === 0) return { settings, periods: [] };

      const existing = (await store.periods.listFromSeq(userId, current.seq + 1)).slice(0, settings.periodsAhead);
      const found: OutlookPeriod[] = [];
      for (const period of existing) {
        const projectedCents = await projectedLeftover(store, period);
        found.push({
          periodId: period.id,
          startDate: period.startDate,
          endDate: period.endDate,
          projectedCents,
          level: balanceLevel(projectedCents, settings.lowBalanceCents),
        });
      }
      return { settings, periods: found };
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
