import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type {
  IssueSummary,
  PostedReport,
  ReportPayload,
  ReportTarget,
  SlackConfig,
  SlackPing,
  SlackReact,
} from '../api/types';
import { Badge, Button, Card, CardHeader, ErrorBanner, Spinner } from '../components/ui';
import { cn, defaultPercent, toIsoDate, toReportDate } from '../utils';
import { ReportForm } from './ReportForm';

export function ReportPage({ targets }: { targets: ReportTarget[] }) {
  const [isoDate, setIsoDate] = useState(() => toIsoDate(new Date()));
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(targets[0]?.id ?? '');

  /**
   * Reports posted today, by target id.
   *
   * Lives here rather than in `ReportForm` because the form is remounted on
   * every tab switch: the Slack button needs to know that HWE is already
   * reported while TMS is on screen.
   */
  const [postedByTarget, setPostedByTarget] = useState<Map<string, PostedReport>>(new Map());
  const [slack, setSlack] = useState<SlackConfig | null>(null);
  const [slackPing, setSlackPing] = useState<SlackPing | null>(null);
  const [pinging, setPinging] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  const [reactResult, setReactResult] = useState<SlackReact | null>(null);
  /**
   * The open tab's payload as it currently reads on screen.
   *
   * The bulk action rebuilds the other projects from defaults, but the one
   * being looked at may have had its percents corrected or a row unticked —
   * posting the default over those edits would quietly throw them away.
   */
  const [liveDraft, setLiveDraft] = useState<ReportPayload | null>(null);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const { issues: fetched } = await api.activity(date);
      setIssues(fetched);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thống kê được.');
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(isoDate);
  }, [isoDate, load]);

  // A new day is a new round of reporting — nothing posted, nothing announced.
  useEffect(() => {
    setPostedByTarget(new Map());
    setSlackPing(null);
  }, [isoDate]);

  // Slack is optional; without it configured the button never appears.
  useEffect(() => {
    let cancelled = false;
    api
      .slackConfig()
      .then((config) => {
        if (!cancelled) setSlack(config);
      })
      .catch(() => {
        if (!cancelled) setSlack({ enabled: false, message: '' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendSlack = async () => {
    setPinging(true);
    try {
      const { slack: result } = await api.pingSlack();
      setSlackPing(result);
    } catch (caught) {
      setSlackPing({
        sent: false,
        skipped: false,
        error: caught instanceof Error ? caught.message : 'Không gửi được Slack.',
      });
    } finally {
      setPinging(false);
    }
  };

  /**
   * Answer Jame's sub-task announcements on Slack.
   *
   * Nothing to do with the report — it is here because this is the screen
   * already about "the day's Slack chores", and because the backend holds the
   * token. The result is counted rather than listed: the messages are in Slack,
   * where they are already visible.
   */
  const reactSlack = async () => {
    setReacting(true);
    setReactResult(null);
    try {
      const { result } = await api.reactSlack();
      setReactResult(result);
    } catch (caught) {
      setReactResult({
        reacted: 0,
        skipped: 0,
        errors: [caught instanceof Error ? caught.message : 'Không react được.'],
      });
    } finally {
      setReacting(false);
    }
  };

  /**
   * The day's report payload for one target, built without its form.
   *
   * `ReportForm` is remounted per tab, so only the project on screen has a
   * form holding its rows, its "Next task" lines and its mentions. The bulk
   * action has to report the others too, so it rebuilds their payloads the
   * same way the form seeds itself: today's activity for that project at the
   * default percent, the previous report's "Next task" carried forward, and
   * the target's own mentions.
   *
   * That makes the bulk button report the *defaults*, not hand-edited values —
   * which is why the per-project button stays. Edits on the open tab are the
   * one exception: `liveDraft` passes them through so the tab being looked at
   * goes out as it reads on screen.
   */
  const buildPayload = useCallback(
    async (target: ReportTarget, rows: IssueSummary[]): Promise<ReportPayload | null> => {
      if (rows.length === 0) return null;

      // Same source the form uses, and the same fallback when the previous
      // report cannot be read — a target with no comment of Bimo's is ordinary.
      let nextTasks = target.defaultNextTasks;
      let percents: Record<string, number> = {};
      try {
        const previous = await api.previousReport(target.id);
        if (previous.nextTasks.length > 0) nextTasks = previous.nextTasks;
        percents = previous.percents;
      } catch {
        // Keep the configured default.
      }

      return {
        dateLabel: toReportDate(isoDate),
        todayTasks: rows.map((issue) => ({
          key: issue.key,
          percent: (issue.wip ? percents[issue.key] : undefined) ?? defaultPercent(issue),
          summary: issue.summary,
        })),
        nextTasks,
        issue: 'none',
        mentions: target.mentions,
      };
    },
    [isoDate],
  );

  /**
   * Report every project that has tasks today, then announce it on Slack.
   *
   * The day's work usually spans two or three projects, each needing the same
   * three clicks on its own tab. This does the lot: one comment per project
   * with tasks, then a single Slack message for the day — not one per project,
   * which is the whole reason the Slack button was split out (CLAUDE.md §3).
   *
   * Posts one at a time rather than `Promise.all`: these are real writes to
   * Jira, and serial keeps them readable in the issue history and clear of
   * rate limits — the same rule the QA dialog follows.
   */
  const reportAll = async () => {
    const pending = targets.filter((target) => (byTarget.get(target.id) ?? []).length > 0);
    if (pending.length === 0) return;

    setBulkBusy(true);
    setBulkError(null);
    const failed: string[] = [];
    let done = 0;

    for (const target of pending) {
      try {
        const draft =
          target.id === active?.id && liveDraft ? liveDraft : null;
        const payload = draft ?? (await buildPayload(target, byTarget.get(target.id) ?? []));
        if (!payload || payload.todayTasks.length === 0 || payload.nextTasks.length === 0) {
          failed.push(`${target.label}: thiếu task hoặc Next task`);
          continue;
        }
        const result = await api.postReport(target.id, payload);
        setPostedByTarget((current) => new Map(current).set(target.id, result));
        done += 1;
      } catch (caught) {
        failed.push(
          `${target.label}: ${caught instanceof Error ? caught.message : 'lỗi không rõ'}`,
        );
      }
    }

    // Slack only after the posting, and only if something was actually
    // reported — announcing "em báo cáo rồi" when every post failed would be
    // telling the channel about work that is not there.
    if (done > 0 && slack?.enabled) await sendSlack();

    if (failed.length > 0) {
      setBulkError(`Đăng được ${done}/${pending.length} báo cáo. Lỗi — ${failed.join(' · ')}`);
    }
    setBulkBusy(false);
  };

  const byTarget = useMemo(() => {
    const map = new Map<string, IssueSummary[]>();
    for (const target of targets) {
      map.set(
        target.id,
        issues.filter((issue) => issue.projectKey === target.projectKey),
      );
    }
    return map;
  }, [issues, targets]);

  const active = targets.find((target) => target.id === activeId) ?? targets[0];

  /** Projects with something to report today — what the bulk button covers. */
  const reportable = useMemo(
    () => targets.filter((target) => (byTarget.get(target.id) ?? []).length > 0),
    [targets, byTarget],
  );

  // Issues from a project no report covers would otherwise vanish silently.
  const uncovered = useMemo(() => {
    const covered = new Set(targets.map((target) => target.projectKey));
    return issues.filter((issue) => !covered.has(issue.projectKey));
  }, [issues, targets]);

  const shiftDay = (days: number) => {
    const date = new Date(`${isoDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    setIsoDate(toIsoDate(date));
  };

  if (!active) return <ErrorBanner message="Chưa cấu hình report target nào." />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Báo cáo hàng ngày"
          subtitle="Thống kê các task đã đổi trạng thái trong ngày, theo từng dự án."
          actions={
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => shiftDay(-1)} title="Ngày trước">
                ‹
              </Button>
              <input
                type="date"
                value={isoDate}
                onChange={(event) => setIsoDate(event.target.value)}
                className="h-7 rounded border border-line bg-raised px-2 text-xs [color-scheme:dark]"
              />
              <Button size="sm" variant="ghost" onClick={() => shiftDay(1)} title="Ngày sau">
                ›
              </Button>
              <Button size="sm" onClick={() => setIsoDate(toIsoDate(new Date()))}>
                Hôm nay
              </Button>
              <Button size="sm" onClick={() => void load(isoDate)} disabled={loading}>
                Làm mới
              </Button>
            </div>
          }
        />

        <nav className="flex items-center gap-1 px-4 py-2">
          {targets.map((target) => {
            const count = byTarget.get(target.id)?.length ?? 0;
            return (
              <button
                key={target.id}
                onClick={() => setActiveId(target.id)}
                className={cn(
                  'flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition',
                  target.id === active.id
                    ? 'bg-brand-soft text-brand'
                    : 'text-muted hover:bg-raised hover:text-ink',
                )}
              >
                {target.label}
                <Badge tone={target.id === active.id ? 'brand' : 'neutral'}>{count}</Badge>
                {postedByTarget.has(target.id) ? (
                  <span className="text-success" title="Đã đăng báo cáo">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
          {/* Up here rather than under the preview: it acts on every project,
              so it does not belong beside one project's preview text — and it
              needs no preview built first, since it composes each report
              itself. */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted">→ {active.reportIssueKey}</span>
            <Button
              size="sm"
              variant="primary"
              disabled={bulkBusy || reportable.length === 0}
              title={
                reportable.length > 0
                  ? `Đăng báo cáo cho ${reportable
                      .map((target) => target.label)
                      .join(', ')} rồi nhắn Slack`
                  : 'Chưa dự án nào có task trong ngày'
              }
              onClick={() => void reportAll()}
            >
              {bulkBusy
                ? 'Đang đăng…'
                : `DM & Report all project${
                    reportable.length > 1 ? ` (${reportable.length})` : ''
                  }`}
            </Button>
            {slack?.enabled ? (
              <Button
                size="sm"
                disabled={reacting}
                title="Thả reaction vào các tin 'em đã tạo sub-task' của Jame trong 2 ngày gần đây"
                onClick={() => void reactSlack()}
              >
                {reacting ? 'Đang react…' : 'React slack'}
              </Button>
            ) : null}
          </div>
        </nav>

        {reactResult ? (
          <p className="px-4 pb-2 text-xs">
            {reactResult.errors.length > 0 ? (
              <span className="text-danger">{reactResult.errors.join(' · ')}</span>
            ) : (
              <span className="text-success">
                ✓ Đã react {reactResult.reacted} tin
                {reactResult.skipped > 0 ? `, bỏ qua ${reactResult.skipped} tin đã react` : ''}.
              </span>
            )}
          </p>
        ) : null}

        {bulkError ? (
          <p className="px-4 pb-2 text-xs text-danger">{bulkError}</p>
        ) : null}
      </Card>

      {error ? <ErrorBanner message={error} onRetry={() => void load(isoDate)} /> : null}

      {uncovered.length > 0 ? (
        <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {uncovered.length} task thuộc dự án chưa cấu hình báo cáo (
          {[...new Set(uncovered.map((issue) => issue.projectKey))].join(', ')}) — không nằm
          trong tab nào.
        </div>
      ) : null}

      {loading && issues.length === 0 ? (
        <Card>
          <Spinner label="Đang thống kê task trong ngày…" />
        </Card>
      ) : (
        <ReportForm
          key={`${active.id}-${isoDate}`}
          target={active}
          issues={byTarget.get(active.id) ?? []}
          isoDate={isoDate}
          loadingIssues={loading}
          posted={postedByTarget.get(active.id) ?? null}
          onPosted={(result) =>
            setPostedByTarget((current) => new Map(current).set(active.id, result))
          }
          onDraftChange={setLiveDraft}
          slack={
            // One message for the whole day, not one per project — so the
            // button lives under "Đăng báo cáo" but its state belongs to the
            // page, which survives the tab switch that remounts this form.
            slack?.enabled
              ? { message: slack.message, ping: slackPing, pinging, onSend: sendSlack }
              : null
          }
        />
      )}

    </div>
  );
}
