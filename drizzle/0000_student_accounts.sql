CREATE TABLE `student_accounts` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`study_group` text DEFAULT '' NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "student_accounts_revision_positive" CHECK("student_accounts"."revision" >= 1)
);
