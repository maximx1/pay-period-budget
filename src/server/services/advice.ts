import {
  ADVICE_GROUPS,
  ADVICE_OFF_MESSAGE,
  ADVICE_PERSONAS,
  ADVICE_QUESTIONS,
  type AdviceAnswerResponse,
  type AdvicePersona,
  type AdviceQuestionsResponse,
  type AdviceTalkMessage,
  type AdviceTalkResponse,
  DEFAULT_PERSONA,
  type ExtraMoneyFacts,
  type QuickAdviceResponse,
  voiceOf,
} from "../../shared/advice.ts";
import type { BillOrIncome } from "../../shared/billsIncome.ts";
import { type Debt, type Saving, safeToSpare } from "../../shared/paydown.ts";
import type { ScheduleType } from "../../shared/schedule.ts";
import type { ModelConfig } from "../env.ts";
import { chatCompletion } from "../lib/chatModel.ts";
import { AppError } from "../lib/errors.ts";
import { RateLimiter } from "../lib/rateLimit.ts";
import type { DataStore, SettingsRecord } from "../repos/types.ts";
import { adviceFacts, type AdviceInputs } from "./adviceFacts.ts";
import type { BalanceService } from "./balances.ts";
import type { BillsIncomeService } from "./billsIncome.ts";
import { extraMoneyText, planLineRule, readPlanLine } from "./extraMoneyFacts.ts";
import type { OutlookService } from "./outlook.ts";
import { quickAnswers } from "./quickAnswers.ts";
import type { PeriodService } from "./periods.ts";
import type { ReportService } from "./reports.ts";

export type AdviceService = ReturnType<typeof createAdviceService>;

/** How many pay periods before the current one the facts look back over. */
const PERIODS_BACK = 6;
/** How many coming periods limit what can be spared now, at the least: more when the warnings look further. */
const PERIODS_AHEAD_AT_LEAST = 5;
const PERIODS_PER_MONTH: Record<ScheduleType, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 };
/**
 * Room for the answer and, for a model that thinks first, its thinking. The prompt keeps
 * the answer itself short; this only stops one that runs on (the timeout does too). A Qwen
 * 27B used 500 to 2,000 tokens thinking over these questions (2026-10-21).
 */
const MAX_ANSWER_TOKENS = 8000;
const ASKS_PER_HOUR = 30;
/** "Talk it through" counts apart from the set questions: a conversation is many messages. */
const TALKS_PER_HOUR = 60;

export const ADVICE_INSTRUCTIONS = `You are the adviser in a pay-period budgeting app. Answer the owner's question from the facts given, in one go: they cannot reply or ask anything else.
- Lead with the answer itself in the first sentence.
- At most 80 words: two or three short sentences, or up to four lines starting with "- ".
- Use the figures in the facts as they are. Do not invent numbers, accounts, debts or interest. Add or subtract only when the question needs it.
- Be specific: name the categories, bills, payees and amounts.
- If the facts cannot answer the question, say what is missing in one sentence.
- Plain text only: no headings, bold or tables. No greeting, no sign-off, no disclaimers, no offer of more help, no questions back.`;

