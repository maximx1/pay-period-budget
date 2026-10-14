import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./client.ts";

// Migrations that rename things run against a database that already holds real data, and a
// generated one has been wrong before (see the note in CLAUDE.md). This builds a database
// as it was just before such a migration, fills it, and lets the migration run for real.

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A database migrated up to, but not including, the migration with this tag. */
async function databaseBefore(tag: string): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), "ppb-migration-"));
  const before = join(dir, "migrations");
  cpSync(migrationsFolder, before, { recursive: true });
  const journalPath = join(before, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  const stopAt = journal.entries.findIndex((entry) => entry.tag === tag);
  expect(stopAt, `migration ${tag} exists`).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, stopAt);
  writeFileSync(journalPath, JSON.stringify(journal));

  const url = `file:${join(dir, "app.db")}`;
  const client = createClient({ url });
  await client.execute("PRAGMA foreign_keys = ON");
  await migrate(drizzle(client), { migrationsFolder: before });
  client.close();
  return url;
}

describe("0008: recurring_items becomes bills_income", () => {
  it("keeps every item, every transaction and every link between them", async () => {
    const url = await databaseBefore("0008_rename_bills_income");

    // The data as the old schema held it.
    const old = createClient({ url });
    await old.execute("PRAGMA foreign_keys = ON");
    await old.batch([
      "insert into users (id, username, email, password_hash, created_at, updated_at) values ('u1', 'ann', 'ann@example.com', 'x', 1, 1)",
      `insert into recurring_items (id, user_id, name, description, kind, default_amount_cents, recurrence_unit, recurrence_interval, first_due_date, end_date, created_at, updated_at)
       values ('rent', 'u1', 'Rent', 'to the landlord', 'expense', 90000, 'month', 1, '2026-01-25', null, 1, 1),
              ('pay', 'u1', 'Paycheck', '', 'income', 200000, 'period', 1, '2026-01-02', null, 1, 1)`,
      `insert into transactions (id, user_id, name, amount_cents, occurs_at, status, paid_at, sort_order, note, recurring_id, occurrence_date, import_key, created_at, updated_at)
       values ('t1', 'u1', 'Rent', -90000, '2026-01-25T00:00', 'upcoming', null, 0, null, 'rent', '2026-01-25', null, 1, 1),
              ('t2', 'u1', 'Rent, late fee', -2500, '2026-01-28T00:00', 'paid', 5, 0, 'tied by hand', 'rent', null, 'bank-7', 1, 1),
              ('t3', 'u1', 'Paycheck', 200000, '2026-01-02T00:00', 'paid', 5, 0, null, 'pay', '2026-01-02', null, 1, 1),
              ('t4', 'u1', 'Coffee', -450, '2026-01-03T08:15', 'paid', 5, 0, null, null, null, null, 1, 1)`,
    ]);
    old.close();

    // Opening the database the way the server does applies whatever is pending.
    const { close } = await openDatabase(url);
    close();

    const now = createClient({ url });
    await now.execute("PRAGMA foreign_keys = ON");
    const rows = async (sql: string) => (await now.execute(sql)).rows.map((row) => Object.values(row));

    expect(await rows("select id, name, kind, default_amount_cents, recurrence_unit, description from bills_income order by id")).toEqual([
      ["pay", "Paycheck", "income", 200000, "period", ""],
      ["rent", "Rent", "expense", 90000, "month", "to the landlord"],
    ]);
    expect(await rows("select id, bill_income_id, occurrence_date, amount_cents, note, import_key from transactions order by id")).toEqual([
      ["t1", "rent", "2026-01-25", -90000, null, null],
      ["t2", "rent", null, -2500, "tied by hand", "bank-7"],
      ["t3", "pay", "2026-01-02", 200000, null, null],
      ["t4", null, null, -450, null, null],
    ]);

    // Nothing of the old names is left, and nothing points at a table that is not there.
    expect(await rows("select name from sqlite_master where name like '%recurring%'")).toEqual([]);
    expect(await rows("select * from pragma_foreign_key_check")).toEqual([]);

    // The rules that hung off the old names still hold under the new ones:
    // one generated transaction per occurrence of an item...
    await expect(
      now.execute(
        `insert into transactions (id, user_id, name, amount_cents, occurs_at, status, sort_order, bill_income_id, occurrence_date, created_at, updated_at)
         values ('t5', 'u1', 'Rent', -90000, '2026-01-25T00:00', 'upcoming', 0, 'rent', '2026-01-25', 1, 1)`,
      ),
    ).rejects.toThrow(/UNIQUE/);
    // ...a transaction cannot be tied to an item that does not exist...
    await expect(now.execute("update transactions set bill_income_id = 'nope' where id = 't4'")).rejects.toThrow(/FOREIGN KEY/);
    // ...and deleting an item unties its transactions without deleting them.
    await now.execute("delete from bills_income where id = 'rent'");
    expect(await rows("select id, bill_income_id from transactions order by id")).toEqual([
      ["t1", null],
      ["t2", null],
      ["t3", "pay"],
      ["t4", null],
    ]);
    now.close();
  });
});

