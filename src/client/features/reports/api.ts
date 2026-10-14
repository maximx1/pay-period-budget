import { useQuery } from "@tanstack/react-query";
import type { LocalDate } from "../../../shared/dates.ts";
import type { Report } from "../../../shared/reports.ts";
import { api } from "../../lib/api.ts";
import { periodKeys } from "../periods/api.ts";

/** Everything the Reports page draws for a span of dates. Pass null until the span is known. */
export function useReport(span: { from: LocalDate; to: LocalDate } | null) {
  return useQuery({
    // Under the `period` prefix: anything that changes a transaction or a period refreshes it.
    queryKey: [...periodKeys.all, "report", span?.from, span?.to] as const,
    queryFn: () => api.get<Report>(`/api/reports?from=${span?.from}&to=${span?.to}`),
    enabled: span !== null,
    // Changing the span keeps the old charts on screen until the new ones arrive.
    placeholderData: (previous) => previous,
  });
}
