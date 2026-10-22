import { z } from "zod";
import type { LocalDate } from "./dates.ts";
import type { Debt, Saving } from "./paydown.ts";

// The Advice page (phases 22 and 29). Quick Questions are answered by the app itself from
// its own figures, with no model. Smart Questions are a fixed set answered in one go by a
// model the server is set up to ask, from figures the server works out.

export type AdviceQuestion = {
  id: string;
  /** What the button says. */
  label: string;
  /** What the model is told to look at and come back with. Only the server sends it. */
  focus: string;
  /** Asked about an amount of extra money, which the request then has to give. */
  needsAmount?: true;
};

/** Answered by the app itself, at once. Their answers come with `GET /api/advice/quick`. */
export const QUICK_QUESTIONS = [
  { id: "make-it-to-payday", label: "Will I make it to payday?" },
  { id: "safe-daily-spend", label: "How much can I safely spend each day until payday?" },
  { id: "spoken-for", label: "How much of each paycheck is already spoken for?" },
  { id: "tight-periods", label: "Which pay periods coming up will be tight?" },
] as const;

export const ADVICE_GROUPS: ReadonlyArray<{ title: string; questions: readonly AdviceQuestion[] }> = [
  {
    title: "This pay period",
    questions: [
      {
        id: "spending-pace",
        label: "Am I spending faster than usual?",
        focus:
          "Compare this period's spending so far with the usual pace by the same day. Name the categories behind any difference.",
      },
    ],
  },
  {
    title: "Habits",
    questions: [
      {
        id: "categories-over",
        label: "Which categories keep going over?",
        focus:
          "Use the limits and how often each was passed. Separate a habit (over most periods) from a one-off, and say when a limit looks set too low for what is really spent.",
      },
      {
        id: "cut-first",
        label: "What should I cut first?",
        focus:
          "Rank two to four cuts by money saved per pay period and least pain: discretionary categories and names before fixed bills. Give an amount for each.",
      },
      {
        id: "payday-splurge",
        label: "Do I blow it right after payday?",
        focus: "Use the share of a period's spending that usually happens in its first three days, and what it goes on.",
      },
    ],
  },
  {
    title: "Bills and the months ahead",
    questions: [
      {
        id: "question-bills",
        label: "Which bills should I question?",
        focus:
          "Pick the bills worth cancelling, renegotiating or checking, by yearly cost, and any whose recent payments run above their usual amount.",
      },
      {
        id: "saving-steadily",
        label: "Am I saving steadily?",
        focus:
          "Use money sent to and brought back from transfers each period against income. Say whether savings stick or keep being pulled back out.",
      },
    ],
  },
  {
    title: "Extra money",
    questions: [
      {
        id: "pay-down-debt",
        label: "Which debt should I pay down?",
        needsAmount: true,
        focus:
          "Compare the Fastest and Fewest payments plans for this amount: what each clears, the interest saved, the payments ended. Recommend one for this owner and say why in a sentence.",
      },
      {
        id: "build-savings",
        label: "How should I build my savings?",
        needsAmount: true,
        focus:
          "Say how many pay periods of usual spending the savings would cover after this amount, and where to put it among the savings. Mention any debt costing far more in interest than savings earn.",
      },
      {
        id: "debt-or-savings",
        label: "How should I balance debt and savings?",
        needsAmount: true,
        focus:
          "Weigh paying debts down against building savings for this amount. Use the Balanced plan as a starting point and change it only for a reason you name.",
      },
      {
        id: "not-sure",
        label: "I'm not sure. What should I do?",
        needsAmount: true,
        focus:
          "Pick the one plan (or a mix) that suits these figures best, in plain words for someone who doesn't know the terms. Say what to do first.",
      },
    ],
  },
];

export const ADVICE_QUESTIONS: readonly AdviceQuestion[] = ADVICE_GROUPS.flatMap((group) => group.questions);

/** The voices an answer can come in. "plain" adds nothing; "custom" uses the owner's own words. */
export const ADVICE_PERSONAS = [
  { id: "plain", label: "Plain and direct", voice: null },
  { id: "british-banker", label: "British bank manager", voice: "a dry, well-spoken British bank manager, a man of few words" },
  { id: "british-assistant", label: "British personal assistant", voice: "a brisk, warm British personal assistant, a woman who keeps you on track" },
  {
    id: "oscar",
    label: "Oscar from The Office",
    voice: "Oscar Martinez from The Office: precise, faintly exasperated, quietly sure he is the only one who read the numbers",
  },
  { id: "buddy", label: "Your working-class mate", voice: "your working-class mate who is good with money: blunt, friendly, no jargon" },
  { id: "custom", label: "Your own", voice: null },
] as const;
export type AdvicePersonaId = (typeof ADVICE_PERSONAS)[number]["id"];

