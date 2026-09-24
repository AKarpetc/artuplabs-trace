import { migrationRunner } from '@forge/sql';

/** Applies all pending migrations; safe to call repeatedly. */
export async function runMigrations() {
  return migrationRunner
    .enqueue('v001_req_issue', `CREATE TABLE IF NOT EXISTS req_issue (
      issue_id VARCHAR(32) PRIMARY KEY,
      issue_key VARCHAR(64) NOT NULL,
      project_id VARCHAR(32) NOT NULL,
      issue_type_id VARCHAR(32) NOT NULL,
      summary VARCHAR(1024) NOT NULL,
      status_name VARCHAR(255) NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      links_hash CHAR(64) NOT NULL,
      covered TINYINT NOT NULL DEFAULT 0,
      fields_json TEXT,
      jira_updated_at VARCHAR(40),
      seen_sync_id BIGINT NOT NULL DEFAULT 0,
      INDEX idx_req_project (project_id, issue_id),
      INDEX idx_req_cov (project_id, covered, issue_id)
    )`)
    .enqueue('v002_trace_link', `CREATE TABLE IF NOT EXISTS trace_link (
      link_id VARCHAR(32) PRIMARY KEY,
      project_id VARCHAR(32) NOT NULL,
      req_issue_id VARCHAR(32) NOT NULL,
      other_issue_id VARCHAR(32) NOT NULL,
      other_key VARCHAR(64) NOT NULL,
      other_type_id VARCHAR(32) NOT NULL,
      other_status VARCHAR(255) NOT NULL,
      link_type_id VARCHAR(32) NOT NULL,
      link_type_name VARCHAR(255) NOT NULL,
      direction VARCHAR(8) NOT NULL,
      confirmed_fingerprint CHAR(64) NOT NULL,
      confirmed_by VARCHAR(128),
      confirmed_at VARCHAR(40),
      suspect TINYINT NOT NULL DEFAULT 0,
      INDEX idx_link_req (req_issue_id),
      INDEX idx_link_suspect (project_id, suspect, link_id)
    )`)
    .enqueue('v003_issue_version', `CREATE TABLE IF NOT EXISTS issue_version (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      issue_id VARCHAR(32) NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      issue_key VARCHAR(64) NOT NULL,
      summary VARCHAR(1024) NOT NULL,
      status_name VARCHAR(255) NOT NULL,
      fields_json TEXT,
      UNIQUE KEY uq_version (issue_id, fingerprint)
    )`)
    .enqueue('v004_baseline', `CREATE TABLE IF NOT EXISTS baseline (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      project_id VARCHAR(32) NOT NULL,
      name VARCHAR(255) NOT NULL,
      created_by VARCHAR(128) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      status VARCHAR(16) NOT NULL,
      member_count INT NOT NULL DEFAULT 0,
      checksum CHAR(64),
      INDEX idx_baseline_project (project_id, id)
    )`)
    .enqueue('v005_baseline_member', `CREATE TABLE IF NOT EXISTS baseline_member (
      baseline_id BIGINT NOT NULL,
      issue_id VARCHAR(32) NOT NULL,
      version_id BIGINT NOT NULL,
      links_hash CHAR(64) NOT NULL,
      PRIMARY KEY (baseline_id, issue_id)
    )`)
    .enqueue('v006_job', `CREATE TABLE IF NOT EXISTS job (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(32) NOT NULL,
      project_id VARCHAR(32) NOT NULL,
      status VARCHAR(16) NOT NULL,
      state_json TEXT NOT NULL,
      error TEXT,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_job_project (project_id, kind, id)
    )`)
    .enqueue('v007_member_status', 'ALTER TABLE baseline_member ADD COLUMN status_name VARCHAR(255) NOT NULL DEFAULT \'\'')
    .run();
}
