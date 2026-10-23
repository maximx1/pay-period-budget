import { randomUUID } from "node:crypto";
import {
  asksFor,
  blendedAprBps,
  canTrackBalance,
  type BalanceCheck,
  type BalanceCheckInput,
  type BalancePartPatch,
  type BalanceHistoryResponse,
  type BalanceSettings,
  type BalancesResponse,
  type CheckEveryDays,
  monthlyInterestCents,
  nextCheckOn,
  partsInterestCents,
  shareOverParts,
  TRACK_ONLY_MONEY_OUT_MESSAGE,
  type TrackBalanceInput,
  type TrackedBalance,
  type TrackedBalancePatch,
} from "../../shared/balances.ts";
import { addDays, dateOf, type LocalDate, type LocalDateTime, nowIn } from "../../shared/dates.ts";
import { AppError } from "../lib/errors.ts";
import type {
  BalanceCheckPartRecord,
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
export async function estimateFor(repos: Repos, userId: string, billIncomeId: string): Promise<Estimate | null> {
  const checks = await repos.balances.listChecks(userId, billIncomeId);
  const last = checks[0];
  if (!last) return null;
  const since = await repos.transactions.listPaidForBillOrIncomeAfter(userId, billIncomeId, last.asOf);
  const estimateCents = since.reduce((sum, transaction) => sum - transaction.amountCents, last.balanceCents);
  const partsByCheck = new Map<string, BalanceCheckPartRecord[]>();
  for (const part of await repos.balances.listCheckParts(userId, billIncomeId)) {
    partsByCheck.set(part.checkId, [...(partsByCheck.get(part.checkId) ?? []), part]);
  }
  // Phase 32: what has moved the whole is shared over its parts by their balances at the check.
  const lastParts = partsByCheck.get(last.id) ?? [];
  const shares = shareOverParts(
    lastParts.map((part) => part.balanceCents),
    estimateCents - last.balanceCents,
  );
  const parts = lastParts.map((part, index) => ({ part, estimateCents: part.balanceCents + shares[index]! }));
  return { estimateCents, last, since, checks, partsByCheck, parts };
}

type Estimate = {
  estimateCents: number;
  last: BalanceCheckRecord;
  since: TransactionRecord[];
  /** Newest first. */
  checks: BalanceCheckRecord[];
  partsByCheck: Map<string, BalanceCheckPartRecord[]>;
  /** The last check's parts, each with its share of the estimate. Empty when not in parts. */
  parts: Array<{ part: BalanceCheckPartRecord; estimateCents: number }>;
};

const toCheck = ({ id, balanceCents, aprBps, asOf }: BalanceCheckRecord, parts: BalanceCheckPartRecord[] = []): BalanceCheck => ({
  id,
  balanceCents,
  aprBps,
  asOf,
  parts: parts.map((part) => ({ id: part.partId, name: part.name, balanceCents: part.balanceCents, aprBps: part.aprBps })),
});

/** A part of a check about to be recorded. */
type NewPart = { partId: string; name: string; balanceCents: number; aprBps: number | null };

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
  ): Promise<{ balance: TrackedBalance; estimate: Estimate }> {
    const estimate = await estimateFor(repos, record.userId, record.billIncomeId);
    // Tracking always starts with a check, and the last one can't be deleted while tracked.
    if (!estimate) throw new Error(`Tracked balance ${record.billIncomeId} has no check`);
    const parts = estimate.parts.map(({ part, estimateCents }) => ({
      id: part.partId,
      name: part.name,
      estimateCents,
      aprBps: part.aprBps,
      monthlyInterestCents: monthlyInterestCents(estimateCents, part.aprBps),
    }));
    return {
      estimate,
      balance: {
        billIncomeId: item.id,
        name: item.name,
        kind: item.kind,
        estimateCents: estimate.estimateCents,
        lastCheck: toCheck(estimate.last, estimate.partsByCheck.get(estimate.last.id)),
        sinceCount: estimate.since.length,
        monthlyInterestCents:
          parts.length > 0 ? partsInterestCents(parts) : monthlyInterestCents(estimate.estimateCents, estimate.last.aprBps),
        parts,
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

  /**
   * What a check's input comes to: its balance and rate, and its parts (null when not in
   * parts). A part's id must be one of the balance's; a rate left out carries on, from the
   * last check for the whole and from the part's latest check for a part. A balance whose
   * last check has parts takes a check without them only when told (`parts: []`).
   */
  async function checkOf(
    repos: Repos,
    userId: string,
    billIncomeId: string,
    input: BalanceCheckInput,
  ): Promise<{ balanceCents: number; aprBps: number | null; parts: NewPart[] | null }> {
    const checks = await repos.balances.listChecks(userId, billIncomeId);
    const last = checks[0];
    const known = await repos.balances.listCheckParts(userId, billIncomeId);
    if (!input.parts || input.parts.length === 0) {
      if (!input.parts && last && known.some((part) => part.checkId === last.id)) {
        throw invalid({ parts: "Give every part's balance, or an empty list of parts to stop splitting it" });
      }
      return {
        balanceCents: input.balanceCents!,
        aprBps: input.aprBps === undefined ? (last?.aprBps ?? null) : input.aprBps,
        parts: null,
      };
    }
    // Each part as it was in the latest check it is in.
    const rank = new Map(checks.map((check, index) => [check.id, index]));
    const latest = new Map<string, BalanceCheckPartRecord>();
    for (const part of known) {
      const seen = latest.get(part.partId);
      if (!seen || rank.get(part.checkId)! < rank.get(seen.checkId)!) latest.set(part.partId, part);
    }
    const fields: Record<string, string> = {};
    const parts = input.parts.map((part, index): NewPart => {
      if (part.id !== undefined && !latest.has(part.id)) fields[`parts.${index}.id`] = "No such part";
      const before = part.id === undefined ? undefined : latest.get(part.id);
      return {
        partId: part.id ?? randomUUID(),
        name: part.name,
        balanceCents: part.balanceCents,
        aprBps: part.aprBps === undefined ? (before?.aprBps ?? null) : part.aprBps,
      };
    });
    if (new Set(parts.map((part) => part.partId)).size < parts.length) fields.parts = "A part is listed twice";
    if (Object.keys(fields).length > 0) throw invalid(fields);
    return { balanceCents: parts.reduce((sum, part) => sum + part.balanceCents, 0), aprBps: blendedAprBps(parts), parts };
  }

  /** Records a check, with its parts if it has any, and sets when to ask next, counting it toward today's asks. */
  async function record(
    repos: Repos,
    userId: string,
    tracked: TrackedBalanceRecord,
    check: { balanceCents: number; aprBps: number | null; asOf: LocalDateTime; parts: NewPart[] | null },
    defaultEvery: number,
    today: LocalDate,
  ): Promise<void> {
    const createdAt = now();
    const { parts, ...fields } = check;
    const checkId = randomUUID();
    await repos.balances.addCheck({ id: checkId, userId, billIncomeId: tracked.billIncomeId, ...fields, createdAt });
    await repos.balances.addCheckParts(
      (parts ?? []).map((part, position) => ({ id: randomUUID(), userId, billIncomeId: tracked.billIncomeId, checkId, position, ...part })),
    );
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
        checks: estimate.checks.map((check) => toCheck(check, estimate.partsByCheck.get(check.id))),
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
        // Starting again from one figure is no slip, whatever the old checks had: no parts is `[]`.
        const check = {
          ...(await checkOf(repos, userId, billIncomeId, { ...input, parts: input.parts ?? [] })),
          asOf: asOfOf(input, settings.timezone),
        };
        await repos.balances.track(row);
        await record(repos, userId, row, check, settings.checkEveryDays, today);
        return one(repos, userId, billIncomeId);
      });
    },

    /** A balance read off the account, or each of its parts'. A rate left out carries on. */
    check(userId: string, billIncomeId: string, input: BalanceCheckInput): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        const { tracked } = await loadTracked(repos, userId, billIncomeId);
        const settings = await settingsOf(repos, userId);
        const check = { ...(await checkOf(repos, userId, billIncomeId, input)), asOf: asOfOf(input, settings.timezone) };
        await record(repos, userId, tracked, check, settings.checkEveryDays, await periods.today(repos, userId));
        return one(repos, userId, billIncomeId);
      });
    },

    /** The estimate is right: recorded as a check as of now, at the same rate; in parts, each at its estimate. */
    looksRight(userId: string, billIncomeId: string): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        const { tracked } = await loadTracked(repos, userId, billIncomeId);
        const settings = await settingsOf(repos, userId);
        const estimate = (await estimateFor(repos, userId, billIncomeId))!;
        const parts = estimate.parts.map(({ part, estimateCents }) => ({
          partId: part.partId,
          name: part.name,
          balanceCents: estimateCents,
          aprBps: part.aprBps,
        }));
        const check = {
          balanceCents: estimate.estimateCents,
          aprBps: parts.length > 0 ? blendedAprBps(parts) : estimate.last.aprBps,
          asOf: nowIn(settings.timezone, now()),
          parts: parts.length > 0 ? parts : null,
        };
        await record(repos, userId, tracked, check, settings.checkEveryDays, await periods.today(repos, userId));
        return one(repos, userId, billIncomeId);
      });
    },

    /** One part of the last check, renamed or given a new rate in place. Not a check: the asking stays as it was. */
    updatePart(userId: string, billIncomeId: string, partId: string, patch: BalancePartPatch): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        await loadTracked(repos, userId, billIncomeId);
        const last = (await repos.balances.listChecks(userId, billIncomeId))[0]!;
        const parts = (await repos.balances.listCheckParts(userId, billIncomeId)).filter((part) => part.checkId === last.id);
        const part = parts.find((candidate) => candidate.partId === partId);
        if (!part) throw new AppError(404, "not_found", "No such part");
        if (
          patch.name !== undefined &&
          parts.some((other) => other !== part && other.name.toLowerCase() === patch.name!.toLowerCase())
        ) {
          throw invalid({ name: "Another part has this name" });
        }
        await repos.balances.updateCheckPart(userId, part.id, patch);
        if (patch.aprBps !== undefined) {
          const rates = parts.map((other) => (other === part ? { ...other, aprBps: patch.aprBps! } : other));
          await repos.balances.updateCheck(userId, last.id, { aprBps: blendedAprBps(rates) });
        }
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

    /**
     * A new interval, or back to the account's (null): the next ask moves to match the last
     * check. A new rate changes the last check's in place; it is not a check, so the asking
     * stays as it was.
     */
    update(userId: string, billIncomeId: string, patch: TrackedBalancePatch): Promise<TrackedBalance> {
      return store.transaction(async (repos) => {
        await loadTracked(repos, userId, billIncomeId);
        const last = (await repos.balances.listChecks(userId, billIncomeId))[0]!;
        if (patch.checkEveryDays !== undefined) {
          const every = patch.checkEveryDays ?? (await settingsOf(repos, userId)).checkEveryDays;
          await repos.balances.updateTracked(
            userId,
            billIncomeId,
            { checkEveryDays: patch.checkEveryDays, nextCheckOn: nextCheckOn(dateOf(last.asOf), every, random()) },
            now(),
          );
        }
        if (patch.aprBps !== undefined) {
          if ((await repos.balances.listCheckParts(userId, billIncomeId)).some((part) => part.checkId === last.id)) {
            throw invalid({ aprBps: "Change each part's rate instead" });
          }
          await repos.balances.updateCheck(userId, last.id, { aprBps: patch.aprBps });
        }
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
