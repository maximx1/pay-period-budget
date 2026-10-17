/** Error envelope returned by every failing API response. */
export type ApiErrorCode =
  | "validation"
  | "unauthenticated"
  | "invalid_credentials"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  /** Something the server relies on, such as the advice model, did not come through. */
  | "unavailable"
  | "internal";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Per-field messages keyed by input field name, when the error maps to form fields. */
    fields?: Record<string, string>;
  };
};
