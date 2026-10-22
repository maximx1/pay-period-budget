# Phase 29: Quick Questions and Smart Questions: where extra money should go

Asked for 2026-10-21 and built the same day on `main` after
[phase 28](phase-28-balances.md); not yet deployed. No migration.

## What the owner asked for

> Then let's add this as a button for the advice section. We could have a "if I have this
> much money that isn't accounted for and here is my list of debts, can you tell me which
> makes sense of my recurring debts to pay towards and how much." I don't know what is the
> best strategy but there is snowball and avalanche so maybe there need to be 3 buttons.
> Have one for pay the debt the fastest and one for reduce the number of payments I have,
> and then one that is left more open ended [...] It should make sure to specify that we
> don't want to overdo it where one of the next payments coming up would go below 0. It
> would be cool if the agent's advice could link up to a "quick add" where you could take
> its suggestions and generate transactions. Actually maybe another button for savings.

And later the same day:

> I want native advice built in. I think you could work out something in the code that
> could handle weighing and deciding which money should go where. of the projected
> leftover based on the recurring. This could be at the top of the [advice] section called
> "Quick Questions". And then we could have a page break with an icon for "Smart
> Questions" and a disclaimer that this will talk to an ai model.

## Decided

Applied as sensible defaults; say so to overrule any of them.

### The page

1. **Advice is in the side panel always.** Quick Questions need no model. Smart Questions
   show only when the server has one (`ADVICE_ENABLED`); without one, the page has Quick
   Questions alone and nothing says a model is missing.
2. **Quick Questions at the top**: answered by the app itself, at once, the same every
   time for the same figures. Nothing leaves the server.
3. **Then a divider with a sparkle icon, "Smart Questions"**, and under it: "These send
   your budget's figures (amounts, dates, names) to the AI model this server is set up
   with. Answers can take a minute or two, and can be wrong: check the figures before acting
   on them." The voice setting moves down into this part.

### Quick Questions

4. **Four of today's model questions move here**, because their answer is a figure the
   server already works out and the model only reads back: "Will I make it to payday?",
   "How much can I safely spend each day?", "How much of each paycheck is already spoken
   for?" and "Which pay periods coming up will be tight?". Each answers in a line or two
   from a template, with the figures. (Tried against a Qwen 27B on 2026-10-21: its answers
   to these restated the facts, and took 15 seconds to over a minute with thinking on.) The
   other six stay Smart Questions: they need judgment.
