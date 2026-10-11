// The data-access boundary. Services and routes depend only on these interfaces;
// nothing outside src/server/repos and src/server/db may import drizzle or the driver.
// Swapping the database means writing a new implementation of DataStore.

import type { LocalDate } from "../../shared/dates.ts";
import type { ScheduleType } from "../../shared/schedule.ts";

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

export type SettingsRecord = {
  userId: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface SettingsRepo {
  get(userId: string): Promise<SettingsRecord | null>;
  upsert(userId: string, values: { timezone: string }, now: Date): Promise<void>;
}

export type ScheduleRecord = {
  id: string;
  userId: string;
  type: ScheduleType;
  anchorDate: LocalDate;
  openingCents: number;
  createdAt: Date;
};

export interface ScheduleRepo {
  getForUser(userId: string): Promise<ScheduleRecord | null>;
  /** Throws UniqueConstraintError if the user already has one. */
  create(schedule: ScheduleRecord): Promise<ScheduleRecord>;
}

export type PeriodRecord = {
  id: string;
  userId: string;
  scheduleId: string;
  seq: number;
  startDate: LocalDate;
  endDate: LocalDate;
  nominalStart: LocalDate;
  nominalEnd: LocalDate;
  startingCents: number;
  startingMode: "auto" | "manual";
  carryStale: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PeriodPatch = Partial<
  Pick<PeriodRecord, "startDate" | "endDate" | "startingCents" | "startingMode" | "carryStale">
>;

export interface PeriodRepo {
  findById(userId: string, id: string): Promise<PeriodRecord | null>;
  findBySeq(userId: string, seq: number): Promise<PeriodRecord | null>;
  /** The period whose start..end (inclusive) covers `date`. */
  findContaining(userId: string, date: LocalDate): Promise<PeriodRecord | null>;
  /** The period with the highest seq. */
  findLast(userId: string): Promise<PeriodRecord | null>;
  /** Periods with seq >= fromSeq, ascending. */
  listFromSeq(userId: string, fromSeq: number): Promise<PeriodRecord[]>;
  /** Throws UniqueConstraintError on a duplicate seq or start date. */
  create(period: PeriodRecord): Promise<PeriodRecord>;
  update(userId: string, id: string, patch: PeriodPatch, now: Date): Promise<void>;
}

export interface Repos {
  users: UserRepo;
  sessions: SessionRepo;
  settings: SettingsRepo;
  schedules: ScheduleRepo;
  periods: PeriodRepo;
}

export interface DataStore extends Repos {
  /**
   * Runs `fn` atomically. Inside it, use only the repos passed to `fn`: calling the store
   * itself (or starting another transaction) from within is an error. Keep the work short
   * and free of slow non-database steps such as password hashing.
   */
  transaction<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}

export class UniqueConstraintError extends Error {
  /**
   * @param field the column that collided, in camelCase; for a multi-column index, the last one
   * @param columns every column of the violated index
   */
  constructor(
    readonly field: string,
    readonly columns: readonly string[] = [field],
  ) {
    super(`Unique constraint violated on ${columns.join(", ")}`);
    this.name = "UniqueConstraintError";
  }
}
