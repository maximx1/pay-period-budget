import { Landmark } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { useBalances, useSnoozeTodaysAsks } from "./api.ts";
import { CheckBalanceRow } from "./CheckBalanceRow.tsx";

/**
 * On today's pay period: the few tracked balances the app is asking about today (at most
 * the day's limit, so ten set up at once come back a few at a time).
 */
export function BalanceAsksCard() {
  const balances = useBalances();
  const notToday = useSnoozeTodaysAsks();
  const toast = useToast();
  const byId = new Map((balances.data?.balances ?? []).map((balance) => [balance.billIncomeId, balance]));
  const asked = (balances.data?.asks ?? []).flatMap((id) => byId.get(id) ?? []);
  if (asked.length === 0) return null;

  return (
    <Card className="mb-4 flex flex-col">
      <div className="flex items-start gap-3">
        <Landmark className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">{asked.length === 1 ? "A balance to check" : "Balances to check"}</h2>
          <p className="text-sm text-muted">What do these accounts say now? It keeps the estimates close.</p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {asked.map((balance) => (
          <li key={balance.billIncomeId}>
            <CheckBalanceRow balance={balance} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <Link
          to="/balances"
          className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          See all balances
        </Link>
        <Button
          variant="ghost"
          loading={notToday.isPending}
          onClick={() =>
            notToday.mutate(undefined, {
              onSuccess: () => toast("Asking again tomorrow."),
              onError: () => toast("Couldn't put those off. Try again.", { variant: "error" }),
            })
          }
        >
          Not today
        </Button>
      </div>
    </Card>
  );
}
