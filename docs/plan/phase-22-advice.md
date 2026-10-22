# Phase 22: Advice

Asked for 2026-10-16. An **Advice** section in the side panel: a set list of questions,
each answered in one go by an OpenAI-compatible model from the owner's own figures. Not a
chat: no free text, no follow-ups. Terse by design.

## What was built

- **Switch:** `ADVICE_ENABLED` (off by default) plus `ADVICE_MODEL_URL`, `ADVICE_MODEL`,
  `ADVICE_MODEL_KEY`, `ADVICE_MODEL_TIMEOUT_SECONDS`. Any `ADVICE_MODEL_*` left out takes
  the `SCAN_MODEL_*` one. Advice and the screenshot model are switched separately, so
  screenshots can use the built-in reader while Advice uses a model, or the reverse. The
  section showed in the side panel only when `/api/auth/config` said `adviceEnabled`;
  since phase 29 it is always there, and only its Smart Questions need the model.
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

## Tried against a real model (2026-10-21)

The owner's llama-server (llama-swap), model "qwopus 3.8 27B flash (150k)", a Qwen-family
27B that thinks before answering. All ten questions asked through the dev server on the
demo account:

- **With the original 350-token cap, nine of ten came back empty** ("it said nothing"):
  the thinking used every token, and llama-server sends thinking in `reasoning_content`,
  which Advice doesn't read. The tenth was cut off. Fixed: the cap is 8,000 tokens (the
  prompt keeps the answer itself short), the default timeout is 180 seconds, running out of
  room says so, and an unfinished `<think>` is stripped.
- **Thinking off** (`ADVICE_MODEL_THINKING=false`, which sends `chat_template_kwargs: {
  enable_thinking: false }`): 4 to 8 seconds each, but several misread the figures (cut the
  savings transfer first; groceries called a bill; 22% of spending in 3 of 14 days called a
  splurge).
- **Thinking on**: 18 to 122 seconds each. Better, not perfect: "Do I blow it after
  payday?" still read 22% in three days as a splurge.
- So in phase 29 the four questions whose answer is a figure the server already works out
  became Quick Questions, answered by the app itself.
- Behind nginx, `proxy_read_timeout` must be raised (see `docs/deploy.md`).

## Not verified

- Answers are not kept: leaving the page forgets them.

## Later

Two phases in `backlog.md` build on this: debts and paying them down, and balances over
time with "where are my biggest concerns".
