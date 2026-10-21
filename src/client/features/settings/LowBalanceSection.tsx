import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { type LowBalanceSettings, MAX_PERIODS_AHEAD } from "../../../shared/outlook.ts";
import { centsToInput, parseMoneyInput } from "../../../shared/money.ts";
import { Button } from "../../components/ui/Button.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useBalanceOutlook } from "../periods/api.ts";
import { useSetLowBalance } from "./api.ts";
import { SettingsSection } from "./SettingsSection.tsx";

const formSchema = z.object({
  amount: z.string().refine((text) => parseMoneyInput(text) !== null, "Enter an amount like 200.00"),
  periodsAhead: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

const periodOptions = Array.from({ length: MAX_PERIODS_AHEAD + 1 }, (_, count) => ({
  value: String(count),
  label: count === 0 ? "Off" : count === 1 ? "The next pay period" : `The next ${count} pay periods`,
}));

const toForm = (settings: LowBalanceSettings): FormValues => ({
  amount: centsToInput(settings.lowBalanceCents),
  periodsAhead: String(settings.periodsAhead),
});

/** When the home screen warns that a coming pay period is set to end low, or below zero. */
export function LowBalanceSection() {
  // The settings come back with the outlook. A server without them sends an error: no section.
  const saved = useBalanceOutlook().data?.settings;
  const save = useSetLowBalance();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { amount: "", periodsAhead: "0" },
  });

  // Keyed on the values: the outlook is refetched (on focus, after any change to a period)
  // with the same settings, and that must not wipe what is being typed.
  const savedCents = saved?.lowBalanceCents;
  const savedAhead = saved?.periodsAhead;
  useEffect(() => {
    if (savedCents !== undefined && savedAhead !== undefined) {
      reset(toForm({ lowBalanceCents: savedCents, periodsAhead: savedAhead }));
    }
  }, [savedCents, savedAhead, reset]);

  if (!saved) return null;

  const submit = handleSubmit((values) => {
    const settings = { lowBalanceCents: parseMoneyInput(values.amount) ?? 0, periodsAhead: Number(values.periodsAhead) };
    save.mutate(settings, {
      onSuccess: () => {
        reset(toForm(settings));
        toast("Warnings saved.");
      },
      onError: (error) => {
        const fields = error instanceof ApiError ? error.fields : undefined;
        if (fields?.lowBalanceCents) setError("amount", { message: fields.lowBalanceCents });
        if (fields?.periodsAhead) setError("periodsAhead", { message: fields.periodsAhead });
        if (!fields?.lowBalanceCents && !fields?.periodsAhead) {
          toast(error instanceof ApiError ? error.message : "Couldn't save that.", { variant: "error" });
        }
      },
    });
  });

  return (
    <SettingsSection
      title="Low balance warnings"
      description="The current pay period warns when one coming up is set to end below an amount, and more urgently when it is set to end below zero."
    >
      <form noValidate className="flex max-w-sm flex-col gap-4" onSubmit={submit}>
        <SelectField
          label="Look ahead at"
          options={periodOptions}
          error={errors.periodsAhead?.message}
          {...register("periodsAhead")}
        />
        <TextField
          label="Warn when a period ends below"
          inputMode="decimal"
          autoComplete="off"
          error={errors.amount?.message}
          hint="Use 0 to be warned only below zero."
          {...register("amount")}
        />
        <Button type="submit" className="self-start" disabled={!isDirty} loading={save.isPending}>
          Save
        </Button>
      </form>
    </SettingsSection>
  );
}
