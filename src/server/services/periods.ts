import { randomUUID } from "node:crypto";
import {
  type Budget,
  type BudgetSetupInput,
  MAX_ANCHOR_AGE_DAYS,
  type PeriodDateChange,
  type PeriodDatesInput,
  type PeriodDatesResponse,
  type PeriodSummary,
  type PeriodView,
} from "../../shared/budget.ts";
import { addDays, diffDays, type LocalDate, todayIn } from "../../shared/dates.ts";
import { earliestSeq, horizonSeq, MAX_HISTORY_YEARS, nominalPeriod } from "../../shared/schedule.ts";
import { AppError } from "../lib/errors.ts";
import { applyLeftoverDelta, markStaleAfter, projectedLeftover, recomputeChain, shiftHistory } from "./carry.ts";
import { planDateChange } from "./periodDates.ts";
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
export const TOO_FAR_BACK = `That's more than ${MAX_HISTORY_YEARS} years back`;
const noBudget = () => new AppError(409, "conflict", "Set up your budget first");
const historyIsDerived = () =>
  new AppError(409, "conflict", "Amounts before your budget started are worked out from its first period");

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

  /** Creates every missing period up to the one containing `date`. Call inside a transaction. */
  async function ensureThroughIn(
    repos: Repos,
    userId: string,
    schedule: ScheduleRecord,
    date: LocalDate,
    today: LocalDate,
  ): Promise<void> {
    let last = await repos.periods.findLast(userId);
    const first = await repos.periods.findFirst(userId);
    if (!last || !first) throw noBudget();

    // Earlier periods are only ever added on purpose, one at a time (see addEarlier).
    if (date < first.startDate) {
      throw dateError(first.seq < 0 ? "That's before your earliest pay period" : "That's before your budget started");
    }
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
        startingCents: await projectedLeftover(repos, last),
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

  /**
   * Adds the period before the earliest one, or returns null if that would be further back
   * than history may go (MAX_HISTORY_YEARS). Call inside a transaction.
   */
  async function addEarlierIn(
    repos: Repos,
    userId: string,
    schedule: ScheduleRecord,
    today: LocalDate,
  ): Promise<PeriodRecord | null> {
    const first = await repos.periods.findFirst(userId);
    if (!first) throw noBudget();

    const seq = first.seq - 1;
    if (seq < earliestSeq(schedule, today)) return null;

    const nominal = nominalPeriod(schedule, seq);
    // End where the next period really starts (its start may have been moved by hand),
    // but start on schedule, mirroring how periods are generated forwards.
    const endDate = addDays(first.startDate, -1);
    const createdAt = now();
    const period: PeriodRecord = {
      id: randomUUID(),
      userId,
      scheduleId: schedule.id,
      seq,
      startDate: nominal.start > endDate ? endDate : nominal.start,
      endDate,
      nominalStart: nominal.start,
      nominalEnd: nominal.end,
      startingCents: first.startingCents,
      startingMode: "auto",
      carryStale: false,
      createdAt,
      updatedAt: createdAt,
    };
    await repos.periods.create(period);
    await onPeriodCreated(repos, period);

    // Recurring items due in it have just been added; back the starting amount off by them.
    const { paidCents, upcomingCents } = await repos.transactions.sumInRange(userId, period.startDate, period.endDate);
    const netCents = paidCents + upcomingCents;
    if (netCents === 0) return period;

    const startingCents = first.startingCents - netCents;
    await repos.periods.update(userId, period.id, { startingCents }, createdAt);
    return { ...period, startingCents };
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

  async function buildView(
    repos: Repos,
    budget: LoadedBudget,
    period: PeriodRecord,
    today: LocalDate,
  ): Promise<PeriodView> {
    const userId = period.userId;
    const prev = await repos.periods.findBySeq(userId, period.seq - 1);
    const next = await repos.periods.findBySeq(userId, period.seq + 1);
    const canGenerateNext = period.seq + 1 <= horizonSeq(budget.schedule, today);
    const canAddPrevious = !prev && period.seq - 1 >= earliestSeq(budget.schedule, today);

    const records = await repos.transactions.listInRange(userId, period.startDate, period.endDate);
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
        canAddPrevious,
        nextId: next?.id ?? null,
        nextDate: !next && canGenerateNext ? addDays(period.endDate, 1) : null,
      },
    };
  }

  /** Loads what every adjustment needs, inside its transaction. */
  async function loadForEdit(repos: Repos, userId: string, periodId: string) {
    const budget = await loadBudget(repos, userId);
    const period = await repos.periods.findById(userId, periodId);
    if (!period) throw new AppError(404, "not_found", "No such period");
    return { budget, period, today: todayIn(budget.timezone, now()) };
  }

  /** The view of a period as it stands after an adjustment made in this transaction. */
  async function viewAfterEdit(repos: Repos, budget: LoadedBudget, periodId: string, today: LocalDate) {
    const period = await repos.periods.findById(budget.schedule.userId, periodId);
    if (!period) throw new Error("Period vanished during its own update");
    return buildView(repos, budget, period, today);
  }

  function changeDates(userId: string, periodId: string, input: PeriodDatesInput): Promise<PeriodDatesResponse> {
    return store.transaction(async (repos) => {
      const { budget, period, today } = await loadForEdit(repos, userId, periodId);
      const { schedule } = budget;
      const previous = await repos.periods.findBySeq(userId, period.seq - 1);
      let next = await repos.periods.findBySeq(userId, period.seq + 1);

      // If the next period hasn't been generated yet but may be, plan against the dates it
      // will get, so days this period gives up always have somewhere to go.
      const nextNominal = nominalPeriod(schedule, period.seq + 1);
      const nextCanBeGenerated = !next && period.seq + 1 <= horizonSeq(schedule, today);
      const upcomingStart = addDays(period.endDate, 1);
      const nextBounds = next
        ? next
        : nextCanBeGenerated
          ? {
              seq: period.seq + 1,
              startDate: upcomingStart,
              endDate: nextNominal.end < upcomingStart ? upcomingStart : nextNominal.end,
            }
          : null;

      const plan = planDateChange({
        period,
        previous,
        next: nextBounds,
        latestEndWithoutNext: addDays(nextNominal.end, -1),
        startDate: input.startDate,
        endDate: input.endDate,
      });
      if ("message" in plan) throw new AppError(400, "validation", plan.message, { [plan.field]: plan.message });

      // Transactions are tied to dates, not periods, so the ones on days that change hands
      // move with those days. Days nobody takes over must be empty.
      const moves: Array<{ fromSeq: number; toSeq: number; sumCents: number }> = [];
      let movedTransactions = 0;
      for (const transfer of plan.transfers) {
        const rows = await repos.transactions.listInRange(userId, transfer.from, transfer.to);
        if (rows.length === 0) continue;
        if (transfer.toSeq === null) {
          const message =
            transfer.field === "startDate"
              ? "There are transactions before that date and no earlier period to hold them"
              : "There are transactions after that date and no later period to hold them yet";
          throw new AppError(400, "validation", message, { [transfer.field]: message });
        }
        movedTransactions += rows.length;
        const sumCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
        moves.push({ fromSeq: transfer.fromSeq, toSeq: transfer.toSeq, sumCents });
      }

      const changes: PeriodDateChange[] = [];
      if (previous && plan.previousEnd) {
        changes.push({
          role: "previous",
          startDate: previous.startDate,
          endDate: plan.previousEnd,
          previousStartDate: previous.startDate,
          previousEndDate: previous.endDate,
        });
      }
      if (plan.startDate !== period.startDate || plan.endDate !== period.endDate) {
        changes.push({
          role: "this",
          startDate: plan.startDate,
          endDate: plan.endDate,
          previousStartDate: period.startDate,
          previousEndDate: period.endDate,
        });
      }
      if (nextBounds && plan.nextStart) {
        changes.push({
          role: "next",
          startDate: plan.nextStart,
          endDate: nextBounds.endDate,
          previousStartDate: nextBounds.startDate,
          previousEndDate: nextBounds.endDate,
        });
      }

      if (input.preview || changes.length === 0) {
        return { view: await buildView(repos, budget, period, today), changes, movedTransactions };
      }

      const updatedAt = now();
      if (plan.nextStart && !next) {
        // Bring the next period into existence on its scheduled dates, then move its start.
        await ensureThroughIn(repos, userId, schedule, upcomingStart, today);
        next = await repos.periods.findBySeq(userId, period.seq + 1);
      }
      if (previous && plan.previousEnd) {
        await repos.periods.update(userId, previous.id, { endDate: plan.previousEnd }, updatedAt);
      }
      await repos.periods.update(userId, period.id, { startDate: plan.startDate, endDate: plan.endDate }, updatedAt);
      if (next && plan.nextStart) {
        await repos.periods.update(userId, next.id, { startDate: plan.nextStart }, updatedAt);
      }

      // Same bookkeeping as changing a transaction's date: it leaves one period and joins another.
      for (const move of moves) {
        await applyLeftoverDelta(repos, userId, move.fromSeq, -move.sumCents, updatedAt);
        await applyLeftoverDelta(repos, userId, move.toSeq, move.sumCents, updatedAt);
      }

      return { view: await viewAfterEdit(repos, budget, periodId, today), changes, movedTransactions };
    });
  }

  return {
    /**
     * Sets a period's starting amount by hand, which pins it: nothing upstream will change
     * it again. `carryForward` chooses between moving later periods by the same difference
     * and leaving them alone but flagged as possibly out of date.
     */
    setStarting(
      userId: string,
      periodId: string,
      input: { startingCents: number; carryForward: boolean },
    ): Promise<PeriodView> {
      return store.transaction(async (repos) => {
        const { budget, period, today } = await loadForEdit(repos, userId, periodId);
        if (period.seq < 0) throw historyIsDerived();
        const updatedAt = now();
        const deltaCents = input.startingCents - period.startingCents;

        await repos.periods.update(
          userId,
          period.id,
          { startingCents: input.startingCents, startingMode: "manual", carryStale: false },
          updatedAt,
        );
        if (input.carryForward) await applyLeftoverDelta(repos, userId, period.seq, deltaCents, updatedAt);
        else if (deltaCents !== 0) await markStaleAfter(repos, userId, period.seq, updatedAt);
        // The history before the budget is anchored on the first period's starting amount.
        if (period.seq === 0) await shiftHistory(repos, userId, deltaCents, updatedAt);

        return viewAfterEdit(repos, budget, periodId, today);
      });
    },

    /** Goes back to the calculated starting amount and brings later periods into line with it. */
    revertStarting(userId: string, periodId: string): Promise<PeriodView> {
      return store.transaction(async (repos) => {
        const { budget, period, today } = await loadForEdit(repos, userId, periodId);
        if (period.seq < 0) throw historyIsDerived();
        if (period.startingMode !== "manual") {
          throw new AppError(409, "conflict", "This starting amount is already the calculated one");
        }
        const updatedAt = now();
        await repos.periods.update(userId, period.id, { startingMode: "auto" }, updatedAt);
        await recomputeChain(repos, userId, period.seq, budget.schedule.openingCents, updatedAt);
        if (period.seq === 0) {
          await shiftHistory(repos, userId, budget.schedule.openingCents - period.startingCents, updatedAt);
        }
        return viewAfterEdit(repos, budget, periodId, today);
      });
    },

    /** Clears "may be out of date" by recalculating the whole flagged run this period is part of. */
    recalculate(userId: string, periodId: string): Promise<PeriodView> {
      return store.transaction(async (repos) => {
        const { budget, period, today } = await loadForEdit(repos, userId, periodId);
        if (!period.carryStale) {
          throw new AppError(409, "conflict", "This starting amount is already up to date");
        }
        // The run began right after the hand-set amount that wasn't carried forward.
        let fromSeq = period.seq;
        while (fromSeq > 0) {
          const before = await repos.periods.findBySeq(userId, fromSeq - 1);
          if (!before || !before.carryStale || before.startingMode === "manual") break;
          fromSeq -= 1;
        }
        await recomputeChain(repos, userId, fromSeq, budget.schedule.openingCents, now());
        return viewAfterEdit(repos, budget, periodId, today);
      });
    },

    /**
     * Moves a period's start and/or end. The neighbour sharing each moved boundary follows,
     * and transactions on days that change hands go with them. With `preview`, reports the
     * effect without changing anything.
     */
    changeDates,

    /** Puts a period back on its scheduled dates (and the shared boundaries with it). */
    async revertDates(userId: string, periodId: string): Promise<PeriodDatesResponse> {
      const period = await store.periods.findById(userId, periodId);
      if (!period) throw new AppError(404, "not_found", "No such period");
      return changeDates(userId, periodId, { startDate: period.nominalStart, endDate: period.nominalEnd });
    },

    /** Changes the zone that decides what "today" is. Stored dates and times are not converted. */
    async setTimezone(userId: string, timezone: string): Promise<Budget> {
      const budget = await loadBudget(store, userId);
      await store.settings.upsert(userId, { timezone }, now());
      const { type, anchorDate, openingCents } = budget.schedule;
      return { type, anchorDate, openingCents, timezone };
    },

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
      return buildView(store, budget, period, today);
    },

    async getView(userId: string, periodId: string): Promise<PeriodView> {
      const budget = await loadBudget(store, userId);
      const period = await store.periods.findById(userId, periodId);
      if (!period) throw new AppError(404, "not_found", "No such period");
      return buildView(store, budget, period, todayIn(budget.timezone, now()));
    },

    /**
     * Adds the period before the earliest one and returns its id. It is history: its
     * starting amount is whatever makes it end on what the next period started with, so
     * nothing from the first period onward changes, now or when transactions are added to it.
     */
    addEarlier(userId: string): Promise<string> {
      return store.transaction(async (repos) => {
        const { schedule, timezone } = await loadBudget(repos, userId);
        const period = await addEarlierIn(repos, userId, schedule, todayIn(timezone, now()));
        if (!period) throw new AppError(400, "validation", TOO_FAR_BACK);
        return period.id;
      });
    },

    /** Every period that exists, oldest first. Creates nothing. */
    async list(userId: string): Promise<PeriodSummary[]> {
      await loadBudget(store, userId);
      const periods = await store.periods.listAll(userId);
      return periods.map(({ id, startDate, endDate }) => ({ id, startDate, endDate }));
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

    /**
     * Creates periods towards both ends of a span of dates, as far as the limits allow, in
     * the caller's transaction: forwards to the horizon, and backwards only if `addEarlier`
     * is set. It never fails for a date out of reach; the caller looks at which periods
     * exist afterwards. Returns how many were created at each end.
     */
    async extendToward(
      repos: Repos,
      userId: string,
      span: { from: LocalDate; to: LocalDate },
      options: { addEarlier: boolean },
    ): Promise<{ earlier: number; later: number }> {
      const { schedule, timezone } = await loadBudget(repos, userId);
      const today = todayIn(timezone, now());
      const firstBefore = await repos.periods.findFirst(userId);
      const lastBefore = await repos.periods.findLast(userId);
      if (!firstBefore || !lastBefore) throw noBudget();

      let earlier = 0;
      if (options.addEarlier) {
        let first: PeriodRecord | null = firstBefore;
        while (first.startDate > span.from) {
          first = await addEarlierIn(repos, userId, schedule, today);
          if (!first) break;
          earlier += 1;
        }
      }

      const horizonEnd = nominalPeriod(schedule, horizonSeq(schedule, today)).end;
      const target = span.to > horizonEnd ? horizonEnd : span.to;
      if (target > lastBefore.endDate) {
        try {
          await ensureThroughIn(repos, userId, schedule, target, today);
        } catch (error) {
          // Out of reach after all (the last allowed period was cut short by hand): stop where it stopped.
          if (!(error instanceof AppError && error.fields?.date)) throw error;
        }
      }
      const lastAfter = await repos.periods.findLast(userId);
      return { earlier, later: (lastAfter?.seq ?? lastBefore.seq) - lastBefore.seq };
    },
  };
}
