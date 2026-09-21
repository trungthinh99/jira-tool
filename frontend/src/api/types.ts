export interface IssueSummary {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  issueType: string;
  projectKey: string;
  parentKey: string | null;
  parentSummary: string | null;
  reporter: string | null;
  created: string | null;
  updated: string | null;
  url: string;
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
}

export interface ReportPayload {
  dateLabel: string;
  todayTasks: TodayTaskLine[];
  nextTasks: string[];
  issue: string;
}

export interface PostedReport {
  commentId: string;
  url: string;
}

export interface TransitionOption {
  id: string;
  name: string;
  to: string;
}
