# Phase 21: Importing transactions from a screenshot

**Goal:** pick one or more screenshots of a bank's transaction list, have the server read
them, and review what it found in a dialog before importing: tick what to bring in, see
which ones may already be there, fix what was misread, and tie each to a bill or income.

**Depends on:** phase 11 (bulk import with a dry run), 13.4 (the import suggests the bill
or income a row belongs to).

**Status:** asked for by the owner on 2026-10-15 and built the same day.

## What the owner asked for

> Upload a screenshot and parse some transactions from it. Then from this I can have a
> dialog where I can bulk import them. Each "found" import would be selectable to say if
> I really need to bring it in, it would detect if I had one potentially already matching
> it from the same day, I could edit it to add one of the recurring values or fix random
> issues (would be nice if it guessed if it were a recurring thing too).

And on how: no cloud model. Text recognition built in with tesseract.js on the server
("option 1"). Optionally an OpenAI-compatible model the owner runs himself, configured on
the server, with its own switch so it can be turned off without losing the settings. It
must work for any bank's layout, not only his ("in case my cousin uses it"). An animated
"processing" screen, reached from the add-transaction dialog.

## Decided

1. **The server reads the image.** tesseract.js (WebAssembly, nothing to compile) runs in
   the API process. Its English data comes from `@tesseract.js-data/eng` in
   `node_modules`, so nothing is fetched from the internet at run time. One worker is
   started on the first screenshot and kept; screenshots queue behind it. Both packages
   are runtime `dependencies`, approved by the owner on 2026-10-15.
2. **Layout is worked out from where the words sit, not from any one bank's format.**
   `rowsFromWords` in `shared/scan.ts` is pure and takes the words with their boxes:
   - A line is split into cells where the gap between words is wide: a date column, the
     description, the amount and a running balance are separate cells even when tesseract
     reads them as one line.
   - Transactions are told apart by the gap between lines: the space between two
     transactions is much wider than between two lines of one.
   - In each transaction: an amount is a cell like `-$1,234.56`, `$12.00`, `(4.50)` or
     `12.00 CR`. Two amounts side by side are the amount and the balance to its right; two
     stacked are the amount over the balance.
   - The date may be one cell (`Oct 10, 2026`, `10/10/2026`, `2026-10-10`, `Today`) or
     stacked in a column (`OCT` / `10` / `2026`). Without a year it is the latest such
     date that is not in the future. A block that is only a date is a heading for the
     transactions under it.
   - Everything else is the description, less known clutter ("Add a category",
     "Pending", "Posted", trailing "…").
   - **The sign.** A minus or brackets mean money out, a plus money in. An amount with
     neither is money in when the same screenshot shows minus signs elsewhere (that
     bank marks spending), and money out when none does (a card statement).
