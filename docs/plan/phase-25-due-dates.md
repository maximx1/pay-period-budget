# Phase 25: due dates on recurring items

Asked for on 2026-10-20: "a normal due date on the recurring [items], and some sort of
notification on a period that would encompass it if there is not already a transaction
scheduled to satisfy it, or if the transaction would be too late to satisfy it. This can be
yearly or monthly or weekly ... normally it'll probably be a monthly thing." Built the same
day. The rules are in "Due dates" in `domain.md`; decision 16 in `README.md`.

## What was built

- `bills_income` gains `due_date` (null = none), `due_unit` (`week` | `month` | `year`,
  default `month`) and `due_interval` (default 1): migration `0012`.
- `src/shared/dueDates.ts`: the due rule, the cycle around each due date, whether it is
  covered, and the wording of a notice. Table-driven tests beside it.
- `BillOrIncome` gains `dueDate`, `dueUnit`, `dueInterval`, `dueText` ("Due every month
  on the 20th") and `nextDueBy`. Create and patch take the first three.
- `PeriodView.dueNotices` (`src/server/services/dueNotices.ts`), one read of the tied
  transactions per period view.
- Recurring dialog: "Track a due date" for a bill or transfer. Ticking it starts from the
  item's own schedule when it repeats by weeks, months or years (otherwise today, monthly).
  The schedule's "First due date" is now "First date".
- Recurring card: the due rule under the schedule, and "Due: <day>" beside "Next:".
- Home screen: one warning per uncovered due date, above the category-limit warnings.
- MCP: `create_bill_or_income` and `update_bill_or_income` take the three fields; the
  item line shows them; `get_period` has a `DUE:` line for each notice.

## Assumptions to confirm with the owner

1. **Only bills and transfers** have a due date, not income.
2. **Any amount counts.** A $25 payment covers a $900 card. Partial payments are not
   checked against the usual amount (a card's balance varies too much to guess).
3. **The cycle is "after the due date before, through this one".** A payment on the 21st
   for a bill due on the 20th covers *next* month and warns about this one as late.
4. **Upcoming counts.** A payment entered but not marked paid is "set to pay it".
5. **Past periods warn too**, in the past tense, from the due date entered onward. Entering
   a due date in the past therefore flags old periods that had no payment.
6. **Only transactions tied to the item** count. An untied "VISA PAYMENT" from an import
   is invisible to it until tied (the import suggests the item, phase 13.4).

## Checked

- `npm run check`: 1118 tests in 56 files, including 26 new for the rules, 15 through the
  API (another user's bills never appear) and one through the MCP tools. Breaking the
  "on or before the due date" rule on purpose failed three of them.
- In the browser on the demo account (item and payment removed afterwards): the dialog at
  1280px dark and 375px light, the card, the "nothing is set" warning and the "set for
  Oct 24" late warning on the home screen; Income hides the section.

## Not checked

- Dark mode at 375px and the dialog at 360px; the Android app (not rebuilt).
- No "add a payment" button on the warning. It would open the transaction dialog tied to
  the item and dated on the due date; the dialog takes no such starting values yet.

## Notes for later

- **The phone app can be newer than the server.** It carries its own copy of the client,
  so a field the client expects may be missing. The first build of this phase called
  `.map` on a missing `dueNotices` and crashed the home screen against the older deployed
  server. The client now treats missing due-date fields as empty; keep doing that for new
  fields.
- **Installing on the phone over Wi-Fi** (Wireless debugging): `adb pair` with the address
  from "Pair device with pairing code" (that popup's port, not the one on the main screen;
  `adb mdns services` lists both), then `adb connect` to the main screen's address and
  `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`. The copy on the
  owner's phone was signed with the Mac's debug key, so an update keeps its sign-in.
