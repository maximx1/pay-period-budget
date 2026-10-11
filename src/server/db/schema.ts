import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
