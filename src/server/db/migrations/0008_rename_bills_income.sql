ALTER TABLE `recurring_items` RENAME TO `bills_income`;--> statement-breakpoint
ALTER TABLE `transactions` RENAME COLUMN `recurring_id` TO `bill_income_id`;--> statement-breakpoint
DROP INDEX `recurring_items_user_id_idx`;--> statement-breakpoint
CREATE INDEX `bills_income_user_id_idx` ON `bills_income` (`user_id`);--> statement-breakpoint
DROP INDEX `transactions_recurring_occurrence_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_bill_income_occurrence_unique` ON `transactions` (`bill_income_id`,`occurrence_date`);
