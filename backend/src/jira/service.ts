import { config, REPORT_TARGETS, slackEnabled, type ReportTarget } from '../config.js';
import { postSlackMessage } from '../slack/client.js';
import { jiraFetch } from './client.js';
import { buildReportAdf, renderReportText, type ReportInput } from './adf.js';
import { parseNextTasks } from './parseReport.js';
import type {
  IssueSummary,
  JiraUser,
  PostedReport,
  RawIssue,
  RawUser,
  SearchResponse,
  SlackPing,
  TransitionOption,
} from './types.js';

const ISSUE_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'project',
  'parent',
  'reporter',
  'assignee',
  'created',
  'updated',
];

function toSummary(raw: RawIssue): IssueSummary {
  const fields = raw.fields ?? {};
  return {
    key: raw.key,
    summary: fields.summary ?? '',
    status: fields.status?.name ?? '',
    statusCategory: fields.status?.statusCategory?.key ?? '',
    issueType: fields.issuetype?.name ?? '',
    projectKey: fields.project?.key ?? raw.key.split('-')[0] ?? '',
    parentKey: fields.parent?.key ?? null,
    parentSummary: fields.parent?.fields?.summary ?? null,
    parentStatus: fields.parent?.fields?.status?.name ?? null,
    parentStatusCategory: fields.parent?.fields?.status?.statusCategory?.key ?? null,
    parentType: fields.parent?.fields?.issuetype?.name ?? null,
    reporter: fields.reporter?.displayName ?? null,
    assignee: fields.assignee?.displayName ?? null,
    created: fields.created ?? null,
    updated: fields.updated ?? null,
    url: `https://${config.jira.site}/browse/${raw.key}`,
  };
}

/**
 * Run a JQL search, following `nextPageToken` until the result set is
 * exhausted. The caps matter: a report day with a lot of movement can exceed
 * one page, and a silently truncated list is a report with missing tasks.
 */
async function searchAll(jql: string, maxPages = 5): Promise<IssueSummary[]> {
  const collected: IssueSummary[] = [];
  let token: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const body: Record<string, unknown> = {
      jql,
      fields: ISSUE_FIELDS,
      maxResults: 100,
    };
    if (token) body['nextPageToken'] = token;

    const response = await jiraFetch<SearchResponse>('/rest/api/3/search/jql', {
      method: 'POST',
      body,
    });

    for (const raw of response.issues ?? []) {
      collected.push(toSummary(raw));
    }

    if (response.isLast !== false || !response.nextPageToken) break;
    token = response.nextPageToken;
  }

  return collected;
}

/**
 * Menu 1 — unfinished work on the stories I am involved in.
 *
 * Widened from `assignee = currentUser() AND status = "To Do"` on 21/09/2026 so
 * the screen can filter by status and by assignee: a To Do-only, mine-only
 * query leaves nothing to filter. Done stays excluded — the inbox is about what
 * is still open. The UI still defaults to To Do and to the current user, so the
 * screen opens on the same list as before.
 */
export async function fetchInbox(): Promise<IssueSummary[]> {
  // Scoped to the configured projects. Widening the query surfaced the report
  // issues themselves (PPP-354, PPP-308 are assigned to the FE and sit at In
  // Progress permanently) plus unrelated projects — none of that is work to do.
  const projects = REPORT_TARGETS.map((t) => `"${t.projectKey}"`).join(', ');
  const mine = await searchAll(
    `project IN (${projects}) AND assignee = currentUser() ` +
      `AND statusCategory != Done ORDER BY created DESC`,
  );

  const parents = [...new Set(mine.flatMap((i) => (i.parentKey ? [i.parentKey] : [])))];
  const siblings = await fetchChildren(parents);

  const byKey = new Map<string, IssueSummary>();
  for (const issue of [...mine, ...siblings]) byKey.set(issue.key, issue);
  return [...byKey.values()];
}

/**
 * Menu 2 — what moved on a given day.
 *
 * `status CHANGED DURING (...)` is the honest question for a daily report: it
 * lists what actually progressed, not what merely got a comment. It does mean a
 * task worked on all day without a status change is absent, which is why the UI
 * lets the user add lines by hand.
 */
export function fetchDayActivity(date: string): Promise<IssueSummary[]> {
  const start = `${date} 00:00`;
  const end = `${date} 23:59`;
  return searchAll(
    `assignee = currentUser() AND status CHANGED DURING ("${start}", "${end}") ORDER BY updated DESC`,
  );
}

