CREATE TABLE `split_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`split_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`start_date` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`split_id`) REFERENCES `splits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `split_items_split_idx` ON `split_items` (`split_id`,`position`);--> statement-breakpoint
CREATE TABLE `splits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`bill_income_id` text,
	`category_id` text,
	`finish_early` integer DEFAULT false NOT NULL,
	`round_up` integer DEFAULT false NOT NULL,
	`skipped_seqs` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bill_income_id`) REFERENCES `bills_income`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `splits_user_idx` ON `splits` (`user_id`);--> statement-breakpoint
ALTER TABLE `split_waiting_payments` ADD `shares` text;--> statement-breakpoint
-- Written by hand: drizzle-kit leaves ON DELETE off a foreign key added to an existing table.
ALTER TABLE `transactions` ADD `split_id` text REFERENCES splits(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `transactions` ADD `split_shares` text;--> statement-breakpoint
CREATE INDEX `transactions_split_idx` ON `transactions` (`split_id`);--> statement-breakpoint
-- Written by hand: a row for each split made before this, which only had payments waiting.
-- It has no items, so it can't be added to or skipped; its waiting payments work as before.
INSERT INTO `splits` (`id`, `user_id`, `name`, `kind`, `note`, `bill_income_id`, `category_id`, `created_at`, `updated_at`)
SELECT `split_id`, MIN(`user_id`), MIN(`name`), CASE WHEN MIN(`amount_cents`) < 0 THEN 'expense' ELSE 'income' END,
  NULL, NULL, NULL, MIN(`created_at`), MIN(`created_at`)
FROM `split_waiting_payments` GROUP BY `split_id`;