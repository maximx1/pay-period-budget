// The data-access boundary. Services and routes depend only on these interfaces;
// nothing outside src/server/repos and src/server/db may import drizzle or the driver.
// Swapping the database means writing a new implementation of DataStore.

import type { ApiTokenScope } from "../../shared/auth.ts";
import type { BillOrIncomeKind } from "../../shared/billsIncome.ts";
import type { LocalDate, LocalDateTime } from "../../shared/dates.ts";
import type { DueUnit } from "../../shared/dueDates.ts";
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
  /** Ends the session after this long without a request. Null: only `expiresAt` ends it. */
  idleTimeoutMs: number | null;
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
  /** Deletes sessions with an idle timeout whose last request is older than it plus `graceMs`. */
  deleteIdle(now: Date, graceMs: number): Promise<void>;
}

export type ApiTokenRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  name: string;
  hint: string;
  scope: ApiTokenScope;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** Null: never expires. */
  expiresAt: Date | null;
};

export interface ApiTokenRepo {
  create(token: ApiTokenRecord): Promise<ApiTokenRecord>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  findById(userId: string, id: string): Promise<ApiTokenRecord | null>;
  /** The user's tokens, newest first. Includes expired ones. */
  listForUser(userId: string): Promise<ApiTokenRecord[]>;
  touch(id: string, lastUsedAt: Date): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

export type SettingsRecord = {
  userId: string;
  timezone: string;
  advicePersona: string | null;
  advicePersonaCustom: string | null;
  lowBalanceCents: number;
  lowBalancePeriods: number;
  createdAt: Date;
  updatedAt: Date;
};

export interface SettingsRepo {
  get(userId: string): Promise<SettingsRecord | null>;
  upsert(userId: string, values: { timezone: string }, now: Date): Promise<void>;
  /** Changes the voice Advice answers in. Returns false when the user has no settings yet. */
  setAdvicePersona(userId: string, persona: { persona: string; custom: string | null }, now: Date): Promise<boolean>;
  /** Changes when coming periods are warned about. Returns false when the user has no settings yet. */
  setLowBalance(userId: string, values: { lowBalanceCents: number; lowBalancePeriods: number }, now: Date): Promise<boolean>;
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
  /** The bill or income that generated it, or null. */
  billIncomeId: string | null;
  /** The scheduled date it was generated for, or null for a one-off. */
  occurrenceDate: LocalDate | null;
  /** The key it was imported under, or null if it was not imported. Unique per user. */
  importKey: string | null;
  /** The category it is filed under, or null. */
  categoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TransactionRecordPatch = Partial<
  Pick<
    TransactionRecord,
    | "name"
    | "amountCents"
    | "occursAt"
    | "status"
    | "paidAt"
    | "sortOrder"
    | "note"
    | "billIncomeId"
    | "occurrenceDate"
    | "categoryId"
  >
>;

/** What a search looks for. Everything given must match. */
export type TransactionSearch = {
  /** Part of the name or the note, compared without regard to case. */
  text?: string;
  from?: LocalDate;
  to?: LocalDate;
  /** A category's id; null for transactions filed under none; undefined for any. */
  categoryId?: string | null;
};

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
  /** Inserts them all. Throws UniqueConstraintError if an import key is already in use. */
  createMany(transactions: TransactionRecord[]): Promise<void>;
  /** Which of these import keys the user's transactions already use. */
  findImportKeys(userId: string, importKeys: string[]): Promise<string[]>;
  /** Records that the user deleted the transaction imported under this key. Safe to repeat. */
  rememberDeletedImportKey(userId: string, importKey: string, now: Date): Promise<void>;
  /** Which of these import keys belong to transactions the user deleted. */
  findDeletedImportKeys(userId: string, importKeys: string[]): Promise<string[]>;
  /** Lets these keys be imported again. */
  forgetDeletedImportKeys(userId: string, importKeys: string[]): Promise<void>;
  /**
   * Inserts a generated transaction unless one already exists for the same bill or income
   * and occurrence date. Returns whether it was inserted.
   */
  createIfAbsent(transaction: TransactionRecord): Promise<boolean>;
  /**
   * A bill or income's transactions, newest first, at most `limit`. With `before`, only
   * those older than that position in the same order.
   */
  listForBillOrIncome(
    userId: string,
    billIncomeId: string,
    page: { limit: number; before?: { occursAt: LocalDateTime; id: string } },
  ): Promise<TransactionRecord[]>;
  /**
   * Each distinct name and note among the transactions tied to bills and income, with the
   * item and the latest date-time it was used. For recognising the same description again.
   */
  listLinkedDescriptions(
    userId: string,
  ): Promise<Array<{ billIncomeId: string; name: string; note: string | null; lastUsedAt: LocalDateTime }>>;
  /**
   * How many transactions a bill or income has, their signed totals by status, and the
   * paid ones split by direction (each a positive amount).
   */
  sumForBillOrIncome(
    userId: string,
    billIncomeId: string,
  ): Promise<{ count: number; paidCents: number; upcomingCents: number; paidOutCents: number; paidInCents: number }>;
  /**
   * The upcoming transactions a bill or income generated, dated after `date`. Not ones
   * tied to it by hand: those are the user's own entries.
   */
  listUpcomingForBillOrIncomeAfter(userId: string, billIncomeId: string, date: LocalDate): Promise<TransactionRecord[]>;
  /** The transactions tied to any of these bills and income, dated `from` through `to` inclusive, oldest first. */
  listForBillsIncomeInRange(
    userId: string,
    billIncomeIds: string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<TransactionRecord[]>;
  /**
   * Files every transaction tied to a bill or income under this category (null: under
   * none). Returns how many were filed differently before.
   */
  setCategoryForBillOrIncome(userId: string, billIncomeId: string, categoryId: string | null, now: Date): Promise<number>;
  /** Files every transaction under one category under another instead. Returns how many moved. */
  moveCategory(userId: string, fromCategoryId: string, toCategoryId: string, now: Date): Promise<number>;
  /** What a search matches, newest first, at most `limit`. With `before`, only those older than that position. */
  search(
    userId: string,
    criteria: TransactionSearch,
    page: { limit: number; before?: { occursAt: LocalDateTime; id: string } },
  ): Promise<TransactionRecord[]>;
  /** How many a search matches in all, and their money out and money in, each as a positive amount. */
  searchTotals(userId: string, criteria: TransactionSearch): Promise<{ count: number; outCents: number; inCents: number }>;
  update(userId: string, id: string, patch: TransactionRecordPatch, now: Date): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
}

export type BillOrIncomeRecord = {
  id: string;
  userId: string;
  name: string;
  description: string;
  kind: BillOrIncomeKind;
  /** A transfer's starting balance, signed. 0 for anything else. */
  openingCents: number;
  /** Positive; `kind` gives the direction. */
  defaultAmountCents: number;
  recurrenceUnit: RecurrenceUnit;
  recurrenceInterval: number;
  firstDueDate: LocalDate;
  endDate: LocalDate | null;
  /** The category its entries are filed under as they are added, or null. */
  categoryId: string | null;
  /** A day it is normally due, repeating every `dueInterval` `dueUnit`s; null for none. */
  dueDate: LocalDate | null;
  dueUnit: DueUnit;
  dueInterval: number;
  createdAt: Date;
  updatedAt: Date;
};

export type BillOrIncomeRecordPatch = Partial<
  Omit<BillOrIncomeRecord, "id" | "userId" | "createdAt" | "updatedAt">
>;

export interface BillsIncomeRepo {
  findById(userId: string, id: string): Promise<BillOrIncomeRecord | null>;
  /** All of the user's items, by name. */
  list(userId: string): Promise<BillOrIncomeRecord[]>;
  create(item: BillOrIncomeRecord): Promise<BillOrIncomeRecord>;
  update(userId: string, id: string, patch: BillOrIncomeRecordPatch, now: Date): Promise<void>;
  /** Transactions it generated stay, with their link to it cleared. */
  delete(userId: string, id: string): Promise<void>;
  /** Files every item under one category under another instead. Returns how many moved. */
  moveCategory(userId: string, fromCategoryId: string, toCategoryId: string, now: Date): Promise<number>;
}

export type CategoryRecord = {
  id: string;
  userId: string;
  name: string;
  /** The limit a newly generated period is given for it. Null: none. */
  defaultLimitCents: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CategoryRecordPatch = Partial<Pick<CategoryRecord, "name" | "defaultLimitCents">>;

export interface CategoryRepo {
  findById(userId: string, id: string): Promise<CategoryRecord | null>;
  /** All of the user's categories, by name. */
  list(userId: string): Promise<CategoryRecord[]>;
  create(category: CategoryRecord): Promise<CategoryRecord>;
  update(userId: string, id: string, patch: CategoryRecordPatch, now: Date): Promise<void>;
  /** What was filed under it stays, filed under nothing. Its limits go with it. */
  delete(userId: string, id: string): Promise<void>;
}

export type CategoryLimitRecord = {
  periodId: string;
  categoryId: string;
  userId: string;
  limitCents: number;
  createdAt: Date;
  updatedAt: Date;
};

export interface CategoryLimitRepo {
  /** Every limit the user has, in any period. */
  listForUser(userId: string): Promise<CategoryLimitRecord[]>;
  /** A period's limits, each with its category's name, by that name. */
  listForPeriod(userId: string, periodId: string): Promise<Array<CategoryLimitRecord & { categoryName: string }>>;
  /** Gives the period this limit for the category, replacing the one it has if any. */
  set(limit: CategoryLimitRecord): Promise<void>;
  /** Returns whether there was one to remove. */
  delete(userId: string, periodId: string, categoryId: string): Promise<boolean>;
}

export interface Repos {
  users: UserRepo;
  sessions: SessionRepo;
  apiTokens: ApiTokenRepo;
  settings: SettingsRepo;
  schedules: ScheduleRepo;
  periods: PeriodRepo;
  transactions: TransactionRepo;
  billsIncome: BillsIncomeRepo;
  categories: CategoryRepo;
  categoryLimits: CategoryLimitRepo;
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
