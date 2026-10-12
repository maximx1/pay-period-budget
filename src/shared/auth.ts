import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use letters, numbers, dots, dashes or underscores");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const registerInputSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.output<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1, "Enter your username or email").max(254),
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.output<typeof loginInputSchema>;

/**
 * How the session is handed to the client. A browser on the app's own origin uses the
 * httpOnly cookie. A client on another origin (the Android app) asks for the token itself
 * and sends it back in an Authorization header.
 */
export const SESSION_TRANSPORTS = ["cookie", "token"] as const;
export type SessionTransport = (typeof SESSION_TRANSPORTS)[number];
const transportSchema = z.enum(SESSION_TRANSPORTS).default("cookie");

/** What the sign-in endpoints accept: the credentials plus, optionally, the transport. */
export const registerRequestSchema = registerInputSchema.extend({ transport: transportSchema });
export const loginRequestSchema = loginInputSchema.extend({ transport: transportSchema });

export type PublicUser = {
  id: string;
  username: string;
  email: string;
};

export type AuthResponse = {
  user: PublicUser;
};

/** The response to a sign-in made with `transport: "token"`. */
export type TokenAuthResponse = AuthResponse & {
  /** Send as `Authorization: Bearer <token>`. Shown once; only its hash is stored. */
  token: string;
  /** ISO instant. Extended while the session is in use; see the X-Session-Expires header. */
  expiresAt: string;
};

/** What a signed-out client needs to know to draw the sign-in screen. */
export type AuthConfigResponse = {
  registrationOpen: boolean;
  /**
   * Minutes without activity after which the web app signs out and the Android app locks.
   * 0: neither happens.
   */
  idleTimeoutMinutes: number;
};

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.output<typeof changePasswordSchema>;

/** One place the account is signed in. */
export type SessionInfo = {
  id: string;
  /** "Chrome on Mac" and the like. */
  device: string;
  /** ISO instants. `lastSeenAt` is only refreshed about once an hour. */
  createdAt: string;
  lastSeenAt: string;
  /** The session making this request. */
  current: boolean;
};

export type SessionListResponse = { sessions: SessionInfo[] };

/**
 * What an API token may do. Either kind reaches budget data only: the account itself
 * (password, sessions, tokens) always needs a signed-in session.
 */
export const API_TOKEN_SCOPES = ["read", "write"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const MAX_API_TOKENS = 10;
export const MAX_API_TOKEN_DAYS = 3650;

export const apiTokenInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60, "Keep the name under 60 characters"),
  scope: z.enum(API_TOKEN_SCOPES),
  /** Left out or null: the token never expires. */
  expiresInDays: z
    .number("Enter a number of days")
    .int("Enter a whole number of days")
    .min(1, "Enter at least one day")
    .max(MAX_API_TOKEN_DAYS, "That's too far ahead")
    .nullable()
    .optional(),
});
export type ApiTokenInput = z.output<typeof apiTokenInputSchema>;

/** A key a program uses to act on the account's budget. The secret itself is never listed. */
export type ApiTokenInfo = {
  id: string;
  name: string;
  scope: ApiTokenScope;
  /** The last four characters of the secret, to tell tokens apart. */
  hint: string;
  /** ISO instants. `lastUsedAt` is only refreshed about once an hour; null if never used. */
  createdAt: string;
  lastUsedAt: string | null;
  /** Null if it never expires. An expired token stays listed until it is revoked. */
  expiresAt: string | null;
};

export type ApiTokenListResponse = { tokens: ApiTokenInfo[] };

/** The response to creating a token: the only time the secret is ever sent. */
export type ApiTokenCreatedResponse = {
  /** Send as `Authorization: Bearer <secret>`. Only its hash is stored. */
  secret: string;
  token: ApiTokenInfo;
};
