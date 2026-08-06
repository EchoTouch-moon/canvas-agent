CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_audit_log_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
CREATE TABLE `baseline_item` (
	`id` text PRIMARY KEY,
	`baseline_id` text NOT NULL,
	`node_version_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `fk_baseline_item_baseline_id_project_baseline_id_fk` FOREIGN KEY (`baseline_id`) REFERENCES `project_baseline`(`id`),
	CONSTRAINT `fk_baseline_item_node_version_id_node_version_id_fk` FOREIGN KEY (`node_version_id`) REFERENCES `node_version`(`id`),
	CONSTRAINT `baseline_item_position` UNIQUE(`baseline_id`,`position`),
	CONSTRAINT `baseline_item_node_version` UNIQUE(`baseline_id`,`node_version_id`)
);
--> statement-breakpoint
CREATE TABLE `project_baseline` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`repository_revision_id` text,
	`activated_at` text,
	`superseded_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_project_baseline_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_project_baseline_repository_revision_id_repository_revision_id_fk` FOREIGN KEY (`repository_revision_id`) REFERENCES `repository_revision`(`id`)
);
--> statement-breakpoint
CREATE TABLE `content_blob` (
	`id` text PRIMARY KEY,
	`size_bytes` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `context_snapshot_item` (
	`id` text PRIMARY KEY,
	`context_snapshot_id` text NOT NULL,
	`position` integer NOT NULL,
	`item_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`resolved_content` text NOT NULL,
	`content_hash` text NOT NULL,
	`selection_reason` text,
	`authority` text NOT NULL,
	`priority` text DEFAULT 'P2' NOT NULL,
	`token_estimate` integer NOT NULL,
	`blob_id` text,
	CONSTRAINT `fk_context_snapshot_item_context_snapshot_id_context_snapshot_id_fk` FOREIGN KEY (`context_snapshot_id`) REFERENCES `context_snapshot`(`id`),
	CONSTRAINT `fk_context_snapshot_item_blob_id_content_blob_id_fk` FOREIGN KEY (`blob_id`) REFERENCES `content_blob`(`id`),
	CONSTRAINT `context_snapshot_item_position` UNIQUE(`context_snapshot_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `context_snapshot` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_spec_version_id` text NOT NULL,
	`base_baseline_id` text NOT NULL,
	`expected_repository_revision_id` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`freshness` text DEFAULT 'CURRENT' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_context_snapshot_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_context_snapshot_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `fk_context_snapshot_task_spec_version_id_task_spec_version_id_fk` FOREIGN KEY (`task_spec_version_id`) REFERENCES `task_spec_version`(`id`),
	CONSTRAINT `fk_context_snapshot_base_baseline_id_project_baseline_id_fk` FOREIGN KEY (`base_baseline_id`) REFERENCES `project_baseline`(`id`),
	CONSTRAINT `fk_context_snapshot_expected_repository_revision_id_repository_revision_id_fk` FOREIGN KEY (`expected_repository_revision_id`) REFERENCES `repository_revision`(`id`)
);
--> statement-breakpoint
CREATE TABLE `edge` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`anchored_node_version_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_edge_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_edge_source_node_id_node_id_fk` FOREIGN KEY (`source_node_id`) REFERENCES `node`(`id`),
	CONSTRAINT `fk_edge_target_node_id_node_id_fk` FOREIGN KEY (`target_node_id`) REFERENCES `node`(`id`),
	CONSTRAINT `fk_edge_anchored_node_version_id_node_version_id_fk` FOREIGN KEY (`anchored_node_version_id`) REFERENCES `node_version`(`id`),
	CONSTRAINT "edge_no_self_link" CHECK("source_node_id" <> "target_node_id")
);
--> statement-breakpoint
CREATE TABLE `node_draft` (
	`id` text PRIMARY KEY,
	`node_id` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_node_draft_node_id_node_id_fk` FOREIGN KEY (`node_id`) REFERENCES `node`(`id`)
);
--> statement-breakpoint
CREATE TABLE `node` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`lifecycle` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_node_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
CREATE TABLE `node_version` (
	`id` text PRIMARY KEY,
	`node_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_node_version_node_id_node_id_fk` FOREIGN KEY (`node_id`) REFERENCES `node`(`id`),
	CONSTRAINT `node_version_node_sequence` UNIQUE(`node_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repository_revision` (
	`id` text PRIMARY KEY,
	`base_commit` text NOT NULL,
	`tree_hash` text NOT NULL,
	`working_tree_patch_hash` text,
	`created_at` text NOT NULL,
	CONSTRAINT `repository_revision_unique` UNIQUE(`base_commit`,`tree_hash`,`working_tree_patch_hash`)
);
--> statement-breakpoint
CREATE TABLE `acceptance_criterion` (
	`id` text PRIMARY KEY,
	`task_spec_version_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`verification_method` text DEFAULT 'MANUAL_REVIEW' NOT NULL,
	CONSTRAINT `fk_acceptance_criterion_task_spec_version_id_task_spec_version_id_fk` FOREIGN KEY (`task_spec_version_id`) REFERENCES `task_spec_version`(`id`),
	CONSTRAINT `acceptance_criterion_position` UNIQUE(`task_spec_version_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `task_dependency` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_task_dependency_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_task_dependency_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `fk_task_dependency_depends_on_task_id_task_id_fk` FOREIGN KEY (`depends_on_task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `task_dependency_pair` UNIQUE(`task_id`,`depends_on_task_id`),
	CONSTRAINT "task_dependency_no_self" CHECK("task_id" <> "depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE `task_draft` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL UNIQUE,
	`description` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_task_draft_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_spec_version` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`description` text NOT NULL,
	`scope` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_task_spec_version_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`),
	CONSTRAINT `task_spec_version_task_sequence` UNIQUE(`task_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_task_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_target` (
	`id` text PRIMARY KEY,
	`task_spec_version_id` text NOT NULL,
	`node_id` text,
	`node_version_id` text,
	`position` integer NOT NULL,
	CONSTRAINT `fk_task_target_task_spec_version_id_task_spec_version_id_fk` FOREIGN KEY (`task_spec_version_id`) REFERENCES `task_spec_version`(`id`),
	CONSTRAINT `fk_task_target_node_id_node_id_fk` FOREIGN KEY (`node_id`) REFERENCES `node`(`id`),
	CONSTRAINT `fk_task_target_node_version_id_node_version_id_fk` FOREIGN KEY (`node_version_id`) REFERENCES `node_version`(`id`),
	CONSTRAINT `task_target_position` UNIQUE(`task_spec_version_id`,`position`),
	CONSTRAINT "task_target_has_reference" CHECK(("node_id" IS NOT NULL OR "node_version_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_baseline_one_active` ON `project_baseline` (`project_id`) WHERE "project_baseline"."status" = 'ACTIVE';