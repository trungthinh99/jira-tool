import { Router, type Request, type Response, type NextFunction } from 'express';
import { config, findTarget, REPORT_TARGETS, slackEnabled, type Mention } from './config.js';
import {
  buildReport,
  createSubtask,
  assignMany,
  fetchCurrentUser,
  fetchDayActivity,
  fetchHandoverBoard,
  fetchInbox,
  fetchMentionableUsers,
  fetchPreviousReport,
  fetchReporter,
  fetchStoryHeadings,
  fetchTransitions,
  pingSlack,
  postReport,
  transitionIssue,
  transitionMany,
} from './jira/service.js';
import { suggestQaTitle } from './jira/suggest.js';
import type { ReportInput, TodayTaskLine } from './jira/adf.js';
import { reactToSubtaskMessages } from './slack/client.js';

export const routes = Router();

/** Wrap an async handler so a rejection reaches the error middleware. */
function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

routes.get('/health', (_req, res) => {
  res.json({ ok: true, site: config.jira.site });
});

/** The UI reads its tabs, mention defaults and report issues from here. */
routes.get(
  '/targets',
  handle(async (_req, res) => {
    res.json(
      REPORT_TARGETS.map((t) => ({
        id: t.id,
        label: t.label,
        projectKey: t.projectKey,
        reportIssueKey: t.reportIssueKey,
        reportIssueUrl: `https://${config.jira.site}/browse/${t.reportIssueKey}`,
        mentions: t.mentions,
        defaultNextTasks: t.defaultNextTasks,
      })),
    );
  }),
);

routes.get(
  '/inbox',
  handle(async (_req, res) => {
    res.json({ issues: await fetchInbox() });
  }),
);

/** Who the token belongs to, so the UI can mark one assignee as "tôi". */
routes.get(
  '/me',
  handle(async (_req, res) => {
    res.json({ user: await fetchCurrentUser() });
  }),
);

routes.get(
  '/activity',
  handle(async (req, res) => {
    const date = String(req.query['date'] ?? '');
    if (!DATE_PATTERN.test(date)) {
      res.status(400).json({ error: 'Query param "date" must be YYYY-MM-DD.' });
      return;
    }
    res.json({ date, issues: await fetchDayActivity(date) });
  }),
);

/** Seeds for a new report: last report's "Next task" lines and its percents. */
routes.get(
  '/targets/:id/previous-next-tasks',
  handle(async (req, res) => {
    const target = findTarget(String(req.params['id']));
    if (!target) {
      res.status(404).json({ error: 'Unknown report target.' });
      return;
    }
    res.json(await fetchPreviousReport(target));
  }),
);

/** Candidates for the mention picker, scoped to this target's report issue. */
routes.get(
  '/targets/:id/users',
  handle(async (req, res) => {
    const target = findTarget(String(req.params['id']));
    if (!target) {
      res.status(404).json({ error: 'Unknown report target.' });
      return;
    }
    res.json({ users: await fetchMentionableUsers(target.reportIssueKey) });
  }),
);

/** Menu 3 — every unfinished sub-task under the stories I am working on. */
routes.get(
  '/targets/:id/handover',
  handle(async (req, res) => {
    const target = findTarget(String(req.params['id']));
    if (!target) {
      res.status(404).json({ error: 'Unknown report target.' });
      return;
    }
    res.json({ issues: await fetchHandoverBoard(target.projectKey) });
  }),
);

/** Bulk status change. Reports per-issue results so a partial run is visible. */
routes.post(
  '/issues/transition-many',
  handle(async (req, res) => {
    const body = req.body as { keys?: unknown; toStatus?: unknown };
    const toStatus = String(body?.toStatus ?? '').trim();
    if (!toStatus) {
      res.status(400).json({ error: 'Body field "toStatus" is required.' });
      return;
    }
    if (!Array.isArray(body?.keys) || body.keys.length === 0) {
      res.status(400).json({ error: 'Body field "keys" must be a non-empty array.' });
      return;
    }
    const keys = body.keys.map((key) => String(key).trim()).filter(Boolean);
    res.json({ results: await transitionMany(keys, toStatus) });
  }),
);

