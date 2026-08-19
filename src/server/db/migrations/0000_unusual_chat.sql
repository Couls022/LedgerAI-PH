CREATE TABLE `accounting_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`fiscal_year` integer NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`soft_closed_at` integer,
	`soft_closed_by` text,
	`hard_closed_at` integer,
	`hard_closed_by` text,
	`reopened_at` integer,
	`reopened_by` text,
	`reopen_reason` text,
	`closed_at` integer,
	`closed_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`soft_closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hard_closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`account_code` text NOT NULL,
	`account_name` text NOT NULL,
	`account_type` text NOT NULL,
	`detail_type` text,
	`parent_account_id` text,
	`normal_balance` text NOT NULL,
	`description` text,
	`is_sub_account` integer DEFAULT false NOT NULL,
	`bir_tax_category` text,
	`opening_balance` real DEFAULT 0,
	`as_of_date` text,
	`is_control_account` integer DEFAULT false NOT NULL,
	`is_cash_account` integer DEFAULT false NOT NULL,
	`is_tax_account` integer DEFAULT false NOT NULL,
	`is_retained_earnings` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_company_id_account_code_unique` ON `accounts` (`company_id`,`account_code`);--> statement-breakpoint
CREATE TABLE `ai_execution_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_role` text,
	`skill_id` text NOT NULL,
	`skill_version` text DEFAULT 'v1' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`risk_level` text DEFAULT 'READ_ONLY' NOT NULL,
	`input_summary` text,
	`output_summary` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `approval_workflow_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`action_type` text NOT NULL,
	`amount_php` integer DEFAULT 0 NOT NULL,
	`maker_user_id` text NOT NULL,
	`checker_user_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`details` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`maker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `atc_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`income_type` text NOT NULL,
	`tax_rate` real NOT NULL,
	`taxpayer_classification` text DEFAULT 'ALL' NOT NULL,
	`form_reference` text DEFAULT '2307 / 1601EQ' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`source_metadata` text DEFAULT 'BIR RR No. 2-98 as amended by RR No. 11-2018' NOT NULL,
	`effective_date` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atc_definitions_code_unique` ON `atc_definitions` (`code`);--> statement-breakpoint
CREATE TABLE `audit_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`adjustment_type` text DEFAULT 'PROPOSED' NOT NULL,
	`classification` text DEFAULT 'FSD' NOT NULL,
	`affected_accounts_json` text NOT NULL,
	`financial_effect` text,
	`management_response` text,
	`approval_status` text DEFAULT 'PENDING' NOT NULL,
	`approved_by` text,
	`journal_entry_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_engagement_items` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`item_category` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`assigned_to` text,
	`due_date` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_engagement_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_engagements` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`client_company_id` text NOT NULL,
	`engagement_name` text NOT NULL,
	`audit_period` text NOT NULL,
	`engagement_type` text NOT NULL,
	`status` text DEFAULT 'PLANNING' NOT NULL,
	`materiality` integer DEFAULT 0 NOT NULL,
	`performance_materiality` integer DEFAULT 0 NOT NULL,
	`trivial_threshold` integer DEFAULT 0 NOT NULL,
	`team_members` text,
	`preparer_id` text,
	`reviewer_id` text,
	`partner_id` text,
	`fieldwork_deadline` text,
	`sign_off_deadline` text,
	`report_deadline` text,
	`notes` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preparer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`title` text NOT NULL,
	`risk_rating` text DEFAULT 'MEDIUM' NOT NULL,
	`criteria` text,
	`condition` text,
	`cause` text,
	`effect` text,
	`recommendation` text,
	`management_response` text,
	`owner_id` text,
	`target_date` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`evidence_ids` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`user_id` text,
	`user_email` text,
	`user_display_name` text,
	`role` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text,
	`record_reference` text,
	`timestamp` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`before_data` text,
	`after_data` text,
	`changed_fields` text,
	`reason` text,
	`result` text DEFAULT 'SUCCESS' NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`request_id` text,
	`source` text DEFAULT 'WEB_UI' NOT NULL,
	`module` text,
	`severity` text DEFAULT 'INFO' NOT NULL,
	`metadata` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_planning_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`entity_understanding` text,
	`business_processes` text,
	`audit_strategy` text,
	`audit_plan` text,
	`sampling_plan` text,
	`materiality_notes` text,
	`preparer_id` text,
	`reviewer_id` text,
	`partner_id` text,
	`preparer_signed_at` integer,
	`reviewer_signed_at` integer,
	`partner_signed_at` integer,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preparer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_planning_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_risks_and_procedures` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`risk_description` text NOT NULL,
	`risk_type` text NOT NULL,
	`assertion_linked` text NOT NULL,
	`audit_procedure` text NOT NULL,
	`assigned_to` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_significant_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`account_name` text NOT NULL,
	`account_balance` integer DEFAULT 0 NOT NULL,
	`is_significant` integer DEFAULT true NOT NULL,
	`assertions` text NOT NULL,
	`inherent_risk` text DEFAULT 'MEDIUM' NOT NULL,
	`control_risk` text DEFAULT 'MEDIUM' NOT NULL,
	`fraud_risk` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_workpaper_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workpaper_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workpaper_id`) REFERENCES `audit_workpapers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_workpapers` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`wp_ref` text NOT NULL,
	`title` text NOT NULL,
	`objective` text,
	`procedure` text,
	`population` text,
	`sample` text,
	`evidence_links` text,
	`result` text,
	`exception` text,
	`conclusion` text,
	`preparer_id` text,
	`prepared_date` text,
	`reviewer_id` text,
	`review_date` text,
	`review_notes` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `audit_engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preparer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `authority_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authority_users_username_unique` ON `authority_users` (`username`);--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`account_name` text NOT NULL,
	`bank_name` text NOT NULL,
	`account_number_encrypted` text NOT NULL,
	`currency` text DEFAULT 'PHP' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_deposits` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`deposit_number` text NOT NULL,
	`deposit_date` text NOT NULL,
	`to_bank_account_id` text NOT NULL,
	`from_cash_account_id` text NOT NULL,
	`total_amount` integer NOT NULL,
	`reference` text,
	`notes` text,
	`attachment_url` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_bank_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_cash_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_reconciliation_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_reconciliation_id` text NOT NULL,
	`company_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`offset_account_id` text NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`adjustment_date` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`bank_reconciliation_id`) REFERENCES `bank_reconciliations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offset_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_reconciliation_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bank_transaction_id` text NOT NULL,
	`matched_record_type` text NOT NULL,
	`matched_record_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_transaction_id`) REFERENCES `bank_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`statement_date` text NOT NULL,
	`statement_ending_balance` integer NOT NULL,
	`book_ending_balance` integer DEFAULT 0 NOT NULL,
	`cleared_deposits_count` integer DEFAULT 0 NOT NULL,
	`cleared_deposits_amount` integer DEFAULT 0 NOT NULL,
	`cleared_checks_count` integer DEFAULT 0 NOT NULL,
	`cleared_checks_amount` integer DEFAULT 0 NOT NULL,
	`outstanding_checks_count` integer DEFAULT 0 NOT NULL,
	`outstanding_checks_amount` integer DEFAULT 0 NOT NULL,
	`deposits_in_transit_count` integer DEFAULT 0 NOT NULL,
	`deposits_in_transit_amount` integer DEFAULT 0 NOT NULL,
	`bank_charges_amount` integer DEFAULT 0 NOT NULL,
	`interest_income_amount` integer DEFAULT 0 NOT NULL,
	`other_adjustments_amount` integer DEFAULT 0 NOT NULL,
	`adjusted_book_balance` integer DEFAULT 0 NOT NULL,
	`adjusted_statement_balance` integer DEFAULT 0 NOT NULL,
	`unexplained_difference` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`reopen_reason` text,
	`journal_entry_id` text,
	`notes` text,
	`attachment_url` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`reopened_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_statement_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_reconciliation_id` text NOT NULL,
	`company_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`line_date` text NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`matched_status` text DEFAULT 'UNMATCHED' NOT NULL,
	`matched_type` text,
	`matched_entity_id` text,
	`matched_amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`bank_reconciliation_id`) REFERENCES `bank_reconciliations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`statement_date` integer NOT NULL,
	`start_date` integer,
	`end_date` integer,
	`filename` text,
	`status` text DEFAULT 'IMPORTED' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bank_statement_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`transaction_date` integer NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`matched_status` text DEFAULT 'UNMATCHED' NOT NULL,
	`matched_journal_id` text,
	`matched_payment_id` text,
	`match_confidence` real,
	`match_reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_statement_id`) REFERENCES `bank_statements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `banks` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`bank_name` text NOT NULL,
	`branch` text,
	`account_number` text,
	`account_type` text,
	`currency` text DEFAULT 'PHP' NOT NULL,
	`gl_account_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gl_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `banks_company_id_code_unique` ON `banks` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `bir_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`issuance_number` text NOT NULL,
	`title` text NOT NULL,
	`issuance_type` text NOT NULL,
	`publication_date` integer,
	`effective_date` integer,
	`source_url` text,
	`status` text DEFAULT 'PENDING_VALIDATION',
	`version` integer DEFAULT 1,
	`affected_tax_area` text,
	`content_summary` text,
	`imported_date` integer NOT NULL,
	`verified_date` integer
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`period_month` text NOT NULL,
	`category` text NOT NULL,
	`monthly_limit` integer NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cash_advances` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_name` text NOT NULL,
	`advance_date` text NOT NULL,
	`amount` integer NOT NULL,
	`liquidated_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'UNLIQUIDATED' NOT NULL,
	`disbursement_transaction_id` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`disbursement_transaction_id`) REFERENCES `cash_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cash_count_denominations` (
	`id` text PRIMARY KEY NOT NULL,
	`cash_count_id` text NOT NULL,
	`denomination_label` text NOT NULL,
	`unit_value` integer NOT NULL,
	`count_quantity` integer NOT NULL,
	`total_amount` integer NOT NULL,
	FOREIGN KEY (`cash_count_id`) REFERENCES `cash_counts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cash_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`count_number` text NOT NULL,
	`count_date` text NOT NULL,
	`cash_account_id` text NOT NULL,
	`custodian_name` text NOT NULL,
	`book_balance` integer NOT NULL,
	`counted_balance` integer NOT NULL,
	`variance_amount` integer NOT NULL,
	`variance_account_id` text,
	`notes` text,
	`attachment_url` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variance_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cash_flow_forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`forecast_date` integer NOT NULL,
	`horizon_days` integer NOT NULL,
	`scenario` text DEFAULT 'BASE' NOT NULL,
	`opening_balance` real NOT NULL,
	`projected_inflows` real NOT NULL,
	`projected_outflows` real NOT NULL,
	`closing_balance` real NOT NULL,
	`details_json` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cash_transaction_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`cash_transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`tax_code_id` text,
	`amount` integer NOT NULL,
	`description` text,
	FOREIGN KEY (`cash_transaction_id`) REFERENCES `cash_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cash_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`transaction_number` text NOT NULL,
	`type` text NOT NULL,
	`transaction_date` text NOT NULL,
	`cash_account_id` text NOT NULL,
	`total_amount` integer NOT NULL,
	`reference` text,
	`description` text,
	`attachment_url` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `checks` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`check_number` text NOT NULL,
	`check_date` text NOT NULL,
	`payee_name` text NOT NULL,
	`cash_account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`voucher_number` text,
	`status` text DEFAULT 'ISSUED' NOT NULL,
	`cleared_date` text,
	`cancellation_reason` text,
	`cancellation_journal_entry_id` text,
	`attachment_url` text,
	`notes` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancellation_journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text,
	`tin` text,
	`address` text,
	`branch_code` text DEFAULT '00000',
	`contact_person` text,
	`contact_email` text,
	`contact_phone` text,
	`industry` text,
	`fiscal_year` integer DEFAULT 2026,
	`fiscal_year_start_month` integer DEFAULT 1 NOT NULL,
	`currency` text DEFAULT 'PHP' NOT NULL,
	`timezone` text DEFAULT 'Asia/Manila' NOT NULL,
	`accounting_method` text DEFAULT 'ACCRUAL',
	`taxpayer_classification` text,
	`taxpayer_type` text,
	`vat_status` text,
	`rdo_code` text,
	`bir_registration_no` text,
	`bir_date_registered` text,
	`document_location_path` text,
	`backup_location_path` text,
	`lock_date` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`primary_provider` text DEFAULT 'gemini' NOT NULL,
	`fallback_provider` text DEFAULT 'local' NOT NULL,
	`primary_key_id` text,
	`secondary_key_id` text,
	`gemini_api_key` text,
	`openai_api_key` text,
	`grok_api_key` text,
	`custom_keys_json` text,
	`daily_limit` integer DEFAULT 100,
	`monthly_limit` integer DEFAULT 1000,
	`enabled` integer DEFAULT true,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company_branding` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`logo_url` text,
	`brand_color` text DEFAULT '#1e1b4b',
	`secondary_color` text DEFAULT '#4f46e5',
	`header_title` text DEFAULT 'Official Billing Statement & BIR Tax Invoice',
	`footer_note` text DEFAULT 'Thank you for your business! Payment terms: Net 30 days. Please issue checks to company legal name.',
	`company_address` text,
	`contact_phone` text,
	`contact_email` text,
	`website` text,
	`tin_number` text,
	`show_logo` integer DEFAULT true,
	`show_watermark` integer DEFAULT true,
	`custom_terms` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_branding_company_id_unique` ON `company_branding` (`company_id`);--> statement-breakpoint
CREATE TABLE `company_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_category` text DEFAULT 'GENERAL' NOT NULL,
	`file_tags` text,
	`file_hash` text NOT NULL,
	`file_size` integer DEFAULT 0 NOT NULL,
	`mime_type` text,
	`file_url` text NOT NULL,
	`extracted_text` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`retention_until` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company_licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`license_key` text NOT NULL,
	`plan_type` text DEFAULT 'TRIAL' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`trial_start_date` text NOT NULL,
	`expiration_date` text NOT NULL,
	`device_binding_hash` text,
	`signed_file_content` text NOT NULL,
	`is_lifetime` integer DEFAULT false NOT NULL,
	`previous_license_id` text,
	`replacement_reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company_tax_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`taxpayer_classification` text,
	`vat_status` text,
	`tax_types` text,
	`tin` text,
	`rdo` text,
	`accounting_period` text,
	`filing_frequency` text,
	`registration_information` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company_user_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`company_user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_user_id`) REFERENCES `company_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_user_roles_company_user_id_role_id_unique` ON `company_user_roles` (`company_user_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `company_users` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text,
	`legacy_role` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_users_company_id_user_id_unique` ON `company_users` (`company_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `cost_centers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`department_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_centers_company_id_code_unique` ON `cost_centers` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `credit_memo_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_memo_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`credit_memo_id`) REFERENCES `credit_memos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `credit_memo_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_memo_id` text NOT NULL,
	`account_id` text NOT NULL,
	`tax_code_id` text,
	`description` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`credit_memo_id`) REFERENCES `credit_memos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `credit_memos` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`credit_memo_number` text NOT NULL,
	`memo_date` text NOT NULL,
	`reason` text,
	`total_amount` integer NOT NULL,
	`balance_remaining` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `currency_exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`rate_date` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`bsp_spot_rate` real NOT NULL,
	`source` text DEFAULT 'BSP' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer_payment_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`withholding_amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `customer_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`payment_number` text NOT NULL,
	`official_receipt_number` text,
	`payment_date` text NOT NULL,
	`cash_account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`withholding_tax_amount` integer DEFAULT 0 NOT NULL,
	`withholding_tax_account_id` text,
	`overpayment_amount` integer DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'BANK_TRANSFER' NOT NULL,
	`reference` text,
	`notes` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`withholding_tax_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text,
	`tin` text,
	`address` text,
	`billing_address` text,
	`shipping_address` text,
	`contact_person` text,
	`contact_details` text,
	`payment_terms` text,
	`credit_limit` integer,
	`tax_classification` text,
	`vat_status` text,
	`withholding_applicability` text,
	`default_receivable_account_id` text,
	`default_revenue_account_id` text,
	`notes` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_receivable_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_revenue_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_company_id_code_unique` ON `customers` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `debit_memo_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`debit_memo_id` text NOT NULL,
	`bill_id` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`debit_memo_id`) REFERENCES `debit_memos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `purchase_bills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `debit_memo_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`debit_memo_id` text NOT NULL,
	`account_id` text NOT NULL,
	`tax_code_id` text,
	`description` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`debit_memo_id`) REFERENCES `debit_memos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `debit_memos` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`debit_memo_number` text NOT NULL,
	`memo_date` text NOT NULL,
	`reason` text,
	`total_amount` integer NOT NULL,
	`balance_remaining` integer NOT NULL,
	`attachment_url` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`manager_name` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_company_id_code_unique` ON `departments` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `depreciation_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`company_id` text NOT NULL,
	`period_month` text NOT NULL,
	`depreciation_amount` integer NOT NULL,
	`accumulated_depreciation` integer NOT NULL,
	`book_value` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`journal_entry_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `fixed_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`document_type` text DEFAULT 'GENERAL_ATTACHMENT' NOT NULL,
	`file_name` text NOT NULL,
	`original_file_name` text,
	`file_type` text NOT NULL,
	`file_size` integer DEFAULT 0 NOT NULL,
	`file_hash` text,
	`file_path` text NOT NULL,
	`source` text DEFAULT 'WEB_UI' NOT NULL,
	`linked_transaction_type` text,
	`linked_transaction_id` text,
	`linked_vendor_id` text,
	`linked_customer_id` text,
	`uploaded_by` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`ocr_status` text DEFAULT 'PENDING',
	`verification_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`confidence_score` real,
	`ocr_result` text,
	`extracted_merchant` text,
	`extracted_customer` text,
	`extracted_tin` text,
	`extracted_address` text,
	`extracted_invoice_number` text,
	`extracted_date` text,
	`extracted_total_amount` integer,
	`extracted_vat_amount` integer,
	`extracted_vatable_sales` integer,
	`extracted_vat_exempt_sales` integer,
	`extracted_zero_rated_sales` integer,
	`extracted_withholding_tax` integer,
	`extracted_payment_method` text,
	`extracted_category` text,
	`validation_errors` text,
	`validation_warnings` text,
	`notes` text,
	`verified_by` text,
	`verified_at` integer,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `electronic_filing_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`filing_type` text NOT NULL,
	`reporting_period` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`adapter_provider` text DEFAULT 'OfficialBirAdapter' NOT NULL,
	`tax_rule_version` text DEFAULT '1.0',
	`atc_version` text DEFAULT '1.0',
	`artifact_checksum` text,
	`artifact_data_json` text,
	`signature_data_json` text,
	`external_reference` text,
	`receipt_reference` text,
	`error_code` text,
	`error_message` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`submitted_at` integer,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_no` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`tin` text,
	`sss_no` text,
	`philhealth_no` text,
	`pagibig_no` text,
	`position` text,
	`department` text,
	`monthly_basic_salary` integer NOT NULL,
	`daily_rate` integer DEFAULT 0 NOT NULL,
	`hourly_rate` integer DEFAULT 0 NOT NULL,
	`custom_sss_ee` integer DEFAULT 0,
	`custom_sss_er` integer DEFAULT 0,
	`custom_philhealth_ee` integer DEFAULT 0,
	`custom_philhealth_er` integer DEFAULT 0,
	`custom_pagibig_ee` integer DEFAULT 0,
	`custom_pagibig_er` integer DEFAULT 0,
	`custom_withholding_tax` integer DEFAULT 0,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fixed_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`asset_tag` text NOT NULL,
	`asset_name` text NOT NULL,
	`category` text NOT NULL,
	`acquisition_date` text NOT NULL,
	`acquisition_cost` integer NOT NULL,
	`salvage_value` integer DEFAULT 0 NOT NULL,
	`useful_life_months` integer NOT NULL,
	`depreciation_method` text DEFAULT 'STRAIGHT_LINE' NOT NULL,
	`asset_account_id` text,
	`accumulated_dep_account_id` text,
	`depreciation_expense_account_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accumulated_dep_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depreciation_expense_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fraud_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`rule_name` text NOT NULL,
	`severity` text DEFAULT 'MEDIUM' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`details_json` text NOT NULL,
	`status` text DEFAULT 'FLAGGED' NOT NULL,
	`assigned_to` text,
	`resolution_notes` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goods_receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`grn_id` text NOT NULL,
	`po_line_id` text NOT NULL,
	`quantity_received` real NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`grn_id`) REFERENCES `goods_receipt_notes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goods_receipt_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`po_id` text NOT NULL,
	`grn_number` text NOT NULL,
	`receipt_date` text NOT NULL,
	`delivery_note_no` text,
	`status` text DEFAULT 'RECEIVED' NOT NULL,
	`received_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `internal_controls_log` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`action_type` text NOT NULL,
	`requested_by` text,
	`approved_by` text,
	`threshold_amount` integer,
	`override_reason` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`unit_of_measure` text DEFAULT 'PCS' NOT NULL,
	`costing_method` text DEFAULT 'FIFO' NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`selling_price` integer DEFAULT 0 NOT NULL,
	`quantity_on_hand` real DEFAULT 0 NOT NULL,
	`reorder_point` real DEFAULT 10 NOT NULL,
	`asset_account_id` text,
	`cogs_account_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cogs_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`item_id` text NOT NULL,
	`transaction_date` text NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost` integer NOT NULL,
	`total_value` integer NOT NULL,
	`reference` text,
	`notes` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`journal_number` text NOT NULL,
	`entry_date` text NOT NULL,
	`accounting_period_id` text,
	`description` text,
	`source_type` text,
	`source_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_by` text NOT NULL,
	`submitted_by` text,
	`approved_by` text,
	`posted_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`submitted_at` integer,
	`approved_at` integer,
	`posted_at` integer,
	`reversed_at` integer,
	`rejection_reason` text,
	`original_journal_id` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accounting_period_id`) REFERENCES `accounting_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`journal_entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`description` text,
	`debit` integer DEFAULT 0 NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	`line_number` integer NOT NULL,
	`department_id` text,
	`project_id` text,
	`cost_center_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cost_center_id`) REFERENCES `cost_centers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lan_server_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`client_ip` text DEFAULT '127.0.0.1' NOT NULL,
	`last_active_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`is_maintenance_mode` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `license_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`is_main_branch` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_company_id_code_unique` ON `locations` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`metadata` text,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'CASH' NOT NULL,
	`default_account_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_methods_company_id_code_unique` ON `payment_methods` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `payroll_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payroll_run_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`basic_pay` integer NOT NULL,
	`overtime_pay` integer DEFAULT 0 NOT NULL,
	`holiday_pay` integer DEFAULT 0 NOT NULL,
	`night_diff_pay` integer DEFAULT 0 NOT NULL,
	`gross_pay` integer NOT NULL,
	`sss_employee` integer DEFAULT 0 NOT NULL,
	`sss_employer` integer DEFAULT 0 NOT NULL,
	`philhealth_employee` integer DEFAULT 0 NOT NULL,
	`philhealth_employer` integer DEFAULT 0 NOT NULL,
	`pagibig_employee` integer DEFAULT 0 NOT NULL,
	`pagibig_employer` integer DEFAULT 0 NOT NULL,
	`withholding_tax` integer DEFAULT 0 NOT NULL,
	`total_deductions` integer NOT NULL,
	`net_pay` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`payroll_period` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`payment_date` text NOT NULL,
	`total_gross_pay` integer DEFAULT 0 NOT NULL,
	`total_sss` integer DEFAULT 0 NOT NULL,
	`total_philhealth` integer DEFAULT 0 NOT NULL,
	`total_pagibig` integer DEFAULT 0 NOT NULL,
	`total_withholding_tax` integer DEFAULT 0 NOT NULL,
	`total_net_pay` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `period_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`accounting_period_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`reason` text,
	`changed_by` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accounting_period_id`) REFERENCES `accounting_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`module` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_code_unique` ON `permissions` (`code`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`client_customer_id` text,
	`budget_amount` integer,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_company_id_code_unique` ON `projects` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `purchase_bill_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` text NOT NULL,
	`account_id` text NOT NULL,
	`tax_code_id` text,
	`description` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `purchase_bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`bill_number` text NOT NULL,
	`bill_date` text NOT NULL,
	`due_date` text,
	`reference` text,
	`notes` text,
	`attachment_url` text,
	`total_amount` integer NOT NULL,
	`balance_due` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`po_id` text NOT NULL,
	`item_id` text,
	`description` text NOT NULL,
	`quantity_ordered` real NOT NULL,
	`quantity_received` real DEFAULT 0 NOT NULL,
	`unit_price` integer NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`po_number` text NOT NULL,
	`po_date` text NOT NULL,
	`expected_delivery_date` text,
	`total_amount` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `record_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`locked_by_user_id` text NOT NULL,
	`locked_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`locked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_journals` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`template_name` text NOT NULL,
	`frequency` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer,
	`next_run_date` integer NOT NULL,
	`last_run_date` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`journal_data_json` text NOT NULL,
	`requires_approval` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permissions_role_id_permission_id_unique` ON `role_permissions` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_code_unique` ON `roles` (`code`);--> statement-breakpoint
CREATE TABLE `sales_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`account_id` text NOT NULL,
	`tax_code_id` text,
	`description` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_type` text DEFAULT 'SALES' NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text,
	`reference` text,
	`total_amount` integer NOT NULL,
	`balance_due` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sod_restrictions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_code` text NOT NULL,
	`rule_name` text NOT NULL,
	`description` text,
	`incompatible_role_1` text NOT NULL,
	`incompatible_role_2` text NOT NULL,
	`restricted_permissions` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sod_restrictions_rule_code_unique` ON `sod_restrictions` (`rule_code`);--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`adjustment_number` text NOT NULL,
	`adjustment_date` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity_change` real NOT NULL,
	`reason` text NOT NULL,
	`expense_account_id` text,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_payment_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`bill_id` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`withholding_amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `supplier_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `purchase_bills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`payment_number` text NOT NULL,
	`payment_date` text NOT NULL,
	`amount` integer NOT NULL,
	`cash_account_id` text NOT NULL,
	`withholding_tax_amount` integer DEFAULT 0 NOT NULL,
	`withholding_tax_account_id` text,
	`overpayment_amount` integer DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'BANK_TRANSFER' NOT NULL,
	`reference` text,
	`notes` text,
	`attachment_url` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`journal_entry_id` text,
	`created_by` text,
	`submitted_by` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`withholding_tax_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `system_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`backup_name` text NOT NULL,
	`checksum` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`password_protected` integer DEFAULT false NOT NULL,
	`payload_json` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_calculations` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`journal_line_id` text,
	`tax_code_id` text NOT NULL,
	`rule_version_id` text NOT NULL,
	`tax_base` integer NOT NULL,
	`tax_rate` real NOT NULL,
	`tax_amount` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_line_id`) REFERENCES `journal_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_version_id`) REFERENCES `tax_rule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_calendar` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`tax_type` text NOT NULL,
	`form_number` text NOT NULL,
	`period_description` text NOT NULL,
	`deadline_date` text NOT NULL,
	`status` text DEFAULT 'UPCOMING' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`tax_type` text NOT NULL,
	`description` text,
	`applicability` text,
	`input_output_direction` text,
	`account_id` text,
	`rule_definition_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_definition_id`) REFERENCES `tax_rule_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_codes_company_id_code_unique` ON `tax_codes` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `tax_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`tax_filing_id` text,
	`exception_type` text NOT NULL,
	`description` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`severity` text DEFAULT 'WARNING' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_filing_id`) REFERENCES `tax_filings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_filing_checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_filing_id` text NOT NULL,
	`task_name` text NOT NULL,
	`description` text,
	`is_completed` integer DEFAULT false NOT NULL,
	`completed_by` text,
	`completed_at` integer,
	FOREIGN KEY (`tax_filing_id`) REFERENCES `tax_filings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_filings` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`tax_type` text NOT NULL,
	`period_name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`deadline_date` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`total_tax_base` integer DEFAULT 0 NOT NULL,
	`total_tax_due` integer DEFAULT 0 NOT NULL,
	`net_tax_payable` integer DEFAULT 0 NOT NULL,
	`filed_at` integer,
	`filed_by` text,
	`locked_at` integer,
	`locked_by` text,
	`notes` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`locked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_manual_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_filing_id` text NOT NULL,
	`company_id` text NOT NULL,
	`adjustment_type` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`approved_by` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`tax_filing_id`) REFERENCES `tax_filings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_rule_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_code` text NOT NULL,
	`rule_name` text NOT NULL,
	`tax_type` text NOT NULL,
	`description` text,
	`taxpayer_scope` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rule_definitions_rule_code_unique` ON `tax_rule_definitions` (`rule_code`);--> statement-breakpoint
