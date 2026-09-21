import { Router, type Request, type Response, type NextFunction } from 'express';
import { config, findTarget, REPORT_TARGETS } from './config.js';
import {
  buildReport,
  fetchDayActivity,
  fetchInbox,
  fetchPreviousNextTasks,
  fetchTransitions,
  postReport,
  transitionIssue,
} from './jira/service.js';
import type { ReportInput, TodayTaskLine } from './jira/adf.js';

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

routes.get(
  '/targets/:id/previous-next-tasks',
  handle(async (req, res) => {
    const target = findTarget(String(req.params['id']));
    if (!target) {
      res.status(404).json({ error: 'Unknown report target.' });
      return;
    }
    res.json({ nextTasks: await fetchPreviousNextTasks(target) });
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
    if (!key) return { ok: false, error: 'Every task needs a "key".' };
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { ok: false, error: `Percent for ${key} must be between 0 and 100.` };
    }
    todayTasks.push({ key, percent: Math.round(percent) });
  }

  const nextTasks = Array.isArray(body.nextTasks)
    ? body.nextTasks.map((line) => String(line).trim()).filter(Boolean)
    : [];
  if (nextTasks.length === 0) {
    return { ok: false, error: 'At least one line is required in "nextTasks".' };
  }

  const issue = String(body.issue ?? '').trim() || 'none';

  return {
    ok: true,
    input: {
      dateLabel,
      todayTasks,
      nextTasks,
      issue,
      mentions: target.mentions,
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
