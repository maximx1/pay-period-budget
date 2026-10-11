// The data-access boundary. Services and routes depend only on these interfaces;
// nothing outside src/server/repos and src/server/db may import drizzle or the driver.
// Swapping the database means writing a new implementation of DataStore.

export type UserRecord = {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NewUser = Pick<UserRecord, "id" | "username" | "email" | "passwordHash"> & { now: Date };

export interface UserRepo {
  findById(id: string): Promise<UserRecord | null>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  /** Throws UniqueConstraintError("username" | "email") on a duplicate. */
  create(user: NewUser): Promise<UserRecord>;
}

export type SessionRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
};

export interface SessionRepo {
  create(session: SessionRecord): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touch(id: string, update: { lastSeenAt: Date; expiresAt: Date }): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}

export interface Repos {
  users: UserRepo;
  sessions: SessionRepo;
}

export interface DataStore extends Repos {
  /** Runs `fn` atomically. Use the repos passed to `fn`, not the outer ones. */
  transaction<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}

export class UniqueConstraintError extends Error {
  constructor(readonly field: string) {
    super(`Unique constraint violated on ${field}`);
    this.name = "UniqueConstraintError";
  }
}
