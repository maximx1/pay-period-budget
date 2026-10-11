CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`occurs_at` text NOT NULL,
	`status` text NOT NULL,
	`paid_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transactions_user_occurs_idx` ON `transactions` (`user_id`,`occurs_at`);