import { describe, expect, it } from "vitest";
import { formSchema, toInput, type FormValues } from "./form.ts";

const blank: FormValues = {
  name: "Rent",
  kind: "expense",
  amount: "1200.00",
  opening: "",
  recurrenceUnit: "month",
  recurrenceInterval: "1",
  firstDueDate: "2026-10-01",
  endDate: "",
  description: "",
  categoryId: "",
  hasDue: false,
  dueDate: "",
  dueUnit: "month",
  dueInterval: "1",
};

const errorPaths = (values: Partial<FormValues>) => {
  const result = formSchema.safeParse({ ...blank, ...values });
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("formSchema", () => {
  it.each<[string, Partial<FormValues>, string[]]>([
    ["a valid monthly bill", {}, []],
    ["an interval of 0 on a schedule", { recurrenceInterval: "0" }, ["recurrenceInterval"]],
    ["an amount of 0 on a schedule", { amount: "0" }, ["amount"]],
    ["a missing first date on a schedule", { firstDueDate: "" }, ["firstDueDate"]],
    ["an invalid starting balance on a transfer", { kind: "transfer", opening: "lots" }, ["opening"]],
    // Fields the form hides once the schedule or type changes are not checked.
    ["an interval of 0 left behind by 'As it happens'", { recurrenceUnit: "none", recurrenceInterval: "0", amount: "" }, []],
    ["an interval of 0 left behind by a pay-period schedule", { recurrenceUnit: "period", recurrenceInterval: "0" }, []],
    ["a cleared first date left behind by 'As it happens'", { recurrenceUnit: "none", firstDueDate: "" }, []],
    ["a bad end date left behind by 'As it happens'", { recurrenceUnit: "none", endDate: "soon" }, []],
    ["a starting balance left behind by switching from a transfer", { kind: "expense", opening: "lots" }, []],
    // With no schedule the usual amount is optional, and 0 means none.
    ["no usual amount with no schedule", { recurrenceUnit: "none", amount: "" }, []],
    ["a usual amount of 0 with no schedule", { recurrenceUnit: "none", amount: "0" }, []],
    ["a usual amount of 0.00 with no schedule", { recurrenceUnit: "none", amount: "0.00" }, []],
    ["a nonsense usual amount with no schedule", { recurrenceUnit: "none", amount: "abc" }, ["amount"]],
  ])("%s", (_, values, expected) => {
    expect(errorPaths(values)).toEqual(expected);
  });
});

describe("toInput", () => {
  it("sends neutral schedule values for an item with no schedule", () => {
    const values = { ...blank, recurrenceUnit: "none", recurrenceInterval: "0", amount: "0", firstDueDate: "" } as const;
    expect(toInput(values)).toMatchObject({
      recurrenceUnit: "none",
      recurrenceInterval: 1,
      defaultAmountCents: 0,
      firstDueDate: undefined,
      endDate: null,
    });
  });
});