CREATE TABLE `tax_rule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_definition_id` text NOT NULL,
	`version` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`calculation_method` text NOT NULL,
	`rate_value` real,
	`rule_configuration` text,
	`taxpayer_scope` text,
	`source_reference` text,
	`source_title` text,
	`source_type` text,
	`source_date` text,
	`notes` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`rule_definition_id`) REFERENCES `tax_rule_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rule_versions_rule_definition_id_version_unique` ON `tax_rule_versions` (`rule_definition_id`,`version`);--> statement-breakpoint
CREATE TABLE `user_permission_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`company_user_id` text NOT NULL,
	`permission_code` text NOT NULL,
	`effect` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_user_id`) REFERENCES `company_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_permission_overrides_company_user_id_permission_code_unique` ON `user_permission_overrides` (`company_user_id`,`permission_code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`theme` text DEFAULT 'light',
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`last_login_at` integer,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`require_password_change` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text,
	`tin` text,
	`address` text,
	`contact_person` text,
	`contact_details` text,
	`payment_terms` text,
	`tax_classification` text,
	`vat_status` text,
	`withholding_applicability` text,
	`default_payable_account_id` text,
	`default_expense_account_id` text,
	`notes` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_demo` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_payable_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_expense_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_company_id_code_unique` ON `vendors` (`company_id`,`code`);