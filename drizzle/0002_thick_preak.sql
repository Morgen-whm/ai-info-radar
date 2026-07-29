CREATE TABLE `weekly_report_items` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`content_id` text NOT NULL,
	`rank` integer NOT NULL,
	`category` text NOT NULL,
	`score` real NOT NULL,
	`item_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_report_items_report_rank_idx` ON `weekly_report_items` (`report_id`,`rank`);--> statement-breakpoint
CREATE INDEX `weekly_report_items_content_idx` ON `weekly_report_items` (`content_id`);--> statement-breakpoint
CREATE TABLE `weekly_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`content_hash` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`stats_json` text DEFAULT '{}' NOT NULL,
	`generated_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `weekly_reports_period_idx` ON `weekly_reports` (`week_start`,`week_end`);--> statement-breakpoint
CREATE INDEX `weekly_reports_status_idx` ON `weekly_reports` (`status`);--> statement-breakpoint
CREATE INDEX `weekly_reports_generated_idx` ON `weekly_reports` (`generated_at`);