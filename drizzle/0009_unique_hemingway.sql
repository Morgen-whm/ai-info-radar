CREATE TABLE `rewrite_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '等待开始' NOT NULL,
	`profile_id` text NOT NULL,
	`profile_version` text NOT NULL,
	`template` text DEFAULT 'knowledge_card' NOT NULL,
	`knowledge_category` text DEFAULT 'overseas_practice' NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rewrite_jobs_content_idx` ON `rewrite_jobs` (`content_id`);--> statement-breakpoint
CREATE INDEX `rewrite_jobs_status_updated_idx` ON `rewrite_jobs` (`status`,`updated_at`);