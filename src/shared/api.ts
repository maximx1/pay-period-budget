/** Error envelope returned by every failing API response. */
export type ApiErrorCode =
  | "validation"
  | "unauthenticated"
  | "invalid_credentials"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Per-field messages keyed by input field name, when the error maps to form fields. */
    fields?: Record<string, string>;
  };
};
