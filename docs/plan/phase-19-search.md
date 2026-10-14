# Phase 19: Search across every transaction

**Goal:** a magnifying glass on the home screen opens a search over every transaction in
every pay period, by words, by category and within dates. A transaction can ask for
"others like this".

**Depends on:** phase 18 (categories).

**Status:** asked for by the owner on 2026-10-13 and built the same night, unattended, on
his instruction to "make assumptions; we can back stuff out tomorrow". Every assumption is
under "Decided". Checked in a browser on the demo account. **Not yet deployed**, the MCP
side has not been used by a real assistant, and nothing has run on Android.

## What the owner asked for

> I would like a search glass on the home screen that can search for all transactions by
> string ignore case. It should pop a full screen tray styl dialog when you hit the search
> icon and then you can hit search. It should have the option to limit the search time
> period. There should be a button or something to click on an transaction too and have it
> prefill the search bar for all like transactions and trigger a search.
>
> Should be able to search via a category too.

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **The search looks in the name and the note.** Any part of either, whatever its
   capitals. What is typed is taken literally: `%` and `_` are not wildcards.
2. **Nothing is searched until Search is pressed** (or Enter), as asked. Arriving from
   "Find others like this" runs it at once.
3. **"Like transactions" means the same name.** "Find others like this" searches for the
   transaction's whole name, in every category and with no dates. It finds a longer name
   that contains it too ("Kroger" finds "KROGER #512").
4. **Where the buttons are.** The magnifying glass is in the top bar on a phone and beside
   the period settings button from 1024px up; the period header has no room for a fifth
   button at 360px. "Find others like this" is in the transaction's edit dialog, and each
   search result has a small magnifying glass that does the same for that result.
5. **Dates are optional and either end may be left open.** A tick box, "Only between
   certain dates", shows From and To. There is no limit on how far apart they are.
6. **Category is a list**: Any category, No category, then each category. With no words
   typed, a category or dates alone are a search.
7. **Results are newest first, 50 at a time**, with "Show more". Above them: how many were
   found and what they add up to, out and in.
8. **A result opens its pay period**, at that day, and closes the search. That is what the
   bill-or-income lists already do.
9. **Searching changes nothing**: no pay period is created for dates that have none.
10. **Capitals are ignored for A to Z only.** SQLite's own lower-casing does not know
    accented letters, so "CAFÉ" does not find "café". Left alone until it matters.

## What was built

- `GET /api/transactions/search?q=&from=&to=&categoryId=&limit=&before=` →
  `{ transactions, nextCursor, totals: { count, outCents, inCents } }`. `categoryId=none`
  is "filed under nothing". At least one of `q`, `from`, `to`, `categoryId` is required.
  The cursor is the same shape as the bill-or-income list's.
- `Dialog` has `size="full"`: a tray filling a phone's screen and most of a wider one.
- `TopBarAction` (in `features/shell/TopBar.tsx`) puts a page's own icon button at the
  end of the small-screen top bar.
- `features/search/`: `SearchDialog.tsx` and `api.ts`. The dialog is also opened from the
  Reports page ("Find them", for what is uncategorised).
- MCP: `search_transactions`.
- `routes/transactions.search.test.ts`, 8 tests, including one that another user's
  transactions are never found; one more in `mcp/tools.test.ts`.
- Checked by breaking five rules once each (the user filter, the literal `%` and `_`, the
  note being searched, the last day being included, "none" meaning no category): each
  fails a test.

**Checked in the browser** on the demo account, 375px dark and 1280px light: the glass in
the top bar opened the tray at full height; "kroger" and Enter found 41 transactions with
their total; a category with a month of dates found 9, all inside the month; a result led
to its pay period and closed the tray; "Find others like this" in a transaction's dialog
opened the search already filled in and run.

**Fixed on the way:** at first the header's glass also showed on a phone, beside the one in
the top bar (`hidden` lost to the button's own `inline-flex`); a wrapper hides it now.

**Not checked:** "Show more" by hand (the paging is tested through the API); the glass on
each result; anything on Android.
