CREATE TABLE `content_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_tier` text DEFAULT 'B' NOT NULL,
	`template` text DEFAULT 'knowledge_card' NOT NULL,
	`source_snapshot_json` text DEFAULT '{}' NOT NULL,
	`ai_draft` text DEFAULT '' NOT NULL,
	`editor_title` text DEFAULT '' NOT NULL,
	`editor_content` text DEFAULT '' NOT NULL,
	`editor_note` text DEFAULT '' NOT NULL,
	`reviewer_name` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	`publication_status` text DEFAULT 'draft' NOT NULL,
	`feishu_document_id` text,
	`feishu_wiki_node_token` text,
	`feishu_url` text,
	`published_content_hash` text,
	`published_at` text,
	`publish_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_reviews_content_idx` ON `content_reviews` (`content_id`);--> statement-breakpoint
CREATE INDEX `content_reviews_status_idx` ON `content_reviews` (`status`);--> statement-breakpoint
CREATE INDEX `content_reviews_publication_idx` ON `content_reviews` (`publication_status`);--> statement-breakpoint
CREATE INDEX `content_reviews_updated_idx` ON `content_reviews` (`updated_at`);