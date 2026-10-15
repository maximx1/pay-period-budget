import { entryKindOf } from "../../shared/billsIncome.ts";
import { addDays, dateOf, diffDays, type LocalDate } from "../../shared/dates.ts";
import { netTransfers } from "../../shared/flows.ts";
import { occurrencesBetween } from "../../shared/recurrence.ts";
import type { Report, ReportFlow, ReportPeriod, ReportQuery } from "../../shared/reports.ts";
import { nominalPeriod, type ScheduleType } from "../../shared/schedule.ts";
import type { BillOrIncomeRecord, DataStore, PeriodRecord, ScheduleRecord, TransactionRecord } from "../repos/types.ts";
import { ruleOf } from "./materialize.ts";
import type { PeriodService } from "./periods.ts";
import { toTransaction } from "./transactionMapper.ts";

export type ReportService = ReturnType<typeof createReportService>;

const TOP_NAMES = 15;
const LARGEST = 10;
const MAX_UNPAID = 50;
const PERIODS_AHEAD = 6;
const PERIODS_PER_YEAR: Record<ScheduleType, number> = { weekly: 52, biweekly: 26, monthly: 12 };

/** 0 for Monday through 6 for Sunday. 2024-01-01 was a Monday. */
const weekdayOf = (date: LocalDate) => ((diffDays("2024-01-01", date) % 7) + 7) % 7;

function addFlow<K>(flows: Map<K, ReportFlow>, key: K, amountCents: number) {
  const flow = flows.get(key) ?? { outCents: 0, inCents: 0 };
  if (amountCents < 0) flow.outCents -= amountCents;
  else flow.inCents += amountCents;
  flows.set(key, flow);
}

/** Money out added up day by day, one entry per day from `from` through `through`. */
function runningOut(records: TransactionRecord[], from: LocalDate, through: LocalDate): number[] {
  const days = new Array<number>(diffDays(from, through) + 1).fill(0);
  for (const record of records) {
    const day = diffDays(from, dateOf(record.occursAt));
    if (record.amountCents < 0 && day >= 0 && day < days.length) days[day]! -= record.amountCents;
  }
  let total = 0;
  return days.map((cents) => (total += cents));
}

/** What an item's schedule comes to over the twelve months from `today`, at its usual amount. */
function yearlyOf(item: BillOrIncomeRecord, schedule: ScheduleRecord, today: LocalDate): number | null {
  if (item.recurrenceUnit === "none") return null;
  if (item.endDate !== null && item.endDate < today) return 0;
  const occurrences =
    item.recurrenceUnit === "period"
      ? PERIODS_PER_YEAR[schedule.type]
      : occurrencesBetween(ruleOf(item), today, addDays(today, 364), today).length;
  return occurrences * item.defaultAmountCents;
}

