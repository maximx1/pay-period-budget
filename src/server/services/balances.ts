import { randomUUID } from "node:crypto";
import {
  asksFor,
  canTrackBalance,
  type BalanceCheck,
  type BalanceCheckInput,
  type BalanceHistoryResponse,
  type BalanceSettings,
  type BalancesResponse,
  type CheckEveryDays,
  monthlyInterestCents,
  nextCheckOn,
  TRACK_ONLY_MONEY_OUT_MESSAGE,
  type TrackBalanceInput,
  type TrackedBalance,
  type TrackedBalancePatch,
} from "../../shared/balances.ts";
import { addDays, dateOf, type LocalDate, type LocalDateTime, nowIn } from "../../shared/dates.ts";
import { AppError } from "../lib/errors.ts";
import type {
  BalanceCheckRecord,
  BillOrIncomeRecord,
  DataStore,
  Repos,
  TrackedBalanceRecord,
  TransactionRecord,
} from "../repos/types.ts";
import type { PeriodService } from "./periods.ts";

// Balances (phase 28): see "Balances" in docs/plan/domain.md.

export type BalanceService = ReturnType<typeof createBalanceService>;

const noSuchItem = () => new AppError(404, "not_found", "No such bill or income");
const notTracked = () => new AppError(404, "not_found", "That isn't tracking a balance");
const noBudget = () => new AppError(409, "conflict", "Set up your budget first");
const invalid = (fields: Record<string, string>) => new AppError(400, "validation", "Some fields need attention", fields);

/**
 * What an item's account holds as far as the budget can tell: the last check, plus every
 * paid transaction tied to the item dated after it. Money sent to it (an expense, negative)
 * raises it; money taken from it lowers it. Null when it has never been checked.
 */
export async function estimateFor(
  repos: Repos,
  userId: string,
  billIncomeId: string,
): Promise<{ estimateCents: number; last: BalanceCheckRecord; since: TransactionRecord[]; checks: BalanceCheckRecord[] } | null> {
  const checks = await repos.balances.listChecks(userId, billIncomeId);
  const last = checks[0];
  if (!last) return null;
  const since = await repos.transactions.listPaidForBillOrIncomeAfter(userId, billIncomeId, last.asOf);
  const estimateCents = since.reduce((sum, transaction) => sum - transaction.amountCents, last.balanceCents);
  return { estimateCents, last, since, checks };
}

const toCheck = ({ id, balanceCents, aprBps, asOf }: BalanceCheckRecord): BalanceCheck => ({ id, balanceCents, aprBps, asOf });

