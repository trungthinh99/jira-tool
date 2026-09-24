export interface IssueSummary {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  issueType: string;
  projectKey: string;
  parentKey: string | null;
  parentSummary: string | null;
  parentStatus: string | null;
  parentStatusCategory: string | null;
  parentType: string | null;
  reporter: string | null;
  assignee: string | null;
  created: string | null;
  updated: string | null;
  url: string;
  /**
   * On the report because it is still in progress, not because its status
   * changed that day — a task spanning several days.
   */
  wip?: boolean;
}

export interface Mention {
  accountId: string;
  name: string;
}

export interface ReportTarget {
  id: string;
  label: string;
  projectKey: string;
  reportIssueKey: string;
  reportIssueUrl: string;
  mentions: Mention[];
  defaultNextTasks: string[];
}

export interface TodayTaskLine {
  key: string;
  percent: number;
  /** Link text in the report. Absent for a manually typed row. */
  summary?: string;
}

export interface ReportPayload {
  dateLabel: string;
  todayTasks: TodayTaskLine[];
  nextTasks: string[];
  issue: string;
  mentions: Mention[];
}

/** A person who can be picked in the mention box, or assigned a QA sub-task. */
export interface JiraUser {
  accountId: string;
  displayName: string;
}

/** Outcome of one issue in a bulk transition. */
export interface BulkResult {
  key: string;
  ok: boolean;
  error?: string;
}

/**
 * Outcome of the Slack ping sent after the report.
 *
 * `skipped` means the backend has no Slack credentials — the normal state when
 * Slack is not set up, and nothing the UI should complain about.
 */
export interface SlackPing {
  sent: boolean;
  skipped: boolean;
  error?: string;
}

export interface PostedReport {
  commentId: string;
  url: string;
}

export interface SlackConfig {
  enabled: boolean;
  message: string;
}

export interface TransitionOption {
  id: string;
  name: string;
  to: string;
}
