# Phase 30: Talk it through

Asked for 2026-10-21 and built the same day on `main` after
[phase 29](phase-29-paydown-advice.md); not yet deployed.

## What the owner asked for

> It is nebulous but I also want a separate advice item that is more of a vague
> interrogatory with the model that could help balance getting out of debt plus building
> savings.

This changes one rule of phase 22, "no free text, no conversation", for this one item
only. The set questions stay as they are.

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **"Talk it through" is the first of the Smart Questions** (phase 29), opening a
   conversation. The model starts by asking: it is told to find out what matters to the
   owner (how much cushion feels safe, anything big coming up, which debt bothers them
   most) one question at a time, then suggest a balance between paying down and saving.
2. **The model sees the same facts as phase 29** (balances, rates, the plans, the safe
   amount, the coming periods), worked out once when the conversation starts.
3. **A suggestion with amounts gets the same quick add** as phase 29, from the same
   checked plan line.
4. **The conversation is not kept.** It lives in the page until it is closed or left, as
   other answers do. The browser sends it back each turn; the server stores nothing.
   Keeping them, and remembering what the owner said about goals, is for later.
5. **Limits**: 20 turns, 1,000 characters a message, answers up to about 150 words, and
   its own 60 messages an hour per account apart from the set questions' 30.
6. **Any Advice answer from phase 29 can be carried on** in a conversation ("Talk about
   this"), starting from that answer.

## Tasks

### 30.1 Server

- [x] Done

- `POST /api/advice/talk { messages: [{ role, text }] }` → `{ text, plan }`. Same 403 when
  Advice is off and 502 when the model fails. Tests: the limits; the facts sent once at
  the top; another user's data never in them.

### 30.2 Client

- [x] Done

- A chat view in a `Dialog` (full screen on a phone): messages, a text field with 16px
  text, Send, a quick add under any answer with a plan. Works at 360px.

### 30.3 Docs

- [x] Done

- `phase-22-advice.md`: the rule change. `domain.md`: the endpoint.

## Implementation notes (2026-10-21)

- `POST /api/advice/talk { messages: [{ role: "owner" | "adviser", text }], amountCents? }`
  → `{ text, plan }`. At most 39 messages (with the reply, twenty each way), each 1 to 1,000
  characters, the last the owner's; none lets the adviser open. 403 without a model, 502
  when it fails, 60 messages an hour per account apart from the questions' 30.
- The system message holds `TALK_INSTRUCTIONS` (find out what matters one question at a
  time, then suggest a balance with amounts; 150 words; only the facts' figures; never
  below zero), the voice, the PLAN line rule ("when a message suggests payments"), and the
  facts: everything `adviceFacts` gives plus the extra money section, about the amount on
  the page, or the safe amount when there is none. The messages follow as user and
  assistant turns. A model's "[1]" item numbers are taken out of anything shown (also for
  the extra-money questions: the 27B used them in its prose).
- Client: "Talk it through" is a card first among the Smart Questions; "Talk about this"
  under an extra-money answer starts one from that question and answer. `TalkDialog`
  (full-size dialog): the messages, a reply box (Enter sends, Shift+Enter a new line), a
  quick add under any message with a plan, "Try again" after a failure, and an end once
  the conversation is as long as it goes.
- **Fixed while checking:** the effect that scrolls to the newest message returned what
  `scrollIntoView` returns, which newer Chromium makes a promise; React took it for a
  cleanup and the dialog crashed ("destroy is not a function"). It is in braces now.
- Tests in `routes/advice.test.ts`: the adviser opening, the facts once in the system
  message with the safe amount, the turns mapped to user and assistant; a plan with the
  numbers hidden; four refused requests; the hourly limit apart from the questions,
  another user's figures, signed out, and no model.
