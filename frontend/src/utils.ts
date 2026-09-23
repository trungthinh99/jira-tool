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
 * Which side of the handover a sub-task belongs to, read from its title.
 *
 * Titles are prefixed by whoever created them: `BE_260921:`, `FE_260921 (ALL):`,
 * `QA_260921:`. Older work used square brackets (`[BE_260820]`, `[QA]`), and
 * both shapes are still on live stories — so this matches an optional bracket
 * and does not assume a date is present. Assignee is not usable here: step 4 of
 * the flow has the FE moving Jame's BE sub-tasks. See CLAUDE.md §1b.
 */
export type TaskRole = 'be' | 'fe' | 'qa' | 'other';

// The separator is matched explicitly rather than with `\b`: `_` counts as a
// word character, so `BE_260921` has no word boundary after `BE` and `\b` would
// never fire on the current title format.
const ROLE_PATTERN = /^\s*\[?\s*(BE|FE|QA)\s*(?:[_:\]]|$)/i;

export function taskRole(issue: IssueSummary): TaskRole {
  const match = ROLE_PATTERN.exec(issue.summary);
  if (!match?.[1]) return 'other';
  return match[1].toLowerCase() as TaskRole;
}

export const ROLE_LABEL: Record<TaskRole, string> = {
  be: 'BE',
  fe: 'FE',
  qa: 'QA',
  other: '—',
};

