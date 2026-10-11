CREATE TABLE `recurring_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`default_amount_cents` integer NOT NULL,
	`recurrence_unit` text NOT NULL,
	`recurrence_interval` integer DEFAULT 1 NOT NULL,
	`first_due_date` text NOT NULL,
	`end_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recurring_items_user_id_idx` ON `recurring_items` (`user_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_id` text REFERENCES recurring_items(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `transactions` ADD `occurrence_date` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_recurring_occurrence_unique` ON `transactions` (`recurring_id`,`occurrence_date`);