import { Link } from "react-router";
import { useState } from "react";
import type { ExtraMoneyFacts } from "../../../shared/advice.ts";
import { formatDateRange } from "../../../shared/dates.ts";
import { formatCents, parseMoneyInput } from "../../../shared/money.ts";
import { describeMonths, makePlan, type PlanStrategy, PLAN_STRATEGIES, safeToSpare, STRATEGY_LABELS } from "../../../shared/paydown.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { QuickAddDialog } from "./QuickAddDialog.tsx";

const ABOUT: Record<PlanStrategy, string> = {
  balanced: "The app's pick: a cushion of savings first, then high interest, then half to each.",
  fastest: "Highest interest first: the least interest paid overall.",
  fewest: "Smallest balance first: each one cleared is a payment gone.",
  savings: "All of it to savings, the lowest first.",
};

/** The amount the extra money plans and questions use: what was typed, or the safe amount until something is. */
export function useExtraAmount(extra: ExtraMoneyFacts | undefined) {
  const [typed, setTyped] = useState<string | null>(null);
  const safe = extra ? safeToSpare(extra.periods, extra.lowBalanceCents) : null;
  const text = typed ?? (safe ? (safe.safeCents / 100).toFixed(2) : "");
  const cents = parseMoneyInput(text);
  return { text, setText: setTyped, cents: cents !== null && cents > 0 ? cents : null };
}

/**
 * "Where should my extra money go?": an amount, four ways to split it over the tracked
 * debts and savings, worked out here as the amount changes, and a quick add of the result.
 */
export function ExtraMoneyCard({ extra, amount }: { extra: ExtraMoneyFacts; amount: ReturnType<typeof useExtraAmount> }) {
  const [strategy, setStrategy] = useState<PlanStrategy>("balanced");
  const [adding, setAdding] = useState(false);
  const { safeCents, zeroCents, limiting } = safeToSpare(extra.periods, extra.lowBalanceCents);
  const lowest = extra.periods[limiting];
  const tracked = extra.debts.length + extra.savings.length > 0;
  const usable = Math.min(amount.cents ?? 0, zeroCents);
  const plan = makePlan(strategy, usable, extra.debts, extra.savings, extra.monthlySpendCents);

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold text-fg">Where should my extra money go?</h3>
        <p className="text-sm text-muted">
          Split over the loans, cards and savings whose balances you track, never taking a coming pay period below zero.
        </p>
      </div>

      {!tracked ? (
        <p className="text-sm text-fg">
          Nothing to put it toward yet.{" "}
          <Link to="/balances" className="font-semibold text-primary hover:underline">
            Track a balance
          </Link>{" "}
          for each loan, card or savings account first.
        </p>
      ) : (
        <>
          <TextField
            label="Extra money"
            inputMode="decimal"
            autoComplete="off"
            value={amount.text}
            onChange={(event) => amount.setText(event.target.value)}
            error={amount.text.trim() !== "" && amount.cents === null ? "Enter an amount like 250.00" : undefined}
            hint={
              lowest
                ? `Safe to spare: ${formatCents(safeCents)} keeps every pay period at or above ${formatCents(extra.lowBalanceCents)}; at most ${formatCents(zeroCents)} keeps them above zero.`
                : undefined
            }
          />
          {amount.cents !== null && amount.cents > zeroCents ? (
            <Alert tone="danger">
              More than {formatCents(zeroCents)} would take {lowest ? formatDateRange(lowest.startDate, lowest.endDate) : "a pay period"} below
              zero. The plan uses {formatCents(zeroCents)}.
            </Alert>
          ) : amount.cents !== null && amount.cents > safeCents && lowest ? (
            <Alert tone="warning">
              {formatDateRange(lowest.startDate, lowest.endDate)} would end with {formatCents(lowest.projectedCents - amount.cents)}, below{" "}
              {formatCents(extra.lowBalanceCents)}.
            </Alert>
          ) : null}

          <SegmentedControl
            label="How to split it"
            options={PLAN_STRATEGIES.map((value) => ({ value, label: STRATEGY_LABELS[value] }))}
            value={strategy}
            onChange={setStrategy}
            fitLabels
          />
          <p className="-mt-2 text-sm text-muted">{ABOUT[strategy]}</p>

          {plan.lines.length === 0 ? (
            <p className="text-sm text-muted">
              {usable === 0 ? "Nothing to split." : strategy === "savings" ? "No savings are tracked." : "No debts are tracked."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {plan.lines.map((line) => (
                <li key={line.billIncomeId} className="flex flex-col gap-0.5 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-medium break-words text-fg">{line.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-fg">{formatCents(line.amountCents)}</span>
                  </div>
                  <p className="text-sm text-muted">{line.reason}</p>
                  {line.payoff && line.payoff.monthsAfter !== line.payoff.monthsBefore && (
                    <p className="text-sm text-muted">
                      Paid off {describeMonths(line.payoff.monthsAfter)} instead of{" "}
                      {describeMonths(line.payoff.monthsBefore).replace("in about ", "")}
                      {line.payoff.interestSavedCents ? `, about ${formatCents(line.payoff.interestSavedCents)} less interest` : ""}.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {plan.unplacedCents > 0 && plan.lines.length > 0 && (
            <p className="text-sm text-muted">{formatCents(plan.unplacedCents)} left over: these would all be cleared.</p>
          )}
          {plan.lines.length > 0 && (
            <Button className="self-start" onClick={() => setAdding(true)}>
              Add these payments
            </Button>
          )}
          <QuickAddDialog
            open={adding}
            onClose={() => setAdding(false)}
            items={plan.lines.map(({ billIncomeId, name, amountCents }) => ({ billIncomeId, name, amountCents }))}
            categoryIds={extra.categoryIds}
          />
        </>
      )}
    </Card>
  );
}
