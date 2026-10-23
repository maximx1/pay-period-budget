CREATE TABLE `balance_check_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bill_income_id` text NOT NULL,
	`check_id` text NOT NULL,
	`part_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`apr_bps` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bill_income_id`) REFERENCES `bills_income`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`check_id`) REFERENCES `balance_checks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_check_parts_check_part_unique` ON `balance_check_parts` (`check_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `balance_check_parts_item_idx` ON `balance_check_parts` (`bill_income_id`);