/** `YYMMDD` for today — the date stamp used in `QA_YYMMDD:` titles. */
export function todayStamp(date = new Date()): string {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// Captures the `YYMMDD` that follows a BE/FE/QA prefix. Both `BE_260921:` and
// the older `[BE_260820]` shape are matched; `FE_260921 (ALL):` too.
const STAMP_PATTERN = /^\s*\[?\s*(?:BE|FE|QA)[_\s]*(\d{6})/i;

export function stampFromSummary(summary: string): string | null {
  return STAMP_PATTERN.exec(summary)?.[1] ?? null;
}

/**
 * The `YYMMDD` a new QA sub-task should carry.
 *
 * It must match the round of work being handed over, not the day the button is
 * pressed — press it the morning after and today's date names a round that does
 * not exist. So the stamp is read off the sibling sub-tasks that are already
 * there: `FE_260921` and `BE_260921` under a story mean its QA is `QA_260921`.
 * Verified on live data: every story on the board carries exactly one stamp
 * across its sub-tasks, and the QA tasks Bimo created by hand follow it.
 *
 * Falls back to today for a story whose sub-tasks are not named to the
 * convention (HWE-328 on the live board has none). The story's own `updated`
 * date would be the better fallback, but Jira does not return it inside
 * `parent.fields` — fetching it would cost a request per story to cover a case
 * where there is no round to match anyway.
 */
export function qaStamp(siblings: readonly IssueSummary[]): string {
  // Newest first: a story handed over twice keeps both rounds' sub-tasks, and
  // the QA being created now belongs to the latest one.
  const stamps = siblings
    .map((issue) => stampFromSummary(issue.summary))
    .filter((stamp): stamp is string => stamp !== null)
    .sort()
    .reverse();

  return stamps[0] ?? todayStamp();
}

/**
 * Whether this round of work still needs its QA sub-task.
 *
 * The question is not "is there a QA task" but "is there one for *this*
 * round" — HWE-303, HWE-291 and HWE-34 all carry a QA task that is Done, from
 * rounds `260827` and earlier, while their current round `260921` has none.
 * Matching on presence alone would call all three covered.
 *
 * A QA task with no stamp at all (the older `[QA] Test ...` shape) counts only
 * when nothing else carries a stamp either. HWE-34 is why: its `[QA]` task is
 * Done from a round that predates the convention, while its current round is
 * `260921` — treating the unstamped task as "close enough" would hide a story
 * that genuinely needs a new QA.
 */
export function needsQa(siblings: readonly IssueSummary[]): boolean {
  const round = qaStamp(siblings);
  return !siblings.some((issue) => isQaForRound(issue, round, siblings));
}

/** Whether this QA sub-task belongs to `round`. */
function isQaForRound(
  issue: IssueSummary,
  round: string,
  siblings: readonly IssueSummary[],
): boolean {
  if (taskRole(issue) !== 'qa') return false;
  const stamp = stampFromSummary(issue.summary);
  if (stamp !== null) return stamp === round;
  // Unstamped `[QA] ...` counts only when nothing else is stamped either.
  return !siblings.some((other) => stampFromSummary(other.summary) !== null);
}

/**
 * Drop finished QA sub-tasks left over from earlier rounds.
 *
 * They are fetched on purpose — `needsQa()` cannot tell a covered round from an
 * uncovered one without them — but they are history, not work in hand. HWE-303
 * carries a Done `QA_260827` while its current round is `260921`; listing it
 * under today's handover only invites moving the wrong task.
 *
 * A Done QA of the *current* round stays: it is this round's QA, and seeing
 * that the BA has already passed it is the point.
 */
export function withoutStaleQa(siblings: readonly IssueSummary[]): IssueSummary[] {
  const round = qaStamp(siblings);
  return siblings.filter((issue) => {
    if (taskRole(issue) !== 'qa') return true;
    if (issue.statusCategory !== 'done') return true;
    return isQaForRound(issue, round, siblings);
  });
}

/** A story with the sub-tasks assigned to me underneath it. */
export interface StoryGroup {
  parentKey: string;
  parentSummary: string | null;
  parentStatus: string | null;
  parentStatusCategory: string | null;
  parentType: string | null;
  items: IssueSummary[];
}

/**
 * Group the inbox for one project: sub-tasks collected under their story,
 * everything else left flat under its own source.
 *
 * Sub-tasks arrive as a flat list, but they are handed over a story at a time —
 * five rows repeating the same parent is how the work actually looks, not how
 * it reads. Improvements and bugs stand alone, so they stay ungrouped.
 */
export interface ProjectInbox {
  stories: StoryGroup[];
  /** Standalone issues keyed by source, in `GROUP_ORDER`. */
  loose: { source: TaskSource; items: IssueSummary[] }[];
  total: number;
}

const LOOSE_ORDER: TaskSource[] = ['ba', 'tester', 'other'];

export function groupProjectInbox(issues: IssueSummary[]): ProjectInbox {
  const stories = new Map<string, StoryGroup>();
  const loose = new Map<TaskSource, IssueSummary[]>();

  for (const issue of issues) {
    const source = taskSource(issue);

    // Only backend sub-tasks nest; an improvement's parent is its epic, which
    // is not the grouping the report cares about.
    if (source === 'backend' && issue.parentKey) {
      const existing = stories.get(issue.parentKey);
      if (existing) existing.items.push(issue);
      else
        stories.set(issue.parentKey, {
          parentKey: issue.parentKey,
          parentSummary: issue.parentSummary,
          parentStatus: issue.parentStatus,
          parentStatusCategory: issue.parentStatusCategory,
          parentType: issue.parentType,
          items: [issue],
        });
      continue;
    }

    const bucket = loose.get(source);
    if (bucket) bucket.push(issue);
    else loose.set(source, [issue]);
  }

  return {
    // Busiest story first — that is where the day's work is.
    stories: [...stories.values()].sort((a, b) => b.items.length - a.items.length),
    loose: LOOSE_ORDER.filter((source) => loose.has(source)).map((source) => ({
      source,
      items: loose.get(source) ?? [],
    })),
    total: issues.length,
  };
}

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

/**
 * Read the active menu from the URL path.
 *
 * Three screens do not justify a router dependency, so the path is read and
 * written directly. An unknown path falls back to the first menu.
 */
export function routeFromPath(path: string, allowed: readonly string[]): string {
  const slug = path.replace(/^\/+|\/+$/g, '');
  return allowed.includes(slug) ? slug : (allowed[0] ?? '');
}

/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` needs a secure context; plain http://localhost counts
 * as one in Chrome and Firefox, but the textarea path is kept for anything
 * that does not — failing silently here would look like the button is dead.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
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
