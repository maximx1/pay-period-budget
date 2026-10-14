import { ChartColumn } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { formatDateRange, formatLongDate, formatMonthDay, isLocalDate, todayIn } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { Report } from "../../../shared/reports.ts";
import { NO_CATEGORY } from "../../../shared/transactions.ts";
import { BarList, type BarRow } from "../../components/charts/BarList.tsx";
import { DataTable, type TableData } from "../../components/charts/DataTable.tsx";
import { DonutChart, type Slice } from "../../components/charts/DonutChart.tsx";
import { compactCents, SERIES_COLORS } from "../../components/charts/palette.ts";
import { type ChartSeries, XYChart } from "../../components/charts/XYChart.tsx";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { KIND_LABELS } from "../billsIncome/ItemTransactions.tsx";
import { useBudget } from "../budget/api.ts";
import { usePeriodList } from "../periods/api.ts";
import { SearchDialog, type SearchStart } from "../search/SearchDialog.tsx";
import { useReport } from "./api.ts";
import { addTo, mean, NONE, rankSeries, SPAN_CHOICES, type SpanChoice, spanFor } from "./derive.ts";

const [BLUE, ORANGE, AQUA] = SERIES_COLORS;
const RED = SERIES_COLORS[7];
const percent = (value: number) => `${Math.round(value)}%`;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

type ReportCardProps = {
  title: string;
  /** One line saying what is being shown and what counts. */
  about: string;
  /** The same numbers as a table, offered beside the chart. */
  table?: TableData;
  /** A choice that belongs to this report alone. */
  controls?: ReactNode;
  children: ReactNode;
};

/** One report: what it is, the drawing, and the numbers behind it for anyone who would rather read them. */
function ReportCard({ title, about, table, controls, children }: ReportCardProps) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-fg">{title}</h3>
          <p className="text-sm text-muted">{about}</p>
        </div>
        {table && (
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((value) => !value)}
            className="-mt-2 -mr-2 min-h-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {asTable ? "Chart" : "Table"}
          </button>
        )}
      </div>
      {controls}
      {asTable && table ? <DataTable {...table} /> : children}
    </Card>
  );
}

