import type { ModelConfig } from "../env.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ReadonlyArray<Record<string, unknown>> };

/**
 * Sends one chat completion to an OpenAI-compatible API (OpenAI itself, or one the owner
 * runs, such as Ollama or LM Studio) and returns the text of its answer. Throws an Error
 * whose message finishes the sentence "The model couldn't help: ...".
 */
export async function chatCompletion(
  config: ModelConfig,
  request: { messages: readonly ChatMessage[]; temperature: number; maxTokens?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }) },
      body: JSON.stringify({
        model: config.model,
        temperature: request.temperature,
        ...(request.maxTokens && { max_tokens: request.maxTokens }),
        ...(config.thinking === false && { chat_template_kwargs: { enable_thinking: false } }),
        messages: request.messages,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError" ? "it took too long to answer" : "it could not be reached");
  }
  if (!response.ok) throw new Error(`it answered with an error (${response.status})`);

  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  } | null;
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  // A model that thinks first can spend every token it was allowed on that, leaving no
  // answer. Some servers then send null, others an empty string or an unfinished <think>.
  if (choice?.finish_reason === "length" && (typeof content !== "string" || isOnlyThinking(content))) {
    throw new Error("it ran out of room before answering, probably thinking it over first");
  }
  if (typeof content !== "string") throw new Error("its answer was not in the expected form");
  return content;
}

/** Nothing but reasoning, closed or not, or nothing at all. */
function isOnlyThinking(content: string): boolean {
  return content.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim() === "";
}