export const TALK_INSTRUCTIONS = `You are the adviser in a pay-period budgeting app, talking with the owner about getting out of debt and building savings. The facts below are their own figures.
- First find out what matters to them: ask one short question at a time (how much of a cushion feels safe, anything big coming up, which debt bothers them most). After two or three answers, suggest a balance between paying down debt and saving, with amounts.
- At most 150 words a message. Plain text: no headings, bold or tables.
- Use the figures in the facts as they are. Do not invent numbers, accounts, debts or interest.
- Never suggest paying so much now that a coming pay period would end below zero: the facts say how much can be spared.
- No more than a few words of greeting, no sign-off, no disclaimers.`;

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
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** An item's usual amount as about a month's worth by its schedule; null with no schedule or amount. */
function monthlyAmount(item: BillOrIncome, periodsPerMonth: number): number | null {
  const { defaultAmountCents: cents, recurrenceUnit: unit, recurrenceInterval: every } = item;
  if (cents <= 0) return null;
  const perMonth = { week: 52 / 12 / every, month: 1 / every, year: 1 / 12 / every, period: periodsPerMonth, none: 0 }[unit];
  return perMonth > 0 ? Math.round(cents * perMonth) : null;
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
  outlook: OutlookService;
  balances: BalanceService;
  /** Null when the server has no model: then only the Quick Questions are answered. */
  model: ModelConfig | null;
  fetch?: typeof fetch;
  now?: () => Date;
}) {
  const { store, periods, reports, billsIncome, outlook, balances, model, now = () => new Date() } = deps;
  const limiter = new RateLimiter(ASKS_PER_HOUR, 60 * 60 * 1000, () => now().getTime());
  const talkLimiter = new RateLimiter(TALKS_PER_HOUR, 60 * 60 * 1000, () => now().getTime());

  function requireModel(): ModelConfig {
    if (!model) throw new AppError(403, "forbidden", ADVICE_OFF_MESSAGE);
    return model;
  }

  /** Everything both kinds of question are worked out from: the current period and a report over the ones before it. */
  async function gather(userId: string): Promise<AdviceInputs> {
    const current = await periods.getCurrent(userId);
    const budget = (await periods.getBudget(userId))!;
    const list = await periods.list(userId);
    const index = Math.max(0, list.findIndex((period) => period.id === current.period.id));
    const report = await reports.build(userId, { from: list[Math.max(0, index - PERIODS_BACK)]!.startDate, to: current.period.endDate });
    return { scheduleType: budget.type, today: report.today, current, report, items: await billsIncome.list(userId) };
  }

  /** What extra money can go toward, and how much of it can be spared. */
  async function extraFacts(userId: string, inputs: AdviceInputs): Promise<ExtraMoneyFacts> {
    const { settings, periods: coming } = await outlook.coming(userId, PERIODS_AHEAD_AT_LEAST);
    const { period, totals } = inputs.current;
    const perMonth = PERIODS_PER_MONTH[inputs.scheduleType];
    const monthly = new Map(inputs.items.map((item) => [item.id, monthlyAmount(item, perMonth)]));
    const debts: Debt[] = [];
    const savings: Saving[] = [];
    for (const balance of (await balances.list(userId)).balances) {
      if (balance.archived) continue;
      const payment = monthly.get(balance.billIncomeId) ?? null;
      // A balance in parts is a debt (or saving) per part, each with its share of the one
      // payment by its share of the balance, as payments are shared out between checks.
      const entries =
        balance.parts.length === 0
          ? [{ name: balance.name, cents: balance.estimateCents, aprBps: balance.lastCheck.aprBps, payment }]
          : balance.parts.map((part) => ({
              partId: part.id,
              name: `${balance.name}: ${part.name}`,
              cents: part.estimateCents,
              aprBps: part.aprBps,
              payment:
                payment === null || balance.estimateCents === 0
                  ? payment
                  : Math.round((payment * part.estimateCents) / balance.estimateCents),
            }));
      for (const { cents, payment: share, ...entry } of entries) {
        const base = { billIncomeId: balance.billIncomeId, ...entry };
        if (cents < 0) debts.push({ ...base, owedCents: -cents, monthlyPaymentCents: share });
        else savings.push({ ...base, heldCents: cents });
      }
    }
    const past = inputs.report.periods.filter((entry) => !entry.isCurrent && !entry.isFuture);
    const spend = past.map((entry) => entry.expenseCents).sort((a, b) => a - b);
    const usualSpend = spend.length === 0 ? 0 : spend[Math.floor(spend.length / 2)]!;
    return {
      periods: [
        { startDate: period.startDate, endDate: period.endDate, projectedCents: totals.projectedCents },
        ...coming.map(({ startDate, endDate, projectedCents }) => ({ startDate, endDate, projectedCents })),
      ],
      lowBalanceCents: settings.lowBalanceCents,
      debts,
      savings,
      monthlySpendCents: Math.round(usualSpend * PERIODS_PER_MONTH[inputs.scheduleType]),
      categoryIds: Object.fromEntries(inputs.items.map((item) => [item.id, item.categoryId])),
    };
  }

  return {
    /** The Quick Questions' answers and what the extra money plans are worked out from. No model needed. */
    async quick(userId: string): Promise<QuickAdviceResponse> {
      const inputs = await gather(userId);
      const extra = await extraFacts(userId, inputs);
      const { settings, periods: coming } = await outlook.get(userId);
      return { answers: quickAnswers({ ...inputs, coming, lowBalanceCents: settings.lowBalanceCents }), extra };
    },

    async questions(userId: string): Promise<AdviceQuestionsResponse> {
      requireModel();
      return {
        groups: ADVICE_GROUPS.map(({ title, questions }) => ({
          title,
          questions: questions.map(({ id, label, needsAmount }) => ({ id, label, ...(needsAmount && { needsAmount }) })),
        })),
        persona: personaOf(await store.settings.get(userId)),
      };
    },

    /**
     * One turn of "Talk it through": the conversation so far (none: the adviser opens it) and
     * the adviser's next message. The facts go once, in the system message; nothing is kept.
     */
    async talk(userId: string, messages: readonly AdviceTalkMessage[], amountCents?: number): Promise<AdviceTalkResponse> {
      const config = requireModel();
      const retryAfter = talkLimiter.retryAfterSeconds(userId);
      if (retryAfter > 0) {
        throw new AppError(429, "rate_limited", "That's a lot of talking for one hour. Try again later.", undefined, {
          "Retry-After": String(retryAfter),
        });
      }
      const inputs = await gather(userId);
      const extra = await extraFacts(userId, inputs);
      // With no amount in mind, the conversation is about what can be spared safely.
      const amount = amountCents ?? safeToSpare(extra.periods, extra.lowBalanceCents).safeCents;
      const voice = voiceOf(personaOf(await store.settings.get(userId)));
      const system = [
        TALK_INSTRUCTIONS,
        voice ? `Talk in the voice of ${voice}. The voice changes the wording only: the facts, the length and the rules stay the same.` : null,
        amount > 0 ? planLineRule(amount, extra, "when-suggesting") : null,
        `Facts:\n${adviceFacts(inputs)}${amount > 0 ? `\n\n${extraMoneyText(amount, extra)}` : ""}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const chat = messages.length
        ? messages.map(({ role, text }) => ({ role: role === "owner" ? ("user" as const) : ("assistant" as const), content: text }))
        : [{ role: "user" as const, content: "Help me balance paying down debt and building savings. Ask me what you need to know." }];

      talkLimiter.hit(userId);
      let reply: string;
      try {
        reply = tidyAnswer(
          await chatCompletion(config, { temperature: 0.5, maxTokens: MAX_ANSWER_TOKENS, messages: [{ role: "system", content: system }, ...chat] }, deps.fetch),
        );
      } catch (error) {
        throw new AppError(502, "unavailable", `The adviser couldn't answer: ${error instanceof Error ? error.message : "something went wrong"}.`);
      }
      const { text, plan } = readPlanLine(reply, amount, extra);
      if (!text) throw new AppError(502, "unavailable", "The adviser couldn't answer: it said nothing.");
      return { text, plan: amount > 0 ? plan : null };
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
    async ask(userId: string, questionId: string, amountCents?: number): Promise<AdviceAnswerResponse> {
      const config = requireModel();
      const question = ADVICE_QUESTIONS.find((entry) => entry.id === questionId);
      if (!question) throw new AppError(404, "not_found", "No such question");
      if (question.needsAmount && amountCents === undefined) {
        throw new AppError(400, "validation", "Some fields need attention", { amountCents: "Enter an amount" });
      }
      const retryAfter = limiter.retryAfterSeconds(userId);
      if (retryAfter > 0) {
        throw new AppError(429, "rate_limited", "That's a lot of questions for one hour. Try again later.", undefined, {
          "Retry-After": String(retryAfter),
        });
      }

      const inputs = await gather(userId);
      let facts = adviceFacts(inputs);
      let extra: ExtraMoneyFacts | null = null;
      if (question.needsAmount && amountCents !== undefined) {
        extra = await extraFacts(userId, inputs);
        facts += `\n\n${extraMoneyText(amountCents, extra)}`;
      }
      const persona = personaOf(await store.settings.get(userId));
      const extraRules = extra && amountCents !== undefined ? `\nFor this question you may use up to 120 words. ${planLineRule(amountCents, extra)}` : "";

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
                { role: "user", content: `Question: ${question.label}\nWhat to look at: ${question.focus}${extraRules}\n\nFacts:\n${facts}` },
              ],
            },
            deps.fetch,
          ),
        );
      } catch (error) {
        throw new AppError(502, "unavailable", `The adviser couldn't answer: ${error instanceof Error ? error.message : "something went wrong"}.`);
      }
      if (!extra || amountCents === undefined) {
        if (!answer) throw new AppError(502, "unavailable", "The adviser couldn't answer: it said nothing.");
        return { questionId, answer, askedAt: now().toISOString() };
      }
      const { text, plan } = readPlanLine(answer, amountCents, extra);
      if (!text) throw new AppError(502, "unavailable", "The adviser couldn't answer: it said nothing.");
      return { questionId, answer: text, askedAt: now().toISOString(), plan };
    },
  };
}
