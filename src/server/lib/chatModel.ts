import type { ModelConfig } from "../env.ts";

export type ChatMessage = { role: "system" | "user"; content: string | ReadonlyArray<Record<string, unknown>> };

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
        messages: request.messages,
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
  return content;
}
