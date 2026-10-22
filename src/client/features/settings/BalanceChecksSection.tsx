import { useEffect, useState } from "react";
import { type BalanceSettings, CHECK_EVERY_OPTIONS, type CheckEveryDays, MAX_CHECKS_PER_DAY } from "../../../shared/balances.ts";
import { Button } from "../../components/ui/Button.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useBalances, useSetBalanceSettings } from "../balances/api.ts";
import { SettingsSection } from "./SettingsSection.tsx";

const everyOptions = CHECK_EVERY_OPTIONS.map(({ days, label }) => ({ value: String(days), label }));
const perDayOptions = Array.from({ length: MAX_CHECKS_PER_DAY }, (_, index) => ({
  value: String(index + 1),
  label: index === 0 ? "1 a day" : `${index + 1} a day`,
}));

/** How often tracked balances are asked about, and how many on one day. */
export function BalanceChecksSection() {
  const saved = useBalances().data?.settings;
  const save = useSetBalanceSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<BalanceSettings | null>(null);

  // Keyed on the values, so a refetch with the same settings doesn't undo a choice not yet saved.
  const savedEvery = saved?.checkEveryDays;
  const savedPerDay = saved?.checksPerDay;
  useEffect(() => {
    if (savedEvery !== undefined && savedPerDay !== undefined) setDraft({ checkEveryDays: savedEvery, checksPerDay: savedPerDay });
  }, [savedEvery, savedPerDay]);

  if (!saved || !draft) return null;
  const changed = draft.checkEveryDays !== saved.checkEveryDays || draft.checksPerDay !== saved.checksPerDay;

  return (
    <SettingsSection
      title="Balance checks"
      description="How often the home screen asks you to check a tracked balance, and the most it asks about in one day. Each one comes round again a few days either side of the interval, so they don't all fall due together."
    >
      <form
        noValidate
        className="flex max-w-sm flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(draft, {
            onSuccess: () => toast("Balance checks saved."),
            onError: (error) => toast(error instanceof ApiError ? error.message : "Couldn't save that.", { variant: "error" }),
          });
        }}
      >
        <SelectField
          label="Ask about each one"
          options={everyOptions}
          value={String(draft.checkEveryDays)}
          onChange={(event) => setDraft({ ...draft, checkEveryDays: Number(event.target.value) as CheckEveryDays })}
        />
        <SelectField
          label="At most"
          options={perDayOptions}
          value={String(draft.checksPerDay)}
          onChange={(event) => setDraft({ ...draft, checksPerDay: Number(event.target.value) })}
        />
        <Button type="submit" className="self-start" disabled={!changed} loading={save.isPending}>
          Save
        </Button>
      </form>
    </SettingsSection>
  );
}
