import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdviceAnswerResponse,
  AdvicePersona,
  AdvicePersonaResponse,
  AdviceQuestionsResponse,
} from "../../../shared/advice.ts";
import { api } from "../../lib/api.ts";

export const adviceKeys = { all: ["advice"] as const };

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
    mutationFn: (questionId: string) => api.post<AdviceAnswerResponse>("/api/advice", { questionId }),
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
