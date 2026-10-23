import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { formatApr, type TrackedBalance } from "../../../shared/balances.ts";
import { dateOf, formatDay } from "../../../shared/dates.ts";
import { Button } from "../../components/ui/Button.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { shownBalance } from "../billsIncome/ItemTransactions.tsx";
import { useBalanceLooksRight, useCheckBalance, useSnoozeBalance } from "./api.ts";
import {
  applyBalanceErrors,
  BalanceFields,
  balanceFieldsInput,
  type BalanceFormValues,
  balanceFormSchema,
  checkDefaults,
  useFollowRates,
} from "./BalanceFields.tsx";

const SNOOZES = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "Next week" },
] as const;

/** What the budget thinks a balance is, and since when: "Estimated $2,475.00 owed · checked Jan 3". */
export function estimateLine(balance: TrackedBalance): string {
  const checked = `checked ${formatDay(dateOf(balance.lastCheck.asOf))}`;
  const rate = balance.lastCheck.aprBps === null ? "" : ` · ${formatApr(balance.lastCheck.aprBps)}`;
  // A rate over parts is their blend: the count says so.
  const parts = balance.parts.length > 0 ? ` · ${balance.parts.length} parts` : "";
  return `${balance.sinceCount > 0 ? "Estimated " : ""}${shownBalance(balance.estimateCents)} · ${checked}${rate}${parts}`;
}

/**
 * A balance due for a check, with a form to enter what the account says now. "Looks right"
 * records the estimate as it is; Snooze asks again later.
 */
export function CheckBalanceRow({ balance, onOpen }: { balance: TrackedBalance; onOpen?: () => void }) {
  const toast = useToast();
  const check = useCheckBalance();
  const looksRight = useBalanceLooksRight();
  const snooze = useSnoozeBalance();
  const [snoozing, setSnoozing] = useState(false);
  const busy = check.isPending || looksRight.isPending || snooze.isPending;
  const form = useForm<BalanceFormValues>({
    resolver: zodResolver(balanceFormSchema),
    defaultValues: checkDefaults(balance),
  });
  useFollowRates(form, balance);

  const failed = (error: unknown) => {
    if (!applyBalanceErrors(error, form)) {
      toast(error instanceof ApiError ? error.message : "Couldn't save that. Try again.", { variant: "error" });
    }
  };

  const submit = form.handleSubmit((values) =>
    check.mutate(
      { billIncomeId: balance.billIncomeId, input: balanceFieldsInput(values) },
      { onSuccess: () => toast(`${balance.name} checked.`), onError: failed },
    ),
  );

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3 py-3">
      <div className="min-w-0">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="text-left font-medium break-words text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {balance.name}
          </button>
        ) : (
          <p className="font-medium break-words text-fg">{balance.name}</p>
        )}
        <p className="text-sm text-muted">{estimateLine(balance)}</p>
      </div>
      <BalanceFields form={form} compact amountLabel="Balance now" />
      {snoozing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Ask again</span>
          {SNOOZES.map(({ days, label }) => (
            <Button
              key={days}
              type="button"
              variant="secondary"
              disabled={busy}
              loading={snooze.isPending && snooze.variables?.days === days}
              onClick={() =>
                snooze.mutate(
                  { billIncomeId: balance.billIncomeId, days },
                  { onSuccess: () => toast(`${balance.name} snoozed.`), onError: failed },
                )
              }
            >
              {label}
            </Button>
          ))}
          <Button type="button" variant="ghost" onClick={() => setSnoozing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} loading={check.isPending}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            loading={looksRight.isPending}
            onClick={() =>
              looksRight.mutate(balance.billIncomeId, {
                onSuccess: () => toast(`${balance.name} checked.`),
                onError: failed,
              })
            }
          >
            Looks right
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setSnoozing(true)}>
            Snooze
          </Button>
        </div>
      )}
    </form>
  );
}
