CREATE TABLE `deleted_import_keys` (
	`user_id` text NOT NULL,
	`import_key` text NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `import_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
