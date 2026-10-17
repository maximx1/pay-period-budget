import { z } from "zod";

// The Advice page: a fixed set of questions, each answered in one go by a model the server
// is set up to ask, from figures the server works out. No free text, no conversation.

export type AdviceQuestion = {
  id: string;
  /** What the button says. */
  label: string;
  /** What the model is told to look at and come back with. Only the server sends it. */
  focus: string;
};

export const ADVICE_GROUPS: ReadonlyArray<{ title: string; questions: readonly AdviceQuestion[] }> = [
  {
    title: "This pay period",
    questions: [
      {
        id: "make-it-to-payday",
        label: "Will I make it to payday?",
        focus:
          "Say yes, tight or no: whether the projected leftover stays above zero, and whether this period ends above or below what it started with. Name the upcoming payments before payday that matter most, and anything overdue.",
      },
      {
        id: "safe-daily-spend",
        label: "How much can I safely spend each day until payday?",
        focus:
          "Headline the daily amount that still ends the period no lower than it started. Mention the amount that uses up what was carried over only as the outer limit. Say what is already allowed for.",
      },
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
        id: "spoken-for",
        label: "How much of each paycheck is already spoken for?",
        focus:
          "Give the share of usual income per pay period that bills and transfers already take, and what that leaves for everything else.",
      },
      {
        id: "tight-periods",
        label: "Which pay periods coming up will be tight?",
        focus: "Use the coming pay periods' scheduled bills against their income. Name the heavy ones and what makes them heavy.",
      },
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
export const adviceRequestSchema = z.object({ questionId: z.enum(questionIds, "Choose a question") });

export type AdviceQuestionsResponse = {
  groups: Array<{ title: string; questions: Array<{ id: string; label: string }> }>;
  persona: AdvicePersona;
};
export type AdviceAnswerResponse = { questionId: string; answer: string; askedAt: string };
export type AdvicePersonaResponse = { persona: AdvicePersona };

export const ADVICE_OFF_MESSAGE = "Advice is turned off on this server";
