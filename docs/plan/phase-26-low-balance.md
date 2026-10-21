# Phase 26: low balance warnings

Asked for on 2026-10-20: "a warning that a future period is getting close to being low
(maybe configurable default to 200) and then a more 'emergency' message that a future
period is below 0. Have this configurable how many periods to get for this and it should
be 0 to turn it off and only up to a max of 10 periods. I think default it should be 5.
Settings per account." Built the same day. The rules are in "Low balance warnings" in
`domain.md`; decision 17 in `README.md`.

## What was built

- `user_settings` gains `low_balance_cents` (default 20000) and `low_balance_periods`
  (default 5): migration `0013`. Existing accounts get the defaults, so the warnings are on.
- `src/shared/outlook.ts`: the settings schema, `balanceLevel` and the wording.
  Table-driven tests beside it.
- `GET /api/periods/outlook` (`src/server/services/outlook.ts`) and
  `PUT /api/settings/low-balance`. The settings are read back through the outlook, the way
  Advice's voice is read back through `GET /api/advice`.
- Home screen, current period only: a red-bordered warning listing the periods set to end
  below zero, then a yellow one for those below the amount, above the due-date and
  category warnings. Each period is a link to it. `Alert` gained a `danger` tone for it (shown on `/dev/ui`).
- Settings: "Low balance warnings", with "Look ahead at" (Off, the next pay period, up to
  the next 10) and "Warn when a period ends below".
- MCP: `get_balance_outlook`, read-only.

## Assumptions to confirm with the owner

1. **The measure is the period's end balance** ("Balance at end of period", the projected
   leftover), not the lowest point inside it. A period that dips below zero mid-way and
   recovers by payday does not warn.
2. **The current period is not one of the N.** Its card already shows how it ends. Five
   means the five after it.
3. **Exactly $200.00 is not low; exactly $0.00 is low, not "below zero".**
4. **Warnings show only on the current period**, not when looking at another one.
5. **One warning per level**, listing its periods, rather than one per period: ten lines
   of the same warning would bury everything else.
6. ~~Periods not created yet are worked out from the bills and income schedules.~~
   Changed the same day at the owner's word: **periods that don't exist yet are ignored.**
   A period is generated when it is navigated to, when a transaction is dated in it, or
   when today reaches it, so on a fresh budget the warnings may cover only one or two
   periods, or none, until the user has looked ahead.

## Checked

- `npm run check`: 1164 tests in 59 files, including table-driven tests
  for the rules, tests through the API (periods not generated yet are left out and nothing
  is created; at most the number asked for; another user's settings and outlook are their
  own) and one through the MCP tools. Treating zero as below zero on purpose failed two.
- In the browser on the demo account, before periods not generated yet were dropped, with a
  temporary $12,000 expense and the amount at $2,000 (both undone afterwards): the settings
  form (a bad amount, saving, the toast) and both warnings at 800px dark and 375px light.
  After the change, the same expense at 800px light: the two periods that existed (Oct 22,
  below zero; Nov 5, low) warned, and nothing further ahead appeared.

## Not checked

- 1280px and wider (the pane was 800px wide), dark mode at 375px, 360px.
- The Android app (not rebuilt). Against an older server the outlook request fails and
  the warnings and the settings section simply don't show.

## Notes for later

- The demo account has the Nov 5 – Nov 18, 2026 period from the first browser check.
