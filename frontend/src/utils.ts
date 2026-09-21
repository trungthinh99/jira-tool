import type { IssueSummary } from './api/types';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** `YYYY-MM-DD` in local time — the format the activity endpoint expects. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `DD/MM/YYYY` — the format the report heading uses. */
export function toReportDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Where a task came from, inferred from its type and parent.
 *
 * This mirrors how the work actually arrives: BE breaks a story into
 * sub-tasks, BA files improvements, QA files bugs. It is a hint for grouping
 * the inbox, not a field Jira stores.
 */
export type TaskSource = 'backend' | 'ba' | 'tester' | 'other';

export function taskSource(issue: IssueSummary): TaskSource {
  const type = issue.issueType.toLowerCase();
  if (type === 'bug') return 'tester';
  if (type === 'improvement') return 'ba';
  if (issue.parentKey) return 'backend';
  return 'other';
}

export const SOURCE_LABEL: Record<TaskSource, string> = {
  backend: 'Sub-task từ BE',
  ba: 'Improvement từ BA',
  tester: 'Bug từ Tester',
  other: 'Khác',
};

/**
 * Default progress for a task on the report, read from its status.
 *
 * Anything finished or handed to review is done from the FE side; a task still
 * in progress is reported at 70%, which is the convention the existing reports
 * follow.
 */
export function defaultPercent(issue: IssueSummary): number {
  if (issue.statusCategory === 'done') return 100;
  const status = issue.status.toLowerCase();
  if (status === 'review') return 100;
  if (issue.statusCategory === 'indeterminate') return 70;
  return 50;
}

const SEEN_KEY = 'jira_tool_seen_issues';

export function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function writeSeen(keys: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...keys]));
  } catch {
    // Private mode or a full quota — the badge is a convenience, not data.
  }
}
