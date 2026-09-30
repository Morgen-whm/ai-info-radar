CREATE TABLE `github_star_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`full_name` text NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`forks` integer DEFAULT 0 NOT NULL,
	`captured_date` text NOT NULL,
	`captured_at` text NOT NULL,
	`repository_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_snapshots_repo_date_idx` ON `github_star_snapshots` (`repository_id`,`captured_date`);--> statement-breakpoint
CREATE INDEX `github_snapshots_date_stars_idx` ON `github_star_snapshots` (`captured_date`,`stars`);--> statement-breakpoint
CREATE INDEX `github_snapshots_name_idx` ON `github_star_snapshots` (`full_name`);