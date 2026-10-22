CREATE TABLE `balance_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bill_income_id` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`apr_bps` integer,
	`as_of` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bill_income_id`) REFERENCES `bills_income`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `balance_checks_item_as_of_idx` ON `balance_checks` (`bill_income_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `tracked_balances` (
	`bill_income_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`check_every_days` integer,
	`next_check_on` text NOT NULL,
	`handled_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bill_income_id`) REFERENCES `bills_income`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracked_balances_user_idx` ON `tracked_balances` (`user_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `balance_check_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `balance_checks_per_day` integer DEFAULT 3 NOT NULL;