import { randomUUID } from "node:crypto";
import type { LoginInput, PublicUser, RegisterInput } from "../../shared/auth.ts";
import { AppError } from "../lib/errors.ts";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../lib/password.ts";
import { generateSessionToken, hashToken } from "../lib/tokens.ts";
import { type DataStore, UniqueConstraintError, type UserRecord } from "../repos/types.ts";

const LAST_SEEN_RESOLUTION_MS = 60 * 60 * 1000;

export type IssuedSession = { user: PublicUser; token: string; expiresAt: Date };
export type AuthenticatedSession = {
  user: PublicUser;
  /** Set when the session was extended and the client should be handed the new expiry. */
  renewedUntil?: Date;
};
export type RequestMeta = { userAgent?: string };

export type AuthService = ReturnType<typeof createAuthService>;

const toPublicUser = ({ id, username, email }: UserRecord): PublicUser => ({ id, username, email });

const takenError = (field: string) =>
  new AppError(409, "conflict", `That ${field} is already in use`, {
    [field]: `That ${field} is already in use`,
  });

export function createAuthService(deps: {
  store: DataStore;
  sessionTtlMs: number;
  now?: () => Date;
}) {
  const { store, sessionTtlMs, now = () => new Date() } = deps;

  async function issueSession(user: UserRecord, meta: RequestMeta): Promise<IssuedSession> {
    const token = generateSessionToken();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + sessionTtlMs);
    await store.sessions.create({
      id: randomUUID(),
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt,
      expiresAt,
      lastSeenAt: createdAt,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
    });
    return { user: toPublicUser(user), token, expiresAt };
  }

  return {
    async register(input: RegisterInput, meta: RequestMeta = {}): Promise<IssuedSession> {
      if (await store.users.findByUsername(input.username)) throw takenError("username");
      if (await store.users.findByEmail(input.email)) throw takenError("email");

      const passwordHash = await hashPassword(input.password);
      try {
        const user = await store.users.create({
          id: randomUUID(),
          username: input.username,
          email: input.email,
          passwordHash,
          now: now(),
        });
        return await issueSession(user, meta);
      } catch (error) {
        // Lost a race with a concurrent registration; the unique index is the source of truth.
        if (error instanceof UniqueConstraintError) throw takenError(error.field);
        throw error;
      }
    },

    async login(input: LoginInput, meta: RequestMeta = {}): Promise<IssuedSession> {
      const user = input.identifier.includes("@")
        ? await store.users.findByEmail(input.identifier)
        : await store.users.findByUsername(input.identifier);

      if (!user) await verifyDummyPassword(input.password);
      if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
        throw new AppError(401, "invalid_credentials", "Incorrect username, email or password");
      }
      return issueSession(user, meta);
    },

    /** Resolves a session token to its user, sliding the expiry forward once half the TTL has passed. */
    async authenticate(token: string): Promise<AuthenticatedSession | null> {
      const session = await store.sessions.findByTokenHash(hashToken(token));
      if (!session) return null;

      const current = now();
      if (session.expiresAt <= current) {
        await store.sessions.deleteById(session.id);
        return null;
      }
      const user = await store.users.findById(session.userId);
      if (!user) return null;

      const needsRenewal = session.expiresAt.getTime() - current.getTime() < sessionTtlMs / 2;
      const lastSeenIsOld = current.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS;
      if (!needsRenewal && !lastSeenIsOld) return { user: toPublicUser(user) };

      const expiresAt = needsRenewal ? new Date(current.getTime() + sessionTtlMs) : session.expiresAt;
      await store.sessions.touch(session.id, { lastSeenAt: current, expiresAt });
      return { user: toPublicUser(user), ...(needsRenewal && { renewedUntil: expiresAt }) };
    },

    async logout(token: string): Promise<void> {
      const session = await store.sessions.findByTokenHash(hashToken(token));
      if (session) await store.sessions.deleteById(session.id);
    },

    async purgeExpiredSessions(): Promise<void> {
      await store.sessions.deleteExpired(now());
    },
  };
}