export function createBalanceService(deps: {
  store: DataStore;
  periods: PeriodService;
  now?: () => Date;
  /** For spreading the next checks out; in [0, 1). Tests pass a fixed one. */
  random?: () => number;
}) {
  const { store, periods, now = () => new Date(), random = Math.random } = deps;

  async function settingsOf(repos: Repos, userId: string): Promise<BalanceSettings & { timezone: string }> {
    const stored = await repos.settings.get(userId);
    if (!stored) throw noBudget();
    return {
      checkEveryDays: stored.balanceCheckDays as CheckEveryDays,
      checksPerDay: stored.balanceChecksPerDay,
      timezone: stored.timezone,
    };
  }

  async function toBalance(
    repos: Repos,
    record: TrackedBalanceRecord,
    item: BillOrIncomeRecord,
    today: LocalDate,
  ): Promise<{ balance: TrackedBalance; estimate: NonNullable<Awaited<ReturnType<typeof estimateFor>>> }> {
    const estimate = await estimateFor(repos, record.userId, record.billIncomeId);
    // Tracking always starts with a check, and the last one can't be deleted while tracked.
    if (!estimate) throw new Error(`Tracked balance ${record.billIncomeId} has no check`);
    return {
      estimate,
      balance: {
        billIncomeId: item.id,
        name: item.name,
        kind: item.kind,
        estimateCents: estimate.estimateCents,
        lastCheck: toCheck(estimate.last),
        sinceCount: estimate.since.length,
        monthlyInterestCents: monthlyInterestCents(estimate.estimateCents, estimate.last.aprBps),
        checkEveryDays: record.checkEveryDays as CheckEveryDays | null,
        nextCheckOn: record.nextCheckOn,
        due: record.nextCheckOn <= today,
        archived: item.endDate !== null && item.endDate < today,
      },
    };
  }

  /** The item, if it is the user's, and its tracking row, if it is tracked. */
  async function load(repos: Repos, userId: string, billIncomeId: string) {
    const item = await repos.billsIncome.findById(userId, billIncomeId);
    if (!item) throw noSuchItem();
    return { item, tracked: await repos.balances.findTracked(userId, billIncomeId) };
  }

  async function loadTracked(repos: Repos, userId: string, billIncomeId: string) {
    const { item, tracked } = await load(repos, userId, billIncomeId);
    if (!tracked) throw notTracked();
    return { item, tracked };
  }

  /** Checks "as of" against now, and fills it in when left out. */
  function asOfOf(input: BalanceCheckInput, timezone: string): LocalDateTime {
    const current = nowIn(timezone, now());
    if (input.asOf === undefined) return current;
    if (input.asOf > current) throw invalid({ asOf: "That's later than now" });
    return input.asOf;
  }

  /** Records a check and sets when to ask next, counting it toward today's asks. */
  async function record(
    repos: Repos,
    userId: string,
    tracked: TrackedBalanceRecord,
    check: { balanceCents: number; aprBps: number | null; asOf: LocalDateTime },
    defaultEvery: number,
    today: LocalDate,
  ): Promise<void> {
    const createdAt = now();
    await repos.balances.addCheck({ id: randomUUID(), userId, billIncomeId: tracked.billIncomeId, ...check, createdAt });
    await repos.balances.updateTracked(
      userId,
      tracked.billIncomeId,
      { nextCheckOn: nextCheckOn(today, tracked.checkEveryDays ?? defaultEvery, random()), handledOn: today },
      createdAt,
    );
  }

  async function one(repos: Repos, userId: string, billIncomeId: string): Promise<TrackedBalance> {
    const { item, tracked } = await loadTracked(repos, userId, billIncomeId);
    return (await toBalance(repos, tracked, item, await periods.today(repos, userId))).balance;
  }

  async function list(userId: string): Promise<BalancesResponse> {
    const { timezone: _timezone, ...settings } = await settingsOf(store, userId);
    const today = await periods.today(store, userId);
    const items = new Map((await store.billsIncome.list(userId)).map((item) => [item.id, item]));
    const trackedRows = await store.balances.listTracked(userId);

    const balances: TrackedBalance[] = [];
    for (const row of trackedRows) {
      const item = items.get(row.billIncomeId);
      if (item) balances.push((await toBalance(store, row, item, today)).balance);
    }
    balances.sort((a, b) => a.name.localeCompare(b.name));

    const handledToday = trackedRows.filter((row) => row.handledOn === today).length;
    return {
      balances,
      totals: {
        owedCents: balances.reduce((sum, b) => sum + Math.max(0, -b.estimateCents), 0),
        heldCents: balances.reduce((sum, b) => sum + Math.max(0, b.estimateCents), 0),
      },
      asks: asksFor(balances, today, settings.checksPerDay, handledToday),
      settings,
    };
  }

  return {
    list,

    async history(userId: string, billIncomeId: string): Promise<BalanceHistoryResponse> {
      const { item, tracked } = await loadTracked(store, userId, billIncomeId);
      const { balance, estimate } = await toBalance(store, tracked, item, await periods.today(store, userId));
      return {
        balance,
        checks: estimate.checks.map(toCheck),
        since: estimate.since.map(({ id, name, amountCents, occursAt }) => ({ id, name, amountCents, occursAt })),
      };
    },

    /** Starts tracking with its first check. Asked about next in about the usual interval. */
    track(userId: string, billIncomeId: string, input: TrackBalanceInput): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        const { item, tracked } = await load(repos, userId, billIncomeId);
        if (!canTrackBalance(item.kind)) throw invalid({ billIncomeId: TRACK_ONLY_MONEY_OUT_MESSAGE });
        if (tracked) throw new AppError(409, "conflict", "Its balance is already tracked");

        const settings = await settingsOf(repos, userId);
        const today = await periods.today(repos, userId);
        const createdAt = now();
        const row: TrackedBalanceRecord = {
          billIncomeId,
          userId,
          checkEveryDays: input.checkEveryDays ?? null,
          nextCheckOn: today,
          handledOn: null,
          createdAt,
          updatedAt: createdAt,
        };
        await repos.balances.track(row);
        const check = { balanceCents: input.balanceCents, aprBps: input.aprBps ?? null, asOf: asOfOf(input, settings.timezone) };
        await record(repos, userId, row, check, settings.checkEveryDays, today);
        return one(repos, userId, billIncomeId);
      });
    },

    /** A balance read off the account. A rate left out carries on from the last check. */
    check(userId: string, billIncomeId: string, input: BalanceCheckInput): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        const { tracked } = await loadTracked(repos, userId, billIncomeId);
        const settings = await settingsOf(repos, userId);
        const last = (await repos.balances.listChecks(userId, billIncomeId))[0];
        const check = {
          balanceCents: input.balanceCents,
          aprBps: input.aprBps === undefined ? (last?.aprBps ?? null) : input.aprBps,
          asOf: asOfOf(input, settings.timezone),
        };
        await record(repos, userId, tracked, check, settings.checkEveryDays, await periods.today(repos, userId));
        return one(repos, userId, billIncomeId);
      });
    },

    /** The estimate is right: recorded as a check as of now, at the same rate. */
    looksRight(userId: string, billIncomeId: string): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        const { tracked } = await loadTracked(repos, userId, billIncomeId);
        const settings = await settingsOf(repos, userId);
        const estimate = (await estimateFor(repos, userId, billIncomeId))!;
        const check = { balanceCents: estimate.estimateCents, aprBps: estimate.last.aprBps, asOf: nowIn(settings.timezone, now()) };
        await record(repos, userId, tracked, check, settings.checkEveryDays, await periods.today(repos, userId));
        return one(repos, userId, billIncomeId);
      });
    },

    /** Asks again in this many days. Counts toward today's asks, so it never brings another in its place. */
    snooze(userId: string, billIncomeId: string, days: number): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        await loadTracked(repos, userId, billIncomeId);
        const today = await periods.today(repos, userId);
        await repos.balances.updateTracked(userId, billIncomeId, { nextCheckOn: addDays(today, days), handledOn: today }, now());
        return one(repos, userId, billIncomeId);
      });
    },

    /** "Not today": everything asked about today waits until tomorrow. */
    async snoozeAsks(userId: string): Promise<void> {
      const { asks } = await list(userId);
      await store.transaction(async (repos) => {
        const today = await periods.today(repos, userId);
        for (const billIncomeId of asks) {
          await repos.balances.updateTracked(userId, billIncomeId, { nextCheckOn: addDays(today, 1), handledOn: today }, now());
        }
      });
    },

    /** A new interval, or back to the account's (null). The next ask moves to match the last check. */
    update(userId: string, billIncomeId: string, patch: TrackedBalancePatch): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        await loadTracked(repos, userId, billIncomeId);
        const settings = await settingsOf(repos, userId);
        const last = (await repos.balances.listChecks(userId, billIncomeId))[0]!;
        const every = patch.checkEveryDays ?? settings.checkEveryDays;
        await repos.balances.updateTracked(
          userId,
          billIncomeId,
          { checkEveryDays: patch.checkEveryDays, nextCheckOn: nextCheckOn(dateOf(last.asOf), every, random()) },
          now(),
        );
        return one(repos, userId, billIncomeId);
      });
    },

    /** Stops asking. Its checks stay, and come back if it is tracked again. */
    untrack(userId: string, billIncomeId: string): Promise<void> {
      return store.transaction(async (repos) => {
        await loadTracked(repos, userId, billIncomeId);
        await repos.balances.untrack(userId, billIncomeId);
      });
    },

    /** A check entered by mistake. The only one left can't go while the balance is tracked. */
    deleteCheck(userId: string, billIncomeId: string, checkId: string): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        await loadTracked(repos, userId, billIncomeId);
        const check = await repos.balances.findCheck(userId, checkId);
        if (!check || check.billIncomeId !== billIncomeId) throw new AppError(404, "not_found", "No such check");
        if ((await repos.balances.listChecks(userId, billIncomeId)).length === 1) {
          throw new AppError(409, "conflict", "That's its only check. Stop tracking its balance instead.");
        }
        await repos.balances.deleteCheck(userId, checkId);
        return one(repos, userId, billIncomeId);
      });
    },

    async setSettings(userId: string, settings: BalanceSettings): Promise<BalanceSettings> {
      const saved = await store.settings.setBalanceChecks(
        userId,
        { balanceCheckDays: settings.checkEveryDays, balanceChecksPerDay: settings.checksPerDay },
        now(),
      );
      if (!saved) throw noBudget();
      return settings;
    },
  };
}
