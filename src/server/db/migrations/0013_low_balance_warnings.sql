ALTER TABLE `user_settings` ADD `low_balance_cents` integer DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `low_balance_periods` integer DEFAULT 5 NOT NULL;