import { ChevronRight, LoaderCircle, MessageSquareText, RotateCcw } from "lucide-react";
import { Link } from "react-router";
import { ADVICE_PERSONAS, type AdvicePersona } from "../../../shared/advice.ts";
import { formatTime, nowIn } from "../../../shared/dates.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { useAdviceEnabled } from "../auth/session.ts";
import { useBudget } from "../budget/api.ts";
import { useAdviceQuestions, useAskAdvice } from "./api.ts";

/** The voice answers come in, as it reads in a sentence. */
function personaLabel({ persona, custom }: AdvicePersona): string {
  if (persona === "custom") return custom ?? "your own voice";
  return ADVICE_PERSONAS.find((entry) => entry.id === persona)?.label ?? "Plain and direct";
}

/** Short answers to set questions, worked out by the server's model from the owner's own figures. */
export function AdvicePage() {
  const enabled = useAdviceEnabled();
  const questions = useAdviceQuestions(enabled);

  let content;
  if (!enabled) {
    content = (
      <Card>
        <EmptyState
          icon={MessageSquareText}
          title="Advice is turned off"
          description="This server hasn't been set up with a model to ask. See ADVICE_ENABLED in the deploy guide."
        />
      </Card>
    );
  } else if (questions.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>{questions.error instanceof ApiError ? questions.error.message : "Couldn't load the questions."}</Alert>
        <Button variant="secondary" onClick={() => questions.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (!questions.data) {
    content = <div className="h-64 animate-pulse rounded-2xl bg-surface-2" role="status" aria-label="Loading questions" />;
  } else {
    content = (
      <>
        <p className="mb-6 text-sm text-muted">
          Answering as <span className="font-medium text-fg">{personaLabel(questions.data.persona)}</span>.{" "}
          <Link to="/settings#advice" className="font-semibold text-primary hover:underline">
            Change
          </Link>
        </p>
        {questions.data.groups.map((group) => (
          <section key={group.title} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-fg">{group.title}</h2>
            <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
              {group.questions.map((question) => (
                <QuestionCard key={question.id} id={question.id} label={question.label} />
              ))}
            </div>
          </section>
        ))}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Advice" subtitle="Short, straight answers worked out from your own numbers. Tap a question." />
      {content}
    </>
  );
}

function QuestionCard({ id, label }: { id: string; label: string }) {
  const ask = useAskAdvice();
  const timezone = useBudget().data?.timezone ?? "UTC";
  const answered = ask.data;

  return (
    <Card padding="none" className="flex min-w-0 flex-col">
      <button
        type="button"
        onClick={() => ask.mutate(id)}
        disabled={ask.isPending}
        aria-expanded={Boolean(answered || ask.isError)}
        className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left font-semibold text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait"
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
            <p className="text-sm text-muted">Working it out…</p>
          ) : ask.isError ? (
            <Alert>{ask.error instanceof ApiError ? ask.error.message : "Couldn't get an answer. Try again."}</Alert>
          ) : answered ? (
            <>
              <p className="text-[15px] leading-relaxed whitespace-pre-line text-fg">{answered.answer}</p>
              <p className="mt-2 text-xs text-muted">
                Answered at {formatTime(nowIn(timezone, new Date(answered.askedAt)))}. Tap the question to ask again.
              </p>
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}
