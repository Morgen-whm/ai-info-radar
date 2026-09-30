CREATE TABLE `rewrite_candidates` (
	`content_id` text PRIMARY KEY NOT NULL,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rewrite_candidates_added_idx` ON `rewrite_candidates` (`added_at`);