import { randomUUID } from "node:crypto";
import {
  type Category,
  type CategoryInput,
  type CategoryPatch,
  DUPLICATE_CATEGORY_MESSAGE,
} from "../../shared/categories.ts";
import { AppError } from "../lib/errors.ts";
import type { CategoryRecord, DataStore, Repos } from "../repos/types.ts";
import { applyUsualLimit } from "./categoryLimits.ts";
import type { PeriodService } from "./periods.ts";

export type CategoryService = ReturnType<typeof createCategoryService>;

const notFound = () => new AppError(404, "not_found", "No such category");

const toCategory = ({ id, name, defaultLimitCents }: CategoryRecord): Category => ({ id, name, defaultLimitCents });

export function createCategoryService(deps: { store: DataStore; periods: PeriodService; now?: () => Date }) {
  const { store, periods, now = () => new Date() } = deps;

  /** "Groceries" and "groceries" are one category. `exceptId` is the one being renamed. */
  async function refuseDuplicate(repos: Repos, userId: string, name: string, exceptId?: string): Promise<void> {
    const wanted = name.toLowerCase();
    const taken = (await repos.categories.list(userId)).some(
      (category) => category.id !== exceptId && category.name.toLowerCase() === wanted,
    );
    if (taken) throw new AppError(400, "validation", DUPLICATE_CATEGORY_MESSAGE, { name: DUPLICATE_CATEGORY_MESSAGE });
  }

  return {
    async list(userId: string): Promise<Category[]> {
      return (await store.categories.list(userId)).map(toCategory);
    },

    create(userId: string, input: CategoryInput): Promise<Category> {
      return store.transaction(async (repos) => {
        await refuseDuplicate(repos, userId, input.name);
        const createdAt = now();
        const record = await repos.categories.create({
          id: randomUUID(),
          userId,
          name: input.name,
          defaultLimitCents: input.defaultLimitCents,
          createdAt,
          updatedAt: createdAt,
        });
        if (input.applyToPeriods) await applyUsualLimit(repos, record, await periods.today(repos, userId), createdAt);
        return toCategory(record);
      });
    },

    update(userId: string, id: string, patch: CategoryPatch): Promise<Category> {
      return store.transaction(async (repos) => {
        const before = await repos.categories.findById(userId, id);
        if (!before) throw notFound();
        if (patch.name !== undefined) await refuseDuplicate(repos, userId, patch.name, id);

        const after: CategoryRecord = {
          ...before,
          name: patch.name ?? before.name,
          defaultLimitCents: patch.defaultLimitCents === undefined ? before.defaultLimitCents : patch.defaultLimitCents,
        };
        const { name, defaultLimitCents } = after;
        const updatedAt = now();
        await repos.categories.update(userId, id, { name, defaultLimitCents }, updatedAt);
        // Without this, only periods generated from now on get the new amount.
        if (patch.applyToPeriods) await applyUsualLimit(repos, after, await periods.today(repos, userId), updatedAt);
        return toCategory(after);
      });
    },

    /** Deletes the category and its limits. What was filed under it stays, filed under nothing. */
    remove(userId: string, id: string): Promise<void> {
      return store.transaction(async (repos) => {
        if (!(await repos.categories.findById(userId, id))) throw notFound();
        await repos.categories.delete(userId, id);
      });
    },
  };
}
