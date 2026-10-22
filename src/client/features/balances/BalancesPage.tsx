import { Landmark, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { TrackedBalance } from "../../../shared/balances.ts";
import { formatDay } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { cn } from "../../lib/cn.ts";
import { useBalances } from "./api.ts";
import { BalanceHistoryDialog } from "./BalanceHistoryDialog.tsx";
import { CheckBalanceRow, estimateLine } from "./CheckBalanceRow.tsx";
import { TrackBalanceDialog } from "./TrackBalanceDialog.tsx";

/**
 * What the bills and transfers whose balances are tracked owe or hold, the ones due for a
 * check (all of them, not only today's few), and each one's history.
 */
export function BalancesPage() {
  const balances = useBalances();
  const [tracking, setTracking] = useState<{ open: boolean; billIncomeId?: string | null }>({ open: false });
  // The id is kept after closing so the dialog doesn't empty while it fades out.
  const [history, setHistory] = useState<{ open: boolean; balance?: TrackedBalance }>({ open: false });

  // Arriving from a recurring item's detail view opens its history, or starts tracking it.
  const [searchParams, setSearchParams] = useSearchParams();
  const itemParam = searchParams.get("item");
  const trackParam = searchParams.get("track");
  useEffect(() => {
    if (trackParam) {
      setTracking({ open: true, billIncomeId: trackParam });
      setSearchParams({}, { replace: true });
    } else if (itemParam && balances.data) {
      const found = balances.data.balances.find((balance) => balance.billIncomeId === itemParam);
      if (found) setHistory({ open: true, balance: found });
      setSearchParams({}, { replace: true });
    }
  }, [itemParam, trackParam, balances.data, setSearchParams]);

  const due = (balances.data?.balances ?? []).filter((balance) => balance.due && !balance.archived);
  const open = (balance: TrackedBalance) => setHistory({ open: true, balance });

  return (
    <>
      <PageHeader
        title="Balances"
        subtitle="What your loans, cards and savings owe or hold: checked now and then, estimated in between from the payments tied to them."
        actions={
          <Button onClick={() => setTracking({ open: true, billIncomeId: null })}>
            <Plus className="size-4" aria-hidden />
            Track a balance
          </Button>
        }
      />
      {balances.isError ? (
        <Alert>Couldn't load balances. Try again.</Alert>
      ) : !balances.data ? null : balances.data.balances.length === 0 ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="No balances tracked yet"
            description="Track a loan, a card or a savings account that's one of your bills or transfers. Enter what it says now; payments you mark paid move the estimate, and every so often you'll be asked to check it again."
            action={<Button onClick={() => setTracking({ open: true, billIncomeId: null })}>Track a balance</Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="min-w-0 rounded-xl border border-border bg-surface px-4 py-3">
              <dt className="text-sm text-muted">Owed</dt>
              <dd className="text-lg font-semibold break-words text-fg tabular-nums">{formatCents(balances.data.totals.owedCents)}</dd>
            </div>
            <div className="min-w-0 rounded-xl border border-border bg-surface px-4 py-3">
              <dt className="text-sm text-muted">Held</dt>
              <dd className="text-lg font-semibold break-words text-fg tabular-nums">{formatCents(balances.data.totals.heldCents)}</dd>
            </div>
          </dl>

          {due.length > 0 && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">Due for a check ({due.length})</h2>
              <Card padding="none">
                <ul className="flex flex-col divide-y divide-border px-4 sm:px-5">
                  {due.map((balance) => (
                    <li key={balance.billIncomeId}>
                      <CheckBalanceRow balance={balance} onOpen={() => open(balance)} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-base font-semibold text-fg">All balances</h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {balances.data.balances.map((balance) => (
                <li key={balance.billIncomeId}>
                  <button
                    type="button"
                    onClick={() => open(balance)}
                    className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-xl border border-border bg-surface px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="font-medium break-words text-fg">
                      {balance.name}
                      {balance.archived && <span className="font-normal text-muted"> · ended</span>}
                    </span>
                    <span className="text-sm text-muted">{estimateLine(balance)}</span>
                    <span className={cn("text-sm", balance.due ? "font-medium text-warning" : "text-muted")}>
                      {balance.due ? "Due for a check" : `Next check around ${formatDay(balance.nextCheckOn)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <TrackBalanceDialog
        open={tracking.open}
        billIncomeId={tracking.billIncomeId}
        onClose={() => setTracking((state) => ({ ...state, open: false }))}
      />
      <BalanceHistoryDialog
        open={history.open}
        billIncomeId={history.balance?.billIncomeId ?? null}
        name={history.balance?.name ?? ""}
        onClose={() => setHistory((state) => ({ ...state, open: false }))}
      />
    </>
  );
}
