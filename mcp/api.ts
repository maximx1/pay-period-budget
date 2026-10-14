// The MCP server's only way to the budget: HTTPS requests to the API, carrying an API token.
import type { ApiErrorBody } from "../src/shared/api.ts";

/** A request the API answered with an error, or never answered. Its message is fit to show. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    /** 0 when the server could not be reached at all. */
    readonly status: number,
    /** Per-field messages, when the server gave any. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type Api = ReturnType<typeof createApi>;

export function createApi(config: { baseUrl: string; token: string; fetch?: typeof fetch }) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const send = config.fetch ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await send(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: "application/json",
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : "";
      throw new ApiRequestError(`Couldn't reach the budget server at ${baseUrl}${reason ? ` (${reason})` : ""}.`, 0);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not the API's JSON: most likely a proxy's error page, or the address of something else.
      throw new ApiRequestError(
        `The server at ${baseUrl} answered ${response.status} with something that isn't the budget API.`,
        response.status,
      );
    }
    if (response.ok) return parsed as T;

    const failure = (parsed as Partial<ApiErrorBody>).error;
    if (response.status === 401) {
      throw new ApiRequestError(
        "The server refused the API token. It may have been revoked or have expired; create a new one in the app's Settings.",
        401,
      );
    }
    throw new ApiRequestError(failure?.message ?? `The server answered ${response.status}.`, response.status, failure?.fields);
  }

  return {
    baseUrl,
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
    delete: <T = void>(path: string) => request<T>("DELETE", path),
  };
}
