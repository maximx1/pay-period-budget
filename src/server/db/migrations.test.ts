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
