CREATE TABLE `budget_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`anchor_date` text NOT NULL,
	`opening_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_schedules_user_id_unique` ON `budget_schedules` (`user_id`);--> statement-breakpoint
CREATE TABLE `periods` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`seq` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`nominal_start` text NOT NULL,
	`nominal_end` text NOT NULL,
	`starting_cents` integer NOT NULL,
	`starting_mode` text DEFAULT 'auto' NOT NULL,
	`carry_stale` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `budget_schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `periods_user_seq_unique` ON `periods` (`user_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `periods_user_start_unique` ON `periods` (`user_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `periods_user_end_idx` ON `periods` (`user_id`,`end_date`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
