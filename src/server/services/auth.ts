import { randomUUID } from "node:crypto";
import {
  type ApiTokenCreatedResponse,
  type ApiTokenInfo,
  type ApiTokenInput,
  type ApiTokenScope,
  type ChangePasswordInput,
  type LoginInput,
  MAX_API_TOKENS,
  type PublicUser,
  type RegisterInput,
  type SessionInfo,
} from "../../shared/auth.ts";
import { AppError } from "../lib/errors.ts";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../lib/password.ts";
import { generateApiToken, generateSessionToken, hashToken } from "../lib/tokens.ts";
import { describeUserAgent } from "../lib/userAgent.ts";
import {
  type ApiTokenRecord,
  type DataStore,
  type SessionRecord,
  UniqueConstraintError,
  type UserRecord,
} from "../repos/types.ts";

const LAST_SEEN_RESOLUTION_MS = 60 * 60 * 1000;
/** A session with an idle timeout has its last request recorded to the minute rather than the hour. */
const IDLE_SEEN_RESOLUTION_MS = 60 * 1000;
/**
 * The server ends an idle session this much later than the timeout says. The browser signs
 * itself out on time; this is the backstop for a closed tab or a stolen cookie, and it must
 * never beat the browser to it. The slack covers the minute's resolution above plus the gap
 * between the browser's keepalive requests while it is in use (see IDLE_KEEPALIVE_MS).
 */
const IDLE_GRACE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type IssuedSession = { user: PublicUser; token: string; expiresAt: Date };
export type AuthenticatedSession = {
  user: PublicUser;
  sessionId: string;
  /** Set when the session was extended and the client should be handed the new expiry. */
  renewedUntil?: Date;
};
export type AuthenticatedApiToken = { user: PublicUser; tokenId: string; scope: ApiTokenScope };
export type RequestMeta = {
  userAgent?: string;
  /** The session is a browser's: end it after the idle timeout. */
  endsWhenIdle?: boolean;
};

export type AuthService = ReturnType<typeof createAuthService>;

const toPublicUser = ({ id, username, email }: UserRecord): PublicUser => ({ id, username, email });

const toApiTokenInfo = (token: ApiTokenRecord): ApiTokenInfo => ({
  id: token.id,
  name: token.name,
  scope: token.scope,
  hint: token.hint,
  createdAt: token.createdAt.toISOString(),
  lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
  expiresAt: token.expiresAt?.toISOString() ?? null,
});

const takenError = (field: string) =>
  new AppError(409, "conflict", `That ${field} is already in use`, {
    [field]: `That ${field} is already in use`,
  });

