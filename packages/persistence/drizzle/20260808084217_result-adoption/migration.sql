CREATE TABLE `artifact_application_event` (
	`id` text PRIMARY KEY,
	`application_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`repository_revision_id` text,
	`reason_code` text,
	`detail` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_artifact_application_event_application_id_artifact_application_id_fk` FOREIGN KEY (`application_id`) REFERENCES `artifact_application`(`id`),
	CONSTRAINT `artifact_application_event_sequence` UNIQUE(`application_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `artifact_application` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL CONSTRAINT `artifact_application_task` UNIQUE,
	`evaluation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`execution_request_id` text NOT NULL,
	`artifact_id` text NOT NULL CONSTRAINT `artifact_application_artifact` UNIQUE,
	`base_baseline_id` text NOT NULL,
	`base_repository_revision_id` text NOT NULL,
	`patch_hash` text NOT NULL,
	`authorized_at` text NOT NULL,
	CONSTRAINT `fk_artifact_application_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_artifact_application_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `fk_artifact_application_evaluation_id_acceptance_evaluation_id_fk` FOREIGN KEY (`evaluation_id`) REFERENCES `acceptance_evaluation`(`id`),
	CONSTRAINT `fk_artifact_application_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`),
	CONSTRAINT `fk_artifact_application_artifact_id_artifact_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`),
	CONSTRAINT `fk_artifact_application_base_baseline_id_project_baseline_id_fk` FOREIGN KEY (`base_baseline_id`) REFERENCES `project_baseline`(`id`)
);
--> statement-breakpoint
CREATE TABLE `baseline_candidate_source` (
	`baseline_id` text PRIMARY KEY,
	`parent_baseline_id` text NOT NULL,
	`task_id` text NOT NULL,
	`artifact_application_id` text NOT NULL CONSTRAINT `baseline_candidate_source_application` UNIQUE,
	CONSTRAINT `fk_baseline_candidate_source_baseline_id_project_baseline_id_fk` FOREIGN KEY (`baseline_id`) REFERENCES `project_baseline`(`id`),
	CONSTRAINT `fk_baseline_candidate_source_parent_baseline_id_project_baseline_id_fk` FOREIGN KEY (`parent_baseline_id`) REFERENCES `project_baseline`(`id`),
	CONSTRAINT `fk_baseline_candidate_source_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `fk_baseline_candidate_source_artifact_application_id_artifact_application_id_fk` FOREIGN KEY (`artifact_application_id`) REFERENCES `artifact_application`(`id`)
);
