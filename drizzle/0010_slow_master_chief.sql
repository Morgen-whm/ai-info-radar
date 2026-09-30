CREATE TABLE `review_inbox_links` (
	`content_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`platform` text NOT NULL,
	`author_name` text DEFAULT '' NOT NULL,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `review_inbox_links_added_idx` ON `review_inbox_links` (`added_at`);