const personaIds = ADVICE_PERSONAS.map((persona) => persona.id) as [AdvicePersonaId, ...AdvicePersonaId[]];

export const advicePersonaSchema = z
  .object({
    persona: z.enum(personaIds, "Choose a voice"),
    /** Only for "custom": who to answer as, e.g. "a pirate who hates waste". */
    custom: z.string().trim().max(120, "Keep it under 120 characters").nullable().default(null),
  })
  .refine((value) => value.persona !== "custom" || (value.custom ?? "") !== "", {
    path: ["custom"],
    message: "Say who should answer",
  });
export type AdvicePersona = z.output<typeof advicePersonaSchema>;

export const DEFAULT_PERSONA: AdvicePersona = { persona: "plain", custom: null };

/** Who the answer should sound like, or null to leave the voice alone. */
export function voiceOf({ persona, custom }: AdvicePersona): string | null {
  if (persona === "custom") return custom?.trim() || null;
  return ADVICE_PERSONAS.find((entry) => entry.id === persona)?.voice ?? null;
}

const questionIds = ADVICE_QUESTIONS.map((question) => question.id) as [string, ...string[]];
export const adviceRequestSchema = z.object({
  questionId: z.enum(questionIds, "Choose a question"),
  /** For a question about extra money: how much. */
  amountCents: z.number("Enter an amount").int("Enter a whole number of cents").min(1, "Enter an amount").max(100_000_000, "That amount is too large").optional(),
});

export type AdviceQuestionsResponse = {
  groups: Array<{ title: string; questions: Array<{ id: string; label: string; needsAmount?: true }> }>;
  persona: AdvicePersona;
};

/** Payments a Smart answer suggests, checked against the tracked balances, for quick add. */
export type AdvicePlan = { items: Array<{ billIncomeId: string; name: string; amountCents: number }> };

export type AdviceAnswerResponse = {
  questionId: string;
  answer: string;
  askedAt: string;
  /** For a question about extra money: what the answer suggests paying, when it named amounts the server could check. */
  plan?: AdvicePlan | null;
};

/** "Talk it through" (phase 30): one message of a conversation. */
export type AdviceTalkMessage = { role: "owner" | "adviser"; text: string };

/** Twenty turns each way. */
export const MAX_TALK_MESSAGES = 40;
export const MAX_TALK_MESSAGE_LENGTH = 1000;

export const adviceTalkSchema = z
  .object({
    /** The conversation so far, oldest first. Empty: the adviser opens it. */
    messages: z
      .array(
        z.object({
          role: z.enum(["owner", "adviser"]),
          text: z
            .string()
            .trim()
            .min(1, "Say something first")
            .max(MAX_TALK_MESSAGE_LENGTH, `Keep a message under ${MAX_TALK_MESSAGE_LENGTH.toLocaleString("en-US")} characters`),
        }),
      )
      .max(MAX_TALK_MESSAGES - 1, "That's as long as one conversation goes"),
    /** The extra money the owner has in mind, if any. */
    amountCents: adviceRequestSchema.shape.amountCents,
  })
  .refine((input) => input.messages.length === 0 || input.messages.at(-1)!.role === "owner", {
    path: ["messages"],
    message: "It's the owner's turn to say something",
  });
export type AdviceTalkInput = z.input<typeof adviceTalkSchema>;
export type AdviceTalkResponse = { text: string; plan: AdvicePlan | null };

export type QuickAnswer = { id: string; label: string; answer: string };

/** What the extra money plans on the page are worked out from. */
export type ExtraMoneyFacts = {
  /** Today's period, then the coming ones that exist, each with how it is set to end. */
  periods: Array<{ startDate: LocalDate; endDate: LocalDate; projectedCents: number }>;
  lowBalanceCents: number;
  debts: Debt[];
  savings: Saving[];
  /** About a month of usual spending: the cushion the balanced plan builds toward. */
  monthlySpendCents: number;
  /** Each tracked item's category, which a quick-added payment is filed under. */
  categoryIds: Record<string, string | null>;
};

export type QuickAdviceResponse = { answers: QuickAnswer[]; extra: ExtraMoneyFacts };
export type AdvicePersonaResponse = { persona: AdvicePersona };

export const ADVICE_OFF_MESSAGE = "Advice is turned off on this server";