export function createReportService(deps: { store: DataStore; periods: PeriodService }) {
  const { store, periods: periodService } = deps;

  return {
    /** Everything the Reports page draws, for the pay periods that overlap the span. Reads only. */
    async build(userId: string, { from, to }: ReportQuery): Promise<Report> {
      const today = await periodService.today(store, userId);
      const schedule = await store.schedules.getForUser(userId);
      const allPeriods = await store.periods.listAll(userId);
      const covered = allPeriods.filter((period) => period.endDate >= from && period.startDate <= to);
      const categories = await store.categories.list(userId);
      const items = await store.billsIncome.list(userId);
      // Each transfer's money sent and brought back within a period counts once, as the difference.
      const transfers = new Map(items.filter((item) => item.kind === "transfer").map((item) => [item.id, { categoryId: item.categoryId }]));

      const first = covered[0];
      const last = covered.at(-1);
      const records = first && last ? await store.transactions.listInRange(userId, first.startDate, last.endDate) : [];
      const limits = covered.length > 0 ? await store.categoryLimits.listForUser(userId) : [];

      // Transactions arrive in date order and so do periods: walk the two together.
      const byPeriod = new Map<string, TransactionRecord[]>(covered.map((period) => [period.id, []]));
      let index = 0;
      for (const record of records) {
        const date = dateOf(record.occursAt);
        while (index < covered.length - 1 && covered[index]!.endDate < date) index += 1;
        byPeriod.get(covered[index]!.id)!.push(record);
      }

      const reportPeriods = covered.map((period): ReportPeriod => {
        const own = byPeriod.get(period.id)!;
        const byCategory = new Map<string | null, ReportFlow>();
        const byItem = new Map<string | null, ReportFlow>();
        const summary = { incomeCents: 0, expenseCents: 0, billOutCents: 0, transferOutCents: 0, transferInCents: 0 };
        for (const { amountCents, categoryId, billIncomeId, transfer } of netTransfers(own, transfers)) {
          addFlow(byCategory, categoryId, amountCents);
          addFlow(byItem, billIncomeId, amountCents);
          if (amountCents < 0) {
            summary.expenseCents -= amountCents;
            if (billIncomeId !== null) summary.billOutCents -= amountCents;
            if (transfer) summary.transferOutCents -= amountCents;
          } else {
            summary.incomeCents += amountCents;
            if (transfer) summary.transferInCents += amountCents;
          }
        }
        return {
          id: period.id,
          startDate: period.startDate,
          endDate: period.endDate,
          isCurrent: period.startDate <= today && today <= period.endDate,
          isFuture: period.startDate > today,
          startingCents: period.startingCents,
          endingCents: period.startingCents + summary.incomeCents - summary.expenseCents,
          ...summary,
          count: own.length,
          categories: [...byCategory].map(([categoryId, flow]) => ({ categoryId, ...flow })),
          billsIncome: [...byItem].map(([billIncomeId, flow]) => ({ billIncomeId, ...flow })),
          // Against each transaction's own category, as the home screen counts a limit.
          limits: limits
            .filter((limit) => limit.periodId === period.id)
            .map(({ categoryId, limitCents }) => {
              const net = own.filter((record) => record.categoryId === categoryId).reduce((sum, record) => sum + record.amountCents, 0);
              return { categoryId, limitCents, spentCents: Math.max(0, -net) };
            }),
        };
      });

      // Names are what stands in for a shop or a payee: "KROGER" and "Kroger" are one.
      const byName = new Map<string, { name: string; outCents: number; count: number }>();
      const weekdays = new Array<number>(7).fill(0);
      for (const record of records) {
        if (record.amountCents >= 0) continue;
        const key = record.name.trim().toLowerCase();
        // Newest last, so the name is shown as it was most recently written.
        const entry = byName.get(key) ?? { name: record.name, outCents: 0, count: 0 };
        entry.name = record.name;
        entry.outCents -= record.amountCents;
        entry.count += 1;
        byName.set(key, entry);
        weekdays[weekdayOf(dateOf(record.occursAt))]! -= record.amountCents;
      }

      // The current period's running total against the average of the ones before it.
      const current = covered.find((period) => period.startDate <= today && today <= period.endDate);
      const earlier = covered.filter((period) => period.endDate < today);
      let usual: number[] | null = null;
      if (earlier.length > 0) {
        const runs = earlier.map((period) => runningOut(byPeriod.get(period.id)!, period.startDate, period.endDate));
        const longest = Math.max(...runs.map((run) => run.length));
        // A shorter period holds at its final total, so the average never dips when it drops out.
        usual = Array.from({ length: longest }, (_, day) =>
          Math.round(runs.reduce((sum, run) => sum + run[Math.min(day, run.length - 1)]!, 0) / runs.length),
        );
      }

      return {
        from: first?.startDate ?? from,
        to: last?.endDate ?? to,
        today,
        periods: reportPeriods,
        categories: categories.map(({ id, name }) => ({ id, name })),
        billsIncome: items.map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind,
          yearlyCents: schedule ? yearlyOf(item, schedule, today) : null,
        })),
        names: [...byName.values()].sort((a, b) => b.outCents - a.outCents).slice(0, TOP_NAMES),
        largest: records
          // What a schedule added is expected, and would crowd out the surprises.
          .filter((record) => record.amountCents < 0 && record.occurrenceDate === null)
          .sort((a, b) => a.amountCents - b.amountCents)
          .slice(0, LARGEST)
          .map(toTransaction),
        weekdays,
        pace: {
          current: current ? runningOut(byPeriod.get(current.id)!, current.startDate, today) : null,
          usual,
        },
        unpaid: records
          .filter((record) => record.status === "upcoming" && dateOf(record.occursAt) < today)
          .slice(0, MAX_UNPAID)
          .map(toTransaction),
        ahead: schedule ? scheduledAhead(schedule, allPeriods, items, today) : [],
      };
    },
  };
}

/** What the schedules add to each of the pay periods after the one containing today. */
function scheduledAhead(
  schedule: ScheduleRecord,
  allPeriods: PeriodRecord[],
  items: BillOrIncomeRecord[],
  today: LocalDate,
): Report["ahead"] {
  const current = allPeriods.find((period) => period.startDate <= today && today <= period.endDate);
  if (!current) return [];
  const bySeq = new Map(allPeriods.map((period) => [period.seq, period]));
  const ahead: Report["ahead"] = [];
  let previousEnd = current.endDate;
  for (let seq = current.seq + 1; seq <= current.seq + PERIODS_AHEAD; seq++) {
    // A period that exists has its own dates; one that does not will start where the last
    // ended and end on schedule, as generation does.
    const existing = bySeq.get(seq);
    const startDate = existing?.startDate ?? addDays(previousEnd, 1);
    const nominalEnd = nominalPeriod(schedule, seq).end;
    const endDate = existing?.endDate ?? (nominalEnd < startDate ? startDate : nominalEnd);
    let billsCents = 0;
    let incomeCents = 0;
    for (const item of items) {
      const total = occurrencesBetween(ruleOf(item), startDate, endDate, startDate).length * item.defaultAmountCents;
      if (entryKindOf(item.kind) === "income") incomeCents += total;
      else billsCents += total;
    }
    ahead.push({ startDate, endDate, billsCents, incomeCents });
    previousEnd = endDate;
  }
  return ahead;
}
