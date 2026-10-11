import { randomUUID } from "node:crypto";
import {
  type Budget,
  type BudgetSetupInput,
  MAX_ANCHOR_AGE_DAYS,
  type PeriodView,
} from "../../shared/budget.ts";
import { addDays, diffDays, type LocalDate, todayIn } from "../../shared/dates.ts";
import { horizonSeq, nominalPeriod } from "../../shared/schedule.ts";
import { AppError } from "../lib/errors.ts";
import { toTransaction } from "./transactionMapper.ts";
import {
  type DataStore,
  type PeriodRecord,
  type Repos,
  type ScheduleRecord,
  UniqueConstraintError,
} from "../repos/types.ts";

export type PeriodService = ReturnType<typeof createPeriodService>;

type LoadedBudget = { schedule: ScheduleRecord; timezone: string };

const dateError = (message: string) => new AppError(400, "validation", message, { date: message });
const anchorError = (message: string) => new AppError(400, "validation", message, { anchorDate: message });
const noBudget = () => new AppError(409, "conflict", "Set up your budget first");

export function createPeriodService(deps: {
  store: DataStore;
  now?: () => Date;
  /**
   * Runs inside the generating transaction for each period as it is created, before the
   * next one is derived from it. The app uses this to add recurring items' transactions.
   */
  onPeriodCreated?: (repos: Repos, period: PeriodRecord) => Promise<void>;
}) {
  const { store, now = () => new Date(), onPeriodCreated = async () => {} } = deps;

  async function loadBudget(repos: Repos, userId: string): Promise<LoadedBudget> {
    const schedule = await repos.schedules.getForUser(userId);
    const settings = await repos.settings.get(userId);
    if (!schedule || !settings) throw noBudget();
    return { schedule, timezone: settings.timezone };
  }

  /**
   * Projected leftover: the starting amount plus every transaction in the period, paid or
   * not. It is what the period is expected to end with, and so what the next one starts with.
   */
  async function projectedOf(repos: Repos, period: PeriodRecord): Promise<number> {
    const { paidCents, upcomingCents } = await repos.transactions.sumInRange(
      period.userId,
      period.startDate,
      period.endDate,
    );
    return period.startingCents + paidCents + upcomingCents;
  }

  /** Creates every missing period up to the one containing `date`. Call inside a transaction. */
  async function ensureThroughIn(
    repos: Repos,
    userId: string,
    schedule: ScheduleRecord,
    date: LocalDate,
    today: LocalDate,
  ): Promise<void> {
    let last = await repos.periods.findLast(userId);
    const first = await repos.periods.findBySeq(userId, 0);
    if (!last || !first) throw noBudget();

    if (date < first.startDate) throw dateError("That's before your budget started");
    const maxSeq = horizonSeq(schedule, today);
    if (date > nominalPeriod(schedule, maxSeq).end) throw dateError("That's more than a year ahead");

    while (last.endDate < date) {
      const seq = last.seq + 1;
      if (seq > maxSeq) throw dateError("That's more than a year ahead");

      const nominal = nominalPeriod(schedule, seq);
      // Start where the previous period really ended (its end may have been moved by hand),
      // but end on schedule so one adjusted period never shifts the rest of the calendar.
      const startDate = addDays(last.endDate, 1);
      const createdAt = now();
      const period: PeriodRecord = {
        id: randomUUID(),
        userId,
        scheduleId: schedule.id,
        seq,
        startDate,
        endDate: nominal.end < startDate ? startDate : nominal.end,
        nominalStart: nominal.start,
        nominalEnd: nominal.end,
        startingCents: await projectedOf(repos, last),
        startingMode: "auto",
        carryStale: last.carryStale,
        createdAt,
        updatedAt: createdAt,
      };
      await repos.periods.create(period);
      await onPeriodCreated(repos, period);
      last = period;
    }
  }

  async function containingOrCreate(userId: string, budget: LoadedBudget, date: LocalDate, today: LocalDate) {
    // The common case needs no writes, so try a plain read before opening a transaction.
    const existing = await store.periods.findContaining(userId, date);
    if (existing) return existing;

    return store.transaction(async (repos) => {
      await ensureThroughIn(repos, userId, budget.schedule, date, today);
      const period = await repos.periods.findContaining(userId, date);
      if (!period) throw new Error(`No period covers ${date} after generating through it`);
      return period;
    });
  }

  async function buildView(budget: LoadedBudget, period: PeriodRecord, today: LocalDate): Promise<PeriodView> {
    const userId = period.userId;
    const prev = period.seq > 0 ? await store.periods.findBySeq(userId, period.seq - 1) : null;
    const next = await store.periods.findBySeq(userId, period.seq + 1);
    const canGenerateNext = period.seq + 1 <= horizonSeq(budget.schedule, today);

    const records = await store.transactions.listInRange(userId, period.startDate, period.endDate);
    let paidCents = 0;
    let upcomingCents = 0;
    for (const record of records) {
      if (record.status === "paid") paidCents += record.amountCents;
      else upcomingCents += record.amountCents;
    }

    return {
      period: {
        id: period.id,
        seq: period.seq,
        startDate: period.startDate,
        endDate: period.endDate,
        nominalStart: period.nominalStart,
        nominalEnd: period.nominalEnd,
        datesEdited: period.startDate !== period.nominalStart || period.endDate !== period.nominalEnd,
        isCurrent: period.startDate <= today && today <= period.endDate,
        startingCents: period.startingCents,
        startingMode: period.startingMode,
        carryStale: period.carryStale,
      },
      totals: {
        paidCents,
        upcomingCents,
        leftoverCents: period.startingCents + paidCents,
        projectedCents: period.startingCents + paidCents + upcomingCents,
      },
      transactions: records.map(toTransaction),
      nav: {
        prevId: prev?.id ?? null,
        nextId: next?.id ?? null,
        nextDate: !next && canGenerateNext ? addDays(period.endDate, 1) : null,
      },
    };
  }

  return {
    async getBudget(userId: string): Promise<Budget | null> {
      const schedule = await store.schedules.getForUser(userId);
      const settings = await store.settings.get(userId);
      if (!schedule || !settings) return null;
      return {
        type: schedule.type,
        anchorDate: schedule.anchorDate,
        openingCents: schedule.openingCents,
        timezone: settings.timezone,
      };
    },

    /** Creates the user's schedule and every period from the anchor date through today. */
    async setup(userId: string, input: BudgetSetupInput): Promise<Budget> {
      const today = todayIn(input.timezone, now());
      if (input.anchorDate > today) throw anchorError("Pick today or an earlier date");
      if (diffDays(input.anchorDate, today) > MAX_ANCHOR_AGE_DAYS) {
        throw anchorError("Pick a date within the last year");
      }
      const alreadySetUp = () => new AppError(409, "conflict", "Your budget is already set up");

      try {
        return await store.transaction(async (repos) => {
          if (await repos.schedules.getForUser(userId)) throw alreadySetUp();

          const createdAt = now();
          await repos.settings.upsert(userId, { timezone: input.timezone }, createdAt);
          const schedule = await repos.schedules.create({
            id: randomUUID(),
            userId,
            type: input.type,
            anchorDate: input.anchorDate,
            openingCents: input.openingCents,
            createdAt,
          });

          const nominal = nominalPeriod(schedule, 0);
          const first: PeriodRecord = {
            id: randomUUID(),
            userId,
            scheduleId: schedule.id,
            seq: 0,
            startDate: nominal.start,
            endDate: nominal.end,
            nominalStart: nominal.start,
            nominalEnd: nominal.end,
            startingCents: input.openingCents,
            startingMode: "auto",
            carryStale: false,
            createdAt,
            updatedAt: createdAt,
          };
          await repos.periods.create(first);
          await onPeriodCreated(repos, first);
          await ensureThroughIn(repos, userId, schedule, today, today);

          const { type, anchorDate, openingCents } = schedule;
          return { type, anchorDate, openingCents, timezone: input.timezone };
        });
      } catch (error) {
        if (error instanceof UniqueConstraintError) throw alreadySetUp();
        throw error;
      }
    },

    /** The period containing today, creating it (and any before it) if it doesn't exist yet. */
    async getCurrent(userId: string): Promise<PeriodView> {
      const budget = await loadBudget(store, userId);
      const today = todayIn(budget.timezone, now());
      const period = await containingOrCreate(userId, budget, today, today);
      return buildView(budget, period, today);
    },

    async getView(userId: string, periodId: string): Promise<PeriodView> {
      const budget = await loadBudget(store, userId);
      const period = await store.periods.findById(userId, periodId);
      if (!period) throw new AppError(404, "not_found", "No such period");
      return buildView(budget, period, todayIn(budget.timezone, now()));
    },

    /** Id of the period containing `date`, generating forward to it when it is within the horizon. */
    async locate(userId: string, date: LocalDate): Promise<string> {
      const budget = await loadBudget(store, userId);
      const today = todayIn(budget.timezone, now());
      return (await containingOrCreate(userId, budget, date, today)).id;
    },

    /** Today's date in the user's budget time zone. Works on the store or inside a transaction. */
    async today(repos: Repos, userId: string): Promise<LocalDate> {
      return todayIn((await loadBudget(repos, userId)).timezone, now());
    },

    /**
     * Makes sure periods exist through `date`, using the caller's transaction. For services
     * that write dated records and need the period to be there.
     */
    async ensureThrough(repos: Repos, userId: string, date: LocalDate): Promise<void> {
      const budget = await loadBudget(repos, userId);
      await ensureThroughIn(repos, userId, budget.schedule, date, todayIn(budget.timezone, now()));
    },
  };
}