function Tiles({ tiles }: { tiles: ReadonlyArray<{ label: string; value: string; note?: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      {tiles.map(({ label, value, note }) => (
        <div key={label} className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
          <dt className="truncate text-xs text-muted">{label}</dt>
          <dd className="truncate text-lg font-semibold text-fg">{value}</dd>
          {note && <dd className="truncate text-xs text-muted">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-8">
    <h2 className="mb-3 text-lg font-semibold text-fg">{title}</h2>
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">{children}</div>
  </section>
);

/** A chart's series as a table: one row for each position along the bottom. */
function seriesTable(first: string, titles: readonly string[], series: readonly ChartSeries[], format: (value: number) => string): TableData {
  return {
    head: [first, ...series.map((entry) => entry.name)],
    rows: titles.map((title, i) => [title, ...series.map((entry) => (entry.values[i] == null ? "" : format(entry.values[i]!)))]),
  };
}

/** Charts, tables and totals drawn from the pay periods a span of time covers. */
export function ReportsPage() {
  const budget = useBudget();
  const today = todayIn(budget.data?.timezone ?? "UTC", new Date());
  const periods = usePeriodList(true);
  const [choice, setChoice] = useState<SpanChoice>("6");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const customValid = isLocalDate(from) && isLocalDate(to) && to >= from;
  const span = choice === "custom" ? (customValid ? { from, to } : null) : periods.data ? spanFor(choice, periods.data, today) : null;
  const report = useReport(span);

  function choose(next: SpanChoice) {
    // Typed dates start from what was on screen, so "custom" begins as a small change.
    if (next === "custom" && span) {
      setFrom(span.from);
      setTo(span.to);
    }
    setChoice(next);
  }

  let content: ReactNode;
  if (report.isError || periods.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load your reports.</Alert>
        <Button variant="secondary" onClick={() => (periods.isError ? periods.refetch() : report.refetch())}>
          Try again
        </Button>
      </div>
    );
  } else if (choice === "custom" && !customValid) {
    content = <p className="text-sm text-muted">Enter a start date and an end date on or after it.</p>;
  } else if (!report.data) {
    content = (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" role="status" aria-label="Loading reports">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="h-72 animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
    );
  } else if (report.data.periods.every((period) => period.count === 0)) {
    content = (
      <Card>
        <EmptyState
          icon={ChartColumn}
          title="Nothing to report on yet"
          description={
            report.data.periods.length === 0
              ? "No pay period falls between those dates."
              : "There are no transactions in these pay periods. Try a longer span."
          }
        />
      </Card>
    );
  } else {
    content = <Reports report={report.data} />;
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Where the money came from and where it went, pay period by pay period." />
      <div className="mb-6 grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,16rem)_auto]">
        <SelectField
          label="Show"
          options={SPAN_CHOICES}
          value={choice}
          onChange={(event) => choose(event.target.value as SpanChoice)}
        />
        {choice === "custom" && (
          <div className="grid grid-cols-2 items-start gap-3">
            <TextField label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <TextField label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
        )}
        {report.data && (
          <p className="text-sm text-muted sm:col-span-2">
            {report.data.periods.length === 1 ? "1 pay period" : `${report.data.periods.length} pay periods`},{" "}
            {formatDateRange(report.data.from, report.data.to)}. Whole pay periods are counted, with what is paid and
            what is still upcoming.
          </p>
        )}
      </div>
      {content}
    </>
  );
}

function Reports({ report }: { report: Report }) {
  const { periods } = report;
  const [billId, setBillId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState<{ open: boolean; start?: SearchStart }>({ open: false });

  const d = useMemo(() => {
    const labels = periods.map((period) => formatMonthDay(period.startDate));
    const titles = periods.map(
      (period) =>
        `${formatDateRange(period.startDate, period.endDate)}${period.isCurrent ? " (current)" : period.isFuture ? " (upcoming)" : ""}`,
    );
    const categoryName = new Map(report.categories.map((category) => [category.id, category.name]));
    const item = new Map(report.billsIncome.map((entry) => [entry.id, entry]));

    // Money out by category and by bill, and money in by where it came from, over the span.
    const categoryOut = new Map<string | null, number>();
    const billOut = new Map<string | null, number>();
    const sourceIn = new Map<string | null, number>();
    for (const period of periods) {
      for (const flow of period.categories) addTo(categoryOut, flow.categoryId, flow.outCents);
      for (const flow of period.billsIncome) {
        addTo(billOut, flow.billIncomeId, flow.outCents);
        addTo(sourceIn, flow.billIncomeId, flow.inCents);
      }
    }
    const categories = rankSeries(categoryOut, (id) => categoryName.get(id), "Uncategorised");
    const bills = rankSeries(billOut, (id) => item.get(id)?.name, "Not tied to a bill");
    const sources = rankSeries(sourceIn, (id) => item.get(id)?.name, "Other income");

    /** One series per ranked thing, each period's money added under the key it is drawn as. */
    const stack = <Flow,>(
      ranked: ReturnType<typeof rankSeries>,
      flowsOf: (period: Report["periods"][number]) => readonly Flow[],
      idOf: (flow: Flow) => string | null,
      amountOf: (flow: Flow) => number,
    ): ChartSeries[] =>
      ranked.series.map(({ key, name, color }) => ({
        name,
        color,
        values: periods.map((period) => sum(flowsOf(period).filter((flow) => ranked.keyOf(idOf(flow)) === key).map(amountOf))),
      }));
    const slices = (ranked: ReturnType<typeof rankSeries>, totals: ReadonlyMap<string | null, number>): Slice[] =>
      ranked.series.map(({ key, name, color }) => ({
        name,
        color,
        value: sum([...totals].filter(([id]) => ranked.keyOf(id) === key).map(([, cents]) => cents)),
      }));

    const income = sum(periods.map((period) => period.incomeCents));
    const expenses = sum(periods.map((period) => period.expenseCents));
    return { labels, titles, categoryName, item, categoryOut, billOut, sourceIn, categories, bills, sources, stack, slices, income, expenses };
  }, [report, periods]);

  const { labels, titles } = d;
  const money = { format: (value: number) => formatCents(value), formatAxis: compactCents };

  // ---- period by period
  const inOut: ChartSeries[] = [
    { name: "Income", color: BLUE, values: periods.map((period) => period.incomeCents) },
    { name: "Expenses", color: ORANGE, values: periods.map((period) => period.expenseCents) },
  ];
  const net = periods.map((period) => period.incomeCents - period.expenseCents);
  const netSeries: ChartSeries[] = [{ name: "Income less expenses", color: BLUE, negativeColor: RED, values: net }];
  const leftover: ChartSeries[] = [{ name: "Leftover at the end", color: BLUE, values: periods.map((period) => period.endingCents) }];
  const byBill = d.stack(
    { ...d.bills, series: d.bills.series.filter((entry) => entry.key !== NONE) },
    (period) => period.billsIncome,
    (flow) => flow.billIncomeId,
    (flow) => flow.outCents,
  );
  const byCategory = d.stack(d.categories, (period) => period.categories, (flow) => flow.categoryId, (flow) => flow.outCents);
  const committed: ChartSeries[] = [
    { name: "Bills and transfers", color: BLUE, values: periods.map((period) => period.billOutCents) },
    { name: "Everything else", color: ORANGE, values: periods.map((period) => period.expenseCents - period.billOutCents) },
  ];
  const shares: ChartSeries[] = [
    {
      name: "Bills and transfers",
      color: BLUE,
      values: periods.map((period) => (period.incomeCents > 0 ? (period.billOutCents / period.incomeCents) * 100 : null)),
    },
    {
      name: "Left over",
      color: AQUA,
      values: periods.map((period) =>
        period.incomeCents > 0 ? ((period.incomeCents - period.expenseCents) / period.incomeCents) * 100 : null,
      ),
    },
  ];
  const hasTransfers = report.billsIncome.some((entry) => entry.kind === "transfer");
  const transfers: ChartSeries[] = [
    { name: "Sent", color: BLUE, values: periods.map((period) => period.transferOutCents) },
    { name: "Brought back", color: ORANGE, values: periods.map((period) => period.transferInCents) },
  ];
  const putAway = sum(periods.map((period) => period.transferOutCents - period.transferInCents));

  // ---- one bill or income, and one category, over time
  const itemChoices = report.billsIncome.filter((entry) => d.billOut.get(entry.id) || d.sourceIn.get(entry.id));
  // Until one is chosen: the bill most went to.
  const chosenItem =
    itemChoices.find((entry) => entry.id === billId) ?? itemChoices.find((entry) => entry.id === d.bills.series[0]?.key) ?? itemChoices[0];
  const itemValues = chosenItem
    ? periods.map((period) => {
        const flow = period.billsIncome.find((entry) => entry.billIncomeId === chosenItem.id);
        return chosenItem.kind === "income" ? (flow?.inCents ?? 0) : (flow?.outCents ?? 0);
      })
    : [];
  const categoryChoices = report.categories.filter(
    (category) => d.categoryOut.get(category.id) || periods.some((period) => period.limits.some((limit) => limit.categoryId === category.id)),
  );
  const chosenCategory =
    categoryChoices.find((category) => category.id === categoryId) ??
    categoryChoices.find((category) => category.id === d.categories.series[0]?.key) ??
    categoryChoices[0];
  const categorySpent: ChartSeries[] = chosenCategory
    ? [
        {
          name: "Spent",
          color: BLUE,
          values: periods.map((period) => period.categories.find((flow) => flow.categoryId === chosenCategory.id)?.outCents ?? 0),
        },
      ]
    : [];
  const categoryLimit: ChartSeries[] = chosenCategory
    ? [
        {
          name: "Limit",
          color: ORANGE,
          values: periods.map((period) => period.limits.find((limit) => limit.categoryId === chosenCategory.id)?.limitCents ?? null),
        },
      ]
    : [];
  const hasLimitLine = categoryLimit.some((series) => series.values.some((value) => value !== null));

  // ---- pace
  const paceDays = Math.max(report.pace.usual?.length ?? 0, report.pace.current?.length ?? 0);
  const pace: ChartSeries[] = [
    ...(report.pace.usual ? [{ name: "Usual", color: ORANGE, values: Array.from({ length: paceDays }, (_, day) => report.pace.usual![day] ?? null) }] : []),
    ...(report.pace.current ? [{ name: "This period", color: BLUE, values: Array.from({ length: paceDays }, (_, day) => report.pace.current![day] ?? null) }] : []),
  ];

  // ---- limits
  const limited = new Map<string, { limitCents: number; spentCents: number; periods: number; over: number }>();
  for (const period of periods) {
    for (const limit of period.limits) {
      const entry = limited.get(limit.categoryId) ?? { limitCents: 0, spentCents: 0, periods: 0, over: 0 };
      entry.limitCents += limit.limitCents;
      entry.spentCents += limit.spentCents;
      entry.periods += 1;
      if (limit.spentCents > limit.limitCents) entry.over += 1;
      limited.set(limit.categoryId, entry);
    }
  }
  const limitRows: BarRow[] = [...limited]
    .map(([id, entry]) => ({
      name: d.categoryName.get(id) ?? "Deleted",
      value: entry.spentCents,
      of: entry.limitCents,
      text: `${formatCents(entry.spentCents)} of ${formatCents(entry.limitCents)}`,
      detail:
        entry.over === 0
          ? `Within its limit in all ${entry.periods} pay period${entry.periods === 1 ? "" : "s"}`
          : `Over in ${entry.over} of ${entry.periods} pay period${entry.periods === 1 ? "" : "s"}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const limitGrid: TableData = {
    head: ["Category", ...labels],
    rows: [...limited.keys()]
      .map((id) => [
        d.categoryName.get(id) ?? "Deleted",
        ...periods.map((period) => {
          const limit = period.limits.find((entry) => entry.categoryId === id);
          if (!limit) return "–";
          const left = limit.limitCents - limit.spentCents;
          return left < 0 ? `over ${formatCents(-left)}` : `${formatCents(left)} left`;
        }),
      ])
      .sort((a, b) => a[0]!.localeCompare(b[0]!)),
  };

  // ---- the latest period against the ones before it
  const latestIndex = periods.findLastIndex((period) => !period.isFuture);
  const latest = periods[latestIndex];
  const before = latestIndex > 0 ? periods.slice(0, latestIndex) : [];
  const againstUsual: TableData = {
    head: ["Category", "This period", "Usual", "Difference"],
    rows:
      latest && before.length > 0
        ? [...new Set([...latest.categories, ...before.flatMap((period) => period.categories)].map((flow) => flow.categoryId))]
            .map((id) => {
              const outIn = (period: Report["periods"][number]) => period.categories.find((flow) => flow.categoryId === id)?.outCents ?? 0;
              const now = outIn(latest);
              const usual = mean(before.map(outIn));
              return { name: id === null ? "Uncategorised" : (d.categoryName.get(id) ?? "Deleted"), now, usual, change: now - usual };
            })
            .filter((row) => row.now > 0 || row.usual > 0)
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
            .map((row) => [
              row.name,
              formatCents(row.now),
              formatCents(row.usual),
              row.change === 0 ? "the same" : `${formatCents(Math.abs(row.change))} ${row.change > 0 ? "more" : "less"}`,
            ])
        : [],
  };

  // ---- bills
  const yearly: TableData = {
    head: ["Bill or income", "Type", "A year, as scheduled", "In this span", "Each pay period"],
    rows: report.billsIncome
      .map((entry) => {
        const inSpan = entry.kind === "income" ? (d.sourceIn.get(entry.id) ?? 0) : (d.billOut.get(entry.id) ?? 0);
        return { entry, inSpan };
      })
      .filter(({ entry, inSpan }) => inSpan > 0 || (entry.yearlyCents ?? 0) > 0)
      .sort((a, b) => (b.entry.yearlyCents ?? 0) - (a.entry.yearlyCents ?? 0) || b.inSpan - a.inSpan)
      .map(({ entry, inSpan }) => [
        entry.name,
        KIND_LABELS[entry.kind],
        entry.yearlyCents === null ? "no schedule" : formatCents(entry.yearlyCents),
        formatCents(inSpan),
        formatCents(Math.round(inSpan / periods.length)),
      ]),
  };
  const aheadLabels = report.ahead.map((period) => formatMonthDay(period.startDate));
  const aheadTitles = report.ahead.map((period) => formatDateRange(period.startDate, period.endDate));
  const ahead: ChartSeries[] = [
    { name: "Income", color: BLUE, values: report.ahead.map((period) => period.incomeCents) },
    { name: "Bills and transfers", color: ORANGE, values: report.ahead.map((period) => period.billsCents) },
  ];

  const uncategorised = d.categoryOut.get(null) ?? 0;
  const counted = periods.length;
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const transactionRows = (transactions: Report["largest"]) =>
    transactions.map((transaction) => [
      transaction.name,
      formatLongDate(transaction.occursAt.slice(0, 10)),
      formatCents(Math.abs(transaction.amountCents)),
    ]);

  return (
    <>
      <Section title="At a glance">
        <ReportCard title="The span in figures" about="Everything dated in these pay periods, paid or upcoming.">
          <Tiles
            tiles={[
              { label: "Income", value: formatCents(d.income), note: `${formatCents(Math.round(d.income / counted))} a pay period` },
              { label: "Expenses", value: formatCents(d.expenses), note: `${formatCents(Math.round(d.expenses / counted))} a pay period` },
              {
                label: d.income >= d.expenses ? "Kept" : "Overspent",
                value: formatCents(Math.abs(d.income - d.expenses)),
                note: d.income > 0 ? `${percent(((d.income - d.expenses) / d.income) * 100)} of income` : undefined,
              },
              { label: "Leftover now", value: formatCents(periods.at(-1)!.endingCents), note: `started at ${formatCents(periods[0]!.startingCents)}` },
              { label: "Transactions", value: sum(periods.map((period) => period.count)).toLocaleString("en-US") },
              { label: "Pay periods", value: String(counted) },
            ]}
          />
        </ReportCard>
        {report.categories.length > 0 && (
          <ReportCard
            title="Not filed under a category"
            about="Money out that the category reports can only show as Uncategorised."
          >
            <Tiles
              tiles={[
                { label: "Uncategorised", value: formatCents(uncategorised) },
                { label: "Share of expenses", value: d.expenses > 0 ? percent((uncategorised / d.expenses) * 100) : "0%" },
              ]}
            />
            {uncategorised > 0 && (
              <Button variant="secondary" className="self-start" onClick={() => setSearch({ open: true, start: { categoryId: NO_CATEGORY } })}>
                Find them
              </Button>
            )}
          </ReportCard>
        )}
      </Section>

      <Section title="Pay period by pay period">
        <ReportCard title="Income and expenses" about="What came in and what went out in each pay period." table={seriesTable("Pay period", titles, inOut, money.format)}>
          <XYChart label="Income and expenses in each pay period" labels={labels} titles={titles} bars={{ series: inOut, mode: "grouped" }} {...money} />
        </ReportCard>
        <ReportCard
          title="What each paycheck left"
          about="Income less expenses. Below the line, more went out than came in."
          table={{ head: ["Pay period", "Income less expenses"], rows: titles.map((title, i) => [title, formatCents(net[i]!)]) }}
        >
          <XYChart label="Income less expenses in each pay period" labels={labels} titles={titles} bars={{ series: netSeries, mode: "grouped" }} {...money} />
        </ReportCard>
        <ReportCard title="Leftover over time" about="What each pay period ended with, which is what the next one started with." table={seriesTable("Pay period", titles, leftover, money.format)}>
          <XYChart label="Leftover at the end of each pay period" labels={labels} titles={titles} lines={leftover} {...money} />
        </ReportCard>
        <ReportCard
          title="Bills and transfers"
          about="Money out tied to each bill or transfer, in each pay period."
          table={seriesTable("Pay period", titles, byBill, money.format)}
        >
          {byBill.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nothing in this span is tied to a bill.</p>
          ) : (
            <XYChart label="Money out by bill in each pay period" labels={labels} titles={titles} bars={{ series: byBill, mode: "stacked" }} {...money} />
          )}
        </ReportCard>
        {chosenItem && (
          <ReportCard
            title="One bill or income over time"
            about="What went to it, or came from it, in each pay period. A change in a bill's price shows as a step."
            table={{ head: ["Pay period", chosenItem.name], rows: titles.map((title, i) => [title, formatCents(itemValues[i]!)]) }}
            controls={
              <SelectField
                label="Bill or income"
                options={itemChoices.map((entry) => ({ value: entry.id, label: entry.name }))}
                value={chosenItem.id}
                onChange={(event) => setBillId(event.target.value)}
              />
            }
          >
            <XYChart
              label={`${chosenItem.name} in each pay period`}
              labels={labels}
              titles={titles}
              bars={{ series: [{ name: chosenItem.name, color: BLUE, values: itemValues }], mode: "grouped" }}
              {...money}
            />
            <Tiles
              tiles={[
                { label: "In this span", value: formatCents(sum(itemValues)) },
                { label: "Each pay period", value: formatCents(mean(itemValues)) },
                { label: "A year, as scheduled", value: chosenItem.yearlyCents === null ? "No schedule" : formatCents(chosenItem.yearlyCents) },
              ]}
            />
          </ReportCard>
        )}
        <ReportCard title="Spending by category" about="Money out under each category, in each pay period." table={seriesTable("Pay period", titles, byCategory, money.format)}>
          <XYChart label="Money out by category in each pay period" labels={labels} titles={titles} bars={{ series: byCategory, mode: "stacked" }} {...money} />
        </ReportCard>
        {chosenCategory && (
          <ReportCard
            title="One category over time"
            about="What was spent under it in each pay period, against that period's limit where it had one."
            table={seriesTable("Pay period", titles, [...categorySpent, ...categoryLimit], money.format)}
            controls={
              <SelectField
                label="Category"
                options={categoryChoices.map((category) => ({ value: category.id, label: category.name }))}
                value={chosenCategory.id}
                onChange={(event) => setCategoryId(event.target.value)}
              />
            }
          >
            <XYChart
              label={`${chosenCategory.name} in each pay period`}
              labels={labels}
              titles={titles}
              bars={{ series: categorySpent, mode: "grouped" }}
              lines={hasLimitLine ? categoryLimit : []}
              {...money}
            />
          </ReportCard>
        )}
        <ReportCard
          title="Committed and everything else"
          about="How much of each pay period's spending was tied to a bill or transfer, and how much was not."
          table={seriesTable("Pay period", titles, committed, money.format)}
        >
          <XYChart label="Spending tied to bills against the rest, in each pay period" labels={labels} titles={titles} bars={{ series: committed, mode: "stacked" }} {...money} />
        </ReportCard>
        <ReportCard
          title="Shares of income"
          about="The part of each pay period's income that went to bills and transfers, and the part left over."
          table={seriesTable("Pay period", titles, shares, percent)}
        >
          <XYChart label="Bills and leftover as shares of income" labels={labels} titles={titles} lines={shares} format={percent} formatAxis={percent} />
        </ReportCard>
        {hasTransfers && (
          <ReportCard
            title="Transfers"
            about={`Money sent to your other accounts and brought back. Over this span, ${formatCents(Math.abs(putAway))} more was ${putAway >= 0 ? "sent than brought back" : "brought back than sent"}.`}
            table={seriesTable("Pay period", titles, transfers, money.format)}
          >
            <XYChart label="Transfers sent and brought back in each pay period" labels={labels} titles={titles} bars={{ series: transfers, mode: "grouped" }} {...money} />
          </ReportCard>
        )}
        {pace.length > 0 && (
          <ReportCard
            title="Spending pace"
            about="Money out added up day by day through a pay period: this one so far, against the average of the ones before it."
            table={seriesTable("Day", Array.from({ length: paceDays }, (_, day) => `Day ${day + 1}`), pace, money.format)}
          >
            <XYChart
              label="Spending so far this pay period against the usual"
              labels={Array.from({ length: paceDays }, (_, day) => String(day + 1))}
              titles={Array.from({ length: paceDays }, (_, day) => `Day ${day + 1}`)}
              lines={pace}
              {...money}
            />
          </ReportCard>
        )}
      </Section>

      <Section title="Where it went">
        <ReportCard title="By category" about="Every dollar out over the span, by the category it was filed under.">
          <DonutChart label="Money out by category" totalLabel="spent" slices={d.slices(d.categories, d.categoryOut)} format={formatCents} />
        </ReportCard>
        <ReportCard title="By bill" about="Every dollar out over the span, by the bill or transfer it was tied to.">
          <DonutChart label="Money out by bill" totalLabel="spent" slices={d.slices(d.bills, d.billOut)} format={formatCents} />
        </ReportCard>
        <ReportCard title="Where income came from" about="Every dollar in over the span, by the income it was tied to.">
          <DonutChart label="Money in by source" totalLabel="came in" slices={d.slices(d.sources, d.sourceIn)} format={formatCents} />
        </ReportCard>
        <ReportCard title="Names most was spent under" about="Transactions with the same name, whatever its capitals, added together.">
          <BarList
            rows={report.names.map((entry) => ({
              name: entry.name,
              value: entry.outCents,
              text: formatCents(entry.outCents),
              detail: `${entry.count} transaction${entry.count === 1 ? "" : "s"}`,
            }))}
          />
        </ReportCard>
        <ReportCard title="Largest one-off payments" about="The ten biggest single amounts out, not counting what your schedules added.">
          <DataTable head={["Name", "Date", "Amount"]} rows={transactionRows(report.largest)} />
        </ReportCard>
        <ReportCard
          title="Days of the week"
          about="Money out by the day it was dated. Bills land on their due dates, whatever the day."
          table={{ head: ["Day", "Money out"], rows: weekdayNames.map((day, i) => [day, formatCents(report.weekdays[i] ?? 0)]) }}
        >
          <XYChart
            label="Money out by day of the week"
            labels={weekdayNames}
            bars={{ series: [{ name: "Money out", color: BLUE, values: report.weekdays }], mode: "grouped" }}
            {...money}
            height={180}
          />
        </ReportCard>
      </Section>

      <Section title="Limits">
        <ReportCard title="Spending against limits" about="For each category, what was spent in the pay periods that had a limit, against those limits added up.">
          <BarList rows={limitRows} empty="No pay period in this span has a category limit." />
        </ReportCard>
        <ReportCard title="Kept or gone over" about="Each limit in each pay period: what was left of it, or how far over it went.">
          <DataTable {...limitGrid} empty="No pay period in this span has a category limit." />
        </ReportCard>
        <ReportCard
          title="This pay period against your usual"
          about={
            latest && before.length > 0
              ? `Money out by category in ${formatDateRange(latest.startDate, latest.endDate)}, against the average of the ${before.length} before it. Largest differences first.`
              : "Money out by category in the latest pay period, against the average of the ones before it."
          }
        >
          <DataTable {...againstUsual} empty="This needs at least two pay periods in the span." />
        </ReportCard>
      </Section>

      <Section title="Bills and what is coming">
        <ReportCard title="What each bill costs a year" about="Each bill or income at its usual amount over the next twelve months, beside what it actually came to in this span.">
          <DataTable {...yearly} empty="No bills or income yet." />
        </ReportCard>
        {ahead.some((series) => series.values.some((value) => value)) && (
          <ReportCard
            title="The next six pay periods"
            about="What your schedules bring: income and bills at their usual amounts. A tall orange bar is a heavy paycheck."
            table={seriesTable("Pay period", aheadTitles, ahead, money.format)}
          >
            <XYChart label="Scheduled income and bills in the next six pay periods" labels={aheadLabels} titles={aheadTitles} bars={{ series: ahead, mode: "grouped" }} {...money} />
          </ReportCard>
        )}
        <ReportCard title="Not yet marked paid" about="Dated before today and still upcoming: a bill that was skipped, or one that was paid and never ticked.">
          <DataTable head={["Name", "Date", "Amount"]} rows={transactionRows(report.unpaid)} empty="Nothing from before today is still upcoming." />
        </ReportCard>
      </Section>

      <SearchDialog
        open={search.open}
        onClose={() => setSearch((current) => ({ ...current, open: false }))}
        today={report.today}
        start={search.start}
      />
    </>
  );
}
