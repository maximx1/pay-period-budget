import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { nowIn } from "../../../shared/dates.ts";
import { centsToInput, formatCents, parseMoneyInput } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useBudget } from "../budget/api.ts";
import { useImportTransactions } from "../transactions/api.ts";
import { adviceKeys } from "./api.ts";

export type QuickAddItem = { billIncomeId: string; name: string; amountCents: number };

type QuickAddDialogProps = {
  open: boolean;
  onClose: () => void;
  items: readonly QuickAddItem[];
  /** Each item's category, which its payment is filed under. */
  categoryIds: Record<string, string | null>;
};

/**
 * Turns suggested payments into transactions: one per item, dated now, tied to it (so its
 * balance moves when it is marked paid) and filed under its category. Amounts can be
 * changed and rows left out first.
 */
export function QuickAddDialog({ open, onClose, items, categoryIds }: QuickAddDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Add these payments">
      <QuickAddForm onClose={onClose} items={items} categoryIds={categoryIds} />
    </Dialog>
  );
}

type Row = QuickAddItem & { included: boolean; amount: string; error?: string };

function QuickAddForm({ onClose, items, categoryIds }: Omit<QuickAddDialogProps, "open">) {
  const timezone = useBudget().data?.timezone ?? "UTC";
  const importTransactions = useImportTransactions();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => items.map((item) => ({ ...item, included: true, amount: centsToInput(item.amountCents) })));
  const [paid, setPaid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const chosen = rows.filter((row) => row.included);
  const total = chosen.reduce((sum, row) => sum + (parseMoneyInput(row.amount) ?? 0), 0);

  const update = (index: number, change: Partial<Row>) => setRows((all) => all.map((row, i) => (i === index ? { ...row, ...change } : row)));

  function submit() {
    setFailure(null);
    const checked = rows.map((row) => {
      const cents = parseMoneyInput(row.amount);
      return { ...row, cents, error: row.included && (cents === null || cents <= 0) ? "Enter an amount greater than zero" : undefined };
    });
    setRows(checked);
    if (checked.some((row) => row.error)) return;
    const occursAt = nowIn(timezone, new Date());
    importTransactions.mutate(
      {
        transactions: checked
          .filter((row) => row.included)
          .map((row) => ({
            name: row.name,
            amountCents: row.cents!,
            kind: "expense" as const,
            occursAt,
            paid,
            billIncomeId: row.billIncomeId,
            categoryId: categoryIds[row.billIncomeId] ?? null,
          })),
      },
      {
        onSuccess: ({ created }) => {
          void queryClient.invalidateQueries({ queryKey: adviceKeys.quick });
          toast(created === 1 ? "1 payment added." : `${created} payments added.`);
          onClose();
        },
        onError: (error) => setFailure(error instanceof ApiError ? error.message : "Couldn't add those. Try again."),
      },
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted">Each is added to today's pay period as a payment to that item.</p>
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.billIncomeId} className="grid grid-cols-[auto_1fr] items-start gap-3">
            <input
              type="checkbox"
              className="mt-3 size-5 accent-primary"
              aria-label={`Add ${row.name}`}
              checked={row.included}
              onChange={(event) => update(index, { included: event.target.checked })}
            />
            <TextField
              label={row.name}
              inputMode="decimal"
              autoComplete="off"
              disabled={!row.included}
              value={row.amount}
              error={row.error}
              data-autofocus={index === 0 || undefined}
              onChange={(event) => update(index, { amount: event.target.value, error: undefined })}
            />
          </li>
        ))}
      </ul>
      <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
        <input type="checkbox" className="size-5 accent-primary" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
        Already paid
      </label>
      {failure && <Alert>{failure}</Alert>}
      <DialogActions>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={chosen.length === 0} loading={importTransactions.isPending}>
          {chosen.length === 0 ? "Add" : `Add ${chosen.length === 1 ? "1 payment" : `${chosen.length} payments`}, ${formatCents(total)}`}
        </Button>
      </DialogActions>
    </form>
  );
}