describe("0009: a starting balance for transfers", () => {
  it("gives every item that already exists a starting balance of zero, and changes nothing else", async () => {
    const url = await databaseBefore("0009_bill_income_opening");

    const old = createClient({ url });
    await old.execute("PRAGMA foreign_keys = ON");
    await old.batch([
      "insert into users (id, username, email, password_hash, created_at, updated_at) values ('u1', 'ann', 'ann@example.com', 'x', 1, 1)",
      `insert into bills_income (id, user_id, name, description, kind, default_amount_cents, recurrence_unit, recurrence_interval, first_due_date, end_date, created_at, updated_at)
       values ('rent', 'u1', 'Rent', 'to the landlord', 'expense', 90000, 'month', 1, '2026-01-25', null, 1, 1),
              ('taxes', 'u1', 'Taxes savings', '', 'expense', 0, 'none', 1, '2026-01-02', null, 1, 1)`,
      `insert into transactions (id, user_id, name, amount_cents, occurs_at, status, paid_at, sort_order, note, bill_income_id, occurrence_date, import_key, created_at, updated_at)
       values ('t1', 'u1', 'Taxes savings', -40000, '2026-01-05T00:00', 'paid', 5, 0, null, 'taxes', null, null, 1, 1)`,
    ]);
    old.close();

    const { close } = await openDatabase(url);
    close();

    const now = createClient({ url });
    await now.execute("PRAGMA foreign_keys = ON");
    const rows = async (sql: string) => (await now.execute(sql)).rows.map((row) => Object.values(row));

    expect(await rows("select id, kind, default_amount_cents, recurrence_unit, opening_cents from bills_income order by id")).toEqual([
      ["rent", "expense", 90000, "month", 0],
      ["taxes", "expense", 0, "none", 0],
    ]);
    expect(await rows("select id, bill_income_id, amount_cents from transactions")).toEqual([["t1", "taxes", -40000]]);
    expect(await rows("select * from pragma_foreign_key_check")).toEqual([]);

    // A new row that does not mention it gets zero too, and it cannot be null.
    await now.execute(
      `insert into bills_income (id, user_id, name, kind, default_amount_cents, recurrence_unit, first_due_date, created_at, updated_at)
       values ('gym', 'u1', 'Gym', 'expense', 3000, 'month', '2026-01-10', 1, 1)`,
    );
    expect(await rows("select opening_cents from bills_income where id = 'gym'")).toEqual([[0]]);
    await expect(now.execute("update bills_income set opening_cents = null where id = 'gym'")).rejects.toThrow(/NOT NULL/);
    now.close();
  });
});

