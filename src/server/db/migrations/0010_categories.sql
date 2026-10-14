CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`default_limit_cents` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_name_unique` ON `categories` (`user_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `period_category_limits` (
	`period_id` text NOT NULL,
	`category_id` text NOT NULL,
	`user_id` text NOT NULL,
	`limit_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`period_id`, `category_id`),
	FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `period_category_limits_category_idx` ON `period_category_limits` (`category_id`);--> statement-breakpoint
ALTER TABLE `bills_income` ADD `category_id` text REFERENCES `categories`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_id` text REFERENCES `categories`(`id`) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);