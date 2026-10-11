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

export type PublicUser = {
  id: string;
  username: string;
  email: string;
};

export type AuthResponse = {
  user: PublicUser;
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
