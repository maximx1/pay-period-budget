# Phase 22: Advice

Asked for 2026-10-16. An **Advice** section in the side panel: a set list of questions,
each answered in one go by an OpenAI-compatible model from the owner's own figures. Not a
chat: no free text, no follow-ups. Terse by design.

## What was built

- **Switch:** `ADVICE_ENABLED` (off by default) plus `ADVICE_MODEL_URL`, `ADVICE_MODEL`,
  `ADVICE_MODEL_KEY`, `ADVICE_MODEL_TIMEOUT_SECONDS`. Any `ADVICE_MODEL_*` left out takes
  the `SCAN_MODEL_*` one. Advice and the screenshot model are switched separately, so
  screenshots can use the built-in reader while Advice uses a model, or the reverse. The
  section shows in the side panel only when `/api/auth/config` says `adviceEnabled`.
- **Questions** (`src/shared/advice.ts`), ten in three groups, picked from what three
  brainstorming passes proposed: this pay period (make it to payday, safe daily spend,
  spending pace), habits (categories that keep going over, what to cut first, payday
  splurges), bills and the months ahead (share of each paycheck spoken for, tight periods
  coming up, bills to question, saving steadily).
- **Facts** (`src/server/services/adviceFacts.ts`): the server works out everything to be
  added up (projected leftover, safe daily spend, usual pace, limits, category averages,
  bills with yearly cost and recent payments, the six coming periods) from the current
  period and a report over the six periods before it. The model only reads, compares and
  explains, which keeps numbers right on small local models.
- **Prompt** (`src/server/services/advice.ts`): lead with the answer, at most 80 words,
  only the figures given, plain text, no greeting or offers. Reasoning blocks
  (`<think>`), bold and headings are stripped from what comes back.
- **Voice:** each account picks one under Settings > Advice: plain, British bank manager,
  British personal assistant, Oscar from The Office, your working-class mate, or its own
  words (120 characters). Stored on `user_settings` (migration `0011`). The voice changes
  wording only.
- **API:** `GET /api/advice` (questions and voice), `POST /api/advice { questionId }`,
  `PUT /api/advice/persona`. 403 while off, 502 `unavailable` when the model fails or
  times out, 30 questions an hour per account.
- **Not in the MCP server**, on purpose: an assistant reads the budget itself.

## Not verified

- No real model has answered yet; tests use a stand-in. Try a few questions against the
  model you mean to use and adjust the wording in `ADVICE_INSTRUCTIONS` or a question's
  `focus` if it rambles or misreads a figure.
- Answers are not kept: leaving the page forgets them.

## Later

Two phases in `backlog.md` build on this: debts and paying them down, and balances over
time with "where are my biggest concerns".
