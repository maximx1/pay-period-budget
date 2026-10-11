const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Formats integer cents as dollars: -2700 → "-$27.00". `showPlus` prefixes positive amounts with "+". */
export function formatCents(cents: number, opts: { showPlus?: boolean } = {}): string {
  const text = USD.format(cents / 100);
  return opts.showPlus && cents > 0 ? `+${text}` : text;
}

const MONEY_RE = /^(\d*)(?:\.(\d{0,2}))?$/;

/**
 * Parses what a person types into an amount field into integer cents: "27" → 2700,
 * "1,234.56" → 123456, "$5" → 500. Returns null for anything that isn't an amount with at
 * most two decimals. Negative amounts ("-40", "-$40") are accepted only with `allowNegative`.
 * Works on the digits as text so no float rounding occurs.
 */
export function parseMoneyInput(text: string, opts: { allowNegative?: boolean } = {}): number | null {
  let cleaned = text.trim();
  const negative = Boolean(opts.allowNegative) && cleaned.startsWith("-");
  if (negative) cleaned = cleaned.slice(1);
  cleaned = cleaned.trim().replace(/^\$/, "").replace(/,/g, "").trim();

  const match = MONEY_RE.exec(cleaned);
  if (!match) return null;
  const [, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;

  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Cents as plain text for an amount field, without sign or symbol: -2700 → "27.00". */
export function centsToInput(cents: number): string {
  const magnitude = Math.abs(cents);
  return `${Math.trunc(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`;
}
