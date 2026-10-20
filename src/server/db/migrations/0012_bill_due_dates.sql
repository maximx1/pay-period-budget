ALTER TABLE `bills_income` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `bills_income` ADD `due_unit` text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE `bills_income` ADD `due_interval` integer DEFAULT 1 NOT NULL;