/**
 * Bulk assign. `accountId` is required but may be null, which unassigns — the
 * distinction matters, so a missing field is an error rather than a silent
 * "clear the assignee".
 */
routes.post(
  '/issues/assign-many',
  handle(async (req, res) => {
    const body = req.body as { keys?: unknown; accountId?: unknown };
    if (!Array.isArray(body?.keys) || body.keys.length === 0) {
      res.status(400).json({ error: 'Body field "keys" must be a non-empty array.' });
      return;
    }
    if (body.accountId !== null && typeof body.accountId !== 'string') {
      res.status(400).json({ error: 'Body field "accountId" must be a string or null.' });
      return;
    }
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : null;
    const keys = body.keys.map((key) => String(key).trim()).filter(Boolean);
    res.json({ results: await assignMany(keys, accountId || null) });
  }),
);

routes.post(
  '/issues/:key/subtasks',
  handle(async (req, res) => {
    const body = req.body as { summary?: unknown; assigneeAccountId?: unknown };
    const summary = String(body?.summary ?? '').trim();
    if (!summary) {
      res.status(400).json({ error: 'Body field "summary" is required.' });
      return;
    }
    const assigneeAccountId = String(body?.assigneeAccountId ?? '').trim();
    const issue = await createSubtask({
      parentKey: String(req.params['key']),
      summary,
      ...(assigneeAccountId ? { assigneeAccountId } : {}),
    });
    res.json({ issue });
  }),
);

/**
 * What to seed the "create QA sub-task" dialog with.
 *
 * Two things at once so the dialog waits on one round trip rather than two:
 * the AI's suggested wording (often absent — see `suggestQaTitle`) and the
 * issue's reporter, used as the assignee default.
 *
 * Never fails the request over the AI: a missing suggestion is the normal case
 * and the dialog has its own default title to fall back on. The reporter is
 * treated the same way, so one broken lookup cannot block creating a QA task.
 */
routes.get(
  '/issues/:key/qa-seed',
  handle(async (req, res) => {
    const key = String(req.params['key']);
    const [suggestion, reporter] = await Promise.all([
      suggestQaTitle(key).catch(() => null),
      fetchReporter(key).catch(() => null),
    ]);
    res.json({ suggestion, reporter });
  }),
);

/**
 * Every `[New]` / `[Update N]` heading in a story's description.
 *
 * Kept apart from `qa-seed` on purpose: a story never asks the AI (its
 * sub-tasks already carry wording to name a QA from, and its description stacks
 * months of `[Update N]` blocks the AI summarises the wrong one of), so routing
 * it through that endpoint would buy a 6–10s wait for an answer it discards.
 * This is one small read instead.
 *
 * Answers an empty list rather than 404 when there is no heading — six of the
 * seventeen open stories have none, which is ordinary.
 */
routes.get(
  '/issues/:key/story-headings',
  handle(async (req, res) => {
    const key = String(req.params['key']);
    res.json({ headings: await fetchStoryHeadings(key).catch(() => []) });
  }),
);

routes.get(
  '/issues/:key/transitions',
  handle(async (req, res) => {
    res.json({ transitions: await fetchTransitions(String(req.params['key'])) });
  }),
);

routes.post(
  '/issues/:key/transition',
  handle(async (req, res) => {
    const toStatus = String((req.body as { toStatus?: unknown })?.toStatus ?? '');
    if (!toStatus) {
      res.status(400).json({ error: 'Body field "toStatus" is required.' });
      return;
    }
    await transitionIssue(String(req.params['key']), toStatus);
    res.json({ ok: true });
  }),
);

interface ReportBody {
  dateLabel?: unknown;
  todayTasks?: unknown;
  nextTasks?: unknown;
  issue?: unknown;
  mentions?: unknown;
}

