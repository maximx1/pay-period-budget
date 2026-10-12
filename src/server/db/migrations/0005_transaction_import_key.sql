ALTER TABLE `transactions` ADD `import_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_import_key_unique` ON `transactions` (`user_id`,`import_key`);