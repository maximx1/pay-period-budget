import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** IANA zone the budget lives in; decides what "today" is, wherever the device is. */
  timezone: text("timezone").notNull(),
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
    /** 0, 1, 2, ... per user with no holes. */
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
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("transactions_user_occurs_idx").on(t.userId, t.occursAt)],
);
