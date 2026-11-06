CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`primary_muscles` text NOT NULL,
	`secondary_muscles` text NOT NULL,
	`equipment` text NOT NULL,
	`load` text NOT NULL,
	`instructions` text NOT NULL,
	`tips` text NOT NULL,
	`image_url` text,
	`video_url` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_exercises_session_idx` ON `workout_exercises` (`session_id`);--> statement-breakpoint
CREATE INDEX `workout_exercises_exercise_idx` ON `workout_exercises` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`note` text,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `workout_sessions_user_started_idx` ON `workout_sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`kg` real,
	`reps` integer,
	`is_warmup` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`workout_exercise_id`) REFERENCES `workout_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_sets_exercise_idx` ON `workout_sets` (`workout_exercise_id`);