/** The account the tool's token belongs to — used to label "me" in the UI. */
export async function fetchCurrentUser(): Promise<JiraUser> {
  const raw = await jiraFetch<RawUser>('/rest/api/3/myself');
  return {
    accountId: raw.accountId ?? '',
    displayName: raw.displayName ?? '',
  };
}

/** Cached user list, keyed by the issue it was looked up against. */
const userCache = new Map<string, { at: number; users: JiraUser[] }>();
const USER_CACHE_MS = 10 * 60 * 1000;

/**
 * People who can be mentioned in a report, looked up against the report issue
 * so the list matches who actually has access to it.
 *
 * Automation accounts are dropped: they can be assigned work, but mentioning
 * one in a daily report notifies nobody. Jira labels them `accountType: 'app'`,
 * which is more reliable than matching on the display name.
 */
export async function fetchMentionableUsers(issueKey: string): Promise<JiraUser[]> {
  const cached = userCache.get(issueKey);
  if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached.users;

  const raw = await jiraFetch<RawUser[]>(
    `/rest/api/3/user/assignable/search?issueKey=${encodeURIComponent(issueKey)}&maxResults=200`,
  );

  const users = (raw ?? [])
    .filter((user) => user.active !== false && user.accountType !== 'app')
    .flatMap((user) =>
      user.accountId && user.displayName
        ? [{ accountId: user.accountId, displayName: user.displayName }]
        : [],
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));

  userCache.set(issueKey, { at: Date.now(), users });
  return users;
}

/**
 * Menu 3 — the handover board.
 *
 * Unlike the inbox this deliberately does NOT filter by assignee: step 4 of the
 * handover flow has the FE moving Jame's BE sub-tasks to Done, so the board has
 * to show work assigned to other people. See CLAUDE.md §1b.
 */
export async function fetchHandoverBoard(projectKey: string): Promise<IssueSummary[]> {
  // Start from my own unfinished work — that is what defines which stories are
  // in play today.
  const mine = await searchAll(
    `project = "${projectKey}" AND assignee = currentUser() ` +
      `AND statusCategory != Done ORDER BY created DESC`,
  );

  // Then pull in every sibling under the same parents, so the BE sub-tasks I
  // have to move to Done show up beside mine.
  const parents = [...new Set(mine.flatMap((issue) => (issue.parentKey ? [issue.parentKey] : [])))];
  const siblings = await fetchChildren(parents);

  const byKey = new Map<string, IssueSummary>();
  for (const issue of [...mine, ...siblings]) byKey.set(issue.key, issue);
  return [...byKey.values()];
}

/**
 * Unfinished sub-tasks under these parents, whoever they are assigned to.
 *
 * Done is excluded because a long-running story carries months of finished
 * sub-tasks — HWE-31 has 14 children of which 10 are closed, and a board that
 * lists them all buries today's handover.
 */
export async function fetchChildren(parentKeys: string[]): Promise<IssueSummary[]> {
  if (parentKeys.length === 0) return [];
  const list = parentKeys.map((key) => `"${key}"`).join(', ');
  return searchAll(`parent IN (${list}) AND statusCategory != Done ORDER BY created ASC`);
}

export interface CreateSubtaskInput {
  parentKey: string;
  summary: string;
  assigneeAccountId?: string;
}

/**
 * Create a QA sub-task under a story or improvement.
 *
 * The project and issue type are read off the parent rather than configured:
 * a sub-task must live in its parent's project, and the sub-task type id is per
 * project (HWE uses 10011), so hardcoding either would break the second project.
 */
export async function createSubtask(input: CreateSubtaskInput): Promise<IssueSummary> {
  const parent = await jiraFetch<RawIssue & { fields: { project?: { key?: string } } }>(
    `/rest/api/3/issue/${encodeURIComponent(input.parentKey)}?fields=project,issuetype`,
  );
  const projectKey = parent.fields?.project?.key;
  if (!projectKey) {
    throw new Error(`Không đọc được project của ${input.parentKey}.`);
  }

  const subtaskTypeId = await findSubtaskTypeId(projectKey);

  const created = await jiraFetch<{ key: string }>('/rest/api/3/issue', {
    method: 'POST',
    body: {
      fields: {
        project: { key: projectKey },
        parent: { key: input.parentKey },
        issuetype: { id: subtaskTypeId },
        summary: input.summary,
        ...(input.assigneeAccountId
          ? { assignee: { accountId: input.assigneeAccountId } }
          : {}),
      },
    },
  });

  const full = await jiraFetch<RawIssue>(
    `/rest/api/3/issue/${encodeURIComponent(created.key)}?fields=${ISSUE_FIELDS.join(',')}`,
  );
  return toSummary(full);
}

