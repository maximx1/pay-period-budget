import type { LocalDate } from "../../shared/dates.ts";
import { modelAnswerSchema, parseDate, type ScannedRow } from "../../shared/scan.ts";
import type { ScanModelConfig } from "../env.ts";

const INSTRUCTIONS = `You read transactions out of a screenshot of a bank's transaction list.
Answer with JSON only, no other text, in exactly this shape:
{"transactions":[{"date":"YYYY-MM-DD","description":"...","amount":-12.34,"balance":1234.56}]}
- One entry per transaction, top to bottom as shown.
- amount: negative for money going out (purchases, payments, transfers out), positive for money coming in (pay, refunds, deposits). A bank that puts a minus on spending leaves money in unmarked.
- balance: the running balance shown beside the transaction, or null when there is none.
- date: the transaction's date. With no year shown, the latest such date that is not after today. null if it cannot be read.
- description: the transaction's name as shown, joined into one line, without dates, amounts, balances or labels such as "Add a category" or "Pending".
- Leave out anything that is not a transaction (headings, totals, the app's own buttons), and a transaction cut off at the top or bottom edge whose amount cannot be seen.`;

type Input = { layout: string; image: Uint8Array; mimeType: string; today: LocalDate };

/** The first {...} in a model's answer, which may come wrapped in a code fence or chatter. */
function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("its answer held no JSON");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("its answer was not valid JSON");
  }
}

/**
 * Asks an OpenAI-compatible model (one the owner runs, such as Ollama or LM Studio) for the
 * transactions in a screenshot. It is given the text the built-in reader found, laid out
 * by position, or with `images` the picture itself. Its answer is checked before it is
 * believed. Throws an Error saying what went wrong, for the caller to fall back on.
 */
export async function readWithModel(config: ScanModelConfig, input: Input, fetchImpl: typeof fetch = fetch): Promise<ScannedRow[]> {
  const ask = config.images
    ? [
        { type: "text", text: `Today is ${input.today}. The transactions in this screenshot:` },
        { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${Buffer.from(input.image).toString("base64")}` } },
      ]
    : `Today is ${input.today}. Text recognition found these lines in the screenshot, top to bottom, with " | " where a wide gap separates columns:\n\n${input.layout}`;

  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }) },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          { role: "system", content: INSTRUCTIONS },
          { role: "user", content: ask },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError" ? "it took too long to answer" : "it could not be reached");
  }
  if (!response.ok) throw new Error(`it answered with an error (${response.status})`);

  const body = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("its answer was not in the expected form");
  const parsed = modelAnswerSchema.safeParse(jsonIn(content));
  if (!parsed.success) throw new Error("its answer was not in the expected form");

  return parsed.data.transactions.map(({ date, description, amount, balance }) => {
    const readDate = date ? parseDate(date, input.today) : null;
    const name = description.replace(/\s+/g, " ").trim();
    return {
      date: readDate,
      name,
      amountCents: Math.round(amount * 100),
      balanceCents: balance === null || balance === undefined ? null : Math.round(balance * 100),
      // A model does not say how sure it is.
      confidence: 100,
      flags: [...(name ? [] : (["hard_to_read"] as const)), ...(readDate ? [] : (["no_date"] as const))],
    };
  });
}
