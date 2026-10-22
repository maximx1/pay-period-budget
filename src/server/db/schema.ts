import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { API_TOKEN_SCOPES } from "../../shared/auth.ts";
import { DEFAULT_CHECK_EVERY_DAYS, DEFAULT_CHECKS_PER_DAY } from "../../shared/balances.ts";
import { BILL_OR_INCOME_KINDS } from "../../shared/billsIncome.ts";
import { DUE_UNITS } from "../../shared/dueDates.ts";
import { DEFAULT_LOW_BALANCE_CENTS, DEFAULT_PERIODS_AHEAD } from "../../shared/outlook.ts";
import { RECURRENCE_UNITS } from "../../shared/recurrence.ts";
import { SCHEDULE_TYPES } from "../../shared/schedule.ts";
import { TRANSACTION_STATUSES } from "../../shared/transactions.ts";

// Conventions: text UUID primary keys, instants as integer milliseconds (timestamp_ms),
// money as integer cents, calendar dates as "YYYY-MM-DD" text.

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** Stored lowercase; uniqueness is therefore case-insensitive. */
    username: text("username").notNull(),
    /** Stored lowercase. */
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("users_username_unique").on(t.username),
    uniqueIndex("users_email_unique").on(t.email),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    /** SHA-256 of the session token. The raw token only ever lives in the client. */
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    /**
     * Set for a browser's session: it ends once this long passes without a request. Null for
     * the Android app's, which locks itself instead and keeps its session.
     */
    idleTimeoutMs: integer("idle_timeout_ms"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

/** Keys for programs acting for the user (an assistant, a script). Limited to budget data. */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    /** SHA-256 of the token. The raw token is shown once, when it is created. */
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The last four characters of the token, to tell tokens apart in a list. */
    hint: text("hint").notNull(),
    scope: text("scope", { enum: API_TOKEN_SCOPES }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    /** Null: never expires. */
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("api_tokens_token_hash_unique").on(t.tokenHash),
    index("api_tokens_user_id_idx").on(t.userId),
  ],
);

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** IANA zone the budget lives in; decides what "today" is, wherever the device is. */
  timezone: text("timezone").notNull(),
  /** The voice Advice answers in: an id from ADVICE_PERSONAS. Null is the plain one. */
  advicePersona: text("advice_persona"),
  /** With advicePersona "custom", who to answer as, in the owner's words. */
  advicePersonaCustom: text("advice_persona_custom"),
  /** Warn when a coming period is set to end below this many cents. */
  lowBalanceCents: integer("low_balance_cents").notNull().default(DEFAULT_LOW_BALANCE_CENTS),
  /** How many periods after the current one the warnings look at; 0 is off. */
  lowBalancePeriods: integer("low_balance_periods").notNull().default(DEFAULT_PERIODS_AHEAD),
  /** About how many days apart to ask for a tracked balance to be checked. */
  balanceCheckDays: integer("balance_check_days").notNull().default(DEFAULT_CHECK_EVERY_DAYS),
  /** The most checks to ask for on the home screen in one day. */
  balanceChecksPerDay: integer("balance_checks_per_day").notNull().default(DEFAULT_CHECKS_PER_DAY),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const budgetSchedules = sqliteTable(
  "budget_schedules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: SCHEDULE_TYPES }).notNull(),
    /** Start of period 0; every nominal period is derived from it. */
    anchorDate: text("anchor_date").notNull(),
    /** Starting amount of period 0. */
    openingCents: integer("opening_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  // One schedule per user for now; changing schedules later means dropping this.
  (t) => [uniqueIndex("budget_schedules_user_id_unique").on(t.userId)],
);

export const periods = sqliteTable(
  "periods",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => budgetSchedules.id, { onDelete: "cascade" }),
    /** Consecutive per user with no holes. 0 starts on the anchor; negative ones were added before it. */
    seq: integer("seq").notNull(),
    startDate: text("start_date").notNull(),
    /** Inclusive. */
    endDate: text("end_date").notNull(),
    /** The dates the schedule gave this period; never change after creation. */
    nominalStart: text("nominal_start").notNull(),
    nominalEnd: text("nominal_end").notNull(),
    startingCents: integer("starting_cents").notNull(),
    startingMode: text("starting_mode", { enum: ["auto", "manual"] })
      .notNull()
      .default("auto"),
    carryStale: integer("carry_stale", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("periods_user_seq_unique").on(t.userId, t.seq),
    uniqueIndex("periods_user_start_unique").on(t.userId, t.startDate),
    index("periods_user_end_idx").on(t.userId, t.endDate),
  ],
);

/** What a transaction is filed under ("Groceries"), with the limit a pay period usually gets for it. */
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What each newly generated period is given as its limit. Null: no limit. */
    defaultLimitCents: integer("default_limit_cents"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  // "Groceries" and "groceries" are the same category.
  (t) => [uniqueIndex("categories_user_name_unique").on(t.userId, sql`lower(${t.name})`)],
);

/** One period's limit for one category: a copy of the category's usual limit, then its own. */
export const periodCategoryLimits = sqliteTable(
  "period_category_limits",
  {
    periodId: text("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    limitCents: integer("limit_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.periodId, t.categoryId] }),
    index("period_category_limits_category_idx").on(t.categoryId),
  ],
);

