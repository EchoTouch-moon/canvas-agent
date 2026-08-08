CREATE TABLE `artifact` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`execution_request_id` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_artifact_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`),
	CONSTRAINT `fk_artifact_execution_request_id_execution_request_record_execution_request_id_fk` FOREIGN KEY (`execution_request_id`) REFERENCES `execution_request_record`(`execution_request_id`),
	CONSTRAINT `artifact_request_position` UNIQUE(`execution_request_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `execution_request_record` (
	`execution_request_id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`worker_attempt_number` integer NOT NULL,
	`checkpoint_id` text,
	`request_hash` text NOT NULL,
	`schema_version` integer NOT NULL,
	`request_json` text NOT NULL,
	`dispatch_outcome` text,
	`claim_granted` integer,
	`rejection_reason` text,
	`revision_mismatch_field` text,
	`revision_mismatch_expected` text,
	`revision_mismatch_actual` text,
	`patch_hash` text,
	`timed_out` integer,
	`recovery_json` text,
	`dispatched_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT `fk_execution_request_record_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`)
);
--> statement-breakpoint
CREATE TABLE `run_event` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_run_event_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`),
	CONSTRAINT `run_event_run_sequence` UNIQUE(`run_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_spec_version_id` text NOT NULL,
	`context_snapshot_id` text NOT NULL,
	`repository_revision_id` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_run_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_run_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `fk_run_task_spec_version_id_task_spec_version_id_fk` FOREIGN KEY (`task_spec_version_id`) REFERENCES `task_spec_version`(`id`),
	CONSTRAINT `fk_run_context_snapshot_id_context_snapshot_id_fk` FOREIGN KEY (`context_snapshot_id`) REFERENCES `context_snapshot`(`id`),
	CONSTRAINT `fk_run_repository_revision_id_repository_revision_id_fk` FOREIGN KEY (`repository_revision_id`) REFERENCES `repository_revision`(`id`)
);
