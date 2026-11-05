import { config, REPORT_TARGETS, slackEnabled, type ReportTarget } from '../config.js';
import { postSlackMessage } from '../slack/client.js';
import { jiraFetch } from './client.js';
import { buildReportAdf, renderReportText, type ReportInput } from './adf.js';
import { parseNextTasks, parseTaskPercents } from './parseReport.js';
import type {
  IssueSummary,
  JiraUser,
  PostedReport,
  RawIssue,
  RawUser,
  SearchResponse,
  SlackPing,
  StoryHeading,
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
  // issues themselves (the PPP report issues sit at In Progress permanently)
  // plus unrelated projects — none of that is work to do.
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

/** Statuses that mean "I am working on this right now". */
const WIP_STATUSES = ['In Progress', 'FIXING'];

/**
 * Menu 2 — what to report for a given day.
 *
 * Two sources, because a day's work is not the same as a day's status changes:
 *
 * 1. `status CHANGED DURING (...)` — what actually moved. Honest, but blind to
 *    a task worked on all day without changing state.
 * 2. Everything still In Progress or FIXING — the work in hand. A story that
 *    takes three days is reported on all three, at 70% then 80% then 90%, and
 *    its status never changes until the last one. Without this the report goes
 *    silent on exactly the tasks taking the most effort.
 *
 * The second list is not restricted by date: "still in progress" has no day
 * attached. That is correct for today and harmless for a past date — a task
 * that is in progress now almost certainly was then, and anything wrong is one
 * untick away. `wip` on the result marks which rows came from source 2 so the
 * UI can say where a line came from.
 */
export async function fetchDayActivity(date: string): Promise<IssueSummary[]> {
  const start = `${date} 00:00`;
  const end = `${date} 23:59`;
  const projects = REPORT_TARGETS.map((t) => `"${t.projectKey}"`).join(', ');
  const wipList = WIP_STATUSES.map((s) => `"${s}"`).join(', ');

  const [moved, inProgress] = await Promise.all([
    searchAll(
      `assignee = currentUser() AND status CHANGED DURING ("${start}", "${end}") ` +
        `ORDER BY updated DESC`,
    ),
    searchAll(
      `project IN (${projects}) AND assignee = currentUser() ` +
        `AND status IN (${wipList}) ORDER BY updated DESC`,
    ),
  ]);

  // A task that both moved today and is still in progress belongs to the first
  // list: it has a real status change to report.
  const byKey = new Map<string, IssueSummary>();
  for (const issue of moved) byKey.set(issue.key, issue);
  for (const issue of inProgress) {
    if (!byKey.has(issue.key)) byKey.set(issue.key, { ...issue, wip: true });
  }
  return [...byKey.values()];
}

/** The account the tool's token belongs to — used to label "me" in the UI. */
export async function fetchCurrentUser(): Promise<JiraUser> {
  const raw = await jiraFetch<RawUser>('/rest/api/3/myself');
  return {
    accountId: raw.accountId ?? '',
    displayName: raw.displayName ?? '',
  };
}

/**
 * Every `[New]` / `[Update N]` heading in a story's description, newest first.
 *
 * The BA opens each round of a story with one, in red: `[New] 02/11/2026` when
 * the story is first written, `[Update 12] 29/10/2026` for each revision after
 * that. Both facts in it are needed to name a QA task for a story whose BE
 * split the round across several FE sub-tasks, where there is no single FE
 * title to copy from.
 *
 * **All** of them are read, not just the first, because a story is handed over
 * in several rounds at once and each needs its own number. DT-198 carries
 * rounds `261028`, `261030` and `261102`, and its headings date update 1 to
 * 28/10, update 2 to 30/10 and update 3 to 02/11 — so naming every round after
 * the top heading would tell the BA to test "update 3" for work that is
 * update 1. Same on DT-689, where round `261028` is update 11, not the 12 at
 * the top.
 *
 * A heading must start its block. That is what separates it from the
 * cross-references filling the body (`... như DT-676 [Update 8] — mỗi lần ...`,
 * `thay phần ... ở [Update 11]`), which name *other* rounds mid-sentence:
 * DT-689 has 13 bare `[Update N]` mentions against its 13 real headings.
 * Requiring a date right after the bracket is the second filter.
 *
 * The colour is deliberately not matched. It is red in both projects but a
 * different red — `#ff5630` on HWE, `#bf2600` on DT — so keying on the hex
 * would quietly stop working the day a third project picks its own shade.
 *
 * Returns an empty list for a story with no heading (HWE-375, HWE-565 and all
 * four open SR stories have none, two of them no description at all). That is
 * an ordinary state, not an error: the caller falls back to the generic title.
 */
export function parseStoryHeadings(description: unknown): StoryHeading[] {
  const found: StoryHeading[] = [];

  for (const block of blockTexts(description)) {
    const match = /^\s*\[\s*(?:(New)|Update\s*(\d+))\s*\]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(
      block,
    );
    if (!match) continue;
    const [, isNew, update, day, month, year] = match;
    if (!day || !month || !year) continue;
    found.push({
      stamp: `${year.slice(-2)}${month.padStart(2, '0')}${day.padStart(2, '0')}`,
      update: isNew ? null : Number(update),
    });
  }

  // Newest first. The description is already written that way, but a round can
  // carry two headings (DT-676 dates both update 8 and update 9 to 29/10), and
  // the later number is the round's final state — so ordering by update rather
  // than by position puts the right one first for a per-stamp lookup.
  return found.sort((a, b) => b.stamp.localeCompare(a.stamp) || (b.update ?? -1) - (a.update ?? -1));
}

/**
 * The plain text of each top-level block of a description.
 *
 * Jira returns the description as ADF, and a heading is styled — red, bold,
 * sometimes inside a heading node — so its text arrives split across several
 * `text` nodes that have to be joined before the brackets can be matched.
 */
function blockTexts(description: unknown): string[] {
  if (!description || typeof description !== 'object') return [];
  const content = (description as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return [];
  return content.map((block) => flatten(block).trim()).filter((text) => text.length > 0);
}

function flatten(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const typed = node as { type?: string; text?: string; content?: unknown[] };
  if (typed.type === 'text') return typed.text ?? '';
  return (typed.content ?? []).map(flatten).join('');
}

/**
 * One story's `[New]` / `[Update N]` headings, newest first.
 *
 * Fetched on its own rather than carried on the handover board: a description
 * is large (DT-689's is 19KB, HWE-402's 24KB) and the board returns up to a
 * hundred issues, so putting it in `ISSUE_FIELDS` would pay that cost on every
 * refresh to serve one dialog. One request when the dialog opens is cheaper,
 * and the story path makes no AI call to begin with.
 */
export async function fetchStoryHeadings(issueKey: string): Promise<StoryHeading[]> {
  const raw = await jiraFetch<{ fields?: { description?: unknown } }>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=description`,
  );
  return parseStoryHeadings(raw.fields?.description);
}

/**
 * Who raised an issue.
 *
 * Used to seed the assignee when creating a QA sub-task under an improvement:
 * the person who asked for the change is usually the one who should verify it.
 * Only a default, never enforced — across the eight most recent QA sub-tasks on
 * DT, Bimo picked the reporter four times and someone else the other four.
 */
export async function fetchReporter(issueKey: string): Promise<JiraUser | null> {
  const raw = await jiraFetch<RawIssue>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=reporter`,
  );
  const reporter = raw.fields?.reporter;
  if (!reporter?.accountId) return null;
  return { accountId: reporter.accountId, displayName: reporter.displayName ?? '' };
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
  //
  // An improvement or bug I hold directly is a parent in its own right: the
  // handover puts its QA sub-task underneath it (HWE-485 under HWE-482), so it
  // has to be asked about too or the board cannot tell whether its QA exists.
  const parents = [
    ...new Set(
      mine.flatMap((issue) =>
        issue.parentKey && issue.issueType.toLowerCase() === 'sub-task'
          ? [issue.parentKey]
          : [issue.key],
      ),
    ),
  ];
  const siblings = await fetchChildren(parents);
  const doneQa = await fetchDoneQaChildren(parents);

  const byKey = new Map<string, IssueSummary>();
  for (const issue of [...mine, ...siblings, ...doneQa]) byKey.set(issue.key, issue);
  return [...byKey.values()];
}

/**
 * Finished QA sub-tasks under these parents.
 *
 * The board hides Done work, but the "chưa có QA" badge has to know about a QA
 * task the BA has already passed — otherwise a story that finished its round
 * still reads as missing its QA. Only QA is carried back in; finished FE and BE
 * sub-tasks stay hidden, which is what keeps the board readable (HWE-31 has 14
 * children, 10 of them closed).
 *
 * Filtering happens here rather than in JQL. `summary ~ "QA"` looks like the
 * obvious clause but silently misses the current naming: Jira's text index
 * treats `QA_260827` as one token, so it matches `[QA] ...` and drops
 * `QA_260827: ...`. Verified on live data — it found 3 of the 5 QA sub-tasks
 * and missed HWE-340 and HWE-343. A missed QA is the one failure that matters,
 * because it makes the badge claim a story has no QA when it does.
 */
async function fetchDoneQaChildren(parentKeys: string[]): Promise<IssueSummary[]> {
  if (parentKeys.length === 0) return [];
  const list = parentKeys.map((key) => `"${key}"`).join(', ');
  const done = await searchAll(
    `parent IN (${list}) AND statusCategory = Done ORDER BY created ASC`,
  );
  return done.filter((issue) => QA_TITLE.test(issue.summary));
}

/** `QA_260921:`, `[QA] ...` — both title shapes are live. See CLAUDE.md §1b. */
const QA_TITLE = /^\s*\[?\s*QA\s*(?:[_:\]]|$)/i;

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

/**
 * Hand several issues to one person.
 *
 * Same shape as `transitionMany` on purpose: sequential, and a failure on one
 * issue does not stop the rest. Jira rejects an assignee who lacks permission
 * on that project, so a mixed board can legitimately half-succeed.
 *
 * `accountId` of `null` clears the assignee — Jira's own "Unassigned".
 */
export async function assignMany(
  keys: string[],
  accountId: string | null,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const key of keys) {
    try {
      await assignIssue(key, accountId);
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

/**
 * Set one issue's assignee.
 *
 * Uses the dedicated `/assignee` endpoint rather than a field edit: it is the
 * one Jira permits with only "Assign issues", without needing "Edit issues".
 */
export async function assignIssue(
  issueKey: string,
  accountId: string | null,
): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`, {
    method: 'PUT',
    body: { accountId },
  });
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

/**
 * The HTML of Bimo's own latest report on that issue, or null when there is
 * none to read.
 *
 * Author-filtered on purpose. Since 28/09/2026 the targets are the shared
 * `[X] Prep for Dev` tasks, where BE and mobile report too — PPP-226 had eight
 * consecutive comments from Perry and Jame and none from Bimo. Taking simply
 * the newest comment would seed the "Next task" box with a colleague's plan
 * ("Upload bản build IOS lên Testflight") and carry over their percents.
 *
 * Scans a page of recent comments rather than just one, because several people
 * report within the same hour every evening. `orderBy=-created` is newest-first
 * (verified against PPP-226), so the first match is the most recent one.
 *
 * No match is normal, not an error: Bimo had never posted on PPP-226 when the
 * targets moved there. The caller falls back to the target's default lines.
 */
async function fetchLatestReportHtml(target: ReportTarget): Promise<string | null> {
  const me = await fetchCurrentUser();
  const response = await jiraFetch<{
    comments?: { renderedBody?: string; author?: { accountId?: string } }[];
  }>(
    `/rest/api/3/issue/${encodeURIComponent(target.reportIssueKey)}/comment` +
      `?orderBy=-created&maxResults=50&expand=renderedBody`,
  );

  const mine = (response.comments ?? []).find(
    (comment) => comment.author?.accountId === me.accountId,
  );
  return mine?.renderedBody ?? null;
}

/**
 * Seed the "Next task" box and the carried-over percents from the previous
 * report on that issue.
 *
 * Both come out of the same comment, so they are read in one request. A task
 * still in progress is opened at the figure it was last reported at: yesterday
 * said 70%, today starts at 70% for Bimo to raise to 80%, instead of snapping
 * back to the status default.
 */
export async function fetchPreviousReport(
  target: ReportTarget,
): Promise<{ nextTasks: string[]; percents: Record<string, number> }> {
  const html = await fetchLatestReportHtml(target);
  if (!html) return { nextTasks: target.defaultNextTasks, percents: {} };

  const parsed = parseNextTasks(html);
  return {
    nextTasks: parsed.length > 0 ? parsed : target.defaultNextTasks,
    percents: Object.fromEntries(parseTaskPercents(html)),
  };
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
  };
}

/**
 * Tell the channel the report is up.
 *
 * Deliberately not part of `postReport`: a working day usually means reporting
 * both projects, and the message announces the day's reporting, not one issue.
 * Firing it per report would ping the channel twice for one piece of news, so
 * the UI keeps it as its own button and Bimo sends it once at the end.
 *
 * A failure is returned rather than thrown — the Jira comment it announces is
 * already posted and cannot be taken back.
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
