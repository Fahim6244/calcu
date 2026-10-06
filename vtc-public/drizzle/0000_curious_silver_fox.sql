CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`metadata` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_report` ON `evidence` (`report_id`);--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`done` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_pending` ON `outbox` (`done`,`next_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`plate` text NOT NULL,
	`credential_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`category` text DEFAULT 'unknown' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`publication` text DEFAULT 'private' NOT NULL,
	`synced_revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_status_updated` ON `reports` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `reports_plate` ON `reports` (`plate`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`plate` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`expires` integer NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sheet_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`tab` text NOT NULL,
	`row` integer NOT NULL
);
