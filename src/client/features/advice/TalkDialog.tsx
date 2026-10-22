import { useEffect, useRef, useState } from "react";
import { type AdviceTalkMessage, type ExtraMoneyFacts, MAX_TALK_MESSAGE_LENGTH, MAX_TALK_MESSAGES } from "../../../shared/advice.ts";
import { formatCents } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { TextAreaField } from "../../components/ui/TextAreaField.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useTalkAdvice } from "./api.ts";
import { type QuickAddItem, QuickAddDialog } from "./QuickAddDialog.tsx";

type TalkDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Where the conversation starts: empty for the adviser to open it, or an answer to carry on from. */
  start: readonly AdviceTalkMessage[];
  amountCents: number | null;
  extra: ExtraMoneyFacts | undefined;
};

/**
 * "Talk it through": a conversation with the model about paying down debt and building
 * savings. Kept only while the dialog is open; the server stores none of it.
 */
export function TalkDialog({ open, onClose, start, amountCents, extra }: TalkDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Talk it through" size="full">
      <Talk start={start} amountCents={amountCents} extra={extra} />
    </Dialog>
  );
}

type Shown = AdviceTalkMessage & { plan?: QuickAddItem[] | null };

function Talk({ start, amountCents, extra }: Omit<TalkDialogProps, "open" | "onClose">) {
  const talk = useTalkAdvice();
  const [messages, setMessages] = useState<Shown[]>(() => [...start]);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState<QuickAddItem[] | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const owners = messages.filter((message) => message.role === "owner").length;
  const full = messages.length >= MAX_TALK_MESSAGES - 1;

  function send(conversation: Shown[]) {
    setMessages(conversation);
    talk.mutate(
      { messages: conversation.map(({ role, text }) => ({ role, text })), ...(amountCents ? { amountCents } : {}) },
      { onSuccess: ({ text, plan }) => setMessages([...conversation, { role: "adviser", text, plan: plan?.items ?? null }]) },
    );
  }

  // The adviser opens: with nothing said yet, or after an answer carried over from a question.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (start.length === 0 || start.at(-1)?.role === "owner") send([...start]);
    // Only once, when the dialog opens.
  }, []);

  // In braces: newer browsers return a promise from scrollIntoView, which React would take for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, talk.isPending]);

  const submit = () => {
    const text = draft.trim();
    if (!text || talk.isPending || full) return;
    setDraft("");
    send([...messages, { role: "owner", text }]);
  };

  return (
    <div className="flex min-h-full flex-col gap-4">
      <p className="text-sm text-muted">
        About getting out of debt and building savings, from your own figures{amountCents ? ` and the ${formatCents(amountCents)} of extra money` : ""}.
        It may ask you a few things first. Nothing here is kept once you close it.
      </p>
      <ol className="flex flex-1 flex-col gap-3" aria-live="polite">
        {messages.map((message, index) => (
          <li
            key={index}
            className={cn(
              "max-w-[90%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-line",
              message.role === "owner" ? "self-end bg-primary text-primary-fg" : "self-start bg-surface-2 text-fg",
            )}
          >
            <span className="sr-only">{message.role === "owner" ? "You: " : "Adviser: "}</span>
            {message.text}
            {message.plan && message.plan.length > 0 && extra && (
              <div className="mt-2 flex flex-col items-start gap-1 border-t border-border pt-2">
                <span className="text-sm text-muted">
                  Suggested: {message.plan.map((item) => `${item.name} ${formatCents(item.amountCents)}`).join(", ")}.
                </span>
                <Button variant="secondary" onClick={() => setAdding(message.plan ?? null)}>
                  Add these payments
                </Button>
              </div>
            )}
          </li>
        ))}
        {talk.isPending && (
          <li className="self-start rounded-2xl bg-surface-2 px-4 py-2.5 text-sm text-muted" role="status">
            Thinking it over… this can take a minute or two.
          </li>
        )}
      </ol>
      {talk.isError && <Alert>{talk.error instanceof ApiError ? talk.error.message : "Couldn't get an answer. Try again."}</Alert>}
      <div ref={end} />
      {full ? (
        <p className="text-sm text-muted">That's as long as one conversation goes. Close it and start again to carry on.</p>
      ) : (
        <form
          noValidate
          className="sticky bottom-0 flex flex-col gap-2 bg-surface pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <TextAreaField
            label={owners === 0 && messages.length === 0 ? "Your message" : "Your reply"}
            rows={2}
            maxLength={MAX_TALK_MESSAGE_LENGTH}
            value={draft}
            data-autofocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter starts a new line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {talk.isError ? (
              <Button type="button" variant="ghost" onClick={() => send(messages)}>
                Try again
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!draft.trim() || talk.isPending}>
              Send
            </Button>
          </div>
        </form>
      )}
      {extra && (
        <QuickAddDialog open={adding !== null} onClose={() => setAdding(null)} items={adding ?? []} categoryIds={extra.categoryIds} />
      )}
    </div>
  );
}
