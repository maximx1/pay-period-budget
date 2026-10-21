import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { type BalanceOutlook, outlookHeading, outlookLine, periodsAt } from "../../../shared/outlook.ts";
import { Alert } from "../../components/ui/Alert.tsx";

/**
 * The coming pay periods set to end below zero (urgent) and below the user's low amount,
 * one warning for each, oldest period first, each period a link to it. Nothing when all is
 * well or warnings are off.
 */
export function OutlookWarnings({ outlook }: { outlook: BalanceOutlook }) {
  return (["negative", "low"] as const).map((level) => {
    const heading = outlookHeading(outlook, level);
    if (!heading) return null;
    return (
      <Alert key={level} tone={level === "negative" ? "danger" : "warning"}>
        <p>{heading}</p>
        <ul>
          {periodsAt(outlook, level).map((period) => (
            <li key={period.periodId}>
              <Link
                to={`/periods/${period.periodId}`}
                className="flex min-h-11 items-center gap-1 font-medium tabular-nums hover:underline"
              >
                <span className="min-w-0">{outlookLine(period)}</span>
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Alert>
    );
  });
}