3. **What is shown as needing a look, and starts unticked:** a row whose words were hard
   to read (tesseract's confidence below 60), one with no date that could be read, and
   one the dry run thinks may already be in the budget. The owner ticks them if wanted.
4. **Several screenshots at once.** The same transaction in two overlapping screenshots
   is kept once: same date, amount and balance, or same date, amount and name when there
   is no balance. Within one screenshot two identical rows are both kept.
5. **Importing again skips what was imported before** when the screenshot shows a running
   balance: the row's import key is made from its date, amount and balance. Without a
   balance there is no key, and the dry run's possible-duplicate check is what warns.
6. **Duplicates and bill guesses come from the existing import dry run**, unchanged:
   same amount within three days of an existing transaction, and the bill or income a row
   probably belongs to (including "this pays the upcoming entry", which fills
   `countsToward`). A guess fills the row's Bill or income; the owner can change it.
7. **The model option.** Off unless `SCAN_MODEL_URL` and `SCAN_MODEL` are set;
   `SCAN_MODEL_ENABLED=false` turns it off while keeping them. It is sent the words tesseract read,
   with their positions, and today's date, and asked for the transactions as JSON
   (`SCAN_MODEL_IMAGES=true` sends the picture instead, for a vision model). Its answer
   is checked like any input. If it fails or times out, the built-in reader's rows are
   used and the review says so. Plain `fetch`; no SDK. `SCAN_MODEL_KEY` if the server
   wants one.
8. **The screenshot is not kept.** It is read in memory and dropped. Up to 10 MB each.
9. **Where it starts:** the add-transaction dialog has two tabs, "Type it in" and "From
   screenshots". Choosing pictures there opens a full-screen dialog that shows each one
   being read (an animated scan over the picture), then the review.
10. **Pasting and dropping** (asked for the same day): while the "From screenshots" tab
   shows, a screenshot pasted with ⌘V or Ctrl+V, or dropped onto the tab, is read as if
   chosen. Only PNG, JPEG and WebP pictures count; text pasted into a field is left alone.
   The hint about it shows only with a mouse and keyboard, not on a phone or in the app.

## What was built

- `shared/scan.ts`: `rowsFromWords` (the layout reader), `parseMoney`, `parseDate`,
  `mergeScans`, `scanImportKey`, `describeLayout` (the text a model is given), and the
  shape a model must answer in. `scan.test.ts` has screenshots described as words laid out
  like a phone app, a bank's website and a card statement, with made-up names and amounts.
- `server/lib/ocr.ts`: the tesseract.js worker, started on first use and replaced after a
  picture it could not read. Its `errorHandler` matters: without one, tesseract.js also
  throws a failed read where nothing catches it, which stops the server.
  `ocr.test.ts` runs the real thing on `fixtures/made-up-bank-list.jpg`, a list drawn in
  the browser with invented rows.
- `server/lib/scanModel.ts`: the OpenAI-compatible call, by plain `fetch`.
- `server/services/scan.ts` and `POST /api/transactions/scan` (multipart, field `image`):
  checks the picture's first bytes are a PNG, JPEG or WebP, reads it, and answers
  `{ rows, reader, notice }`. Saves nothing. Its own body limit of 10 MB.
  `routes/transactions.scan.test.ts`, 10 tests, with a stand-in reader and a stand-in model.
- Config: `SCAN_MODEL_URL`, `SCAN_MODEL`, `SCAN_MODEL_KEY`, `SCAN_MODEL_ENABLED`,
  `SCAN_MODEL_IMAGES`, `SCAN_MODEL_TIMEOUT_SECONDS`, passed through `compose.yaml` (blank
  counts as unset, as Compose passes it), which also maps `host.docker.internal` to the
  host for a model running there. Documented in `README.md`, `docs/deploy.md` and both
  `.env` examples.
- Client: `api.upload` in `lib/api.ts` for form data. `features/scan/`: `ScreenshotPicker`
  (the add dialog's second tab), `ScanImportDialog` (reading, then review) and `review.ts`
  (drafts, the dry run's findings, the import request) with its tests. `TransactionDialog`
  takes `onScan`; `HomePage` holds the scan dialog. `useImportTransactions` in
  `transactions/api.ts`.

**Checked** on the owner's four screenshots (kept out of the repository: they show his
balances, a card number and his town): the built-in reader found the eleven transactions
in them correctly, plus the row cut off at the top of one, which it read with the balance
as the amount and flagged, so it starts unticked. A day misread as "°" on the website
screenshot left that row with no date, and `mergeScans` matched it to the same row from
the phone screenshot by amount and balance. About half a second a screenshot.

In the browser at 1280px, a pasted picture and a dropped one (with a text file beside it,
which was ignored) were each read and reviewed. At 375px: the tab, the processing screen (slowed down
to see it), the review, and an import of two rows, which arrived paid and under their
keys. Reading the same picture again marked them "Already imported" and unticked; the row
matching the demo's own $150 Savings transfer two days earlier was marked as a possible
duplicate with Savings suggested. The two imported rows were deleted afterwards.

**Not checked:** the picker on Android (Capacitor passes a file input to the system's
picker, which should offer the gallery, but it has not been tried); a real model; the
Docker image with the two new packages (no Docker on the development machine); a dark-mode
bank app's screenshot (tesseract inverts light-on-dark text itself, untried); a list so
tight that two transactions sit closer than a line apart, which would be read as one.
