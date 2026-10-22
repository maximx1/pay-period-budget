import { ChevronRight, LoaderCircle, MessagesSquare, RotateCcw, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ADVICE_PERSONAS, type AdvicePersona, type AdviceTalkMessage, type ExtraMoneyFacts } from "../../../shared/advice.ts";
import { formatTime, nowIn } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import { makePlan, safeToSpare } from "../../../shared/paydown.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { useAdviceEnabled } from "../auth/session.ts";
import { useBudget } from "../budget/api.ts";
import { useAdviceQuestions, useAskAdvice, useQuickAdvice } from "./api.ts";
import { ExtraMoneyCard, useExtraAmount } from "./ExtraMoneyCard.tsx";
import { type QuickAddItem, QuickAddDialog } from "./QuickAddDialog.tsx";
import { TalkDialog } from "./TalkDialog.tsx";

/** The voice answers come in, as it reads in a sentence. */
function personaLabel({ persona, custom }: AdvicePersona): string {
  if (persona === "custom") return custom ?? "your own voice";
  return ADVICE_PERSONAS.find((entry) => entry.id === persona)?.label ?? "Plain and direct";
}

/**
 * Quick Questions, answered by the app itself, then (when the server has a model) Smart
 * Questions, answered by it from the owner's own figures.
 */
export function AdvicePage() {
  const enabled = useAdviceEnabled();
  const quick = useQuickAdvice();
  const amount = useExtraAmount(quick.data?.extra);

  return (
    <>
      <PageHeader title="Advice" subtitle="Straight answers worked out from your own numbers." />

      <section className="mb-8">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-fg">
          <Zap className="size-5 text-primary" aria-hidden />
          Quick Questions
        </h2>
        <p className="mb-4 text-sm text-muted">Answered by the app itself, straight away. Nothing leaves this server.</p>
        {quick.isError ? (
          <div className="flex flex-col items-start gap-3">
            <Alert>{quick.error instanceof ApiError ? quick.error.message : "Couldn't work those out."}</Alert>
            <Button variant="secondary" onClick={() => quick.refetch()}>
              Try again
            </Button>
          </div>
        ) : !quick.data ? (
          <div className="h-64 animate-pulse rounded-2xl bg-surface-2" role="status" aria-label="Working it out" />
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
            {quick.data.answers.map((answer) => (
              <Card key={answer.id} className="min-w-0">
                <h3 className="font-semibold text-fg">{answer.label}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-fg">{answer.answer}</p>
              </Card>
            ))}
            <div className="xl:col-span-2">
              <ExtraMoneyCard extra={quick.data.extra} amount={amount} />
            </div>
          </div>
        )}
      </section>

      {enabled && <SmartQuestions extra={quick.data?.extra} amountCents={amount.cents} />}
    </>
  );
}

