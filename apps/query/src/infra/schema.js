import { migrationRunner } from '@forge/sql';

/** Applies pending index migrations; safe to call repeatedly. */
export async function runMigrations() {
  return migrationRunner
    .enqueue('v001_sprint', `CREATE TABLE IF NOT EXISTS sprint (
      sprint_id BIGINT PRIMARY KEY,
      board_id BIGINT NOT NULL,
      name VARCHAR(255) NOT NULL,
      state VARCHAR(16) NOT NULL,
      start_at BIGINT NULL,
      complete_at BIGINT NULL,
      INDEX idx_sprint_board (board_id)
    )`)
    .enqueue('v002_sprint_event', `CREATE TABLE IF NOT EXISTS sprint_event (
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      sprint_id BIGINT NOT NULL,
      kind CHAR(1) NOT NULL,
      at BIGINT NOT NULL,
      change_id BIGINT NOT NULL,
      PRIMARY KEY (change_id, issue_id, sprint_id, kind),
      INDEX idx_se_sprint (sprint_id, at),
      INDEX idx_se_issue (issue_id),
      INDEX idx_se_project (project_id)
    )`)
    .enqueue('v003_status_event', `CREATE TABLE IF NOT EXISTS status_event (
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      at BIGINT NOT NULL,
      from_cat VARCHAR(16) NOT NULL,
      to_cat VARCHAR(16) NOT NULL,
      change_id BIGINT NOT NULL,
      PRIMARY KEY (change_id, issue_id),
      INDEX idx_st_issue (issue_id, at),
      INDEX idx_st_project (project_id)
    )`)
    .enqueue('v004_comment_meta', `CREATE TABLE IF NOT EXISTS comment_meta (
      comment_id BIGINT PRIMARY KEY,
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      author VARCHAR(128) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      vis_type VARCHAR(8) NULL,
      vis_value VARCHAR(255) NULL,
      INDEX idx_cm_issue (issue_id, created_at),
      INDEX idx_cm_author (author, created_at),
      INDEX idx_cm_created (created_at),
      INDEX idx_cm_project (project_id)
    )`)
    .enqueue('v005_attachment_meta', `CREATE TABLE IF NOT EXISTS attachment_meta (
      attachment_id BIGINT PRIMARY KEY,
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      author VARCHAR(128) NOT NULL,
      created_at BIGINT NOT NULL,
      ext VARCHAR(32) NOT NULL,
      INDEX idx_am_issue (issue_id),
      INDEX idx_am_ext (ext),
      INDEX idx_am_project (project_id)
    )`)
    .run();
}
