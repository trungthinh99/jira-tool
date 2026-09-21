import { config, type ReportTarget } from '../config.js';
import { jiraFetch } from './client.js';
import { buildReportAdf, renderReportText, type ReportInput } from './adf.js';
import { parseNextTasks } from './parseReport.js';
import type { IssueSummary, RawIssue, SearchResponse, TransitionOption } from './types.js';

const ISSUE_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'project',
  'parent',
  'reporter',
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
    reporter: fields.reporter?.displayName ?? null,
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

/** Menu 1 — everything assigned to me that is still untouched. */
export function fetchInbox(): Promise<IssueSummary[]> {
  return searchAll('assignee = currentUser() AND status = "To Do" ORDER BY created DESC');
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
): Promise<{ commentId: string; url: string }> {
  const created = await jiraFetch<{ id: string }>(
    `/rest/api/3/issue/${encodeURIComponent(target.reportIssueKey)}/comment`,
    { method: 'POST', body: { body: buildReportAdf(input) } },
  );

  return {
    commentId: created.id,
    url: `https://${config.jira.site}/browse/${target.reportIssueKey}?focusedCommentId=${created.id}`,
  };
}