function SmartQuestions({ extra, amountCents }: { extra: ExtraMoneyFacts | undefined; amountCents: number | null }) {
  const questions = useAdviceQuestions();
  // A key per opening, so each conversation starts fresh.
  const [talk, setTalk] = useState<{ open: boolean; start: AdviceTalkMessage[]; key: number }>({ open: false, start: [], key: 0 });
  const startTalk = (start: AdviceTalkMessage[]) => setTalk((state) => ({ open: true, start, key: state.key + 1 }));

  return (
    <section>
      <div role="separator" className="mb-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
          <Sparkles className="size-5 text-primary" aria-hidden />
          Smart Questions
        </h2>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <Alert tone="warning">
        These send your budget's figures (amounts, dates and names) to the AI model this server is set up with. Answers can take a
        minute or two, and can be wrong: check the figures before acting on them.
      </Alert>

      {questions.isError ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <Alert>{questions.error instanceof ApiError ? questions.error.message : "Couldn't load the questions."}</Alert>
          <Button variant="secondary" onClick={() => questions.refetch()}>
            Try again
          </Button>
        </div>
      ) : !questions.data ? (
        <div className="mt-4 h-64 animate-pulse rounded-2xl bg-surface-2" role="status" aria-label="Loading questions" />
      ) : (
        <>
          <p className="my-6 text-sm text-muted">
            Answering as <span className="font-medium text-fg">{personaLabel(questions.data.persona)}</span>.{" "}
            <Link to="/settings#advice" className="font-semibold text-primary hover:underline">
              Change
            </Link>
          </p>
          <Card className="mb-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <MessagesSquare className="size-6 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-fg">Talk it through</h3>
              <p className="text-sm text-muted">
                A conversation about getting out of debt and building savings. It asks what matters to you, then suggests a balance.
              </p>
            </div>
            <Button onClick={() => startTalk([])}>Start</Button>
          </Card>
          {questions.data.groups.map((group) => {
            const aboutAmount = group.questions.some((question) => question.needsAmount);
            return (
              <section key={group.title} className="mb-8">
                <h3 className="mb-1 text-lg font-semibold text-fg">{group.title}</h3>
                {aboutAmount && (
                  <p className="mb-3 text-sm text-muted">
                    {amountCents === null
                      ? "Enter an amount under Where should my extra money go? first."
                      : `About the ${formatCents(amountCents)} entered under Where should my extra money go?`}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
                  {group.questions.map((question) => (
                    <QuestionCard
                      key={question.id}
                      id={question.id}
                      label={question.label}
                      amountCents={question.needsAmount ? amountCents : undefined}
                      extra={question.needsAmount ? extra : undefined}
                      onTalk={question.needsAmount ? startTalk : undefined}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
      <TalkDialog
        key={talk.key}
        open={talk.open}
        onClose={() => setTalk((state) => ({ ...state, open: false }))}
        start={talk.start}
        amountCents={amountCents}
        extra={extra}
      />
    </section>
  );
}

type QuestionCardProps = {
  id: string;
  label: string;
  /** For a question about extra money: the amount, or null when none is entered. Undefined otherwise. */
  amountCents?: number | null;
  extra?: ExtraMoneyFacts;
  /** Carries the answer on in "Talk it through". */
  onTalk?: (start: AdviceTalkMessage[]) => void;
};

function QuestionCard({ id, label, amountCents, extra, onTalk }: QuestionCardProps) {
  const ask = useAskAdvice();
  const timezone = useBudget().data?.timezone ?? "UTC";
  const [adding, setAdding] = useState<QuickAddItem[] | null>(null);
  const answered = ask.data;
  const blocked = amountCents === null;

  // With no plan the server could check, the balanced plan for the same amount is offered instead.
  const fallback =
    answered && extra && answered.plan === null && answered.questionId === id
      ? makePlan(
          "balanced",
          Math.min(ask.variables?.amountCents ?? 0, safeToSpare(extra.periods, extra.lowBalanceCents).zeroCents),
          extra.debts,
          extra.savings,
          extra.monthlySpendCents,
        ).lines.map(({ billIncomeId, name, amountCents: cents }) => ({ billIncomeId, name, amountCents: cents }))
      : [];

  return (
    <Card padding="none" className="flex min-w-0 flex-col">
      <button
        type="button"
        onClick={() => ask.mutate({ questionId: id, ...(amountCents ? { amountCents } : {}) })}
        disabled={ask.isPending || blocked}
        aria-expanded={Boolean(answered || ask.isError)}
        className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left font-semibold text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className="min-w-0 flex-1">{label}</span>
        {ask.isPending ? (
          <LoaderCircle className="size-5 shrink-0 animate-spin text-muted" aria-hidden />
        ) : answered ? (
          <RotateCcw className="size-5 shrink-0 text-muted" aria-label="Ask again" />
        ) : (
          <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
        )}
      </button>

      {(ask.isPending || answered || ask.isError) && (
        <div className="px-4 pb-4" aria-live="polite">
          {ask.isPending ? (
            <p className="text-sm text-muted">Working it out… this can take a minute or two.</p>
          ) : ask.isError ? (
            <Alert>{ask.error instanceof ApiError ? ask.error.message : "Couldn't get an answer. Try again."}</Alert>
          ) : answered ? (
            <>
              <p className="text-[15px] leading-relaxed whitespace-pre-line text-fg">{answered.answer}</p>
              {extra && (answered.plan?.items.length || fallback.length > 0) ? (
                <div className="mt-3 flex flex-col items-start gap-1">
                  {answered.plan?.items.length ? (
                    <>
                      <p className="text-sm text-muted">
                        Suggested: {answered.plan.items.map((item) => `${item.name} ${formatCents(item.amountCents)}`).join(", ")}.
                      </p>
                      <Button variant="secondary" onClick={() => setAdding(answered.plan!.items)}>
                        Add these payments
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => setAdding(fallback)}>
                      Add the balanced plan's payments
                    </Button>
                  )}
                </div>
              ) : null}
              {onTalk && (
                <Button
                  variant="ghost"
                  className="mt-1 -ml-3"
                  onClick={() => onTalk([{ role: "owner", text: label }, { role: "adviser", text: answered.answer }])}
                >
                  Talk about this
                </Button>
              )}
              <p className="mt-2 text-xs text-muted">
                Answered at {formatTime(nowIn(timezone, new Date(answered.askedAt)))}. Tap the question to ask again.
              </p>
            </>
          ) : null}
        </div>
      )}
      {extra && (
        <QuickAddDialog open={adding !== null} onClose={() => setAdding(null)} items={adding ?? []} categoryIds={extra.categoryIds} />
      )}
    </Card>
  );
}
