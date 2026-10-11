import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody, ApiErrorCode } from "../../shared/api.ts";

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.fields && { fields: this.fields }) } };
  }
}
