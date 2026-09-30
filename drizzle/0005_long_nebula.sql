CREATE TABLE `knowledge_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`slug` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`body_markdown` text NOT NULL,
	`source_snapshot_json` text DEFAULT '{}' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`published_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_articles_content_idx` ON `knowledge_articles` (`content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_articles_slug_idx` ON `knowledge_articles` (`slug`);--> statement-breakpoint
CREATE INDEX `knowledge_articles_category_idx` ON `knowledge_articles` (`category`);--> statement-breakpoint
CREATE INDEX `knowledge_articles_status_date_idx` ON `knowledge_articles` (`status`,`published_at`);--> statement-breakpoint
ALTER TABLE `content_reviews` ADD `knowledge_category` text DEFAULT 'overseas_practice' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_reviews` ADD `site_publication_status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_reviews` ADD `knowledge_article_id` text;--> statement-breakpoint
ALTER TABLE `content_reviews` ADD `site_url` text;--> statement-breakpoint
ALTER TABLE `content_reviews` ADD `site_published_at` text;--> statement-breakpoint
ALTER TABLE `content_reviews` ADD `site_publish_error` text;--> statement-breakpoint
CREATE INDEX `content_reviews_site_publication_idx` ON `content_reviews` (`site_publication_status`);