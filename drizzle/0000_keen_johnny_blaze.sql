CREATE TABLE `garage_saves` (
	`code` text PRIMARY KEY NOT NULL,
	`car_tier` text NOT NULL,
	`parts_json` text NOT NULL,
	`tickets` integer DEFAULT 0 NOT NULL,
	`challenge_tier` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