/**
 * Validate a report payload into the shape the ADF builder needs. Returns a
 * readable message instead of throwing, so both the preview and the post route
 * can answer 400 with the same wording.
 */
function readReportBody(
  targetId: string,
  body: ReportBody,
): { ok: true; input: ReportInput } | { ok: false; error: string } {
  const target = findTarget(targetId);
  if (!target) return { ok: false, error: 'Unknown report target.' };

  const dateLabel = String(body.dateLabel ?? '').trim();
  if (!dateLabel) return { ok: false, error: 'Field "dateLabel" is required.' };

  if (!Array.isArray(body.todayTasks) || body.todayTasks.length === 0) {
    return { ok: false, error: 'At least one task is required in "todayTasks".' };
  }

  const todayTasks: TodayTaskLine[] = [];
  for (const entry of body.todayTasks) {
    const key = String((entry as { key?: unknown })?.key ?? '').trim();
    const percent = Number((entry as { percent?: unknown })?.percent);
    const summary = String((entry as { summary?: unknown })?.summary ?? '').trim();
    if (!key) return { ok: false, error: 'Every task needs a "key".' };
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { ok: false, error: `Percent for ${key} must be between 0 and 100.` };
    }
    todayTasks.push({ key, percent: Math.round(percent), ...(summary ? { summary } : {}) });
  }

  const nextTasks = Array.isArray(body.nextTasks)
    ? body.nextTasks.map((line) => String(line).trim()).filter(Boolean)
    : [];
  if (nextTasks.length === 0) {
    return { ok: false, error: 'At least one line is required in "nextTasks".' };
  }

  const issue = String(body.issue ?? '').trim() || 'none';

  // Mentions are chosen in the UI, seeded from the target. An absent field
  // falls back to the configured list so an older client still reports
  // correctly; an explicit empty array means the user cleared it on purpose.
  let mentions: Mention[] = target.mentions;
  if (Array.isArray(body.mentions)) {
    mentions = [];
    for (const entry of body.mentions) {
      const accountId = String((entry as { accountId?: unknown })?.accountId ?? '').trim();
      const name = String((entry as { name?: unknown })?.name ?? '').trim();
      if (!accountId || !name) {
        return { ok: false, error: 'Mỗi mention cần "accountId" và "name".' };
      }
      if (!mentions.some((m) => m.accountId === accountId)) {
        mentions.push({ accountId, name });
      }
    }
  }

  return {
    ok: true,
    input: {
      dateLabel,
      todayTasks,
      nextTasks,
      issue,
      mentions,
      site: config.jira.site,
    },
  };
}

routes.post(
  '/targets/:id/preview',
  handle(async (req, res) => {
    const parsed = readReportBody(String(req.params['id']), req.body as ReportBody);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.json(buildReport(parsed.input));
  }),
);

routes.post(
  '/targets/:id/report',
  handle(async (req, res) => {
    const id = String(req.params['id']);
    const parsed = readReportBody(id, req.body as ReportBody);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const target = findTarget(id)!;
    res.json(await postReport(target, parsed.input));
  }),
);

/** Whether the UI should offer the Slack button at all. */
routes.get(
  '/slack',
  handle(async (_req, res) => {
    res.json({ enabled: slackEnabled(), message: config.slack.message });
  }),
);

/**
 * Send the Slack ping.
 *
 * Its own route because one working day usually means two reports (HWE and
 * TMS) but only one message — see `pingSlack()`. Bimo posts each report, then
 * sends this once.
 */
routes.post(
  '/slack/ping',
  handle(async (_req, res) => {
    res.json({ slack: await pingSlack() });
  }),
);

/**
 * React to Jame's recent "em đã tạo sub-task" messages.
 *
 * A write to Slack, but a reversible one — and unlike the report ping it reads
 * the channel first, so it needs scopes beyond `chat:write`. A missing scope
 * surfaces as a plain error naming what to add.
 */
routes.post(
  '/slack/react',
  handle(async (_req, res) => {
    res.json({ result: await reactToSubtaskMessages() });
  }),
);