export function createAuthService(deps: {
  store: DataStore;
  sessionTtlMs: number;
  /** 0: no session ends for being idle. */
  idleTimeoutMs?: number;
  now?: () => Date;
}) {
  const { store, sessionTtlMs, idleTimeoutMs = 0, now = () => new Date() } = deps;

  /** Whether the session has gone unused for longer than its idle timeout allows. */
  const idledOut = (session: SessionRecord, current: Date) =>
    session.idleTimeoutMs !== null &&
    current.getTime() - session.lastSeenAt.getTime() > session.idleTimeoutMs + IDLE_GRACE_MS;

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
      idleTimeoutMs: meta.endsWhenIdle && idleTimeoutMs > 0 ? idleTimeoutMs : null,
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
      if (session.expiresAt <= current || idledOut(session, current)) {
        await store.sessions.deleteById(session.id);
        return null;
      }
      const user = await store.users.findById(session.userId);
      if (!user) return null;

      const needsRenewal = session.expiresAt.getTime() - current.getTime() < sessionTtlMs / 2;
      const seenResolution = session.idleTimeoutMs === null ? LAST_SEEN_RESOLUTION_MS : IDLE_SEEN_RESOLUTION_MS;
      const lastSeenIsOld = current.getTime() - session.lastSeenAt.getTime() > seenResolution;
      if (!needsRenewal && !lastSeenIsOld) return { user: toPublicUser(user), sessionId: session.id };

      const expiresAt = needsRenewal ? new Date(current.getTime() + sessionTtlMs) : session.expiresAt;
      await store.sessions.touch(session.id, { lastSeenAt: current, expiresAt });
      return { user: toPublicUser(user), sessionId: session.id, ...(needsRenewal && { renewedUntil: expiresAt }) };
    },

    async logout(token: string): Promise<void> {
      const session = await store.sessions.findByTokenHash(hashToken(token));
      if (session) await store.sessions.deleteById(session.id);
    },

    /** Resolves an API token to its user and what it may do. Null if unknown or expired. */
    async authenticateApiToken(token: string): Promise<AuthenticatedApiToken | null> {
      const record = await store.apiTokens.findByTokenHash(hashToken(token));
      if (!record) return null;

      const current = now();
      if (record.expiresAt && record.expiresAt <= current) return null;
      const user = await store.users.findById(record.userId);
      if (!user) return null;

      if (!record.lastUsedAt || current.getTime() - record.lastUsedAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
        await store.apiTokens.touch(record.id, current);
      }
      return { user: toPublicUser(user), tokenId: record.id, scope: record.scope };
    },

    /**
     * Replaces the password after checking the current one, signs out every other session
     * and revokes every API token: whoever else had access shouldn't keep it.
     */
    async changePassword(userId: string, currentSessionId: string, input: ChangePasswordInput): Promise<void> {
      const user = await store.users.findById(userId);
      if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
        const message = "That's not your current password";
        throw new AppError(400, "validation", message, { currentPassword: message });
      }
      const passwordHash = await hashPassword(input.newPassword);
      await store.transaction(async (repos) => {
        await repos.users.updatePasswordHash(userId, passwordHash, now());
        await repos.sessions.deleteOthers(userId, currentSessionId);
        await repos.apiTokens.deleteAllForUser(userId);
      });
    },

    /** Where the account is signed in, most recently used first. */
    async listSessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
      const current = now();
      return (await store.sessions.listForUser(userId))
        .filter((session) => session.expiresAt > current && !idledOut(session, current))
        .map((session) => ({
          id: session.id,
          device: describeUserAgent(session.userAgent),
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          current: session.id === currentSessionId,
        }));
    },

    async revokeSession(userId: string, sessionId: string): Promise<void> {
      if (!(await store.sessions.findById(userId, sessionId))) {
        throw new AppError(404, "not_found", "No such session");
      }
      await store.sessions.deleteById(sessionId);
    },

    async revokeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
      await store.sessions.deleteOthers(userId, currentSessionId);
    },

    /** The account's API tokens, newest first. Never includes a secret. */
    async listApiTokens(userId: string): Promise<ApiTokenInfo[]> {
      return (await store.apiTokens.listForUser(userId)).map(toApiTokenInfo);
    },

    /** Creates a token and returns its secret, which cannot be recovered afterwards. */
    async createApiToken(userId: string, input: ApiTokenInput): Promise<ApiTokenCreatedResponse> {
      const secret = generateApiToken();
      const createdAt = now();
      const record = await store.transaction(async (repos) => {
        if ((await repos.apiTokens.listForUser(userId)).length >= MAX_API_TOKENS) {
          throw new AppError(409, "conflict", `You can have ${MAX_API_TOKENS} tokens at most. Revoke one first.`);
        }
        return repos.apiTokens.create({
          id: randomUUID(),
          tokenHash: hashToken(secret),
          userId,
          name: input.name,
          hint: secret.slice(-4),
          scope: input.scope,
          createdAt,
          lastUsedAt: null,
          expiresAt: input.expiresInDays ? new Date(createdAt.getTime() + input.expiresInDays * DAY_MS) : null,
        });
      });
      return { secret, token: toApiTokenInfo(record) };
    },

    async revokeApiToken(userId: string, tokenId: string): Promise<void> {
      if (!(await store.apiTokens.findById(userId, tokenId))) {
        throw new AppError(404, "not_found", "No such token");
      }
      await store.apiTokens.delete(userId, tokenId);
    },

    async purgeExpiredSessions(): Promise<void> {
      await store.sessions.deleteExpired(now());
      await store.sessions.deleteIdle(now(), IDLE_GRACE_MS);
    },
  };
}