/** Cached per project — the sub-task type id is workflow config, not a constant. */
const subtaskTypeCache = new Map<string, string>();

async function findSubtaskTypeId(projectKey: string): Promise<string> {
  const cached = subtaskTypeCache.get(projectKey);
  if (cached) return cached;

  const response = await jiraFetch<{
    projects?: { issuetypes?: { id: string; name: string; subtask?: boolean }[] }[];
  }>(
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}` +
      `&expand=projects.issuetypes`,
  );

  const types = response.projects?.[0]?.issuetypes ?? [];
  const match = types.find((type) => type.subtask === true);
  if (!match) {
    throw new Error(`Dự án ${projectKey} không có issue type sub-task nào.`);
  }

  subtaskTypeCache.set(projectKey, match.id);
  return match.id;
}

export interface BulkResult {
  key: string;
  ok: boolean;
  error?: string;
}

/**
 * Move several issues one after another.
 *
 * Runs sequentially and keeps going after a failure: a partial success has to
 * be reported per issue, because the user needs to know exactly which ones
 * moved before deciding what to retry.
 */
export async function transitionMany(
  keys: string[],
  toStatus: string,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const key of keys) {
    try {
      await transitionIssue(key, toStatus);
      results.push({ key, ok: true });
    } catch (caught) {
      results.push({
        key,
        ok: false,
        error: caught instanceof Error ? caught.message : 'Lỗi không xác định.',
      });
    }
  }
  return results;
}

export async function fetchTransitions(issueKey: string): Promise<TransitionOption[]> {
  const response = await jiraFetch<{
    transitions?: { id: string; name: string; to?: { name?: string } }[];
  }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);

  return (response.transitions ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    to: t.to?.name ?? '',
  }));
}

/**
 * Move an issue by target status name rather than by transition id. Workflow
 * ids are configuration and do change, so resolving the name at call time is
 * what keeps this working after a board edit.
 */
export async function transitionIssue(issueKey: string, toStatus: string): Promise<void> {
  const options = await fetchTransitions(issueKey);
  const match =
    options.find((t) => t.to.toLowerCase() === toStatus.toLowerCase()) ??
    options.find((t) => t.name.toLowerCase() === toStatus.toLowerCase());

  if (!match) {
    const available = options.map((t) => t.to || t.name).join(', ') || 'none';
    throw new Error(`No transition to "${toStatus}" on ${issueKey}. Available: ${available}`);
  }

  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    body: { transition: { id: match.id } },
  });
}

/** Seed the "Next task" box from the previous report on that issue. */
export async function fetchPreviousNextTasks(target: ReportTarget): Promise<string[]> {
  const response = await jiraFetch<{
    comments?: { body?: unknown }[];
  }>(
    `/rest/api/3/issue/${encodeURIComponent(target.reportIssueKey)}/comment` +
      `?orderBy=-created&maxResults=1&expand=renderedBody`,
  );

  const latest = response.comments?.[0] as { renderedBody?: string } | undefined;
  if (!latest?.renderedBody) return target.defaultNextTasks;

  const parsed = parseNextTasks(latest.renderedBody);
  return parsed.length > 0 ? parsed : target.defaultNextTasks;
}

export function buildReport(input: ReportInput) {
  return { adf: buildReportAdf(input), text: renderReportText(input) };
}

export async function postReport(
  target: ReportTarget,
  input: ReportInput,
): Promise<PostedReport> {
  const created = await jiraFetch<{ id: string }>(
    `/rest/api/3/issue/${encodeURIComponent(target.reportIssueKey)}/comment`,
    { method: 'POST', body: { body: buildReportAdf(input) } },
  );

  return {
    commentId: created.id,
    url: `https://${config.jira.site}/browse/${target.reportIssueKey}?focusedCommentId=${created.id}`,
    slack: await pingSlack(),
  };
}

/**
 * Tell the channel the report is up.
 *
 * The Jira comment is already posted by the time this runs and cannot be taken
 * back, so a Slack failure is reported alongside the success rather than
 * thrown — otherwise the UI would show an error for a report that did go out,
 * and Bimo would post it twice.
 */
export async function pingSlack(): Promise<SlackPing> {
  if (!slackEnabled()) return { sent: false, skipped: true };
  try {
    await postSlackMessage(config.slack.channel, config.slack.message);
    return { sent: true, skipped: false };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
