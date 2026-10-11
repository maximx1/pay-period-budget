import { zodResolver } from "@hookform/resolvers/zod";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import { localDateSchema } from "../../../shared/budget.ts";
import { todayIn } from "../../../shared/dates.ts";
import { parseMoneyInput } from "../../../shared/money.ts";
import { SCHEDULE_TYPES, type ScheduleType } from "../../../shared/schedule.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useDocumentTitle } from "../../lib/useDocumentTitle.ts";
import { applyApiError } from "../auth/formErrors.ts";
import { useLogout } from "../auth/session.ts";
import { useSetupBudget } from "./api.ts";

const scheduleLabels: Record<ScheduleType, string> = {
  biweekly: "Every 2 weeks",
  weekly: "Every week",
  monthly: "Monthly",
};

const parseOpening = (text: string) => (text.trim() === "" ? 0 : parseMoneyInput(text, { allowNegative: true }));

const setupFormSchema = z.object({
  type: z.enum(SCHEDULE_TYPES),
  anchorDate: localDateSchema,
  opening: z.string().refine((text) => parseOpening(text) !== null, "Enter an amount like 1250.00"),
});
type SetupValues = z.infer<typeof setupFormSchema>;

export function SetupPage() {
  useDocumentTitle("Set up your budget");
  const navigate = useNavigate();
  const setup = useSetupBudget();
  const logout = useLogout();
  const [formError, setFormError] = useState<string | null>(null);

  // The budget's home time zone is wherever it is being set up.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayIn(timezone, new Date());

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SetupValues>({
    resolver: zodResolver(setupFormSchema),
    defaultValues: { type: SCHEDULE_TYPES[0], anchorDate: today, opening: "" },
  });

  const onSubmit = handleSubmit(async ({ type, anchorDate, opening }) => {
    setFormError(null);
    try {
      await setup.mutateAsync({ type, anchorDate, openingCents: parseOpening(opening) ?? 0, timezone });
      navigate("/", { replace: true });
    } catch (error) {
      setFormError(applyApiError(error, setError, ["type", "anchorDate"]));
    }
  });

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-fg">
            <Wallet className="size-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-fg">Set up your budget</h1>
          <p className="text-sm text-muted">Three questions and you're in.</p>
        </div>

        <Card padding="lg" className="shadow-sm">
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            {formError && <Alert>{formError}</Alert>}

            <fieldset>
              <legend className="text-sm font-medium text-fg">How often are you paid?</legend>
              <div className="mt-1.5 grid gap-2">
                {SCHEDULE_TYPES.map((type) => (
                  <label
                    key={type}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg transition-colors has-checked:border-primary has-checked:bg-surface-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
                  >
                    <input type="radio" value={type} className="size-4 shrink-0 accent-primary" {...register("type")} />
                    {scheduleLabels[type]}
                  </label>
                ))}
              </div>
              {errors.type && <p className="mt-1.5 text-sm text-danger">{errors.type.message}</p>}
            </fieldset>

            <TextField
              label="When did your current pay period start?"
              type="date"
              max={today}
              hint="Usually your most recent payday."
              error={errors.anchorDate?.message}
              {...register("anchorDate")}
            />

            <TextField
              label="Starting balance"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              hint="What you have to work with at the start of this period. Leave blank for zero."
              error={errors.opening?.message}
              {...register("opening")}
            />

            <Button type="submit" loading={setup.isPending} className="mt-1">
              Start budgeting
            </Button>
          </form>
        </Card>

        <div className="mt-4 flex flex-col items-center gap-1 text-center text-sm text-muted">
          <p>Time zone: {timezone}</p>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="min-h-11 rounded-lg px-3 font-medium hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            Log out
          </button>
        </div>
      </div>
    </main>
  );
}
