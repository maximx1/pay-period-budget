import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdviceAnswerResponse,
  AdvicePersona,
  AdvicePersonaResponse,
  AdviceQuestionsResponse,
  AdviceTalkInput,
  AdviceTalkResponse,
  QuickAdviceResponse,
} from "../../../shared/advice.ts";
import { api } from "../../lib/api.ts";

export const adviceKeys = { all: ["advice"] as const, quick: ["advice-quick"] as const };

/**
 * The Quick Questions' answers and what extra money plans are worked out from. Fetched
 * afresh each time the page opens: any transaction or balance can change them.
 */
export function useQuickAdvice() {
  return useQuery({ queryKey: adviceKeys.quick, queryFn: () => api.get<QuickAdviceResponse>("/api/advice/quick"), staleTime: 0 });
}

/** The questions there are to ask, and the voice answers come in. */
export function useAdviceQuestions(enabled = true) {
  return useQuery({
    queryKey: adviceKeys.all,
    queryFn: () => api.get<AdviceQuestionsResponse>("/api/advice"),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Asks one question. Each ask is a fresh answer from the latest figures. */
export function useAskAdvice() {
  return useMutation({
    mutationFn: ({ questionId, amountCents }: { questionId: string; amountCents?: number }) =>
      api.post<AdviceAnswerResponse>("/api/advice", { questionId, ...(amountCents !== undefined && { amountCents }) }),
  });
}

export function useSetAdvicePersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (persona: AdvicePersona) => api.put<AdvicePersonaResponse>("/api/advice/persona", persona),
    onSuccess: ({ persona }) =>
      queryClient.setQueryData<AdviceQuestionsResponse>(adviceKeys.all, (old) => (old ? { ...old, persona } : old)),
  });
}

/** One turn of "Talk it through": the conversation so far goes up, the adviser's next message comes back. */
export function useTalkAdvice() {
  return useMutation({ mutationFn: (input: AdviceTalkInput) => api.post<AdviceTalkResponse>("/api/advice/talk", input) });
}
