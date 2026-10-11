import { formatLongDate } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { ScheduleType } from "../../../shared/schedule.ts";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useBudget } from "../budget/api.ts";
import { useSetTimezone } from "./api.ts";
import { Detail, SettingsSection } from "./SettingsSection.tsx";

const scheduleLabels: Record<ScheduleType, string> = {
  biweekly: "Every 2 weeks",
  weekly: "Every week",
  monthly: "Monthly",
};

/** Every zone the browser knows, plus the current one in case it isn't on that list (e.g. "UTC"). */
function timezoneOptions(current: string) {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add(current);
  return [...zones].sort().map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}

export function BudgetSection() {
  const toast = useToast();
  const { data: budget } = useBudget();
  const setTimezone = useSetTimezone();
  if (!budget) return null;

  return (
    <SettingsSection title="Budget">
      <dl className="flex flex-col gap-3">
        <Detail label="Pay schedule">{scheduleLabels[budget.type]}</Detail>
        <Detail label="First period started">{formatLongDate(budget.anchorDate)}</Detail>
        <Detail label="Opening balance">{formatCents(budget.openingCents)}</Detail>
      </dl>
      <p className="mt-3 text-sm text-muted">Changing the pay schedule isn't available yet.</p>

      <div className="mt-5 max-w-sm">
        <SelectField
          label="Time zone"
          hint="Decides when one day, and one period, rolls over to the next, wherever you are."
          options={timezoneOptions(budget.timezone)}
          value={budget.timezone}
          disabled={setTimezone.isPending}
          onChange={(event) =>
            setTimezone.mutate(event.target.value, {
              onSuccess: () => toast("Time zone updated."),
              onError: (error) =>
                toast(error instanceof ApiError ? error.message : "Couldn't update the time zone.", { variant: "error" }),
            })
          }
        />
      </div>
    </SettingsSection>
  );
}
