import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import type { PeriodView } from "../../../shared/budget.ts";
import { formatDateRange, formatLongDate, isLocalDate, type LocalDate } from "../../../shared/dates.ts";
import { findPeriodForDate } from "../../../shared/periodSearch.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { usePeriodList } from "./api.ts";

type GoToDateDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The period on screen. */
  view: PeriodView;
  today: LocalDate;
};

/** Date search: pick a date and open the pay period that covers it. Only periods that exist count. */
export function GoToDateDialog({ open, onClose, view, today }: GoToDateDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Go to a date">
      <GoToDateForm onClose={onClose} view={view} today={today} />
    </Dialog>
  );
}

function GoToDateForm({ onClose, view, today }: Omit<GoToDateDialogProps, "open">) {
  const navigate = useNavigate();
  const periods = usePeriodList(true);
  const [date, setDate] = useState(today);

  const first = periods.data?.[0];
  const last = periods.data?.at(-1);
  const result = periods.data && isLocalDate(date) ? findPeriodForDate(periods.data, date) : null;
  const match = result?.found ? result.period : null;

  function go(event: FormEvent) {
    event.preventDefault();
    if (!match) return;
    // Today's period lives at "/", like the Today link.
    const path = match.startDate <= today && today <= match.endDate ? "/" : `/periods/${match.id}`;
    navigate(`${path}?date=${date}`);
    onClose();
  }

  return (
    <form onSubmit={go} noValidate className="flex flex-col gap-4">
      {periods.isError && <Alert>Couldn't load your pay periods.</Alert>}
      <TextField
        label="Date"
        type="date"
        data-autofocus
        required
        value={date}
        min={first?.startDate}
        max={last?.endDate}
        onChange={(event) => setDate(event.target.value)}
        error={result && !result.found ? result.message : undefined}
        hint={
          first && last
            ? `Your budget covers ${formatLongDate(first.startDate)} to ${formatLongDate(last.endDate)}.`
            : undefined
        }
      />
      {match && (
        <p role="status" className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-fg">
          <span className="font-semibold tabular-nums">{formatDateRange(match.startDate, match.endDate)}</span>
          <span className="text-muted">
            {match.id === view.period.id
              ? " · the period you're looking at"
              : match.endDate < today
                ? " · past period"
                : match.startDate > today
                  ? " · upcoming period"
                  : " · current period"}
          </span>
        </p>
      )}
      <DialogActions>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!match}>
          Go to period
        </Button>
      </DialogActions>
    </form>
  );
}