describe("0010: categories", () => {
  it("adds an empty category to everything that already exists, and keeps every link", async () => {
    const url = await databaseBefore("0010_categories");

    const old = createClient({ url });
    await old.execute("PRAGMA foreign_keys = ON");
    await old.batch([
      "insert into users (id, username, email, password_hash, created_at, updated_at) values ('u1', 'ann', 'ann@example.com', 'x', 1, 1)",
      `insert into bills_income (id, user_id, name, description, kind, default_amount_cents, recurrence_unit, recurrence_interval, first_due_date, end_date, created_at, updated_at)
       values ('rent', 'u1', 'Rent', 'to the landlord', 'expense', 90000, 'month', 1, '2026-01-25', null, 1, 1),
              ('taxes', 'u1', 'Taxes savings', '', 'transfer', 0, 'none', 1, '2026-01-02', null, 1, 1)`,
      `insert into transactions (id, user_id, name, amount_cents, occurs_at, status, paid_at, sort_order, note, bill_income_id, occurrence_date, import_key, created_at, updated_at)
       values ('t1', 'u1', 'Rent', -90000, '2026-01-25T00:00', 'upcoming', null, 0, null, 'rent', '2026-01-25', null, 1, 1),
              ('t2', 'u1', 'Taxes savings', -40000, '2026-01-05T00:00', 'paid', 5, 0, null, 'taxes', null, 'bank-7', 1, 1),
              ('t3', 'u1', 'Coffee', -450, '2026-01-03T08:15', 'paid', 5, 0, null, null, null, null, 1, 1)`,
    ]);
    old.close();

    const { close } = await openDatabase(url);
    close();

    const now = createClient({ url });
    await now.execute("PRAGMA foreign_keys = ON");
    const rows = async (sql: string) => (await now.execute(sql)).rows.map((row) => Object.values(row));

    expect(await rows("select id, kind, default_amount_cents, recurrence_unit, category_id from bills_income order by id")).toEqual([
      ["rent", "expense", 90000, "month", null],
      ["taxes", "transfer", 0, "none", null],
    ]);
    expect(await rows("select id, bill_income_id, occurrence_date, amount_cents, import_key, category_id from transactions order by id")).toEqual([
      ["t1", "rent", "2026-01-25", -90000, null, null],
      ["t2", "taxes", null, -40000, "bank-7", null],
      ["t3", null, null, -450, null, null],
    ]);
    expect(await rows("select * from pragma_foreign_key_check")).toEqual([]);

    await now.batch([
      "insert into categories (id, user_id, name, default_limit_cents, created_at, updated_at) values ('food', 'u1', 'Groceries', 20000, 1, 1)",
      "update transactions set category_id = 'food' where id in ('t2', 't3')",
      "update bills_income set category_id = 'food' where id = 'rent'",
    ]);
    // "Groceries" and "groceries" are one category...
    await expect(
      now.execute("insert into categories (id, user_id, name, created_at, updated_at) values ('food2', 'u1', 'groceries', 1, 1)"),
    ).rejects.toThrow(/UNIQUE/);
    // ...and nothing can be filed under one that does not exist.
    await expect(now.execute("update transactions set category_id = 'nope' where id = 't1'")).rejects.toThrow(/FOREIGN KEY/);
    await expect(now.execute("update bills_income set category_id = 'nope' where id = 'taxes'")).rejects.toThrow(/FOREIGN KEY/);

    // Deleting a category unfiles what was under it and deletes nothing. The generated
    // migration had lost this rule from both new columns; it was put back by hand.
    await now.execute("delete from categories where id = 'food'");
    expect(await rows("select id, bill_income_id, category_id from transactions order by id")).toEqual([
      ["t1", "rent", null],
      ["t2", "taxes", null],
      ["t3", null, null],
    ]);
    expect(await rows("select id, category_id from bills_income order by id")).toEqual([
      ["rent", null],
      ["taxes", null],
    ]);
    now.close();
  });

  it("removes a period's limits with the period, and a category's limits with the category", async () => {
    const url = await databaseBefore("0010_categories");
    const { close } = await openDatabase(url);
    close();

    const now = createClient({ url });
    await now.execute("PRAGMA foreign_keys = ON");
    const rows = async (sql: string) => (await now.execute(sql)).rows.map((row) => Object.values(row));
    await now.batch([
      "insert into users (id, username, email, password_hash, created_at, updated_at) values ('u1', 'ann', 'ann@example.com', 'x', 1, 1)",
      "insert into budget_schedules (id, user_id, type, anchor_date, opening_cents, created_at) values ('s1', 'u1', 'biweekly', '2026-01-02', 0, 1)",
      `insert into periods (id, user_id, schedule_id, seq, start_date, end_date, nominal_start, nominal_end, starting_cents, created_at, updated_at)
       values ('p0', 'u1', 's1', 0, '2026-01-02', '2026-01-15', '2026-01-02', '2026-01-15', 0, 1, 1),
              ('p1', 'u1', 's1', 1, '2026-01-16', '2026-01-29', '2026-01-16', '2026-01-29', 0, 1, 1)`,
      `insert into categories (id, user_id, name, default_limit_cents, created_at, updated_at)
       values ('food', 'u1', 'Groceries', 20000, 1, 1), ('car', 'u1', 'Car', null, 1, 1)`,
      `insert into period_category_limits (period_id, category_id, user_id, limit_cents, created_at, updated_at)
       values ('p0', 'food', 'u1', 20000, 1, 1), ('p1', 'food', 'u1', 25000, 1, 1), ('p1', 'car', 'u1', 5000, 1, 1)`,
    ]);

    // One limit per category in a period.
    await expect(
      now.execute("insert into period_category_limits (period_id, category_id, user_id, limit_cents, created_at, updated_at) values ('p0', 'food', 'u1', 1, 1, 1)"),
    ).rejects.toThrow(/UNIQUE|PRIMARY/);

    await now.execute("delete from categories where id = 'food'");
    expect(await rows("select period_id, category_id, limit_cents from period_category_limits")).toEqual([["p1", "car", 5000]]);
    await now.execute("delete from periods where id = 'p1'");
    expect(await rows("select count(*) from period_category_limits")).toEqual([[0]]);
    now.close();
  });
});
