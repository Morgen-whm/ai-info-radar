CREATE TABLE `wechat_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`data_base64` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wechat_drafts` (
	`content_id` text PRIMARY KEY NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`operation` text DEFAULT '' NOT NULL,
	`operation_token` text DEFAULT '' NOT NULL,
	`operation_started_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wechat_sync_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`media_id` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wechat_logs_content_time_idx` ON `wechat_sync_logs` (`content_id`,`created_at`);