/** Bills and income: templates that produce transactions. (Not "accounts".) */
export const billsIncome = sqliteTable(
  "bills_income",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind", { enum: BILL_OR_INCOME_KINDS }).notNull(),
    /** A transfer's starting balance, signed (negative is money owed). 0 for a bill or an income. */
    openingCents: integer("opening_cents").notNull().default(0),
    /** Positive; `kind` gives the direction. Used when an occurrence is turned into a transaction. */
    defaultAmountCents: integer("default_amount_cents").notNull(),
    recurrenceUnit: text("recurrence_unit", { enum: RECURRENCE_UNITS }).notNull(),
    recurrenceInterval: integer("recurrence_interval").notNull().default(1),
    firstDueDate: text("first_due_date").notNull(),
    endDate: text("end_date"),
    /** What its entries are filed under as they are added. Cleared if that category is deleted. */
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    /** A day it is normally due, repeating every due_interval due_units. Null: none. */
    dueDate: text("due_date"),
    dueUnit: text("due_unit", { enum: DUE_UNITS }).notNull().default("month"),
    dueInterval: integer("due_interval").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("bills_income_user_id_idx").on(t.userId)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Signed: negative for an expense, positive for income. */
    amountCents: integer("amount_cents").notNull(),
    /** "YYYY-MM-DDTHH:mm" in the budget's time zone. Its date decides which period it belongs to. */
    occursAt: text("occurs_at").notNull(),
    status: text("status", { enum: TRANSACTION_STATUSES }).notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    /** Manual order among transactions with the same occurs_at. */
    sortOrder: integer("sort_order").notNull().default(0),
    note: text("note"),
    /** The bill or income this came from, if any. Cleared if that item is deleted. */
    billIncomeId: text("bill_income_id").references(() => billsIncome.id, { onDelete: "set null" }),
    /** The scheduled date this was generated for. Unlike occurs_at it never changes. */
    occurrenceDate: text("occurrence_date"),
    /** The importer's own name for this row, so importing the same row again adds nothing. */
    importKey: text("import_key"),
    /** What it is filed under, if anything. Cleared if that category is deleted. */
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("transactions_user_occurs_idx").on(t.userId, t.occursAt),
    // Rows that were not imported have a null key and never collide.
    uniqueIndex("transactions_user_import_key_unique").on(t.userId, t.importKey),
    // One transaction per occurrence of an item. Rows with no item have a null bill_income_id,
    // and SQLite treats nulls as distinct, so they are unaffected.
    uniqueIndex("transactions_bill_income_occurrence_unique").on(t.billIncomeId, t.occurrenceDate),
    index("transactions_category_idx").on(t.categoryId),
  ],
);

/**
 * Import keys of transactions the user deleted. An import skips them, so a row removed
 * from the budget does not come back with the next bank export that still lists it.
 */
export const deletedImportKeys = sqliteTable(
  "deleted_import_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    importKey: text("import_key").notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.importKey] })],
);

/**
 * The payments of a split that fall too far ahead for their pay periods to exist yet.
 * Each is a transaction worked out in full and waiting to be added; the rows one split
 * left share a `split_id`. Adding one deletes it here.
 */
export const splitWaitingPayments = sqliteTable(
  "split_waiting_payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    splitId: text("split_id").notNull(),
    name: text("name").notNull(),
    /** Signed: negative for an expense, positive for income. */
    amountCents: integer("amount_cents").notNull(),
    /** "YYYY-MM-DDTHH:mm" in the budget's time zone, as the transaction will have it. */
    occursAt: text("occurs_at").notNull(),
    note: text("note"),
    /** Cleared if that bill or income is deleted before the payment is added. */
    billIncomeId: text("bill_income_id").references(() => billsIncome.id, { onDelete: "set null" }),
    /** Cleared if that category is deleted before the payment is added. */
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("split_waiting_user_occurs_idx").on(t.userId, t.occursAt),
    index("split_waiting_split_idx").on(t.splitId),
  ],
);

/**
 * A bill or transfer whose own account's balance is tracked (phase 28). Its checks are in
 * `balance_checks`; the row going away stops the asking and keeps them.
 */
export const trackedBalances = sqliteTable(
  "tracked_balances",
  {
    billIncomeId: text("bill_income_id")
      .primaryKey()
      .references(() => billsIncome.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Its own interval in days; null follows user_settings.balance_check_days. */
    checkEveryDays: integer("check_every_days"),
    /** When to ask for a check next. */
    nextCheckOn: text("next_check_on").notNull(),
    /** The last day it was checked or snoozed, which counts toward that day's asks. */
    handledOn: text("handled_on"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("tracked_balances_user_idx").on(t.userId)],
);

/** A balance as the owner read it at a moment. Kept after tracking stops; deleted with the item. */
export const balanceChecks = sqliteTable(
  "balance_checks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    billIncomeId: text("bill_income_id")
      .notNull()
      .references(() => billsIncome.id, { onDelete: "cascade" }),
    /** Signed: below zero is owed. */
    balanceCents: integer("balance_cents").notNull(),
    /** Basis points: 2499 is 24.99%. Null: no rate given. */
    aprBps: integer("apr_bps"),
    /** "YYYY-MM-DDTHH:mm" in the budget's time zone, as transactions have it. */
    asOf: text("as_of").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("balance_checks_item_as_of_idx").on(t.billIncomeId, t.asOf)],
);