5. **"Where should my extra money go?"**: an amount, and four ways to split it, each
   showing its plan at once:
   - **Balanced** (first): the app's own recommendation, by a fixed order: keep a cushion;
     put savings up to one month of usual spending if they are below it; then debts at 8%
     APR or more, highest rate first; then whatever is left half to savings, half to the
     highest-rate debt left.
   - **Fastest**: avalanche, highest interest rate first. Least interest paid overall.
   - **Fewest payments**: snowball, smallest balance first. Each debt cleared is one less
     payment a pay period.
   - **Savings**: all of it to savings, split over the tracked savings by how far each is
     below the largest.

   Each plan line says why ("Visa: 24.99%, the highest rate"; "Car loan: $410 left, so
   $410 clears it and its $289 payment ends") and, for a debt, about how much sooner it is
   paid off and how much interest that saves, from its APR and usual payment.
6. **The amount starts at what is safe to spare**: the lowest projected end of today's
   period and each coming period that exists (as many as the low balance warnings look
   at), less the low balance warning amount. Paying something now lowers every later
   period by the same amount, so that lowest point is what limits it. The field can be
   changed. **A plan never puts in more than keeps every period at or above zero**; between
   that and the warning amount it says which period would end low.
7. **Debts are the tracked balances below zero; savings those above.** A debt with no APR
   goes last in Fastest and Balanced, and says so. With nothing tracked the question says
   to start tracking balances, and links to the Balances page.
8. **Quick add under every plan**: "Add these payments" opens a review of one transaction
   per item: its name, the amount, dated today, tied to the item (so its balance estimate
   moves when marked paid), filed under its category, upcoming unless "Already paid" is
   ticked. Amounts can be changed and rows left out. It saves through the bulk import the
   add dialog already uses.

### Smart Questions

9. **Four model questions on the same amount**: "Which debt should I pay down?", "How
   should I build my savings?", "How should I balance debt and savings?" and "I'm not sure.
   What should I do?". The model gets the four Quick plans as facts, with everything Quick
   Questions know, and explains, compares or mixes them. It never does the arithmetic.
10. **Quick add after a Smart answer**: the model ends with one machine-readable line
    naming items and amounts; the server checks it (known tracked items only, whole positive
    cents, no more than the amount or the safe limit) and drops it if it fails, so the
    answer still shows without quick add. The line is never shown. Failing that, the answer
    offers the Balanced plan's quick add.
11. **Answers up to about 120 words** for these, since there are amounts to name. Same
    voices.

## Tasks

### 29.1 The page split and the four native answers

- [x] Done

- Advice in the side panel regardless of the switch; `GET /api/advice` returns the Quick
  Questions always and the Smart ones only with a model.
- `src/shared/quickAnswers.ts`: the four templates over the same facts `adviceFacts`
  works out (worked out once as data, then written as text for the model or as a Quick
  answer). Table tests.
- The divider and disclaimer; the voice setting under it.

### 29.2 Safe to spare (shared, pure)

- [x] Done

- `safeToSpare(current, outlook, lowBalanceCents)` with table tests.

### 29.3 The plans (shared, pure; needs 28)

- [x] Done

- `src/shared/paydown.ts`: `balanced`, `avalanche`, `snowball`, `savingsSplit`,
  `payoffMonths` (month by month: interest from APR, the usual payment as a monthly amount).
  Table tests, including a debt with no APR, an amount larger than all the debts, and a
  payment smaller than the interest (never paid off: say so, do not loop).

### 29.4 Quick add

- [x] Done

- The review dialog from decision 8, saving through `POST /api/transactions/import`.

### 29.5 Smart Questions on extra money

- [x] Done

- Decisions 9 to 11. Tests with the stand-in model: a bad plan line drops the plan and keeps
  the text; the sum never above the safe limit; another user's items never appear.

### 29.6 Docs

- [x] Done

- `phase-22-advice.md`, `domain.md`, `docs/deploy.md` (Advice without a model).

## Implementation notes (2026-10-21)

**Changed from the plan**

- The Smart questions about extra money are "Which debt should I pay down?", "How should I
  build my savings?", "How should I balance debt and savings?" and "I'm not sure. What
  should I do?", in a group "Extra money", about the amount entered in the Quick card.
- The four Quick answers are shown straight away, not behind a tap: they cost nothing.
- Safe to spare looks at least five coming periods, more if the warnings look further.
- A monthly payment is worked out from the item's own schedule (a week is 52/12 a month,
  a pay period by the budget's schedule), not from the report's twelve-month figure, which
  counts eleven payments for a bill that starts next month.
- The facts number items "[1] Visa" so a model never copies an id, and its PLAN line uses
  those numbers.
- "Do I blow it right after payday?" now gets the even-spread share beside the real one
  ("22%; spread evenly it would be 21%"): the model kept calling 22% a splurge.

**Server**

- `GET /api/advice/quick` (no model): `services/quickAnswers.ts` writes the four answers
  from the same inputs as `adviceFacts`; `extraFacts` in `services/advice.ts` gathers the
  periods, debts, savings and usual spending. `outlook.coming(userId, atLeast)` is the
  outlook looking at least that far.
- `POST /api/advice` takes `amountCents`, needed for the extra-money questions (field
  error otherwise). The facts gain `extraMoneyText` (`services/extraMoneyFacts.ts`): the
  safe amounts and the period that limits them, the numbered debts and savings, usual
  spending and how long the savings would last, and all four plans with each line's reason
  and payoff effect. `readPlanLine` checks and strips the PLAN line.
- Tests: `shared/paydown.test.ts` (26: safe amounts, payoff months including a payment
  under the interest, the savings split, each strategy, nothing in nothing out);
  `routes/advice.test.ts` gains the Quick endpoint with and without a model and another
  user's balances kept out, an extra-money question's facts and plan, four bad PLAN lines,
  and an amount larger than can be spared.

**Client**

- Advice is always in the side panel. Quick Questions first (four answer cards and
  "Where should my extra money go?": the amount, starting at the safe amount, with its
  limits as a hint and a warning above them; Balanced / Fastest / Fewest payments /
  Savings; each line's amount, reason and payoff effect; "Add these payments"). Then,
  with a model, a divider with a sparkle, "Smart Questions", and the disclaimer; the voice
  line; the groups. An extra-money answer offers its own plan's quick add, or the balanced
  plan's when its PLAN line didn't pass.
- Quick add (`QuickAddDialog`): one row per item with its amount, each can be left out;
  "Already paid"; saved through `POST /api/transactions/import` as payments tied to the
  items, dated now, filed under each item's category.

**Checked in the browser** on the demo account at 1024px: the four Quick answers (their
figures match the facts the model was given); the planner with the safe amount
($9,584.80) as Balanced (savings cushion, then the car loan, with "about $636 less
interest"), then $300 as Fastest; quick add of that $300 as already paid, after which the
Balances page showed the car loan at "Estimated $8,000.00 owed" from $8,300.
