import { useInfiniteQuery } from "@tanstack/react-query";
import type { LocalDate } from "../../../shared/dates.ts";
import type { TransactionSearchResponse } from "../../../shared/transactions.ts";
import { api } from "../../lib/api.ts";
import { periodKeys } from "../periods/api.ts";

/** What a search looks for. Everything given must match. */
export type SearchCriteria = {
  text?: string;
  from?: LocalDate;
  to?: LocalDate;
  /** A category's id, or NO_CATEGORY for transactions filed under none. */
  categoryId?: string;
};

export const SEARCH_PAGE = 50;

function searchPath({ text, from, to, categoryId }: SearchCriteria, before: string | null) {
  const query = new URLSearchParams({ limit: String(SEARCH_PAGE) });
  if (text) query.set("q", text);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (categoryId) query.set("categoryId", categoryId);
  if (before) query.set("before", before);
  return `/api/transactions/search?${query}`;
}

/** What matches, newest first, a page at a time. Pass null until there is something to look for. */
export function useTransactionSearch(criteria: SearchCriteria | null) {
  return useInfiniteQuery({
    // Under the `period` prefix: anything that changes a transaction refreshes a search too.
    queryKey: [...periodKeys.all, "search", criteria] as const,
    queryFn: ({ pageParam }) => api.get<TransactionSearchResponse>(searchPath(criteria ?? {}, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: criteria !== null,
  });
}
