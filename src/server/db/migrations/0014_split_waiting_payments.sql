CREATE TABLE `split_waiting_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`split_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`occurs_at` text NOT NULL,
	`note` text,
	`bill_income_id` text,
	`category_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bill_income_id`) REFERENCES `bills_income`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `split_waiting_user_occurs_idx` ON `split_waiting_payments` (`user_id`,`occurs_at`);--> statement-breakpoint
CREATE INDEX `split_waiting_split_idx` ON `split_waiting_payments` (`split_id`);