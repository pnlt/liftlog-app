CREATE TABLE `sync_accounts` (
	`owner` text PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`imported` integer DEFAULT 0 NOT NULL,
	`bootstrapped` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE TABLE `sync_entities` (
	`owner` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`local_revision` integer DEFAULT 0 NOT NULL,
	`server_version` integer DEFAULT 0 NOT NULL,
	`local_json` text NOT NULL,
	`server_json` text,
	PRIMARY KEY(`owner`, `entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mutation_id` text NOT NULL,
	`owner` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`local_revision` integer NOT NULL,
	`predecessor_id` text,
	`base_version` integer,
	`operation` text NOT NULL,
	`payload_json` text NOT NULL,
	`body_json` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_outbox_mutation_id_unique` ON `sync_outbox` (`mutation_id`);--> statement-breakpoint
CREATE INDEX `sync_outbox_owner_entity_idx` ON `sync_outbox` (`owner`,`entity_type`,`entity_id`);--> statement-breakpoint
ALTER TABLE `workout_exercises` ADD `exercise_name` text;--> statement-breakpoint
ALTER TABLE `workout_exercises` ADD `exercise_load` text;