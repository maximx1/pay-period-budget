import { z } from "zod";
import { formatCents } from "./money.ts";
import { MAX_TRANSACTION_CENTS } from "./transactions.ts";

export const DUPLICATE_CATEGORY_MESSAGE = "You already have a category with that name";

// Plain field rules, shared by the create and patch schemas below. Defaults live only on
// the create schema: a patch must never fill in a field the caller didn't send.
const limitCents = z
  .number("Enter an amount")
  .int("Enter a whole number of cents")
  .min(0, "Enter zero or more")
  .max(MAX_TRANSACTION_CENTS, "That amount is too large");

const fields = {
  name: z.string().trim().min(1, "Enter a name").max(40, "Keep the name under 40 characters"),
  /**
   * The limit each newly generated pay period gets for this category. 0 means "spend
   * nothing"; null means no limit.
   */
  defaultLimitCents: limitCents.nullable(),
  /**
   * Also give the usual limit to the current pay period and every later one that already
   * exists, replacing what they have (or, with no usual limit, removing it). Periods that
   * have ended are never touched.
   */
  applyToPeriods: z.boolean().optional(),
};

export const categoryInputSchema = z.object({
  name: fields.name,
  defaultLimitCents: fields.defaultLimitCents.default(null),
  applyToPeriods: fields.applyToPeriods,
});
export type CategoryInput = z.output<typeof categoryInputSchema>;

export const categoryPatchSchema = z
  .object({
    name: fields.name.optional(),
    /** Null takes the usual limit away. */
    defaultLimitCents: fields.defaultLimitCents.optional(),
    applyToPeriods: fields.applyToPeriods,
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");
export type CategoryPatch = z.output<typeof categoryPatchSchema>;

/**
 * Moves everything filed under a category, every transaction (past ones too) and every bill
 * or income, to another. The other category keeps its own limits. With `deleteAfter`, the
 * emptied category is then deleted with its limits, which makes the move a merge.
 */
export const categoryMoveSchema = z.object({
  toCategoryId: z.string("Choose a category").min(1, "Choose a category").max(100),
  deleteAfter: z.boolean().default(false),
});
export type CategoryMove = z.output<typeof categoryMoveSchema>;
export const SAME_CATEGORY_MESSAGE = "Choose a different category";

/** How many of each were moved, and whether the category they came from is gone. */
export type CategoryMoveResponse = { transactions: number; billsIncome: number; deleted: boolean };

export type Category = {
  id: string;
  name: string;
  /** The limit a new pay period is given for it, or null for none. */
  defaultLimitCents: number | null;
};

/** By name. */
export type CategoryListResponse = { categories: Category[] };
export type CategoryResponse = { category: Category };

/** One pay period's limit for one category. */
export const categoryLimitSchema = z.object({ limitCents });

/** A period's limit for a category, with what has been spent against it. */
export type PeriodCategoryLimit = {
  categoryId: string;
  name: string;
  limitCents: number;
  /**
   * Money out less money in over every transaction in the period filed under the
   * category, paid or upcoming. Never below zero.
   */
  spentCents: number;
  /** The same over paid transactions only: tells "went over" from "set to go over". */
  paidSpentCents: number;
};

/**
 * What to tell the user about a limit that has been passed, or null when it has not.
 * Spending exactly the limit is not over it.
 */
export function overLimitMessage({ name, limitCents, spentCents, paidSpentCents }: PeriodCategoryLimit): string | null {
  if (spentCents <= limitCents) return null;
  const projected = formatCents(spentCents - limitCents);
  if (paidSpentCents <= limitCents) {
    return `You're set to go over your budget for ${name} by ${projected} this period.`;
  }
  const soFar = `You went over your budget for ${name} by ${formatCents(paidSpentCents - limitCents)} this period.`;
  return spentCents > paidSpentCents ? `${soFar} With what's upcoming it will be ${projected}.` : soFar;
}
