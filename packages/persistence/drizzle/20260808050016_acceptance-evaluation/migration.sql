CREATE TABLE `acceptance_evaluation_item` (
	`id` text PRIMARY KEY,
	`evaluation_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`verdict` text NOT NULL,
	`note` text,
	`position` integer NOT NULL,
	CONSTRAINT `fk_acceptance_evaluation_item_evaluation_id_acceptance_evaluation_id_fk` FOREIGN KEY (`evaluation_id`) REFERENCES `acceptance_evaluation`(`id`),
	CONSTRAINT `fk_acceptance_evaluation_item_criterion_id_acceptance_criterion_id_fk` FOREIGN KEY (`criterion_id`) REFERENCES `acceptance_criterion`(`id`),
	CONSTRAINT `acceptance_item_evaluation_criterion` UNIQUE(`evaluation_id`,`criterion_id`),
	CONSTRAINT `acceptance_item_evaluation_position` UNIQUE(`evaluation_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `acceptance_evaluation` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_spec_version_id` text NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_acceptance_evaluation_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_acceptance_evaluation_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `fk_acceptance_evaluation_task_spec_version_id_task_spec_version_id_fk` FOREIGN KEY (`task_spec_version_id`) REFERENCES `task_spec_version`(`id`),
	CONSTRAINT `fk_acceptance_evaluation_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`),
	CONSTRAINT `acceptance_evaluation_task_sequence` UNIQUE(`task_id`,`sequence`)
);
--> statement-breakpoint
UPDATE task SET status = 'READY'
WHERE status = 'DRAFT'
  AND EXISTS (SELECT 1 FROM task_spec_version WHERE task_spec_version.task_id = task.id);
