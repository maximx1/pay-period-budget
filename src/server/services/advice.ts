import {
  ADVICE_GROUPS,
  ADVICE_OFF_MESSAGE,
  ADVICE_PERSONAS,
  ADVICE_QUESTIONS,
  type AdviceAnswerResponse,
  type AdvicePersona,
  type AdviceQuestionsResponse,
  DEFAULT_PERSONA,
  voiceOf,
} from "../../shared/advice.ts";
import type { ModelConfig } from "../env.ts";
import { chatCompletion } from "../lib/chatModel.ts";
import { AppError } from "../lib/errors.ts";
import { RateLimiter } from "../lib/rateLimit.ts";
import type { DataStore, SettingsRecord } from "../repos/types.ts";
import { adviceFacts } from "./adviceFacts.ts";
import type { BillsIncomeService } from "./billsIncome.ts";
import type { PeriodService } from "./periods.ts";
import type { ReportService } from "./reports.ts";

export type AdviceService = ReturnType<typeof createAdviceService>;

/** How many pay periods before the current one the facts look back over. */
const PERIODS_BACK = 6;
const MAX_ANSWER_TOKENS = 350;
const ASKS_PER_HOUR = 30;

export const ADVICE_INSTRUCTIONS = `You are the adviser in a pay-period budgeting app. Answer the owner's question from the facts given, in one go: they cannot reply or ask anything else.
- Lead with the answer itself in the first sentence.
- At most 80 words: two or three short sentences, or up to four lines starting with "- ".
- Use the figures in the facts as they are. Do not invent numbers, accounts, debts or interest. Add or subtract only when the question needs it.
- Be specific: name the categories, bills, payees and amounts.
- If the facts cannot answer the question, say what is missing in one sentence.
- Plain text only: no headings, bold or tables. No greeting, no sign-off, no disclaimers, no offer of more help, no questions back.`;

/** The system message: the rules, and the voice to say it in when one is chosen. */
export function systemPrompt(persona: AdvicePersona): string {
  const voice = voiceOf(persona);
  return voice
    ? `${ADVICE_INSTRUCTIONS}\n\nAnswer in the voice of ${voice}. The voice changes the wording only: the facts, the length and the rules stay the same.`
    : ADVICE_INSTRUCTIONS;
}

/** A model's answer made fit to show: its private reasoning, markdown emphasis and headings taken out. */
export function tidyAnswer(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const personaOf = (settings: SettingsRecord | null): AdvicePersona => {
  const known = ADVICE_PERSONAS.find((entry) => entry.id === settings?.advicePersona);
  return known ? { persona: known.id, custom: settings?.advicePersonaCustom ?? null } : DEFAULT_PERSONA;
};

export function createAdviceService(deps: {
  store: DataStore;
  periods: PeriodService;
  reports: ReportService;
  billsIncome: BillsIncomeService;
  /** Null when the Advice page is turned off on this server. */
  model: ModelConfig | null;
  fetch?: typeof fetch;
  now?: () => Date;
}) {
  const { store, periods, reports, billsIncome, model, now = () => new Date() } = deps;
  const limiter = new RateLimiter(ASKS_PER_HOUR, 60 * 60 * 1000, () => now().getTime());

  function requireModel(): ModelConfig {
    if (!model) throw new AppError(403, "forbidden", ADVICE_OFF_MESSAGE);
    return model;
  }

  return {
    async questions(userId: string): Promise<AdviceQuestionsResponse> {
      requireModel();
      return {
        groups: ADVICE_GROUPS.map(({ title, questions }) => ({ title, questions: questions.map(({ id, label }) => ({ id, label })) })),
        persona: personaOf(await store.settings.get(userId)),
      };
    },

    async setPersona(userId: string, persona: AdvicePersona): Promise<AdvicePersona> {
      requireModel();
      const saved = { persona: persona.persona, custom: persona.persona === "custom" ? persona.custom : null };
      if (!(await store.settings.setAdvicePersona(userId, saved, now()))) {
        throw new AppError(409, "conflict", "Set up your budget first");
      }
      return saved;
    },

    /** Works out the facts, asks the model once, and hands back what it said. */
    async ask(userId: string, questionId: string): Promise<AdviceAnswerResponse> {
      const config = requireModel();
      const question = ADVICE_QUESTIONS.find((entry) => entry.id === questionId);
      if (!question) throw new AppError(404, "not_found", "No such question");
      const retryAfter = limiter.retryAfterSeconds(userId);
      if (retryAfter > 0) {
        throw new AppError(429, "rate_limited", "That's a lot of questions for one hour. Try again later.", undefined, {
          "Retry-After": String(retryAfter),
        });
      }

      const current = await periods.getCurrent(userId);
      const budget = (await periods.getBudget(userId))!;
      const list = await periods.list(userId);
      const index = Math.max(0, list.findIndex((period) => period.id === current.period.id));
      const report = await reports.build(userId, { from: list[Math.max(0, index - PERIODS_BACK)]!.startDate, to: current.period.endDate });
      const facts = adviceFacts({
        scheduleType: budget.type,
        today: report.today,
        current,
        report,
        items: await billsIncome.list(userId),
      });
      const persona = personaOf(await store.settings.get(userId));

      limiter.hit(userId);
      let answer: string;
      try {
        answer = tidyAnswer(
          await chatCompletion(
            config,
            {
              temperature: 0.4,
              maxTokens: MAX_ANSWER_TOKENS,
              messages: [
                { role: "system", content: systemPrompt(persona) },
                { role: "user", content: `Question: ${question.label}\nWhat to look at: ${question.focus}\n\nFacts:\n${facts}` },
              ],
            },
            deps.fetch,
          ),
        );
      } catch (error) {
        throw new AppError(502, "unavailable", `The adviser couldn't answer: ${error instanceof Error ? error.message : "something went wrong"}.`);
      }
      if (!answer) throw new AppError(502, "unavailable", "The adviser couldn't answer: it said nothing.");
      return { questionId, answer, askedAt: now().toISOString() };
    },
  };
}
