import { describe, expect, it } from "vitest";
import { type BillsIncomeFilters, matchesFilters } from "./filter.ts";

type Item = Parameters<typeof matchesFilters>[0];

const items = {
  rent: { name: "Rent", description: "Pay at https://landlord.example", kind: "expense", recurrenceUnit: "month", archived: false },
  paycheck: { name: "Paycheck", description: "", kind: "income", recurrenceUnit: "period", archived: false },
  card: { name: "Credit card", description: "Extra payments", kind: "expense", recurrenceUnit: "none", archived: false },
  sideJobs: { name: "Side jobs", description: "Roofing with Sam", kind: "income", recurrenceUnit: "none", archived: false },
  oldGym: { name: "Gym", description: "", kind: "expense", recurrenceUnit: "month", archived: true },
  oldFavours: { name: "Favours", description: "", kind: "income", recurrenceUnit: "none", archived: true },
  taxes: { name: "Taxes savings", description: "", kind: "transfer", recurrenceUnit: "none", archived: false },
  heloc: { name: "HELOC", description: "Payment on the 5th", kind: "transfer", recurrenceUnit: "month", archived: false },
} satisfies Record<string, Item>;

const everything: BillsIncomeFilters = { search: "", kind: "all", schedule: "any", showArchived: false };

const shown = (filters: Partial<BillsIncomeFilters>) =>
  Object.entries(items)
    .filter(([, item]) => matchesFilters(item, { ...everything, ...filters }))
    .map(([key]) => key);

describe("matchesFilters", () => {
  it.each<[string, Partial<BillsIncomeFilters>, string[]]>([
    ["nothing chosen: all but the archived", {}, ["rent", "paycheck", "card", "sideJobs", "taxes", "heloc"]],
    ["bills, which a transfer is not", { kind: "expense" }, ["rent", "card"]],
    ["income", { kind: "income" }, ["paycheck", "sideJobs"]],
    ["transfers", { kind: "transfer" }, ["taxes", "heloc"]],
    ["transfers on a schedule", { kind: "transfer", schedule: "scheduled" }, ["heloc"]],
    ["on a schedule", { schedule: "scheduled" }, ["rent", "paycheck", "heloc"]],
    ["as it happens", { schedule: "unscheduled" }, ["card", "sideJobs", "taxes"]],
    ["income as it happens", { kind: "income", schedule: "unscheduled" }, ["sideJobs"]],
    ["bills on a schedule", { kind: "expense", schedule: "scheduled" }, ["rent"]],
    ["archived too", { showArchived: true }, ["rent", "paycheck", "card", "sideJobs", "oldGym", "oldFavours", "taxes", "heloc"]],
    ["archived, as it happens", { showArchived: true, schedule: "unscheduled" }, ["card", "sideJobs", "oldFavours", "taxes"]],
    ["archived, bills on a schedule", { showArchived: true, kind: "expense", schedule: "scheduled" }, ["rent", "oldGym"]],
    ["search by name, any case", { search: "  CREDIT " }, ["card"]],
    ["search finds the description", { search: "landlord" }, ["rent"]],
    ["search and a filter that disagree", { search: "roofing", schedule: "scheduled" }, []],
    ["search and a filter that agree", { search: "roofing", schedule: "unscheduled" }, ["sideJobs"]],
    ["search does not reach the archived", { search: "gym" }, []],
  ])("%s", (_name, filters, expected) => {
    expect(shown(filters)).toEqual(expected);
  });
});
