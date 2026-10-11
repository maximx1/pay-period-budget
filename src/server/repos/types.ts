// The data-access boundary. Services and routes depend only on these interfaces;
// nothing outside src/server/repos and src/server/db may import drizzle or the driver.
// Swapping the database means writing a new implementation of DataStore.

import type { LocalDate, LocalDateTime } from "../../shared/dates.ts";
import type { RecurrenceUnit } from "../../shared/recurrence.ts";
import type { ScheduleType } from "../../shared/schedule.ts";
import type { TransactionKind, TransactionStatus } from "../../shared/transactions.ts";

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
  updatePasswordHash(id: string, passwordHash: string, now: Date): Promise<void>;
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
  findById(userId: string, id: string): Promise<SessionRecord | null>;
  /** The user's sessions, most recently used first. Includes expired ones not yet purged. */
  listForUser(userId: string): Promise<SessionRecord[]>;
  touch(id: string, update: { lastSeenAt: Date; expiresAt: Date }): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
  /** Signs the user out everywhere except the session with `keepId`. */
  deleteOthers(userId: string, keepId: string): Promise<void>;
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
  /** The period with the lowest seq: the earliest one. */
  findFirst(userId: string): Promise<PeriodRecord | null>;
  /** The period with the highest seq. */
  findLast(userId: string): Promise<PeriodRecord | null>;
  /** Periods with seq >= fromSeq, ascending. */
  listFromSeq(userId: string, fromSeq: number): Promise<PeriodRecord[]>;
  /** Every period, ascending by seq. */
  listAll(userId: string): Promise<PeriodRecord[]>;
  /** Throws UniqueConstraintError on a duplicate seq or start date. */
  create(period: PeriodRecord): Promise<PeriodRecord>;
  update(userId: string, id: string, patch: PeriodPatch, now: Date): Promise<void>;
}

export type TransactionRecord = {
  id: string;
  userId: string;
  name: string;
  /** Signed: negative for an expense, positive for income. */
  amountCents: number;
  occursAt: LocalDateTime;
  status: TransactionStatus;
  paidAt: Date | null;
  sortOrder: number;
  note: string | null;
  /** The recurring item that generated it, or null. */
  recurringId: string | null;
  /** The scheduled date it was generated for, or null for a one-off. */
  occurrenceDate: LocalDate | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TransactionRecordPatch = Partial<
  Pick<TransactionRecord, "name" | "amountCents" | "occursAt" | "status" | "paidAt" | "sortOrder" | "note">
>;

export interface TransactionRepo {
  findById(userId: string, id: string): Promise<TransactionRecord | null>;
  /** Transactions dated from `startDate` through `endDate` inclusive, in display order. */
  listInRange(userId: string, startDate: LocalDate, endDate: LocalDate): Promise<TransactionRecord[]>;
  /** Signed totals by status over the same range. */
  sumInRange(
    userId: string,
    startDate: LocalDate,
    endDate: LocalDate,
  ): Promise<{ paidCents: number; upcomingCents: number }>;
  /** The highest manual order among transactions at exactly this date and time, or null if there are none. */
  maxSortOrderAt(userId: string, occursAt: LocalDateTime): Promise<number | null>;
  create(transaction: TransactionRecord): Promise<TransactionRecord>;
  /**
   * Inserts a generated transaction unless one already exists for the same recurring item
   * and occurrence date. Returns whether it was inserted.
   */
  createIfAbsent(transaction: TransactionRecord): Promise<boolean>;
  /** A recurring item's upcoming transactions dated after `date`. */
  listUpcomingForRecurringAfter(userId: string, recurringId: string, date: LocalDate): Promise<TransactionRecord[]>;
  update(userId: string, id: string, patch: TransactionRecordPatch, now: Date): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
}

export type RecurringRecord = {
  id: string;
  userId: string;
  name: string;
  description: string;
  kind: TransactionKind;
  /** Positive; `kind` gives the direction. */
  defaultAmountCents: number;
  recurrenceUnit: RecurrenceUnit;
  recurrenceInterval: number;
  firstDueDate: LocalDate;
  endDate: LocalDate | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RecurringRecordPatch = Partial<
  Omit<RecurringRecord, "id" | "userId" | "createdAt" | "updatedAt">
>;

export interface RecurringRepo {
  findById(userId: string, id: string): Promise<RecurringRecord | null>;
  /** All of the user's items, by name. */
  list(userId: string): Promise<RecurringRecord[]>;
  create(item: RecurringRecord): Promise<RecurringRecord>;
  update(userId: string, id: string, patch: RecurringRecordPatch, now: Date): Promise<void>;
  /** Transactions it generated stay, with their link to it cleared. */
  delete(userId: string, id: string): Promise<void>;
}

export interface Repos {
  users: UserRepo;
  sessions: SessionRepo;
  settings: SettingsRepo;
  schedules: ScheduleRepo;
  periods: PeriodRepo;
  transactions: TransactionRepo;
  recurring: RecurringRepo;
}

export interface DataStore extends Repos {
  /** Resolves if the database answers a trivial query; rejects otherwise. For health checks. */
  ping(): Promise<void>;
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
