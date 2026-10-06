ALTER TABLE `audit` ADD `last_op` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox` ADD `last_op` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD `last_op` text DEFAULT '' NOT NULL;