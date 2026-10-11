import { type FormEvent, useState } from "react";
import type { PeriodDatesResponse, PeriodView } from "../../../shared/budget.ts";
import { formatMonthDay, isLocalDate } from "../../../shared/dates.ts";
import { centsToInput, parseMoneyInput } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { ApiError } from "../../lib/api.ts";
import { useDebouncedValue } from "../../lib/useDebouncedValue.ts";
import {
  useChangePeriodDates,
  usePeriodDatesPreview,
  useRevertStartingAmount,
  useSetStartingAmount,
} from "./api.ts";

type PeriodSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  view: PeriodView;
};

/** For the exceptions: a payday that lands early or late, or a starting amount that needs correcting. */
export function PeriodSettingsDialog({ open, onClose, view }: PeriodSettingsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Period settings">
      <PeriodSettingsForm onClose={onClose} view={view} />
    </Dialog>
  );
}

const signedInput = (cents: number) => `${cents < 0 ? "-" : ""}${centsToInput(cents)}`;
const fieldErrorsOf = (error: unknown) => (error instanceof ApiError ? (error.fields ?? {}) : {});

/** The knock-on effects of a date change, in plain words. */
function describeEffects({ changes, movedTransactions }: PeriodDatesResponse): string[] {
  const lines: string[] = [];
  for (const change of changes) {
    if (change.role === "previous") {
      lines.push(
        `The previous period will end ${formatMonthDay(change.endDate)} instead of ${formatMonthDay(change.previousEndDate)}.`,
      );
    } else if (change.role === "next") {
      lines.push(
        `The next period will start ${formatMonthDay(change.startDate)} instead of ${formatMonthDay(change.previousStartDate)}.`,
      );
    }
  }
  if (movedTransactions > 0) {
    lines.push(
      `${movedTransactions} transaction${movedTransactions === 1 ? "" : "s"} will move to a different period.`,
    );
  }
  return lines;
}

function PeriodSettingsForm({ onClose, view }: Omit<PeriodSettingsDialogProps, "open">) {
  const { period } = view;
  const changeDates = useChangePeriodDates();
  const setStarting = useSetStartingAmount();
  const revertStarting = useRevertStartingAmount();

  const [startDate, setStartDate] = useState(period.startDate);
  const [endDate, setEndDate] = useState(period.endDate);
  const [startingText, setStartingText] = useState(signedInput(period.startingCents));
  const [carryForward, setCarryForward] = useState(true);
  const [saveError, setSaveError] = useState<unknown>(null);

  const datesValid = isLocalDate(startDate) && isLocalDate(endDate);
  const datesChanged = startDate !== period.startDate || endDate !== period.endDate;
  const offSchedule = startDate !== period.nominalStart || endDate !== period.nominalEnd;

  // Ask the server what the change would do; it also knows the limits.
  const pendingChange = useDebouncedValue(datesValid && datesChanged ? `${startDate}|${endDate}` : null, 300);
  const [previewStart = "", previewEnd = ""] = pendingChange?.split("|") ?? [];
  const preview = usePeriodDatesPreview(
    period.id,
    pendingChange ? { startDate: previewStart, endDate: previewEnd } : null,
  );
  const previewIsCurrent = pendingChange === `${startDate}|${endDate}`;
  const dateErrors = {
    ...(previewIsCurrent && preview.isError ? fieldErrorsOf(preview.error) : {}),
    ...fieldErrorsOf(saveError),
  };
  const effects = previewIsCurrent && preview.data ? describeEffects(preview.data) : [];

  const startingCents = parseMoneyInput(startingText, { allowNegative: true });
  const startingChanged = startingCents !== null && startingCents !== period.startingCents;

  const saving = changeDates.isPending || setStarting.isPending;
  const blocked =
    !datesValid || startingCents === null || Boolean(dateErrors.startDate || dateErrors.endDate) || (datesChanged && !previewIsCurrent);
  const canSave = (datesChanged || startingChanged) && !blocked;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaveError(null);
    try {
      // Dates first: moving a boundary can itself shift this period's calculated starting
      // amount, and a typed amount should have the last word.
      if (datesChanged) await changeDates.mutateAsync({ periodId: period.id, startDate, endDate });
      if (startingChanged && startingCents !== null) {
        await setStarting.mutateAsync({ periodId: period.id, startingCents, carryForward });
      }
      onClose();
    } catch (error) {
      setSaveError(error);
    }
  }

  async function revertToCalculated() {
    setSaveError(null);
    try {
      await revertStarting.mutateAsync(period.id);
      onClose();
    } catch (error) {
      setSaveError(error);
    }
  }

  const generalError =
    saveError && Object.keys(fieldErrorsOf(saveError)).length === 0
      ? saveError instanceof ApiError
        ? saveError.message
        : "That didn't work. Try again."
      : null;

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      {generalError && <Alert>{generalError}</Alert>}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-semibold text-fg">Dates</h3>
          {offSchedule && (
            <button
              type="button"
              onClick={() => {
                setStartDate(period.nominalStart);
                setEndDate(period.nominalEnd);
                setSaveError(null);
              }}
              className="rounded text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Reset to schedule
            </button>
          )}
        </div>
        <p className="text-sm text-muted">For a payday that lands early or late. The period next to it adjusts to match.</p>
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <TextField
            label="Starts"
            type="date"
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setSaveError(null);
            }}
            error={dateErrors.startDate}
          />
          <TextField
            label="Ends"
            type="date"
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              setSaveError(null);
            }}
            error={dateErrors.endDate}
          />
        </div>
        {effects.length > 0 && (
          <ul role="status" className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-fg">
            {effects.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <h3 className="font-semibold text-fg">Starting amount</h3>
        <TextField
          label="Amount this period starts with"
          inputMode="decimal"
          autoComplete="off"
          value={startingText}
          onChange={(event) => setStartingText(event.target.value)}
          error={startingCents === null ? "Enter an amount like 1250.00" : undefined}
          hint={
            period.startingMode === "manual"
              ? "Set by hand. Changes in earlier periods no longer affect it."
              : "Calculated from the period before. Typing a different amount pins it."
          }
        />
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-primary"
            checked={carryForward}
            onChange={(event) => setCarryForward(event.target.checked)}
          />
          <span>
            <span className="font-medium">Carry this change into later periods</span>
            <span className="block text-muted">
              {carryForward
                ? "Later periods move by the same difference."
                : "Later periods keep their current starting amounts and will be marked as possibly out of date."}
            </span>
          </span>
        </label>
        {period.startingMode === "manual" && (
          <Button variant="secondary" className="self-start" onClick={revertToCalculated} loading={revertStarting.isPending}>
            Use calculated amount
          </Button>
        )}
      </section>

      <DialogActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!canSave}>
          Save
        </Button>
      </DialogActions>
    </form>
  );
}
