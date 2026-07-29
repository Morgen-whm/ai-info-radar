CREATE TABLE `api_usage_daily` (
	`date` text NOT NULL,
	`provider` text NOT NULL,
	`route` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`successes` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_day_route_idx` ON `api_usage_daily` (`date`,`provider`,`route`);--> statement-breakpoint
CREATE TABLE `collection_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`platform` text NOT NULL,
	`status` text NOT NULL,
	`items_found` integer DEFAULT 0 NOT NULL,
	`items_added` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`error_message` text,
	`request_id` text,
	`billable` integer DEFAULT false NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `jobs_started_idx` ON `collection_jobs` (`started_at`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `collection_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`source_id` text NOT NULL,
	`content_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`author_name` text DEFAULT '' NOT NULL,
	`author_handle` text,
	`published_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`hot_score` real DEFAULT 0 NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`ai_summary` text,
	`summary_status` text DEFAULT 'pending' NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contents_platform_external_idx` ON `contents` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `contents_published_idx` ON `contents` (`published_at`);--> statement-breakpoint
CREATE INDEX `contents_hot_score_idx` ON `contents` (`hot_score`);--> statement-breakpoint
CREATE INDEX `contents_source_idx` ON `contents` (`source_id`);--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`metrics_json` text NOT NULL,
	`hot_score` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_content_time_idx` ON `metric_snapshots` (`content_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`interval_minutes` integer DEFAULT 15 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'healthy' NOT NULL,
	`last_synced_at` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_platform_idx` ON `sources` (`platform`);--> statement-breakpoint
CREATE INDEX `sources_enabled_idx` ON `sources` (`enabled`);