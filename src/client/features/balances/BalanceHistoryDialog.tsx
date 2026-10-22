import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { type BalanceHistoryResponse, type CheckEveryDays, formatApr } from "../../../shared/balances.ts";
import { dateOf, formatDay, todayIn } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import { compactCents, SERIES_COLORS } from "../../components/charts/palette.ts";
import { XYChart } from "../../components/charts/XYChart.tsx";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { shownBalance } from "../billsIncome/ItemTransactions.tsx";
import { useBudget } from "../budget/api.ts";
import {
  useBalanceHistory,
  useBalances,
  useCheckBalance,
  useDeleteBalanceCheck,
  useStopTrackingBalance,
  useUpdateTrackedBalance,
} from "./api.ts";
import {
  applyBalanceErrors,
  BalanceFields,
  balanceFieldDefaults,
  balanceFieldsInput,
  type BalanceFormValues,
  balanceFormSchema,
} from "./BalanceFields.tsx";
import { everyOptions } from "./TrackBalanceDialog.tsx";

type BalanceHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Kept after closing so the dialog doesn't empty while it fades out. */
  billIncomeId: string | null;
  name: string;
};

/** One tracked balance: where it stands, its checks over time, and what has moved it since the last. */
export function BalanceHistoryDialog({ open, onClose, billIncomeId, name }: BalanceHistoryDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={name}>
      {billIncomeId && <History billIncomeId={billIncomeId} onClose={onClose} />}
    </Dialog>
  );
}

function History({ billIncomeId, onClose }: { billIncomeId: string; onClose: () => void }) {
  const history = useBalanceHistory(billIncomeId);

  if (history.isPending) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" role="status" aria-label="Loading" />;
  if (history.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load this balance.</Alert>
        <Button variant="secondary" onClick={() => history.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <Loaded data={history.data} onClose={onClose} />;
}

function Figure({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-surface-2 px-3 py-2", wide && "col-span-2")}>
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="font-semibold break-words text-fg tabular-nums">{value}</dd>
    </div>
  );
}

function Loaded({ data, onClose }: { data: BalanceHistoryResponse; onClose: () => void }) {
  const { balance, checks, since } = data;
  const toast = useToast();
  const usual = useBalances().data?.settings.checkEveryDays;
  const update = useUpdateTrackedBalance();
  const stop = useStopTrackingBalance();
  const remove = useDeleteBalanceCheck();
  const [stopping, setStopping] = useState(false);
  const rate = balance.lastCheck.aprBps;
  const interest = balance.monthlyInterestCents;
  // Oldest first along the bottom, then where the estimate has got to since.
  const points = [...checks].reverse().map((check) => ({ label: formatDay(dateOf(check.asOf)), cents: check.balanceCents }));
  if (balance.sinceCount > 0) points.push({ label: "Now (estimated)", cents: balance.estimateCents });

  const failed = (error: unknown) =>
    toast(error instanceof ApiError ? error.message : "Couldn't save that. Try again.", { variant: "error" });

  return (
    <div className="flex flex-col gap-5">
      {/* The balance and the interest have a row each: "owed" after a large amount needs the width. */}
      <dl className="grid grid-cols-2 gap-2">
        <Figure wide label={balance.sinceCount > 0 ? "Estimated balance" : "Balance"} value={shownBalance(balance.estimateCents)} />
        <Figure label="Last checked" value={formatDay(dateOf(balance.lastCheck.asOf))} />
        <Figure label="APR" value={rate === null ? "None given" : formatApr(rate)} />
        <Figure
          wide
          label={balance.estimateCents < 0 ? "Interest a month" : "Earns a month"}
          value={interest === null ? "Give an APR to see" : `About ${formatCents(interest)}`}
        />
      </dl>

      <div className="flex flex-col gap-1">
        <SelectField
          label="Ask me to check it"
          options={everyOptions(usual)}
          value={balance.checkEveryDays === null ? "" : String(balance.checkEveryDays)}
          disabled={update.isPending}
          hint={balance.due ? "Due for a check now." : `Next asked around ${formatDay(balance.nextCheckOn)}.`}
          onChange={(event) =>
            update.mutate(
              {
                billIncomeId: balance.billIncomeId,
                patch: { checkEveryDays: event.target.value ? (Number(event.target.value) as CheckEveryDays) : null },
              },
              { onError: failed },
            )
          }
        />
      </div>

      {points.length >= 2 && (
        <XYChart
          label={`${balance.name} over time`}
          labels={points.map((point) => point.label)}
          lines={[{ name: "Balance", color: SERIES_COLORS[0], values: points.map((point) => point.cents) }]}
          format={(cents) => formatCents(cents)}
          formatAxis={compactCents}
          height={180}
        />
      )}

      {since.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-fg">Paid since the last check</h3>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {since.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 break-words text-fg">
                  {row.name} <span className="text-muted">· {formatDay(dateOf(row.occursAt))}</span>
                </span>
                {/* Money sent to it raises its balance, so it shows as a plus here. */}
                <span className="shrink-0 tabular-nums text-fg">{formatCents(-row.amountCents, { showPlus: true })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AddCheck data={data} />

      <section>
        <h3 className="mb-1 text-sm font-semibold text-fg">Checks</h3>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {checks.map((check) => (
            <li key={check.id} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 text-muted">
                {formatDay(dateOf(check.asOf))}
                {check.aprBps !== null && ` · ${formatApr(check.aprBps)}`}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-fg">{shownBalance(check.balanceCents)}</span>
              {checks.length > 1 && (
                <IconButton
                  label={`Delete the check of ${formatDay(dateOf(check.asOf))}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(
                      { billIncomeId: balance.billIncomeId, checkId: check.id },
                      { onSuccess: () => toast("Check deleted."), onError: failed },
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </section>

      {stopping ? (
        <Alert tone="warning">
          <div className="flex flex-col gap-3">
            <p>Stop asking about {balance.name}? Its checks are kept, and come back if you track it again.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                loading={stop.isPending}
                onClick={() =>
                  stop.mutate(balance.billIncomeId, {
                    onSuccess: () => {
                      toast(`Stopped tracking ${balance.name}.`);
                      onClose();
                    },
                    onError: failed,
                  })
                }
              >
                Stop tracking
              </Button>
              <Button variant="ghost" onClick={() => setStopping(false)}>
                Keep it
              </Button>
            </div>
          </div>
        </Alert>
      ) : (
        <DialogActions>
          <Button variant="ghost" onClick={() => setStopping(true)}>
            Stop tracking
          </Button>
          <Button data-autofocus onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      )}
    </div>
  );
}

/** A new check, optionally dated earlier: a statement's closing balance, say. */
function AddCheck({ data }: { data: BalanceHistoryResponse }) {
  const { balance } = data;
  const toast = useToast();
  const timezone = useBudget().data?.timezone;
  const check = useCheckBalance();
  const form = useForm<BalanceFormValues>({
    resolver: zodResolver(balanceFormSchema),
    defaultValues: { ...balanceFieldDefaults(balance.estimateCents, balance.lastCheck.aprBps, false), asOfDate: "" },
  });
  const today = timezone ? todayIn(timezone, new Date()) : undefined;

  const submit = form.handleSubmit((values) => {
    // A day before today means that day's close; today (or none) means now.
    const asOf = values.asOfDate && values.asOfDate !== today ? `${values.asOfDate}T23:59` : undefined;
    check.mutate(
      { billIncomeId: balance.billIncomeId, input: { ...balanceFieldsInput(values), asOf } },
      {
        onSuccess: () => {
          toast(`${balance.name} checked.`);
          form.reset({ ...balanceFieldDefaults(balance.estimateCents, balance.lastCheck.aprBps, false), asOfDate: "" });
        },
        onError: (error) => {
          const fields = error instanceof ApiError ? error.fields : undefined;
          if (fields?.asOf) form.setError("asOfDate", { message: fields.asOf });
          if (!applyBalanceErrors(error, form) && !fields?.asOf) {
            toast(error instanceof ApiError ? error.message : "Couldn't save that. Try again.", { variant: "error" });
          }
        },
      },
    );
  });

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-fg">Add a check</h3>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <BalanceFields form={form} compact />
        <TextField
          label="As of (optional)"
          type="date"
          max={today}
          hint="Leave empty for now; an earlier day counts as that day's close."
          error={form.formState.errors.asOfDate?.message}
          {...form.register("asOfDate")}
        />
        <Button type="submit" variant="secondary" className="self-start" loading={check.isPending}>
          Save check
        </Button>
      </form>
    </section>
  );
}
